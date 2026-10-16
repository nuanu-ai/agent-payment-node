import { ApnError } from "./errors.js";
import { OperationService } from "./operation-service.js";
import type { RuntimeContext } from "./runtime.js";

/** Caller holds the profile lock; this precedes every potentially mutating wallet action. */
export async function assertWalletLifecycleAvailable(context: RuntimeContext, profileHash: string): Promise<void> {
  await new OperationService(context.state, context.providerX402Repository, undefined, undefined,
    undefined, context.metaMaskGasless?.records).assertProfileAvailable(profileHash);
}

/**
 * Read-only wallet commands never wait for money operations. While one is in flight they still answer,
 * but skip profile upkeep (migration saves, permission activation, drift saves) that could move a frozen revision.
 */
export async function walletLifecycleMutable(context: RuntimeContext, profileHash: string): Promise<boolean> {
  try {
    await assertWalletLifecycleAvailable(context, profileHash);
    return true;
  } catch (error) {
    if (error instanceof ApnError && error.code === "APN_OPERATION_BLOCKED") return false;
    throw error;
  }
}
