import { AssetUsageLedger } from "./asset-usage-ledger.js";
import { walletCustodyLock } from "./encrypted-wallet-store.js";
import { DirectPublicEffectJournal } from "./direct-public-effect.js";
import { EvmDirectSubmissionJournal } from "./evm-direct-submission.js";
import { ApnError } from "./errors.js";
import { hasSafeEvmInclusion } from "./direct-terminal-receipt.js";
import { requireEvmRpc } from "./evm-direct.js";
import { directEvmNetwork, directEvmRequiresSafeHead } from "./evm-direct-networks.js";
import { canonicalOperationId, hasExactTransfer, hasSoleExactTransfer, parseEffect, publicOperation, publicReceipt, verifyEffect } from "./transfer-policy.js";
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
    /**
     * Every check that can refuse (policy, funding, fees, nonce) ran before signing. A persisted signature is only ever
     * dispatched, as these exact bytes, or kept resumable; nothing after signing may strand it.
     */
    async submitAndInspect(operationInput, rawTransaction) {
        const journal = new EvmDirectSubmissionJournal(this.context.state.root);
        return await journal.withLocks([`submission:${operationInput.operationId}`], async () => {
            await new DirectPublicEffectJournal(this.context.state).effect(operationInput);
            if (await journal.exists(operationInput))
                return await this.inspectReceipt(operationInput, this.context.requireRpc());
            await journal.fence(operationInput, rawTransaction);
            return await this.dispatchAndInspect(operationInput, rawTransaction);
        });
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
    async resume(operationIdInput, waitSeconds, observeOnly, coinbaseObservationRpc) {
        const operationId = canonicalOperationId(operationIdInput);
        await this.context.ready();
        const found = await this.requiredOperation(operationId);
        if (observeOnly && found.providerDirect !== undefined)
            throw new ApnError("APN_INVALID_INPUT", "Observation-only recovery requires a local direct transfer.");
        if (found.providerDirect !== undefined)
            return await this.providerDirect.resume(operationId, waitSeconds, coinbaseObservationRpc);
        if (found.chainId === 1 || found.chainId === 56 || found.chainId === 8453 || found.chainId === 42161 || found.chainId === 1329)
            this.context.requireRpc().armEvmDirectRpcGuard?.();
        if (waitSeconds !== undefined) {
            throw new ApnError("APN_INVALID_INPUT", "--wait-seconds is unavailable for local direct transfers.");
        }
        const localFound = requiredLocal(found);
        const { profileHash } = localFound;
        return await this.context.state.withLocks([`profile:${profileHash}`, `operation:${operationId}`], async () => {
            let operation = requiredLocal(await this.requiredOperation(operationId));
            if (observeOnly && !(operation.evm !== undefined && operation.state === "signed_not_submitted") && operation.state !== "submitted_pending" && operation.state !== "unknown_finality" &&
                !(operation.terminal && operation.transactionHash !== undefined)) {
                throw new ApnError("APN_INVALID_INPUT", "Observation-only recovery requires an already submitted local direct transfer.");
            }
            if (operation.terminal)
                return publicOperation(await this.lifecycle.followUsage(operation));
            if (operation.state === "awaiting_approval")
                throw new ApnError("APN_OPERATION_BLOCKED", "Operation still requires transfer approve.");
            const publicJournal = new DirectPublicEffectJournal(this.context.state);
            await this.context.state.withLocks([walletCustodyLock(this.context.state, operation.profile)], async () => {
                if (!await publicJournal.noPrivateEntry(operation))
                    return;
                const reservation = operation.allowlistLease?.reservation;
                // Finish the public proof before taking the bucket lock. A concurrent ledger transition
                // is then compared under that lock, which remains held through terminal persistence and release.
                if (!await publicJournal.noPrivateEntry(operation))
                    throw new ApnError("APN_OPERATION_BLOCKED", "No-private-entry proof disappeared.");
                if (reservation === undefined) {
                    await this.lifecycle.transition(operation, "failed_before_effect", true, "native_approval_returned_before_private_entry", "durable_native_no_private_entry");
                }
                else {
                    operation = await new AssetUsageLedger(this.context.state.root).releaseDirectReservedAfter(reservation, async () => {
                        const updated = await this.lifecycle.persistNoPrivateEntry(operation);
                        const last = updated.transitions.at(-1);
                        return { value: updated, now: new Date(last.at), outcomeDigest: last.hash };
                    });
                    await this.lifecycle.followUsage(operation);
                }
                throw new ApnError("APN_REPREPARE_REQUIRED", "Native returned before private entry; prepare a new operation.");
            });
            // Missing public proof cannot establish absence of a signature or release an occupied nonce.
            const effect = await publicJournal.effect(operation);
            if (operation.state === "started")
                operation = await this.lifecycle.transition(operation, "signed_not_submitted", false, "same_public_signature_recovered", "public_native_transaction_hash", effect);
            if (operation.transactionHash === undefined || operation.rawTransactionHash === undefined)
                throw new ApnError("APN_STATE_CORRUPT", "Signed operation lacks its public effect binding.");
            const dispatched = await new EvmDirectSubmissionJournal(this.context.state.root).exists(operation);
            // APN never dispatched this signature: send the exact approved bytes now, once, behind the same dispatch fence.
            if (operation.state === "signed_not_submitted" && !dispatched && observeOnly !== true) {
                return publicOperation(await this.submitAndInspect(operation, await this.signedRawTransaction(operation)));
            }
            if (operation.state === "signed_not_submitted")
                operation = await this.lifecycle.transition(operation, "unknown_finality", false, "signed_recovery_observation_only", "dispatch_history_ambiguous");
            const rpc = this.context.requireRpc(), observed = await this.observeReceipt(operation, rpc);
            return publicOperation(observed.receipt === "absent" ? await this.settleUnlanded(observed.operation, rpc, observeOnly === true) : observed.operation);
        });
    }
    /**
     * No receipt. A finalized sender nonce past the frozen one, read in the same POST as the missing receipt, proves another
     * transaction consumed it: this one can never land. A hash the RPC does not hold at all is re-sent as the identical
     * signed bytes; at most one copy of them can ever be included, so observing first and re-sending never adds an effect.
     */
    async settleUnlanded(operation, rpc, observeOnly) {
        const evm = rpc.evm;
        if (evm?.unlandedEvidence === undefined || operation.transactionHash === undefined)
            return operation;
        let seen;
        try {
            seen = await evm.unlandedEvidence(operation.chainId, operation.walletAddress, operation.transactionHash);
        }
        catch {
            return operation;
        }
        if (seen.receiptFound)
            return operation;
        if (BigInt(seen.finalizedNonce) > BigInt(operation.economics.nonceAtomic)) {
            return await this.lifecycle.transition(operation, "failed_proven_superseded", true, "frozen_nonce_finalized_by_another_transaction", "finalized_nonce_without_receipt");
        }
        if (seen.transactionKnown || observeOnly)
            return operation;
        const rawTransaction = await this.signedRawTransaction(operation);
        const journal = new EvmDirectSubmissionJournal(this.context.state.root);
        return await journal.withLocks([`submission:${operation.operationId}`], async () => {
            const at = this.context.clock.now().toISOString();
            try {
                const returned = await rpc.submitRawTransaction(rawTransaction);
                if (returned.toLowerCase() !== operation.transactionHash?.toLowerCase())
                    return operation;
                return await this.lifecycle.transition(operation, "submitted_pending", false, "same_signed_bytes_redispatched", "transaction_hash_only", { lastSubmissionAt: at });
            }
            catch {
                return operation.state === "unknown_finality" ? operation : await this.lifecycle.transition(operation, "unknown_finality", false, "redispatch_outcome_ambiguous", "ambiguous_submission", { lastSubmissionAt: at });
            }
        });
    }
    /** The persisted signed bytes, read back from encrypted custody and checked against the frozen transfer; never a new signature. */
    async signedRawTransaction(operation) {
        const effect = parseEffect(await this.context.requireNative().request(this.context.nativeRequest("directTransfer.signedMaterial.get", {
            profile: operation.profile, operationId: operation.operationId, fingerprint: operation.fingerprint,
            expectedTransactionHash: operation.transactionHash, expectedRawTransactionHash: operation.rawTransactionHash,
        })));
        if (effect.transactionHash !== operation.transactionHash || effect.rawTransactionHash !== operation.rawTransactionHash) {
            throw new ApnError("APN_STATE_CORRUPT", "Recovered signed bytes differ from the saved public effect.");
        }
        await verifyEffect(effect, operation);
        return effect.rawTransaction;
    }
    /** Signed but never dispatched by APN: after the owner's foreground acknowledgement it is closed and never sent. */
    async abandonUndispatched(operationIdInput) {
        const operationId = canonicalOperationId(operationIdInput);
        await this.context.ready();
        const found = requiredLocal(await this.requiredOperation(operationId));
        return await this.context.state.withLocks([`profile:${found.profileHash}`, `operation:${operationId}`], async () => {
            let operation = requiredLocal(await this.requiredOperation(operationId));
            if (operation.state === "abandoned_unknown" && operation.terminal)
                return publicOperation(operation);
            const submissions = new EvmDirectSubmissionJournal(this.context.state.root), publicJournal = new DirectPublicEffectJournal(this.context.state);
            if (operation.terminal || !["started", "signed_not_submitted"].includes(operation.state) || !await publicJournal.hasSigned(operation) ||
                await submissions.exists(operation)) {
                throw new ApnError("APN_OPERATION_BLOCKED", "Only a local transfer APN signed but never dispatched can be abandoned; resume the others.", { reason: "local_direct_not_abandonable", nextActions: [`apn operation resume --operation ${operationId}`] });
            }
            const effect = await publicJournal.effect(operation);
            await this.context.requireOperationAbandonApproval().approve(undispatchedAbandonIntent(operation));
            if (operation.state === "started")
                operation = await this.lifecycle.transition(operation, "signed_not_submitted", false, "same_public_signature_recovered", "public_native_transaction_hash", effect);
            return publicOperation(await this.lifecycle.transition(operation, "abandoned_unknown", true, "owner_abandoned_undispatched_signature", "owner_acknowledgement_only"));
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
        return (await this.observeReceipt(operation, rpc)).operation;
    }
    async observeReceipt(operation, rpc) {
        if (operation.transactionHash === undefined)
            return { operation, receipt: "unavailable" };
        let receipt;
        try {
            receipt = operation.evm === undefined ? await rpc.getReceipt(operation.transactionHash) :
                await requireEvmRpc(rpc).receipt(operation.chainId, operation.transactionHash);
        }
        catch {
            return { operation, receipt: "unavailable" };
        }
        if (receipt === null)
            return { operation, receipt: "absent" };
        return { operation: await this.classifyReceipt(operation, receipt, rpc), receipt: "read" };
    }
    async classifyReceipt(operation, receiptInput, rpc) {
        let receipt = receiptInput;
        if (operation.transactionHash === undefined)
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
        if (!native && !(operation.evm === undefined ? hasExactTransfer(receipt, operation) : hasSoleExactTransfer(receipt, operation))) {
            return await this.lifecycle.transition(operation, "unknown_finality", false, "successful_receipt_missing_exact_transfer", "invalid_receipt", {}, receipt);
        }
        return await this.lifecycle.transition(operation, "completed", true, operation.evm === undefined ? "confirmed_exact_usdc_transfer" : native ? "confirmed_exact_native_transfer" : "confirmed_exact_erc20_transfer", operation.evm === undefined ? "confirmed_receipt_and_exact_transfer_log" : native ? "included_native_transaction_and_receipt" : "included_exact_transfer_event", {}, receipt);
    }
    async requiredOperation(operationId) {
        const operation = await this.context.state.findOperation(operationId);
        if (operation === null)
            throw new ApnError("APN_OPERATION_NOT_FOUND", "Operation was not found.");
        return operation;
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
function undispatchedAbandonIntent(operation) {
    const asset = operation.evm?.asset, network = asset === undefined ? undefined : directEvmNetwork(asset.chainId);
    return { operationId: operation.operationId, fingerprint: operation.fingerprint, profile: operation.profile, providerId: "local",
        walletAddress: operation.walletAddress, recipient: operation.recipient, amountAtomic: operation.amountAtomic, amountDecimal: operation.amountDecimal,
        chainLabel: network === undefined ? "Base (eip155:8453)" : `${network.name} (${network.caip2})`,
        assetLabel: asset === undefined ? "canonical Base USDC" : asset.kind === "native" ? `native ${network?.nativeSymbol}` : asset.address,
        unit: asset === undefined ? "USDC" : asset.kind === "native" ? network?.nativeSymbol ?? "native" : "token",
        outcomeNote: "Financial outcome: APN signed this transfer but holds no record of dispatching it. After abandonment APN never sends it; " +
            `the next transfer from this account reuses nonce ${operation.economics.nonceAtomic}, which voids these signed bytes.` };
}
export function requiredLocal(operation) {
    if (operation.providerDirect !== undefined || operation.transactionData === undefined ||
        operation.economics === undefined || operation.preparedBlockNumberAtomic === undefined)
        throw new ApnError("APN_STATE_CORRUPT", "Local direct operation is missing its transaction economics.");
    return operation;
}
//# sourceMappingURL=transfer-service-observe.js.map