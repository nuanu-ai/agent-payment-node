import { validateMerchantFeeContext } from "./mega-fee.js";
import { hashObject } from "../canonical.js";
import { refuse } from "./protocol.js";
const grants = new WeakMap();
/** This in-memory authority exists only during the foreground approval under its policy lock. */
export function issueMerchantAuthority(controller, o, tokenHold, nativeHold, approvalEndsAt) {
    if (o.feeContext === undefined)
        refuse("merchant_new_full_fee_context_required");
    if (o.effectBinding === undefined)
        refuse("merchant_new_effect_binding_required");
    const opaque = Object.freeze({});
    grants.set(opaque, { controller, frame: o.fingerprint, endsAt: [o.expiresAt, o.effectBinding.policyEndsAt, approvalEndsAt].sort()[0], live: true, sign: false, send: false, tokenHold, nativeHold, material: null, feeWitness: null });
    return Object.freeze({ opaque });
}
export function assertMerchantAuthority(grant, controller, o, now, effect) {
    const b = grant === undefined ? undefined : grants.get(grant.opaque);
    if (b === undefined || !b.live || b.controller !== controller || b.frame !== o.fingerprint || o.effectBinding === undefined || now.toISOString() >= b.endsAt || now.toISOString().slice(0, 10) !== o.createdAt.slice(0, 10) || !b.tokenHold || !b.nativeHold)
        refuse("merchant_foreground_authority_required_or_expired");
    if (o.feeContext !== undefined && (b.feeWitness === null || now.toISOString() < b.feeWitness.startedAt || now.toISOString() >= b.feeWitness.endsAt))
        refuse("merchant_fee_witness_expired");
    if (effect !== undefined) {
        if (effect === "send" && b.material === null)
            refuse("merchant_material_authority_required");
        if (b[effect])
            refuse("merchant_effect_authority_consumed");
        b[effect] = true;
    }
}
/** Actual RPC check timestamp is anchored before its awaits, never renewed by a delayed wallet/queue/TLS step. */
export function bindMerchantFeeAdmission(grant, controller, o, fresh, started, now) {
    const b = grants.get(grant.opaque);
    if (b === undefined || !b.live || b.controller !== controller || b.frame !== o.fingerprint || o.feeContext === undefined || now.toISOString() >= b.endsAt)
        refuse("merchant_fee_authority_required");
    validateMerchantFeeContext(fresh, o.envelope);
    if (BigInt(fresh.admissionEstimatedUpper) > BigInt(o.envelope.nativeFeeReserveWei ?? o.feeContext.admissionEstimatedUpper) || now.getTime() < started.getTime() || now.getTime() - started.getTime() >= 10000)
        refuse("merchant_fee_witness_expired");
    b.feeWitness = { startedAt: started.toISOString(), endsAt: new Date(Math.min(started.getTime() + 10000, Date.parse(b.endsAt))).toISOString(), digest: hashObject(fresh) };
}
export function bindMerchantMaterial(grant, controller, o, now, materialHash) { assertMerchantAuthority(grant, controller, o, now); const b = grants.get(grant.opaque); if (b.material !== null || !/^[a-f0-9]{64}$/u.test(materialHash))
    refuse("merchant_material_authority_binding"); b.material = materialHash; }
export function disposeMerchantAuthority(grant) { const b = grants.get(grant.opaque); if (b !== undefined)
    b.live = false; grants.delete(grant.opaque); }
export function merchantHoldBinding(o, reservationDigest) { return hashObject({ frame: o.fingerprint, reservationDigest }); }
//# sourceMappingURL=authority.js.map