import type { ClockPort, X402RpcPort } from "./ports.js";
import { X402Erc7710RpcReconciler } from "./x402-erc7710-rpc-reconciler.js";
import {
  X402RpcReconciler,
  type X402ReconciliationOutcome,
  type X402ReconciliationStore,
} from "./x402-rpc-reconciler.js";
import type { X402OperationRecord } from "./x402-state-integrity.js";

export async function reconcileX402Method(
  rpc: X402RpcPort,
  clock: ClockPort,
  store: X402ReconciliationStore,
  operation: X402OperationRecord,
): Promise<X402ReconciliationOutcome> {
  if (operation.selectedOffer.resolved.assetTransferMethod === "erc7710") {
    return {
      operation: await new X402Erc7710RpcReconciler(rpc, clock, store).reconcile(operation),
      completeZeroScanValidated: false,
      completeZeroScanRead: false,
    };
  }
  return await new X402RpcReconciler(rpc, clock, store).reconcile(operation);
}
