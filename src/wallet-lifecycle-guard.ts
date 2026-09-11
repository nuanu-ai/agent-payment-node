import { OperationService } from "./operation-service.js";
import type { RuntimeContext } from "./runtime.js";

/** Caller holds the profile lock; this precedes every potentially mutating wallet action. */
export async function assertWalletLifecycleAvailable(context: RuntimeContext, profileHash: string): Promise<void> {
  await new OperationService(context.state, context.providerX402Repository, undefined, undefined,
    undefined, context.metaMaskGasless?.records).assertProfileAvailable(profileHash);
}
