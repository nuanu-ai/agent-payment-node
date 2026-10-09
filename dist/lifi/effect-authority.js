import { keccak256 } from "viem";
import { hashObject } from "../canonical.js";
import { ApnError } from "../errors.js";
import { SecureStateStore } from "../secure-state-store.js";
const signGrants = new WeakMap();
const physicalGrants = new WeakMap();
const fail = () => { throw new ApnError("APN_OPERATION_BLOCKED", "Fresh bridge effect authority is unavailable or expired."); };
export function guardedWbtc(op) {
    const m = op.intent.materialization, r = m.request;
    return m.tool === "across" && ((r.fromChainId === 1 && r.toChainId === 42161 &&
        r.fromToken === "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599" && r.toToken === "0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f") ||
        (r.fromChainId === 42161 && r.toChainId === 1 && r.fromToken === "0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f" &&
            r.toToken === "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599"));
}
export function bridgeEffectBinding(op, role) {
    return hashObject({ profileHash: op.profileHash, operationId: op.operationId, fingerprint: op.fingerprint,
        intent: op.intent, role, envelope: op.effects.find(e => e.role === role).envelope });
}
export function assertBridgeSignGrant(check, op, role) {
    if (check === undefined || signGrants.get(check)?.binding !== bridgeEffectBinding(op, role))
        fail();
}
export function assertBridgeSignImmediate(check) {
    const grant = signGrants.get(check);
    if (grant === undefined)
        return fail();
    grant.immediate();
}
export function assertBridgePhysicalGrant(check, raw) {
    if (check === undefined || physicalGrants.get(check) !== raw)
        fail();
}
/** The approval completion instant and controller are invocation-private, never reconstructed from a journal. */
export async function withBridgeEffectAuthority(op, now, foregroundConfirm, rejected, confirmPolicy, work) {
    if (!await foregroundConfirm())
        return await rejected();
    const approvedAt = now();
    let live = true, deadline = Math.min(approvedAt + 60_000, Date.parse(op.intent.expiresAt));
    const binding = hashObject({ operationId: op.operationId, fingerprint: op.fingerprint, intent: op.intent });
    const issued = [];
    const immediate = () => { if (!live || !Number.isFinite(deadline) || now() >= deadline)
        fail(); };
    const check = async (current) => {
        if (!live || !Number.isFinite(deadline) || now() >= deadline ||
            hashObject({ operationId: current.operationId, fingerprint: current.fingerprint, intent: current.intent }) !== binding ||
            current.intent.allowlist?.activationDigest === undefined)
            fail();
        const policyExpiry = await confirmPolicy(current);
        if (policyExpiry !== undefined)
            deadline = Math.min(deadline, Date.parse(policyExpiry));
        if (!live || !Number.isFinite(deadline) || now() >= deadline)
            fail();
    };
    const authority = {
        check,
        sign: (current, role) => {
            const expected = bridgeEffectBinding(current, role);
            const callback = async () => { if (bridgeEffectBinding(current, role) !== expected)
                fail(); await check(current); };
            signGrants.set(callback, { binding: expected, immediate });
            issued.push(callback);
            return callback;
        },
        send: (current, material) => {
            const expected = bridgeEffectBinding(current, material.role), exactMaterial = hashObject(material);
            let checks = 0;
            const callback = async () => {
                if (++checks > 3 || hashObject(material) !== exactMaterial || bridgeEffectBinding(current, material.role) !== expected ||
                    material.operationId !== current.operationId || material.fingerprint !== current.fingerprint ||
                    material.envelopeHash !== current.effects.find(e => e.role === material.role).envelope.envelopeHash ||
                    keccak256(material.rawTransaction) !== material.transactionHash)
                    fail();
                await check(current);
            };
            physicalGrants.set(callback, material.rawTransaction);
            issued.push(callback);
            return callback;
        },
    };
    try {
        return await work(authority, approvedAt);
    }
    finally {
        live = false;
        for (const callback of issued) {
            signGrants.delete(callback);
            physicalGrants.delete(callback);
        }
    }
}
/** Permanent create-only barriers live outside rollbackable operation/usage journals. A lost result never permits another effect. */
export class BridgeEffectClaims extends SecureStateStore {
    async claim(op, role, boundary, material) {
        await this.initialize();
        const directory = `bridge-effect-claims/${op.profileHash}`;
        await this.ensureDirectory(directory);
        await this.writeJson(`${directory}/${op.operationId}-${role}-${boundary}.json`, {
            schemaVersion: "apn.bridge-effect-claim.v1", boundary, effectBinding: bridgeEffectBinding(op, role),
            ...(material === undefined ? {} : { materialHash: material.materialHash, transactionHash: material.transactionHash }),
        }, true);
    }
}
//# sourceMappingURL=effect-authority.js.map