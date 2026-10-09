import { isSealedBurnRetirement } from "./burn-retirement.js";
import { exactKeys, hashObject, isPlainRecord } from "../canonical.js";
import { SecureStateStore } from "../secure-state-store.js";
import { circleBlocked, circleCorrupt } from "./operation-model.js";
import { circleRetirementBinding } from "./nonce-retirement-store.js";
export class CircleRetirementAuthorityStore extends SecureStateStore {
    path(id) { if (!/^[a-f0-9]{64}$/u.test(id))
        circleCorrupt("retirement_id"); return `circle-v2-nonce-retirements/${id}-authority.json`; }
    async load(op) {
        if ((op.destinationChain !== 143 || op.destinationProfile !== "default") && !isSealedBurnRetirement(op))
            circleBlocked("finite_nonce_retirement_authority_only");
        const value = await this.readJson(this.path(op.operationId));
        if (value === null)
            return null;
        if (!isPlainRecord(value) || !exactKeys(value, ["version", "operationId", "parentBinding", "sourceCustody", "destinationCustody", "policies", "windowEndsAt", "capturedAt", "authorityHash"]))
            circleCorrupt("retirement_authority_shape");
        const frame = value, { authorityHash, ...body } = frame;
        if (frame.version !== "apn.circle-retirement-authority.v1" || frame.operationId !== op.operationId || frame.parentBinding !== circleRetirementBinding(op) || hashObject(body) !== authorityHash ||
            hashObject(frame.sourceCustody) !== hashObject(op.sourceCustody) || hashObject(frame.destinationCustody) !== hashObject(op.destinationCustody) ||
            !Array.isArray(frame.policies) || frame.policies.length !== 2 || frame.policies.some(p => !isPlainRecord(p) || !exactKeys(p, ["profile", "profileHash", "policyDigest", "revision", "activationDigest"]) ||
            p.profileHash !== (p.profile === op.profile ? op.profileHash : p.profile === op.destinationProfile ? op.destinationProfileHash : null) || ![p.policyDigest, p.activationDigest].every(x => typeof x === "string" && /^[a-f0-9]{64}$/u.test(x)) || typeof p.revision !== "number" || !Number.isSafeInteger(p.revision) || p.revision < 1) ||
            new Set(frame.policies.map(p => p.profile)).size !== 2 || !validInstant(frame.capturedAt) || frame.windowEndsAt !== null && !validInstant(frame.windowEndsAt))
            circleCorrupt("retirement_authority_binding");
        return frame;
    }
    async capture(op, policies, windowEndsAt, now) {
        const existing = await this.load(op);
        if (existing !== null)
            return existing;
        const body = { version: "apn.circle-retirement-authority.v1", operationId: op.operationId, parentBinding: circleRetirementBinding(op), sourceCustody: op.sourceCustody, destinationCustody: op.destinationCustody,
            policies, windowEndsAt, capturedAt: new Date(now).toISOString() };
        await this.initialize();
        await this.ensureDirectory("circle-v2-nonce-retirements");
        await this.writeJson(this.path(op.operationId), { ...body, authorityHash: hashObject(body) }, true);
        return (await this.load(op));
    }
}
export function assertCircleRetirementWindow(frame, now) {
    if (now < Date.parse(frame.capturedAt) || frame.windowEndsAt !== null && now >= Date.parse(frame.windowEndsAt))
        circleBlocked("retirement_current_policy_window_expired");
}
function validInstant(value) { return typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value; }
//# sourceMappingURL=nonce-retirement-authority.js.map