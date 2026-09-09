import { OperationService } from "./operation-service.js";
/** Caller holds the profile lock; this precedes every potentially mutating wallet action. */
export async function assertWalletLifecycleAvailable(context, profileHash) {
    await new OperationService(context.state, context.providerX402Repository, undefined, undefined, undefined, context.metaMaskGasless?.records).assertProfileAvailable(profileHash);
}
//# sourceMappingURL=wallet-lifecycle-guard.js.map