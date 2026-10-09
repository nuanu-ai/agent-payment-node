import { withCleanup85FinancialScope, withCleanup85UnsignedRetirementScope, type HeldCleanup85Scope } from "../circle-cleanup85-financial-scope.js";
import { resolveCleanup85NativeLineage, verifiedCleanup85NativeLineage } from "../circle-cleanup85-unsigned-retirement.js";
import { walletCustodyLock } from "../encrypted-wallet-store.js";
import { prepareCleanup85UnsignedRetirement } from "../circle-cleanup85-unsigned-retirement.js";
import type { Cleanup85CancellationRequest } from "../circle-cleanup85-cancellation-contract.js";
import { assertExclusiveEvmRawSigner, evmAddressLock } from "../evm-address-ownership.js";
import { assertEvmNativeCustody, evmNativeCustody } from "../evm-native-custody.js";
import { OperationService } from "../operation-service.js";
import type { StateStore } from "../state.js";
import { CircleRepository } from "./repository.js";
import { CircleUsage } from "./usage.js";
import { CircleNonceRetirementStore } from "./nonce-retirement-store.js";
import { Cleanup85RecoveryStore, assertCleanup85Parent, assertCleanup85Window, cleanup85CancellationRequest } from "./cleanup85-recovery-store.js";
import { consumedBurnEvidence } from "./consumed-burn-rpc.js";
import { circleBlocked } from "./operation-model.js";
import { currentCircleDeployments, type CircleRpc } from "./rpc.js";
/** Normal preparation only. It publishes a finite immutable admission frame, never financial authority. */
export async function prepareCleanup85Recovery(state: StateStore, source: CircleRpc, destination: CircleRpc, id: string, now: () => number): Promise<Cleanup85CancellationRequest> {
  const repo = new CircleRepository(state.root), initial = await repo.load(id); if (initial === null) circleBlocked("cleanup85_parent_missing"); assertCleanup85Parent(initial);
  const recipient = await evmNativeCustody(state, "default"), usage = new CircleUsage(state, now), store = new Cleanup85RecoveryStore(state.root), old = new CircleNonceRetirementStore(state.root);
  const action = async (scope?:HeldCleanup85Scope) => {
    const op = await repo.load(id); if (op === null || op.terminal || op.usageFinalized) circleBlocked("cleanup85_parent_unavailable"); assertCleanup85Parent(op);
    const parent = await old.intent(op); if (parent === null || !await old.hasClaim(op, "sign") || await old.hasClaim(op, "send")) circleBlocked("cleanup85_original_claim_identity_required");
    await store.assertRetainedMaterialHeaders(op);
    for (const [profile, custody] of [[op.profile, op.sourceCustody], [op.destinationProfile, op.destinationCustody], ["default", recipient]] as const) {
      await assertEvmNativeCustody(state, profile, custody); await assertExclusiveEvmRawSigner(state, custody.walletAddress, custody.profileHash);
    }
    const existing = await store.load(op, parent);
    await new OperationService(state).assertCleanup85PreparationAccountsAvailable(op, now());
    if (existing !== null && scope !== undefined && await prepareCleanup85UnsignedRetirement(state, source, destination, op, existing, now, scope)) return cleanup85CancellationRequest(existing);
    const policies = existing?.policies ?? await usage.retirementPolicies(op);
    await usage.confirm(op, policies); const windowEndsAt = await usage.authorizationDeadline(op, policies);
    if (existing !== null) assertCleanup85Window(existing, now());
    await currentCircleDeployments(source, destination, 1329);
    if (await source.call("eth_getTransactionReceipt", [op.effects[2]!.transactionHash]) !== null) circleBlocked("cleanup85_original_receipt_requires_public_reconciliation");
    const evidence = await consumedBurnEvidence(source, op);
    const intent = await store.start(op, parent, { sourceCustody: op.sourceCustody, destinationCustody: op.destinationCustody, recipientCustody: recipient, policies, windowEndsAt, capturedAt: new Date(now()).toISOString(), evidence });
    return cleanup85CancellationRequest(intent);
  };
  const parent=await old.intent(initial),existing=parent===null?null:await store.load(initial,parent);
  if(existing!==null){const request=cleanup85CancellationRequest(existing),originalId=state.operationId("evm-live-buyer",`cleanup85-native:${request.recoveryBinding}`),native=await state.findOperation(originalId);if(native?.state==="awaiting_approval"&&now()>=Date.parse(native.expiresAt))return withCleanup85UnsignedRetirementScope(state,request,scope=>usage.withCleanup85HeldPolicyScope(scope,request,originalId,()=>action(scope)));const lineage=verifiedCleanup85NativeLineage(await resolveCleanup85NativeLineage(state,request),state,request);return withCleanup85FinancialScope(state,request,lineage.operationId,scope=>usage.withCleanup85HeldPolicyScope(scope,request,lineage.operationId,()=>action(scope)));}
  return state.withLocks([initial.profile,initial.destinationProfile,"default"].map(p=>walletCustodyLock(state,p)),()=>state.withLocks([`profile:${initial.profileHash}`,`profile:${initial.destinationProfileHash}`,`profile:${recipient.profileHash}`,`operation:${id}`,`operation:idempotency:${initial.idempotencyHash}`,evmAddressLock(initial.sourceCustody.walletAddress),evmAddressLock(initial.destinationCustody.walletAddress),evmAddressLock(recipient.walletAddress)],()=>usage.withPolicyLocks([initial.profile,initial.destinationProfile,"default"],()=>action())));
}
