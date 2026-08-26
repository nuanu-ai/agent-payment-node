import { hashObject } from "./canonical.js";
import { APPROVAL_WINDOW_MS, BASE_USDC, CHAIN_ID, STATE_VERSION, USDC_DECIMALS } from "./constants.js";
import { ApnError } from "./errors.js";
import { parseAtomic, parseDecimal } from "./money.js";
import { appendTransition, sealOperation, sealReceipt } from "./state.js";
import { canonicalAddress, canonicalIdempotencyKey, canonicalOperationId, hasExactTransfer, parseEffect, publicOperation, publicReceipt, requireFunding, transferData, validateBalance, validateEconomics, verifyEffect, } from "./transfer-policy.js";
import { canonicalProfile } from "./wallet-policy.js";
export class TransferService {
    context;
    constructor(context) {
        this.context = context;
    }
    async prepare(request) {
        const profile = canonicalProfile(request.profile);
        const idempotencyKey = canonicalIdempotencyKey(request.idempotencyKey);
        const recipient = canonicalAddress(request.recipient);
        const amount = parseDecimal(request.amount, USDC_DECIMALS, { positive: true });
        await this.context.ready();
        const state = this.context.state;
        const profileHash = state.profileHash(profile);
        const operationId = state.operationId(profile, idempotencyKey);
        const idempotencyHash = state.idempotencyHash(idempotencyKey);
        const materialRequest = {
            method: "pay.transfer",
            profile,
            chainId: CHAIN_ID,
            token: BASE_USDC,
            recipient,
            amountAtomic: amount.atomic,
        };
        const requestHash = hashObject(materialRequest);
        return await state.withLocks([`profile:${profileHash}`, `operation:${operationId}`], async () => {
            const existing = await state.loadOperation(profileHash, operationId);
            if (existing !== null) {
                if (existing.requestHash !== requestHash) {
                    throw new ApnError("APN_IDEMPOTENCY_CONFLICT", "Idempotency key is already bound to different transfer inputs.");
                }
                return publicOperation(existing);
            }
            const other = (await state.listOperations(profileHash)).find((operation) => !operation.terminal);
            if (other !== undefined) {
                throw new ApnError("APN_OPERATION_BLOCKED", "Another transfer for this profile is not terminal.", {
                    blockingOperationId: other.operationId,
                    blockingState: other.state,
                });
            }
            const wallet = await state.loadWallet(profileHash);
            if (wallet === null)
                throw new ApnError("APN_OPERATION_BLOCKED", "Wallet is not initialized.");
            const rpc = this.context.requireRpc();
            await rpc.assertBaseChain();
            const data = transferData(recipient, amount.atomic);
            const [balances, nonceAtomic, fees] = await Promise.all([
                rpc.getBalances(wallet.address),
                rpc.getPendingNonce(wallet.address),
                rpc.estimateDirectTransfer({ from: wallet.address, to: BASE_USDC, data }),
            ]);
            validateBalance(balances, wallet.address);
            const economics = validateEconomics(nonceAtomic, fees);
            requireFunding(balances, amount.atomic, economics.maximumGasCostAtomic);
            const preparedAt = new Date(Math.floor(this.context.clock.now().getTime() / 1000) * 1000);
            const expiresAt = new Date(preparedAt.getTime() + APPROVAL_WINDOW_MS);
            const fingerprint = hashObject({
                method: materialRequest.method,
                operationId,
                profile,
                chainId: CHAIN_ID,
                token: BASE_USDC,
                walletAddress: wallet.address,
                recipient,
                amountAtomic: amount.atomic,
                transactionData: data,
                economics,
                preparedAt: preparedAt.toISOString(),
                expiresAt: expiresAt.toISOString(),
            });
            const initial = {
                at: preparedAt.toISOString(),
                state: "awaiting_approval",
                terminal: false,
                reason: "prepared_and_frozen",
                proofClass: "durable_pre_effect",
            };
            const operation = sealOperation({
                schemaVersion: STATE_VERSION,
                operationId,
                idempotencyHash,
                profile,
                profileHash,
                requestHash,
                fingerprint,
                walletAddress: wallet.address,
                recipient,
                amountAtomic: amount.atomic,
                amountDecimal: amount.decimal,
                chainId: CHAIN_ID,
                token: BASE_USDC,
                transactionData: data,
                economics,
                preparedAt: preparedAt.toISOString(),
                preparedBlockNumberAtomic: balances.blockNumberAtomic,
                expiresAt: expiresAt.toISOString(),
                state: initial.state,
                terminal: initial.terminal,
                reason: initial.reason,
                proofClass: initial.proofClass,
                transitions: appendTransition([], initial),
            });
            await this.persist(operation);
            return publicOperation(operation);
        });
    }
    async approve(operationIdInput) {
        const operationId = canonicalOperationId(operationIdInput);
        await this.context.ready();
        const found = await this.requiredOperation(operationId);
        const { profile, profileHash } = found;
        return await this.context.state.withLocks([`profile:${profileHash}`, `operation:${operationId}`], async () => {
            let operation = await this.requiredOperation(operationId);
            if (operation.terminal)
                return publicOperation(operation);
            if (operation.state !== "awaiting_approval") {
                throw new ApnError("APN_OPERATION_BLOCKED", "Operation is already signed; use operation resume.");
            }
            if (this.context.clock.now().getTime() >= Date.parse(operation.expiresAt)) {
                await this.failBeforeEffect(operation, "approval_window_expired");
            }
            const rpc = this.context.requireRpc();
            await rpc.assertBaseChain();
            const [balances, nonceAtomic, currentFees] = await Promise.all([
                rpc.getBalances(operation.walletAddress),
                rpc.getPendingNonce(operation.walletAddress),
                rpc.estimateDirectTransfer({ from: operation.walletAddress, to: BASE_USDC, data: operation.transactionData }),
            ]);
            validateBalance(balances, operation.walletAddress);
            if (parseAtomic(nonceAtomic).toString() !== operation.economics.nonceAtomic) {
                await this.failBeforeEffect(operation, "pending_nonce_changed");
            }
            try {
                requireFunding(balances, operation.amountAtomic, operation.economics.maximumGasCostAtomic);
            }
            catch (error) {
                if (error instanceof ApnError && ["APN_INSUFFICIENT_USDC", "APN_INSUFFICIENT_GAS"].includes(error.code)) {
                    await this.failBeforeEffect(operation, "funding_changed");
                }
                throw error;
            }
            const fresh = validateEconomics(nonceAtomic, currentFees);
            if (fresh.gasLimitAtomic !== operation.economics.gasLimitAtomic ||
                fresh.maxFeePerGasAtomic !== operation.economics.maxFeePerGasAtomic ||
                fresh.maxPriorityFeePerGasAtomic !== operation.economics.maxPriorityFeePerGasAtomic)
                await this.failBeforeEffect(operation, "fee_economics_changed");
            const effect = parseEffect(await this.context.requireNative().request(this.context.nativeRequest("directTransfer.approveAndSign", {
                profile,
                operationId: operation.operationId,
                fingerprint: operation.fingerprint,
                walletAddress: operation.walletAddress,
                chainId: CHAIN_ID,
                transaction: {
                    type: "eip1559",
                    to: BASE_USDC,
                    valueAtomic: "0",
                    data: operation.transactionData,
                    nonceAtomic: operation.economics.nonceAtomic,
                    gasLimitAtomic: operation.economics.gasLimitAtomic,
                    maxFeePerGasAtomic: operation.economics.maxFeePerGasAtomic,
                    maxPriorityFeePerGasAtomic: operation.economics.maxPriorityFeePerGasAtomic,
                    accessList: [],
                },
                approval: {
                    recipient: operation.recipient,
                    amountAtomic: operation.amountAtomic,
                    amountDecimal: operation.amountDecimal,
                    expiresAt: operation.expiresAt,
                },
            })));
            await verifyEffect(effect, operation);
            operation = await this.transition(operation, "signed_not_submitted", false, "native_effect_material_bound", "native_transaction_hash", { transactionHash: effect.transactionHash, rawTransactionHash: effect.rawTransactionHash });
            operation = await this.submitAndInspect(operation, effect.rawTransaction);
            return publicOperation(operation);
        });
    }
    async resume(operationIdInput) {
        const operationId = canonicalOperationId(operationIdInput);
        await this.context.ready();
        const found = await this.requiredOperation(operationId);
        const { profile, profileHash } = found;
        return await this.context.state.withLocks([`profile:${profileHash}`, `operation:${operationId}`], async () => {
            let operation = await this.requiredOperation(operationId);
            if (operation.terminal)
                return publicOperation(operation);
            if (operation.state === "awaiting_approval") {
                throw new ApnError("APN_OPERATION_BLOCKED", "Operation still requires transfer approve.");
            }
            if (operation.transactionHash === undefined || operation.rawTransactionHash === undefined) {
                throw new ApnError("APN_STATE_CORRUPT", "Signed operation is missing its public effect binding.");
            }
            operation = await this.inspectReceipt(operation, this.context.requireRpc());
            if (operation.terminal)
                return publicOperation(operation);
            const superseding = await this.proveSuperseding(operation, this.context.requireRpc());
            if (superseding !== null)
                return publicOperation(superseding);
            const effect = parseEffect(await this.context.requireNative().request(this.context.nativeRequest("effectMaterial.get", {
                profile,
                operationId: operation.operationId,
                fingerprint: operation.fingerprint,
                expectedTransactionHash: operation.transactionHash,
                expectedRawTransactionHash: operation.rawTransactionHash,
            })));
            await verifyEffect(effect, operation);
            if (effect.transactionHash !== operation.transactionHash || effect.rawTransactionHash !== operation.rawTransactionHash) {
                throw new ApnError("APN_NATIVE_PROTOCOL", "Recovered effect material differs from the durable binding.");
            }
            operation = await this.submitAndInspect(operation, effect.rawTransaction);
            return publicOperation(operation);
        });
    }
    async status(operationIdInput) {
        await this.context.ready();
        return publicOperation(await this.requiredOperation(canonicalOperationId(operationIdInput)));
    }
    async receipt(operationIdInput) {
        await this.context.ready();
        const operationId = canonicalOperationId(operationIdInput);
        const operation = await this.requiredOperation(operationId);
        const receipt = await this.context.state.loadReceipt(operation.profileHash, operationId);
        if (receipt === null)
            throw new ApnError("APN_RECEIPT_NOT_FOUND", "Durable receipt is not available.");
        if (receipt.operationIntegrityHash !== operation.integrityHash) {
            throw new ApnError("APN_STATE_CORRUPT", "Receipt is not linked to the current operation transition.");
        }
        return publicReceipt(receipt);
    }
    async submitAndInspect(operationInput, rawTransaction) {
        let operation = operationInput;
        const rpc = this.context.requireRpc();
        try {
            const returnedHash = await rpc.submitRawTransaction(rawTransaction);
            if (returnedHash.toLowerCase() !== operation.transactionHash?.toLowerCase()) {
                return await this.transition(operation, "unknown_finality", false, "rpc_returned_different_hash", "ambiguous_submission");
            }
            operation = await this.transition(operation, "submitted_pending", false, "submission_accepted_hash_only", "transaction_hash_only", { lastSubmissionAt: this.context.clock.now().toISOString() });
        }
        catch {
            return await this.transition(operation, "unknown_finality", false, "submission_outcome_ambiguous", "ambiguous_submission", { lastSubmissionAt: this.context.clock.now().toISOString() });
        }
        return await this.inspectReceipt(operation, rpc);
    }
    async inspectReceipt(operation, rpc) {
        if (operation.transactionHash === undefined)
            return operation;
        let receipt;
        try {
            receipt = await rpc.getReceipt(operation.transactionHash);
        }
        catch {
            return operation;
        }
        if (receipt === null)
            return operation;
        if (receipt.transactionHash.toLowerCase() !== operation.transactionHash.toLowerCase()) {
            return await this.transition(operation, "unknown_finality", false, "receipt_hash_mismatch", "invalid_receipt");
        }
        if (receipt.status === "reverted") {
            return await this.transition(operation, "failed_confirmed_revert", true, "confirmed_receipt_revert", "confirmed_receipt", {}, receipt);
        }
        if (!hasExactTransfer(receipt, operation)) {
            return await this.transition(operation, "unknown_finality", false, "successful_receipt_missing_exact_transfer", "invalid_receipt", {}, receipt);
        }
        return await this.transition(operation, "completed", true, "confirmed_exact_usdc_transfer", "confirmed_receipt_and_exact_transfer_log", {}, receipt);
    }
    async proveSuperseding(operation, rpc) {
        const latest = parseAtomic(await rpc.getLatestConfirmedNonce(operation.walletAddress));
        if (latest <= parseAtomic(operation.economics.nonceAtomic))
            return null;
        const hash = await rpc.getConfirmedTransactionAtNonce(operation.walletAddress, operation.economics.nonceAtomic, operation.preparedBlockNumberAtomic);
        if (hash !== null && hash.toLowerCase() !== operation.transactionHash?.toLowerCase()) {
            return await this.transition(operation, "failed_proven_superseded", true, "confirmed_different_transaction_at_nonce", "confirmed_superseding_nonce");
        }
        return await this.transition(operation, "unknown_finality", false, hash === null ? "confirmed_nonce_advanced_unresolved" : "own_transaction_confirmed_receipt_unavailable", "manual_finality_resolution_required");
    }
    async requiredOperation(operationId) {
        const operation = await this.context.state.findOperation(operationId);
        if (operation === null)
            throw new ApnError("APN_OPERATION_NOT_FOUND", "Operation was not found.");
        return operation;
    }
    async failBeforeEffect(operation, reason) {
        await this.transition(operation, "failed_before_effect", true, reason, "durable_pre_effect_failure");
        throw new ApnError("APN_REPREPARE_REQUIRED", "Frozen transfer inputs changed before approval; prepare a new operation.");
    }
    async transition(operation, state, terminal, reason, proofClass, extra = {}, rpcReceipt) {
        const at = this.context.clock.now().toISOString();
        const transitions = appendTransition(operation.transitions, { at, state, terminal, reason, proofClass });
        const { integrityHash: _previousIntegrityHash, ...base } = operation;
        const updated = sealOperation({ ...base, ...extra, state, terminal, reason, proofClass, transitions });
        await this.persist(updated, rpcReceipt);
        return updated;
    }
    async persist(operation, rpcReceipt) {
        await this.context.state.writeOperation(operation);
        const receiptBase = {
            schemaVersion: STATE_VERSION,
            operationId: operation.operationId,
            state: operation.state,
            terminal: operation.terminal,
            reason: operation.reason,
            proofClass: operation.proofClass,
            ...(operation.transactionHash === undefined ? {} : { transactionHash: operation.transactionHash }),
            ...(rpcReceipt === undefined ? {} : {
                blockNumberAtomic: rpcReceipt.blockNumberAtomic,
                exactTransferLog: hasExactTransfer(rpcReceipt, operation),
            }),
            createdAt: this.context.clock.now().toISOString(),
            operationIntegrityHash: operation.integrityHash,
        };
        await this.context.state.writeReceipt(operation.profileHash, sealReceipt(receiptBase));
    }
}
//# sourceMappingURL=transfer-service.js.map