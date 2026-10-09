import { hashObject } from "../canonical.js";
import type { MerchantOperation } from "./model.js";
import { refuse } from "./protocol.js";
export type MerchantEffect = "sign" | "send";
export interface MerchantAuthority { readonly opaque: object; }
interface Binding { controller: object; frame: string; endsAt: string; live: boolean; sign: boolean; send: boolean; tokenHold: string; nativeHold: string; material: string|null; }
const grants = new WeakMap<object, Binding>();
/** This in-memory authority exists only during the foreground approval under its policy lock. */
export function issueMerchantAuthority(controller: object, o: MerchantOperation, tokenHold: string, nativeHold: string, now:Date=new Date(o.createdAt)): MerchantAuthority {
    if (o.effectBinding === undefined) refuse("merchant_new_effect_binding_required");
    const opaque = Object.freeze({});
    grants.set(opaque, { controller, frame:o.fingerprint, endsAt:[o.expiresAt,o.effectBinding.policyEndsAt,new Date(now.getTime()+120000).toISOString()].sort()[0]!, live:true, sign:false, send:false, tokenHold, nativeHold, material:null });
    return Object.freeze({opaque});
}
export function assertMerchantAuthority(grant: MerchantAuthority | undefined, controller: object, o: MerchantOperation, now: Date, effect?: MerchantEffect): void {
    const b = grant === undefined ? undefined : grants.get(grant.opaque);
    if (b === undefined || !b.live || b.controller !== controller || b.frame !== o.fingerprint || o.effectBinding === undefined || now.toISOString() >= b.endsAt || now.toISOString().slice(0,10) !== o.createdAt.slice(0,10) || !b.tokenHold || !b.nativeHold)
        refuse("merchant_foreground_authority_required_or_expired");
    if (effect !== undefined) { if(effect==="send"&&b.material===null)refuse("merchant_material_authority_required"); if (b[effect]) refuse("merchant_effect_authority_consumed"); b[effect]=true; }
}
export function bindMerchantMaterial(grant:MerchantAuthority, controller:object,o:MerchantOperation,now:Date,materialHash:string) { assertMerchantAuthority(grant,controller,o,now); const b=grants.get(grant.opaque)!; if(b.material!==null || !/^[a-f0-9]{64}$/u.test(materialHash))refuse("merchant_material_authority_binding");b.material=materialHash; }
export function disposeMerchantAuthority(grant: MerchantAuthority): void { const b=grants.get(grant.opaque); if(b!==undefined)b.live=false; grants.delete(grant.opaque); }
export function merchantHoldBinding(o: MerchantOperation, reservationDigest: string) { return hashObject({frame:o.fingerprint,reservationDigest}); }
