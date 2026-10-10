import { hashObject, exactKeys, isPlainRecord } from "../canonical.js";
import { assertEvmNativeCustody } from "../evm-native-custody.js";
import { CircleRepository } from "./repository.js";
import { CircleNonceRetirementStore } from "./nonce-retirement-store.js";
import { Cleanup85RecoveryStore, cleanup85CancellationRequest, assertCleanup85Parent } from "./cleanup85-recovery-store.js";
import { consumedBurnEvidence } from "./consumed-burn-rpc.js";
import { approvalReceiptIdentity } from "./burn-retirement-rpc.js";
import { currentCircleDeployments } from "./rpc.js";
import { circleBlocked } from "./operation-model.js";
const verified = new WeakMap();
export function verifiedCleanup85RecoveryAdmission(token, request) {
    const body = verified.get(token);
    if (body === undefined || hashObject(body.request) !== hashObject(request))
        circleBlocked("private_cleanup85_admission_required");
    return structuredClone(body);
}
/** Public-only. B calls under its reacquired Buyer/Default owner+policy locks and uses its own policy/TTY grant.
 * Both RPCs must be real bounded public readers; source archive and Sei deployment pins remain mandatory. */
export async function verifyCleanup85RecoveryAdmission(state, source, destination, request) {
    if (!isPlainRecord(request) || !exactKeys(request, ["parentOperationId", "recoveryBinding", "parentIntentHash", "oldCleanupTransactionHash", "oldCleanupMaterialHash", "oldCleanupEnvelopeHash"]))
        circleBlocked("cleanup85_request_shape");
    const op = await new CircleRepository(state.root).load(request.parentOperationId);
    if (op === null || op.terminal || op.usageFinalized || op.residualAllowanceAtomic !== "40100")
        circleBlocked("cleanup85_parent_unavailable");
    assertCleanup85Parent(op);
    const old = new CircleNonceRetirementStore(state.root), parent = await old.intent(op);
    if (parent === null || !await old.hasClaim(op, "sign") || await old.hasClaim(op, "send"))
        circleBlocked("cleanup85_original_claim_identity_required");
    const store = new Cleanup85RecoveryStore(state.root);
    await store.assertRetainedMaterialHeaders(op);
    const intent = await store.load(op, parent);
    if (intent === null || hashObject(cleanup85CancellationRequest(intent)) !== hashObject(request))
        circleBlocked("cleanup85_request_binding");
    await assertEvmNativeCustody(state, op.profile, op.sourceCustody);
    await assertEvmNativeCustody(state, "default", intent.recipientCustody);
    if (source.chainId !== 42161 || destination.chainId !== 1329)
        circleBlocked("cleanup85_rpc_identity");
    const deployments = await currentCircleDeployments(source, destination, 1329);
    // Canonical receipt race always stops cancellation. Null is not an absence/effect verdict.
    if (await source.call("eth_getTransactionReceipt", [request.oldCleanupTransactionHash]) !== null)
        circleBlocked("cleanup85_original_receipt_requires_public_reconciliation");
    const evidence = await consumedBurnEvidence(source, op);
    if (approvalReceiptIdentity(evidence.approvalProof) !== approvalReceiptIdentity(intent.evidence.approvalProof) || approvalReceiptIdentity(evidence.consumerProof) !== approvalReceiptIdentity(intent.evidence.consumerProof))
        circleBlocked("cleanup85_original_evidence_changed");
    const token = Object.freeze({ kind: "verified-cleanup85-recovery-admission" });
    verified.set(token, structuredClone({ request, intent, parent: op, evidence, deployments }));
    return token;
}
//# sourceMappingURL=cleanup85-recovery-admission.js.map