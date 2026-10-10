import { MerchantRetirementClaims } from "./retirement-claims.js";
import { SecureStateStore } from "../secure-state-store.js";
import { canonicalJson, hashObject } from "../canonical.js";
import type { MerchantOperation } from "./model.js";
import { refuse } from "./protocol.js";
export class MerchantClaims extends SecureStateStore {
    private binding(o: MerchantOperation, effect: "sign"|"send", txHash: string|null) { return {schemaVersion:"apn.merchant-effect-claim.v1",operationId:o.operationId,profileHash:o.profileHash,fingerprint:o.fingerprint,effect,txHash}; }
    async assertUnused(o: MerchantOperation) {
        await new MerchantRetirementClaims(this.root).assertNoRetirement(o);
        for (const p of [`merchant-effect-claims/${o.operationId}.sign.json`,`merchant-effect-claims/${o.operationId}.send.json`,`merchant-material/${o.operationId}.json`]) if (await this.readJson(p)!==null) refuse("merchant_retained_effect_claim_or_material");
    }
    async requireSign(o:MerchantOperation) { await new MerchantRetirementClaims(this.root).assertNoRetirement(o); const b=this.binding(o,"sign",null); if(canonicalJson(await this.readJson(`merchant-effect-claims/${o.operationId}.sign.json`))!==canonicalJson({...b,claimDigest:hashObject(b)}))refuse("merchant_sign_claim_required"); if(await this.readJson(`merchant-material/${o.operationId}.json`)!==null || await this.readJson(`merchant-effect-claims/${o.operationId}.send.json`)!==null)refuse("merchant_retained_signed_material"); }
    /** Independent create-only/fsynced records survive restoring only the operation and usage journals. */
    async claim(o: MerchantOperation, effect:"sign"|"send", txHash:string|null=null) {
        await new MerchantRetirementClaims(this.root).assertNoRetirement(o);
        await this.initialize(); await this.ensureDirectory("merchant-effect-claims");
        if(effect==="send") {
            const prior=await this.readJson(`merchant-effect-claims/${o.operationId}.sign.json`), b=this.binding(o,"sign",null);
            if(canonicalJson(prior)!==canonicalJson({...b,claimDigest:hashObject(b)})) refuse("merchant_sign_claim_binding");
        }
        const b=this.binding(o,effect,txHash);
        await this.writeJson(`merchant-effect-claims/${o.operationId}.${effect}.json`,{...b,claimDigest:hashObject(b)},true);
    }
}
