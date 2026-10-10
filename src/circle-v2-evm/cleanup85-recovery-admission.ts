import { hashObject, exactKeys, isPlainRecord } from "../canonical.js";
import type { Cleanup85CancellationRequest } from "../circle-cleanup85-cancellation-contract.js";
import { assertEvmNativeCustody } from "../evm-native-custody.js";
import type { StateStore } from "../state.js";
import { CircleRepository } from "./repository.js";
import { CircleNonceRetirementStore } from "./nonce-retirement-store.js";
import { Cleanup85RecoveryStore, cleanup85CancellationRequest, assertCleanup85Parent, type Cleanup85RecoveryIntent } from "./cleanup85-recovery-store.js";
import { consumedBurnEvidence, type ConsumedBurnEvidence } from "./consumed-burn-rpc.js";
import { approvalReceiptIdentity } from "./burn-retirement-rpc.js";
import { currentCircleDeployments, type CircleRpc } from "./rpc.js";
import { circleBlocked, type CircleOperationV1 } from "./operation-model.js";
/** Detached private verification provenance, never a caller-supplied boolean or persisted authority. */
export interface VerifiedCleanup85RecoveryAdmission { readonly kind: "verified-cleanup85-recovery-admission"; }
interface VerifiedBody { readonly request: Cleanup85CancellationRequest; readonly intent: Cleanup85RecoveryIntent; readonly parent: CircleOperationV1; readonly evidence: ConsumedBurnEvidence; readonly deployments: Readonly<Awaited<ReturnType<typeof currentCircleDeployments>>>; }
const verified = new WeakMap<VerifiedCleanup85RecoveryAdmission, VerifiedBody>();
export function verifiedCleanup85RecoveryAdmission(token: VerifiedCleanup85RecoveryAdmission, request: Cleanup85CancellationRequest): VerifiedBody {
  const body = verified.get(token); if (body === undefined || hashObject(body.request) !== hashObject(request)) circleBlocked("private_cleanup85_admission_required");
  return structuredClone(body);
}
/** Public-only. B calls under its reacquired Buyer/Default owner+policy locks and uses its own policy/TTY grant.
 * Both RPCs must be real bounded public readers; source archive and Sei deployment pins remain mandatory. */
export async function verifyCleanup85RecoveryAdmission(state: StateStore, source: CircleRpc, destination: CircleRpc, request: Cleanup85CancellationRequest): Promise<VerifiedCleanup85RecoveryAdmission> {
  if (!isPlainRecord(request) || !exactKeys(request, ["parentOperationId", "recoveryBinding", "parentIntentHash", "oldCleanupTransactionHash", "oldCleanupMaterialHash", "oldCleanupEnvelopeHash"])) circleBlocked("cleanup85_request_shape");
  const op = await new CircleRepository(state.root).load(request.parentOperationId); if (op === null || op.terminal || op.usageFinalized || op.residualAllowanceAtomic !== "40100") circleBlocked("cleanup85_parent_unavailable");
  assertCleanup85Parent(op);
  const old = new CircleNonceRetirementStore(state.root), parent = await old.intent(op); if (parent === null || !await old.hasClaim(op, "sign") || await old.hasClaim(op, "send")) circleBlocked("cleanup85_original_claim_identity_required");
  const store = new Cleanup85RecoveryStore(state.root); await store.assertRetainedMaterialHeaders(op);
  const intent = await store.load(op, parent); if (intent === null || hashObject(cleanup85CancellationRequest(intent)) !== hashObject(request)) circleBlocked("cleanup85_request_binding");
  await assertEvmNativeCustody(state, op.profile, op.sourceCustody); await assertEvmNativeCustody(state, "default", intent.recipientCustody);
  if (source.chainId !== 42161 || destination.chainId !== 1329) circleBlocked("cleanup85_rpc_identity");
  const deployments = await currentCircleDeployments(source, destination, 1329);
  // Canonical receipt race always stops cancellation. Null is not an absence/effect verdict.
  if (await source.call("eth_getTransactionReceipt", [request.oldCleanupTransactionHash]) !== null) circleBlocked("cleanup85_original_receipt_requires_public_reconciliation");
  const evidence = await consumedBurnEvidence(source, op);
  if (approvalReceiptIdentity(evidence.approvalProof) !== approvalReceiptIdentity(intent.evidence.approvalProof) || approvalReceiptIdentity(evidence.consumerProof) !== approvalReceiptIdentity(intent.evidence.consumerProof)) circleBlocked("cleanup85_original_evidence_changed");
  const token = Object.freeze({ kind: "verified-cleanup85-recovery-admission" as const });
  verified.set(token, structuredClone({ request, intent, parent: op, evidence, deployments })); return token;
}
