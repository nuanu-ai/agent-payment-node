import { TransferServiceObservation, requiredLocal } from "./transfer-service-observe.js";
import { exactKeys, hashObject, isPlainRecord } from "./canonical.js";
import { APPROVAL_WINDOW_MS, BASE_USDC, CHAIN_ID, STATE_VERSION, USDC_DECIMALS } from "./constants.js";
import { ApnError } from "./errors.js";
import { prepareEvmTransfer } from "./evm-transfer-prepare.js";
import { evmCustodyPayload } from "./evm-transfer-approval.js";
import { checkTransferApproval } from "./transfer-approval-check.js";
import { parseDecimal } from "./money.js";
import { conflictDomainKey, evmConflictDomain, storedOperationDomains } from "./operation-conflict-domain.js";
import { OperationService } from "./operation-service.js";
import { appendTransition, sealOperation, sealReceipt } from "./state.js";
import { canonicalAddress, canonicalIdempotencyKey, canonicalOperationId, hasExactTransfer, parseEffect, publicOperation, requireFunding, transferData, validateBalance, validateEconomics, verifyEffect, } from "./transfer-policy.js";
import { canonicalProfile } from "./wallet-policy.js";
import { ProviderDirectTransferService } from "./provider-direct-transfer.js";
import { DirectAllowlistGate, refuse } from "./direct-allowlist-gate.js";
import { evmAllowlistSubject, evmUsageTarget } from "./evm-direct-allowlist.js";
import { walletCustodyLock } from "./encrypted-wallet-store.js";
export class TransferService {
    context;
    operations;
    providerDirect;
    observation;
    allowlist;
    constructor(context) {
        this.context = context;
        this.operations = new OperationService(context.state);
        this.allowlist = new DirectAllowlistGate(context);
        this.providerDirect = new ProviderDirectTransferService(context);
        this.observation = new TransferServiceObservation(context, this.providerDirect, {
            followUsage: operation => this.followUsage(operation),
            transition: (operation, state, terminal, reason, proofClass, extra, rpcReceipt) => this.transition(operation, state, terminal, reason, proofClass, extra, rpcReceipt),
            failBeforeEffect: (operation, reason) => this.failBeforeEffect(operation, reason),
        });
    }
    async prepare(request) {
        if (request.asset !== undefined) {
            if (await this.providerDirect.canHandle(request.profile))
                throw new ApnError("APN_PROVIDER_UNAVAILABLE", "Generic EVM direct transfer is available only for the local wallet; external profiles retain their explicit Base-USDC capabilities.");
            return await prepareEvmTransfer(this.context, this.operations, request, (operation) => this.persist(operation), (profileHash, chainId, account) => this.retireExpiredDirectTransfers(profileHash, chainId, account));
        }
        if (request.maxFeeWei !== undefined)
            throw new ApnError("APN_INVALID_INPUT", "Generic fee budget requires explicit chain and asset selection.");
        if (await this.providerDirect.canHandle(request.profile))
            return await this.providerDirect.prepare(request);
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
        return await state.withLocks([
            `profile:${profileHash}`,
            `operation:${operationId}`,
            `operation:idempotency:${idempotencyHash}`,
        ], async () => {
            const existing = await this.operations.resolvePrepare({
                kind: "direct_transfer",
                profileHash,
                operationId,
                idempotencyHash,
                requestHash,
            });
            if (existing !== null)
                return publicOperation(existing.record);
            const wallet = await state.loadWallet(profileHash);
            if (wallet === null)
                throw new ApnError("APN_OPERATION_BLOCKED", "Wallet is not initialized.");
            await this.operations.assertEvmAccountAvailable(profileHash, CHAIN_ID, wallet.address);
            const rpc = this.context.requireRpc();
            rpc.armEvmDirectRpcGuard?.();
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
    async prepareCoinbaseGasless(request) {
        return await this.providerDirect.prepareCoinbaseGasless(request);
    }
    async approve(operationIdInput) {
        const operationId = canonicalOperationId(operationIdInput);
        await this.context.ready();
        const found = await this.requiredOperation(operationId);
        if (found.providerDirect !== undefined)
            return await this.providerDirect.approve(operationId);
        const localFound = requiredLocal(found);
        const { profile, profileHash } = localFound;
        return await this.context.state.withLocks([`profile:${profileHash}`, `operation:${operationId}`], async () => {
            let operation = requiredLocal(await this.requiredOperation(operationId));
            if (operation.terminal)
                return publicOperation(await this.followUsage(operation));
            if (operation.state !== "awaiting_approval") {
                throw new ApnError("APN_OPERATION_BLOCKED", "Operation is already signed; use operation resume.");
            }
            if (this.context.clock.now().getTime() >= Date.parse(operation.expiresAt)) {
                await this.failBeforeEffect(operation, "approval_window_expired");
            }
            const rpc = this.context.requireRpc();
            if (operation.chainId === 8453 || operation.chainId === 42161 || operation.chainId === 1329)
                rpc.armEvmDirectRpcGuard?.();
            const check = async () => await checkTransferApproval(rpc, operation, (reason) => this.failBeforeEffect(operation, reason), this.context.state.root);
            if (operation.evm === undefined)
                await check();
            else
                await this.context.state.withLocks([walletCustodyLock(this.context.state, profile)], check);
            if (operation.evm !== undefined) {
                // The native signer approves and signs in one call, so the reservation is durable in both stores before it.
                const allowlistLease = await this.reserveUsage(operation);
                operation = await this.transition(operation, "started", false, "foreground_signing_started", "durable_pre_effect", { allowlistLease });
            }
            const custodyPayload = operation.evm === undefined ? {
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
            } : evmCustodyPayload(operation);
            let effectValue;
            try {
                effectValue = await this.context.requireNative().request(this.context.nativeRequest("directTransfer.approveAndSign", custodyPayload));
            }
            catch (error) {
                if (operation.evm !== undefined && error instanceof ApnError && error.code === "APN_REPREPARE_REQUIRED") {
                    const stored = await this.context.requireNative().request(this.context.nativeRequest("effectMaterial.get", {
                        profile, operationId, fingerprint: operation.fingerprint, expectedPayloadHash: hashObject(custodyPayload),
                    }));
                    if (isPlainRecord(stored) && exactKeys(stored, ["found"]) && stored.found === false) {
                        await this.transition(operation, "failed_before_effect", true, "native_signer_reprepare_required", "durable_pre_effect_failure");
                    }
                }
                throw error;
            }
            const effect = parseEffect(effectValue);
            await verifyEffect(effect, operation);
            operation = await this.transition(operation, "signed_not_submitted", false, "native_effect_material_bound", "native_transaction_hash", { transactionHash: effect.transactionHash, rawTransactionHash: effect.rawTransactionHash });
            operation = await this.submitAndInspect(operation, effect.rawTransaction);
            return publicOperation(operation);
        });
    }
    async resume(operationId, waitSeconds, observeOnly) {
        return await this.observation.resume(operationId, waitSeconds, observeOnly);
    }
    async recoverProviderRequest(operationId, providerRequestId) {
        return await this.observation.recoverProviderRequest(operationId, providerRequestId);
    }
    async status(operationId) { return await this.observation.status(operationId); }
    async receipt(operationId) { return await this.observation.receipt(operationId); }
    async inspectReceipt(operation, rpc) {
        return await this.observation.inspectReceipt(operation, rpc);
    }
    async requiredOperation(operationId) {
        return await this.observation.requiredOperation(operationId);
    }
    async submitAndInspect(operation, rawTransaction) {
        return await this.observation.submitAndInspect(operation, rawTransaction);
    }
    /** After every approval pre-check and before the native approve-and-sign call; refusals end the operation before effect. */
    async reserveUsage(operation) {
        try {
            if (operation.allowlist === undefined) {
                refuse("allowlist_binding_missing", "This transfer was prepared before the owner allowlist gate; prepare a new transfer.");
            }
            return await this.allowlist.reserve(evmAllowlistSubject(operation), operation.allowlist);
        }
        catch (error) {
            if (error instanceof ApnError && error.code === "APN_ALLOWLIST_REFUSED") {
                await this.transition(operation, "failed_before_effect", true, "allowlist_refused_at_approval", "durable_pre_effect_failure");
            }
            throw error;
        }
    }
    /** The journal owns the effect state; the shared usage ledger follows it forward, idempotently, after each durable write. */
    async followUsage(operation) {
        if (operation.allowlist !== undefined) {
            await this.allowlist.follow(evmAllowlistSubject(operation), evmUsageTarget(operation.state), operation.transitions.at(-1).hash);
        }
        return operation;
    }
    /** Caller holds the profile lock shared by approval and prepare; all local lifecycle writers take it first.
     * Re-read under that lock without nesting another operation lock or changing the established lock order. */
    async retireExpiredDirectTransfers(profileHash, chainId, account) {
        const wanted = conflictDomainKey(evmConflictDomain(chainId, account));
        const eligible = (operation) => operation.profileHash === profileHash &&
            operation.evm !== undefined && operation.providerDirect === undefined && !operation.terminal && operation.state === "awaiting_approval" &&
            this.context.clock.now().getTime() >= Date.parse(operation.expiresAt) &&
            storedOperationDomains({ kind: "direct_transfer", record: operation })?.some(domain => conflictDomainKey(domain) === wanted);
        for (const candidate of await this.context.state.listOperations(profileHash)) {
            if (!eligible(candidate))
                continue;
            const operation = requiredLocal(await this.requiredOperation(candidate.operationId));
            if (operation.integrityHash !== candidate.integrityHash || !eligible(operation)) {
                throw new ApnError("APN_STATE_CORRUPT", "Expired direct transfer changed while its profile was locked.");
            }
            if (operation.allowlistLease !== undefined || operation.transactionHash !== undefined ||
                operation.rawTransactionHash !== undefined || operation.lastSubmissionAt !== undefined ||
                operation.providerEffect !== undefined || operation.transitions.some(item => item.state !== "awaiting_approval") ||
                (operation.evm !== undefined && await this.allowlist.hasReservation(evmAllowlistSubject(operation)))) {
                throw new ApnError("APN_OPERATION_BLOCKED", "Expired direct transfer has durable effect or reservation evidence.", { blockingOperationId: operation.operationId, blockingState: operation.state });
            }
            await this.transition(operation, "failed_before_effect", true, "approval_window_expired", "durable_pre_effect_failure");
        }
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
        return await this.followUsage(updated);
    }
    async persist(operation, rpcReceipt) {
        if (operation.evm === undefined)
            await this.context.state.writeOperation(operation);
        const receiptBase = {
            schemaVersion: STATE_VERSION,
            operationId: operation.operationId,
            state: operation.state,
            terminal: operation.terminal,
            reason: operation.reason,
            proofClass: operation.proofClass,
            ...(operation.evm === undefined ? {} : { evm: operation.evm, amountAtomic: operation.amountAtomic }),
            ...(operation.transactionHash === undefined ? {} : { transactionHash: operation.transactionHash }),
            ...(rpcReceipt === undefined ? {} : {
                blockNumberAtomic: rpcReceipt.blockNumberAtomic,
                ...(operation.evm?.asset.kind === "native" ? {} : { exactTransferLog: hasExactTransfer(rpcReceipt, operation) }),
                ...(rpcReceipt.evmEvidence === undefined ? {} : { evmEvidence: rpcReceipt.evmEvidence }),
            }),
            createdAt: operation.evm === undefined ? this.context.clock.now().toISOString() : operation.transitions.at(-1).at,
            operationIntegrityHash: operation.integrityHash,
        };
        await this.context.state.writeReceipt(operation.profileHash, sealReceipt(receiptBase));
        if (operation.evm !== undefined)
            await this.context.state.writeOperation(operation);
    }
}
//# sourceMappingURL=transfer-service.js.map