import { X402Erc7710RpcReconciler } from "./x402-erc7710-rpc-reconciler.js";
import { X402RpcReconciler, } from "./x402-rpc-reconciler.js";
export async function reconcileX402Method(rpc, clock, store, operation) {
    if (operation.selectedOffer.resolved.assetTransferMethod === "erc7710") {
        return {
            operation: await new X402Erc7710RpcReconciler(rpc, clock, store).reconcile(operation),
            completeZeroScanValidated: false,
            completeZeroScanRead: false,
        };
    }
    return await new X402RpcReconciler(rpc, clock, store).reconcile(operation);
}
//# sourceMappingURL=x402-method-reconciliation.js.map