import { keccak256 } from "viem";
import { hashObject } from "../canonical.js";
import { ApnError } from "../errors.js";
import { circleBlocked, validateCircleEnvelope } from "./operation-model.js";
import { Cleanup86Store } from "./cleanup86-store.js";
const grants = new WeakMap();
function frozen(value) { if (value !== null && typeof value === "object") {
    for (const child of Object.values(value))
        frozen(child);
    Object.freeze(value);
} return value; }
function assertFrame(intent) { const { intentHash, ...body } = intent; if (intentHash !== hashObject(body))
    circleBlocked("cleanup86_immutable_intent_changed"); validateCircleEnvelope(intent.envelope, "cleanup", 1329, null, "evm-live-seller"); if (intent.envelope.nonceAtomic !== "86" || BigInt(intent.envelope.gasLimitAtomic) * BigInt(intent.envelope.maxFeePerGasAtomic) > 15000000000000n)
    circleBlocked("cleanup86_immutable_envelope_changed"); }
export function assertCleanup86Grant(grant, root, op, intent) {
    assertFrame(intent);
    const g = grants.get(grant);
    if (g?.active !== true || g.root !== root || g.operationId !== op.operationId || g.parentFingerprint !== op.fingerprint || g.intentHash !== intent.intentHash || g.intentDigest !== hashObject(intent) || g.parentDigest !== hashObject(op) || g.now() >= g.expiresAt)
        circleBlocked("private_cleanup86_foreground_authority_required");
}
export function claimCleanup86Custody(grant, root, op, intent) {
    assertCleanup86Grant(grant, root, op, intent);
    const body = grants.get(grant);
    if (body.custodyClaimed)
        circleBlocked("cleanup86_private_custody_already_claimed");
    body.custodyClaimed = true;
}
/** Only an explicit foreground command invokes this. Claims are permanent even if a restorable
 * effect journal is rolled back; neither controller nor observer loads private material to retry. */
export async function executeCleanup86(root, op, intent, store, ports) {
    assertFrame(intent);
    op = frozen(structuredClone(op));
    intent = frozen(structuredClone(intent));
    const parentDigest = hashObject(op), intentDigest = hashObject(intent);
    if (await store.claimed(op, intent, "sign") || await store.claimed(op, intent, "send"))
        circleBlocked("cleanup86_claimed_observe_only");
    let effect = await store.effect(op, intent);
    if (effect !== null && effect.phase !== "prepared")
        circleBlocked("cleanup86_nonprepared_observe_only");
    await ports.preflight(intent); // Expensive anchored reads precede foreground approval.
    if (effect === null)
        effect = await store.saveEffect(op, intent, null, { phase: "prepared", transactionHash: null, materialHash: null });
    const promptEnteredAt = ports.now(), expiresAt = Math.min(promptEnteredAt + 60_000, intent.windowEndsAt === null ? Infinity : Date.parse(intent.windowEndsAt));
    const grant = Object.freeze({ kind: "cleanup86-foreground-grant" }), body = { root, operationId: op.operationId, parentFingerprint: op.fingerprint, intentHash: intent.intentHash, intentDigest, parentDigest, expiresAt, now: ports.now, active: true, custodyClaimed: false };
    grants.set(grant, body);
    const gate = () => assertCleanup86Grant(grant, root, op, intent);
    try {
        gate();
        await ports.confirm(intent, new Date(expiresAt).toISOString());
        gate();
        await ports.preflight(intent, grant);
        gate();
        effect = await store.saveEffect(op, intent, effect, { ...effect, phase: "signing_started" });
        gate();
        await store.claim(op, intent, "sign", effect);
        gate();
        const material = frozen(structuredClone(await ports.seal(intent, grant)));
        gate();
        if (material.version !== "apn.circle-cleanup86-material.v1" || keccak256(material.rawTransaction) !== material.transactionHash || material.intentHash !== intent.intentHash || material.recoveryBinding !== intent.recoveryBinding || material.envelopeHash !== intent.envelope.envelopeHash || material.materialHash !== hashObject(Object.fromEntries(Object.entries(material).filter(([key]) => key !== "materialHash"))))
            circleBlocked("cleanup86_material_binding");
        effect = await store.saveEffect(op, intent, effect, { phase: "sealed", transactionHash: material.transactionHash, materialHash: material.materialHash });
        gate();
        await ports.preflight(intent, grant);
        gate();
        effect = await store.saveEffect(op, intent, effect, { ...effect, phase: "submission_started" });
        gate();
        await store.claim(op, intent, "send", effect);
        gate();
        const sent = await ports.send(material, grant);
        gate();
        if (sent !== material.transactionHash)
            circleBlocked("cleanup86_submission_hash_changed");
        effect = await store.saveEffect(op, intent, effect, { ...effect, phase: "unknown" });
        return effect;
    }
    catch (error) {
        if (await store.claimed(op, intent, "sign")) {
            const current = await store.effect(op, intent);
            if (current !== null && current.phase !== "unknown")
                await store.saveEffect(op, intent, current, { ...current, phase: "unknown" });
            // Keep first sanitized code, not a replacement observer error or signed request body.
            if (error instanceof ApnError)
                await store.recordFailure(op, intent, error.code, error.details);
        }
        throw error;
    }
    finally {
        body.active = false;
        grants.delete(grant);
    }
}
//# sourceMappingURL=cleanup86-controller.js.map