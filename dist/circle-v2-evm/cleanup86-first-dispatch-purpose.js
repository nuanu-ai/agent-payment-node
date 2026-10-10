import { canonicalJson, hashObject } from "../canonical.js";
import { assertHeldCleanup85Scope } from "../circle-cleanup85-financial-scope.js";
import { assertEvmNativeCustody } from "../evm-native-custody.js";
import { assertExclusiveEvmRawSigner } from "../evm-address-ownership.js";
import { OperationService } from "../operation-service.js";
import { cleanup85CancellationRequest } from "./cleanup85-recovery-store.js";
import { authenticateCleanup86CurrentHistory } from "./cleanup86-current-purpose.js";
import { CircleUsage } from "./usage.js";
import { CircleRepository } from "./repository.js";
import { circleBlocked } from "./operation-model.js";
import { AssetUsageLedger } from "../asset-usage-ledger.js";
const certificates = new WeakMap();
function detached(value) { const result = structuredClone(value); const freeze = (v) => { if (v !== null && typeof v === "object") {
    for (const x of Object.values(v))
        freeze(x);
    Object.freeze(v);
} }; freeze(result); return result; }
async function permission(c) {
    assertHeldCleanup85Scope(c.scope, c.state, cleanup85CancellationRequest(c.recovery), c.proof.operationId);
    if (hashObject(await new CircleRepository(c.state.root).load(c.op.operationId)) !== hashObject(c.op))
        circleBlocked("cleanup86_first_dispatch_parent_changed");
    // Only recorded historical authentication: current renewal/old expiry does not grant execution.
    await authenticateCleanup86CurrentHistory(c.state.root, c.op, c.intent.currentPurpose);
    for (const [profile, custody] of [[c.op.profile, c.op.sourceCustody], [c.op.destinationProfile, c.op.destinationCustody], ["default", c.recovery.recipientCustody]]) {
        await assertEvmNativeCustody(c.state, profile, custody);
        await assertExclusiveEvmRawSigner(c.state, custody.walletAddress, custody.profileHash);
    }
    await new OperationService(c.state).assertCircleAccountsAvailable(c.op, true, "cleanup");
    const census = await new AssetUsageLedger(c.state.root).usageReadOnly({ account: c.op.sourceCustody.walletAddress, chain: "eip155:42161", asset: { kind: "native", identifier: null } }, new Date(c.now()));
    if (census.amountAtomic !== c.body.nativeUsageAtomic)
        circleBlocked("cleanup86_first_dispatch_native_census_changed");
    const usage = new CircleUsage(c.state, c.now);
    await usage.withCleanup85HeldPolicyScope(c.scope, cleanup85CancellationRequest(c.recovery), c.proof.operationId, async () => {
        await usage.confirm(c.op, c.body.policies);
        const deadline = await usage.authorizationDeadline(c.op, c.body.policies);
        if (deadline !== null && Date.parse(deadline) < Date.parse(c.body.windowEndsAt))
            circleBlocked("cleanup86_first_dispatch_policy_window_changed");
    });
    verifiedCleanup86FirstDispatchPurposeToken(c);
}
function verifiedCleanup86FirstDispatchPurposeToken(c) {
    const at = c.now();
    if (at < Date.parse(c.body.capturedAt) || at >= Date.parse(c.body.windowEndsAt) || new Date(at).toISOString().slice(0, 10) !== c.body.capturedAt.slice(0, 10))
        circleBlocked("cleanup86_first_dispatch_purpose_expired");
}
/** Called after complete fresh public admission under the same private held financial scope. */
export async function verifyCleanup86FirstDispatchPurpose(state, op, recovery, intent, binding, proof, scope, now) {
    if (intent.version !== "apn.circle-cleanup86-intent.v5" || intent.currentPurpose === undefined || binding.root !== state.root || binding.operationId !== op.operationId || binding.intentHash !== intent.intentHash || binding.recoveryId !== intent.recoveryBinding || binding.envelopeHash !== intent.envelope.envelopeHash || proof.proofHash !== intent.cancellationProofHash)
        circleBlocked("cleanup86_first_dispatch_purpose_binding");
    const usage = new CircleUsage(state, now);
    const capture = await usage.withCleanup85HeldPolicyScope(scope, cleanup85CancellationRequest(recovery), proof.operationId, async () => {
        const policies = await usage.retirementPolicies(op);
        await usage.confirm(op, policies);
        return { policies, deadline: await usage.authorizationDeadline(op, policies) };
    });
    const at = now(), end = Math.min(at + 60_000, capture.deadline === null ? Infinity : Date.parse(capture.deadline));
    const census = await new AssetUsageLedger(state.root).usageReadOnly({ account: op.sourceCustody.walletAddress, chain: "eip155:42161", asset: { kind: "native", identifier: null } }, new Date(at));
    const frame = { version: "apn.circle-cleanup86-first-dispatch-purpose.v1", action: "first_dispatch_exact_sealed_zero_approval", binding: detached(binding), originalIntentDigest: hashObject(intent), originalPurposeDigest: hashObject(intent.currentPurpose), parentDigest: hashObject(op), parentFingerprint: op.fingerprint, custodyDigest: hashObject(op.sourceCustody), policies: detached(capture.policies), maximumFeeAtomic: "15000000000000", frozenFeeUpperAtomic: (BigInt(intent.envelope.gasLimitAtomic) * BigInt(intent.envelope.maxFeePerGasAtomic)).toString(), nativeUsageAtomic: census.amountAtomic, capturedAt: new Date(at).toISOString(), windowEndsAt: new Date(end).toISOString() };
    const body = detached({ ...frame, purposeHash: hashObject(frame) }), token = Object.freeze({ kind: "verified-cleanup86-first-dispatch-purpose" });
    const c = { state, op: detached(op), recovery: detached(recovery), intent: detached(intent), scope, proof: detached(proof), body, now, claimed: false };
    await permission(c);
    certificates.set(token, c);
    return token;
}
export function verifiedCleanup86FirstDispatchPurpose(token, binding) {
    const c = certificates.get(token);
    if (c === undefined || canonicalJson(c.body.binding) !== canonicalJson(binding))
        circleBlocked("cleanup86_private_first_dispatch_purpose_required");
    assertHeldCleanup85Scope(c.scope, c.state, cleanup85CancellationRequest(c.recovery), c.proof.operationId);
    verifiedCleanup86FirstDispatchPurposeToken(c);
    return c.body;
}
export function claimCleanup86FirstDispatchPurpose(token, binding) {
    const purpose = verifiedCleanup86FirstDispatchPurpose(token, binding), c = certificates.get(token);
    if (c.claimed)
        circleBlocked("cleanup86_first_dispatch_purpose_used");
    c.claimed = true;
    return { purpose, now: c.now };
}
export async function assertCleanup86FirstDispatchPermission(token, binding) { verifiedCleanup86FirstDispatchPurpose(token, binding); await permission(certificates.get(token)); }
//# sourceMappingURL=cleanup86-first-dispatch-purpose.js.map