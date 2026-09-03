import { sha256 } from "./canonical.js";
import { providerDirectReceipt, recoverProviderTerminalOperation } from "./provider-direct-receipt.js";
import { appendTransition, sealOperation } from "./state.js";
import { hasExactTransfer } from "./transfer-policy.js";
export class ProviderDirectState {
    context;
    constructor(context) {
        this.context = context;
    }
    async recoverOrphanTerminal(operation) {
        const receipt = await this.context.state.loadReceipt(operation.profileHash, operation.operationId);
        const recovered = recoverProviderTerminalOperation(operation, receipt);
        if (recovered === null)
            return operation;
        await this.context.state.writeOperation(recovered);
        return recovered;
    }
    async inspectReceipt(operation) {
        if (operation.transactionHash === undefined || operation.terminal ||
            !["provider_acknowledged", "evidence_pending", "ambiguous_effect"].includes(operation.state))
            return operation;
        const binding = operation.providerDirect;
        if (binding === undefined)
            return operation;
        let receipt;
        try {
            if (sha256(`direct-rpc\0${this.context.requireRpcUrl()}`) !== binding.rpcBindingHash)
                throw new Error("rpc binding drift");
            const rpc = this.context.requireRpc();
            const identity = await rpc.assertBaseChain();
            if (sha256(`direct-rpc-origin\0${identity.rpcOrigin}`) !== binding.rpcOriginHash)
                throw new Error("rpc origin drift");
            receipt = await rpc.getReceipt(operation.transactionHash);
        }
        catch {
            return await this.receiptPending(operation, "receipt_evidence_unavailable");
        }
        if (receipt === null)
            return await this.receiptPending(operation, "receipt_evidence_pending");
        if (receipt.rpcOrigin.length === 0 ||
            sha256(`direct-rpc-origin\0${receipt.rpcOrigin}`) !== binding.rpcOriginHash ||
            receipt.transactionHash.toLowerCase() !== operation.transactionHash.toLowerCase()) {
            return await this.receiptAmbiguous(operation, "receipt_identity_mismatch");
        }
        if (receipt.status === "reverted")
            return await this.transition(operation, "failed_confirmed_revert", true, "confirmed_receipt_revert", "confirmed_receipt", {}, receipt);
        if (!hasExactTransfer(receipt, operation)) {
            return await this.receiptAmbiguous(operation, "successful_receipt_missing_exact_transfer", receipt);
        }
        return await this.transition(operation, "completed", true, "confirmed_exact_usdc_transfer", "confirmed_receipt_and_exact_transfer_log", {}, receipt);
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
        const receipt = providerDirectReceipt(operation, rpcReceipt);
        if (operation.terminal) {
            await this.context.state.writeReceipt(operation.profileHash, receipt);
            await this.context.state.writeOperation(operation);
            return;
        }
        await this.context.state.writeOperation(operation);
        await this.context.state.writeReceipt(operation.profileHash, receipt);
    }
    async receiptPending(operation, reason) {
        if (operation.state === "evidence_pending" || operation.state === "ambiguous_effect")
            return operation;
        return await this.transition(operation, "evidence_pending", false, reason, "provider_transaction_hash_only");
    }
    async receiptAmbiguous(operation, reason, receipt) {
        if (operation.state === "ambiguous_effect")
            return operation;
        return await this.transition(operation, "ambiguous_effect", false, reason, "provider_effect_no_replay", {}, receipt);
    }
}
//# sourceMappingURL=provider-direct-state.js.map