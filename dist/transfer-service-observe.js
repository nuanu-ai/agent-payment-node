import { EvmDirectSubmissionJournal } from "./evm-direct-submission.js";
import { exactKeys, hashObject, isPlainRecord } from "./canonical.js";
import { ApnError } from "./errors.js";
import { hasSafeEvmInclusion } from "./direct-terminal-receipt.js";
import { requireEvmRpc } from "./evm-direct.js";
import { directEvmRequiresSafeHead } from "./evm-direct-networks.js";
import { checkEvmTransferFunding, evmCustodyPayload } from "./evm-transfer-approval.js";
import { parseAtomic } from "./money.js";
import { canonicalOperationId, hasExactTransfer, parseEffect, publicOperation, publicReceipt, verifyEffect } from "./transfer-policy.js";
import { ProviderDirectTransferService } from "./provider-direct-transfer.js";
import { ProviderDirectRequestRecoveryService } from "./provider-direct-request-recovery.js";
import { ProviderDirectState } from "./provider-direct-state.js";
/** Observation/recovery implementation behind the unchanged TransferService facade. */
export class TransferServiceObservation {
    context;
    providerDirect;
    lifecycle;
    providerDirectRecovery;
    constructor(context, providerDirect, lifecycle) {
        this.context = context;
        this.providerDirect = providerDirect;
        this.lifecycle = lifecycle;
        this.providerDirectRecovery = new ProviderDirectRequestRecoveryService(context);
    }
    async submitAndInspect(operationInput, rawTransaction) {
        if (operationInput.evm !== undefined) {
            const journal = new EvmDirectSubmissionJournal(this.context.state.root);
            return await journal.withLocks([`submission:${operationInput.operationId}`], async () => {
                if (await journal.exists(operationInput))
                    return await this.inspectReceipt(operationInput, this.context.requireRpc());
                await checkEvmTransferFunding(this.context.requireRpc(), operationInput, false);
                await journal.fence(operationInput, rawTransaction);
                return await this.dispatchAndInspect(operationInput, rawTransaction);
            });
        }
        return await this.dispatchAndInspect(operationInput, rawTransaction);
    }
    async dispatchAndInspect(operationInput, rawTransaction) {
        let operation = operationInput;
        const rpc = this.context.requireRpc();
        try {
            const returnedHash = await rpc.submitRawTransaction(rawTransaction);
            if (returnedHash.toLowerCase() !== operation.transactionHash?.toLowerCase()) {
                return await this.lifecycle.transition(operation, "unknown_finality", false, "rpc_returned_different_hash", "ambiguous_submission");
            }
            operation = await this.lifecycle.transition(operation, "submitted_pending", false, "submission_accepted_hash_only", "transaction_hash_only", { lastSubmissionAt: this.context.clock.now().toISOString() });
        }
        catch {
            return await this.lifecycle.transition(operation, "unknown_finality", false, "submission_outcome_ambiguous", "ambiguous_submission", { lastSubmissionAt: this.context.clock.now().toISOString() });
        }
        // A successful Ethereum send is durable at this point. Receipt inspection belongs to
        // explicit observation, preserving this invocation's bounded pre-send RPC budget.
        if (operation.evm?.asset.chainId === 1 && (operation.evm.asset.kind === "native" ||
            operation.evm.asset.address.toLowerCase() === "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48" ||
            operation.evm.asset.address.toLowerCase() === "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2"))
            return operation;
        if (operation.evm?.asset.chainId === 8453 && operation.evm.asset.kind === "erc20" &&
            ["0x4200000000000000000000000000000000000006", "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"].includes(operation.evm.asset.address.toLowerCase()))
            return operation;
        if (operation.evm?.asset.chainId === 42161 && operation.evm.asset.kind === "erc20" &&
            ["0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9", "0xaf88d065e77c8cc2239327c5edb3a432268e5831"].includes(operation.evm.asset.address.toLowerCase()))
            return operation;
        return await this.inspectReceipt(operation, rpc);
    }
    async resume(operationIdInput, waitSeconds, observeOnly) {
        const operationId = canonicalOperationId(operationIdInput);
        await this.context.ready();
        const found = await this.requiredOperation(operationId);
        if (observeOnly && found.providerDirect !== undefined)
            throw new ApnError("APN_INVALID_INPUT", "Observation-only recovery requires a local direct transfer.");
        if (found.providerDirect !== undefined)
            return await this.providerDirect.resume(operationId, waitSeconds);
        if (found.chainId === 1 || found.chainId === 56 || found.chainId === 8453 || found.chainId === 42161 || found.chainId === 1329)
            this.context.requireRpc().armEvmDirectRpcGuard?.();
        if (waitSeconds !== undefined) {
            throw new ApnError("APN_INVALID_INPUT", "--wait-seconds is unavailable for local direct transfers.");
        }
        const localFound = requiredLocal(found);
        const { profile, profileHash } = localFound;
        return await this.context.state.withLocks([`profile:${profileHash}`, `operation:${operationId}`], async () => {
            let operation = requiredLocal(await this.requiredOperation(operationId));
            if (observeOnly && !(operation.evm !== undefined && operation.state === "signed_not_submitted") && operation.state !== "submitted_pending" && operation.state !== "unknown_finality" &&
                !(operation.terminal && operation.transactionHash !== undefined)) {
                throw new ApnError("APN_INVALID_INPUT", "Observation-only recovery requires an already submitted local direct transfer.");
            }
            if (operation.terminal)
                return publicOperation(await this.lifecycle.followUsage(operation));
            if (operation.evm !== undefined && operation.transactionHash !== undefined)
                await new EvmDirectSubmissionJournal(this.context.state.root).exists(operation);
            if (operation.state === "unknown_finality") {
                return publicOperation(await this.inspectReceipt(operation, this.context.requireRpc()));
            }
            if (observeOnly && operation.evm === undefined)
                return publicOperation(await this.inspectReceipt(operation, this.context.requireRpc()));
            if (operation.evm !== undefined) {
                if (!observeOnly)
                    await this.lifecycle.followUsage(operation);
                if (operation.state === "started") {
                    const stored = await this.context.requireNative().request(this.context.nativeRequest("effectMaterial.get", {
                        profile, operationId, fingerprint: operation.fingerprint, expectedPayloadHash: hashObject(evmCustodyPayload(operation)),
                    }));
                    if (isPlainRecord(stored) && exactKeys(stored, ["found"]) && stored.found === false)
                        await this.lifecycle.failBeforeEffect(operation, "no_durable_signature_created");
                    const recovered = parseEffect(stored);
                    await verifyEffect(recovered, operation);
                    operation = await this.lifecycle.transition(operation, "signed_not_submitted", false, "same_signature_recovered", "native_transaction_hash", {
                        transactionHash: recovered.transactionHash, rawTransactionHash: recovered.rawTransactionHash,
                    });
                }
                if (operation.state !== "awaiting_approval") {
                    if (operation.transactionHash === undefined || operation.rawTransactionHash === undefined)
                        throw new ApnError("APN_STATE_CORRUPT", "Signed operation lacks its durable hash.");
                    await new EvmDirectSubmissionJournal(this.context.state.root).exists(operation);
                    if (operation.state === "signed_not_submitted")
                        operation = await this.lifecycle.transition(operation, "unknown_finality", false, "signed_recovery_observation_only", "dispatch_history_ambiguous");
                    return publicOperation(await this.inspectReceipt(operation, this.context.requireRpc()));
                }
            }
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
            const effect = await this.effectFor(operation);
            await verifyEffect(effect, operation);
            if (effect.transactionHash !== operation.transactionHash || effect.rawTransactionHash !== operation.rawTransactionHash) {
                throw new ApnError("APN_NATIVE_PROTOCOL", "Recovered effect material differs from the durable binding.");
            }
            operation = await this.submitAndInspect(operation, effect.rawTransaction);
            return publicOperation(operation);
        });
    }
    async recoverProviderRequest(operationIdInput, providerRequestId) {
        const operationId = canonicalOperationId(operationIdInput);
        await this.context.ready();
        const found = await this.requiredOperation(operationId);
        if (found.providerDirect === undefined) {
            throw new ApnError("APN_OPERATION_BLOCKED", "Operation is not a provider-atomic direct transfer.");
        }
        return await this.providerDirectRecovery.recover(operationId, providerRequestId);
    }
    async status(operationIdInput) {
        const operationId = canonicalOperationId(operationIdInput);
        await this.context.ready();
        const found = await this.requiredOperation(operationId);
        if (found.providerDirect === undefined)
            return publicOperation(found);
        return await this.context.state.withLocks([
            `profile:${found.profileHash}`,
            `operation:${operationId}`,
        ], async () => publicOperation(await new ProviderDirectState(this.context)
            .recoverOrphanTerminal(await this.requiredOperation(operationId))));
    }
    async receipt(operationIdInput) {
        await this.context.ready();
        const operationId = canonicalOperationId(operationIdInput);
        const operation = await this.requiredOperation(operationId);
        if (operation.providerDirect !== undefined)
            return await this.providerDirect.receipt(operationId);
        const receipt = await this.context.state.loadReceipt(operation.profileHash, operationId);
        if (receipt === null)
            throw new ApnError("APN_RECEIPT_NOT_FOUND", "Durable receipt is not available.");
        if (receipt.operationIntegrityHash !== operation.integrityHash) {
            throw new ApnError("APN_STATE_CORRUPT", "Receipt is not linked to the current operation transition.");
        }
        return publicReceipt(receipt);
    }
    async inspectReceipt(operation, rpc) {
        if (operation.transactionHash === undefined)
            return operation;
        let receipt;
        try {
            receipt = operation.evm === undefined ? await rpc.getReceipt(operation.transactionHash) :
                await requireEvmRpc(rpc).receipt(operation.chainId, operation.transactionHash);
        }
        catch {
            return operation;
        }
        if (receipt === null)
            return operation;
        if (receipt.transactionHash.toLowerCase() !== operation.transactionHash.toLowerCase()) {
            return await this.lifecycle.transition(operation, "unknown_finality", false, "receipt_hash_mismatch", "invalid_receipt");
        }
        if (operation.evm !== undefined) {
            try {
                receipt = { ...receipt, evmEvidence: await requireEvmRpc(rpc).evidence(operation, receipt) };
                if (directEvmRequiresSafeHead(operation.chainId) && !hasSafeEvmInclusion(receipt.evmEvidence, receipt.blockNumberAtomic)) {
                    throw new ApnError("APN_RPC_PROTOCOL", "The receipt lacks selected RPC safe inclusion evidence.");
                }
            }
            catch (error) {
                return await this.lifecycle.transition(operation, "unknown_finality", false, evmEffectFailureReason(error), "inclusion_effect_unproven");
            }
            if (receipt.evmEvidence?.transactionVerified !== true)
                return await this.lifecycle.transition(operation, "unknown_finality", false, "evm_transaction_mismatch", "invalid_receipt");
        }
        if (receipt.status === "reverted") {
            return await this.lifecycle.transition(operation, "failed_confirmed_revert", true, "confirmed_receipt_revert", "confirmed_receipt", {}, receipt);
        }
        const native = operation.evm?.asset.kind === "native";
        if (!native && (!hasExactTransfer(receipt, operation) || (operation.evm !== undefined && receipt.evmEvidence?.tokenBalanceDeltasVerified !== true))) {
            return await this.lifecycle.transition(operation, "unknown_finality", false, "successful_receipt_missing_exact_transfer", "invalid_receipt", {}, receipt);
        }
        return await this.lifecycle.transition(operation, "completed", true, operation.evm === undefined ? "confirmed_exact_usdc_transfer" : native ? "confirmed_exact_native_transfer" : "confirmed_exact_erc20_transfer", operation.evm === undefined ? "confirmed_receipt_and_exact_transfer_log" : native ? "included_native_transaction_and_receipt" : "included_transfer_event_and_block_balance_deltas", {}, receipt);
    }
    async proveSuperseding(operation, rpc) {
        const latest = parseAtomic(operation.evm === undefined ? await rpc.getLatestConfirmedNonce(operation.walletAddress) :
            await requireEvmRpc(rpc).nonce(operation.chainId, operation.walletAddress, "latest"));
        if (latest <= parseAtomic(operation.economics.nonceAtomic))
            return null;
        const hash = operation.evm === undefined ? await rpc.getConfirmedTransactionAtNonce(operation.walletAddress, operation.economics.nonceAtomic, operation.preparedBlockNumberAtomic) : await requireEvmRpc(rpc).confirmedAtNonce(operation.chainId, operation.walletAddress, operation.economics.nonceAtomic, operation.preparedBlockNumberAtomic);
        if (hash !== null && hash.toLowerCase() !== operation.transactionHash?.toLowerCase()) {
            return await this.lifecycle.transition(operation, "failed_proven_superseded", true, "confirmed_different_transaction_at_nonce", "confirmed_superseding_nonce");
        }
        return await this.lifecycle.transition(operation, "unknown_finality", false, hash === null ? "confirmed_nonce_advanced_unresolved" : "own_transaction_confirmed_receipt_unavailable", "manual_finality_resolution_required");
    }
    async requiredOperation(operationId) {
        const operation = await this.context.state.findOperation(operationId);
        if (operation === null)
            throw new ApnError("APN_OPERATION_NOT_FOUND", "Operation was not found.");
        return operation;
    }
    async effectFor(operation) {
        return parseEffect(await this.context.requireNative().request(this.context.nativeRequest("effectMaterial.get", {
            profile: operation.profile, operationId: operation.operationId, fingerprint: operation.fingerprint,
            expectedTransactionHash: operation.transactionHash, expectedRawTransactionHash: operation.rawTransactionHash,
        })));
    }
}
function evmEffectFailureReason(error) {
    if (!(error instanceof ApnError))
        return "evm_effect_evidence_unavailable";
    if (error.details?.httpStatus === 403)
        return "evm_effect_rpc_forbidden";
    if (error.code === "APN_RPC_RATE_LIMITED" || error.details?.httpStatus === 429)
        return "evm_effect_rpc_rate_limited";
    if (error.code === "APN_RPC_BUDGET_EXCEEDED")
        return "evm_effect_rpc_budget_exceeded";
    if (error.code === "APN_RPC_AMBIGUOUS" && error.details?.reason === "request_deadline")
        return "evm_effect_rpc_deadline";
    if (error.code === "APN_RPC_PROTOCOL" && error.details?.reason === "evm_safe_head_lag")
        return "evm_effect_safe_head_lag";
    if (error.code === "APN_RPC_PROTOCOL" && error.details?.reason === "evm_block_identity_changed")
        return "evm_effect_block_changed";
    return "evm_effect_evidence_unavailable";
}
export function requiredLocal(operation) {
    if (operation.providerDirect !== undefined || operation.transactionData === undefined ||
        operation.economics === undefined || operation.preparedBlockNumberAtomic === undefined)
        throw new ApnError("APN_STATE_CORRUPT", "Local direct operation is missing its transaction economics.");
    return operation;
}
//# sourceMappingURL=transfer-service-observe.js.map