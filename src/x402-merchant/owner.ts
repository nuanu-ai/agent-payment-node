import { canonicalJson, hashObject } from "../canonical.js";
import { loadActiveAssetPolicyRegistry } from "../allowlist-active-policy.js";
import { evaluateAssetPolicy } from "../asset-policy-registry.js";
import { AssetUsageLedger, assetUsageReservationId, type AssetUsageIdentity } from "../asset-usage-ledger.js";
import { assertEvmNativeCustody } from "../evm-native-custody.js";
import { assertExclusiveEvmRawSigner } from "../evm-address-ownership.js";
import type { StateStore } from "../state.js";
import type { MerchantOperation } from "./model.js";
import { MERCHANT_AMOUNT, MERCHANT_CHAIN, MERCHANT_MECHANISM, MERCHANT_OWNER, MERCHANT_TOKEN } from "./pins.js";
import { refuse } from "./protocol.js";
export const merchantUsageIdentity: AssetUsageIdentity = { account: MERCHANT_OWNER, chain: MERCHANT_CHAIN, asset: { kind: "token", identifier: MERCHANT_TOKEN } };
export function merchantUsageKey(id: string) { return `apn.merchant-x402:${id}`; }
export class MerchantOwner {
    private readonly ledger: AssetUsageLedger;
    constructor(private readonly state: StateStore, private readonly now: () => Date) { this.ledger = new AssetUsageLedger(state.root); }
    async admit(profile: string, operation?: MerchantOperation) {
        const at = this.now(), active = await loadActiveAssetPolicyRegistry(this.state.root, profile, at);
        if (active === null || active.accounts.evm !== MERCHANT_OWNER)
            refuse("merchant_owner_policy_required");
        const usage = await this.ledger.usage(merchantUsageIdentity, at);
        const reservation = operation === undefined ? null : await this.ledger.load(merchantUsageIdentity, assetUsageReservationId(merchantUsageIdentity, merchantUsageKey(operation.operationId)));
        if (reservation !== null && (reservation.amountAtomic !== MERCHANT_AMOUNT || reservation.policyDigest !== operation!.policy.digest || reservation.rail !== "x402"))
            refuse("merchant_usage_binding");
        const own = reservation !== null && ["reserved", "submitted", "unknown_finality"].includes(reservation.state) ? BigInt(reservation.amountAtomic) : 0n;
        if (own > BigInt(usage.amountAtomic))
            refuse("merchant_usage_accounting");
        const admission = evaluateAssetPolicy(active.registry, { chain: merchantUsageIdentity.chain, asset: merchantUsageIdentity.asset, rail: "x402", amountAtomic: MERCHANT_AMOUNT, dailyUsageAtomic: (BigInt(usage.amountAtomic) - own).toString(), asOfDate: at.toISOString().slice(0, 10), asOf: at.toISOString() });
        if (admission.asset.decimals !== 18 || canonicalJson(admission.asset.mechanismPins?.x402 ?? null) !== canonicalJson(MERCHANT_MECHANISM))
            refuse("merchant_mechanism_pin_required");
        return { digest: active.digest, revision: active.revision, activationDigest: active.activationDigest };
    }
    async confirm(o: MerchantOperation) {
        await assertEvmNativeCustody(this.state, o.profile, o.custody);
        await assertExclusiveEvmRawSigner(this.state, MERCHANT_OWNER, o.profileHash);
        if (canonicalJson(await this.admit(o.profile, o)) !== canonicalJson(o.policy))
            refuse("merchant_active_policy_changed");
    }
    async reserve(o: MerchantOperation) {
        const active = await loadActiveAssetPolicyRegistry(this.state.root, o.profile, this.now());
        if (active === null || active.digest !== o.policy.digest || active.revision !== o.policy.revision || active.activationDigest !== o.policy.activationDigest)
            refuse("merchant_active_policy_changed");
        const r = await this.ledger.reserve({ ...merchantUsageIdentity, registry: active.registry, rail: "x402", amountAtomic: MERCHANT_AMOUNT, idempotencyKey: merchantUsageKey(o.operationId), now: this.now() });
        if (r.state !== "reserved")
            refuse("merchant_usage_already_crossed_boundary");
    }
    async follow(o: MerchantOperation, target: "unknown_finality" | "finalized" | "failed_confirmed_revert") {
        const reservationId = assetUsageReservationId(merchantUsageIdentity, merchantUsageKey(o.operationId)), r = await this.ledger.load(merchantUsageIdentity, reservationId);
        if (r === null || r.policyDigest !== o.policy.digest || r.amountAtomic !== MERCHANT_AMOUNT || r.rail !== "x402")
            refuse("merchant_usage_binding");
        if (r.state === target)
            return;
        if (["finalized", "failed_before_effect", "failed_confirmed_revert", "released_unsubmitted"].includes(r.state))
            refuse("merchant_usage_terminal_conflict");
        await this.ledger.transition({ ...merchantUsageIdentity, reservationId, policyDigest: o.policy.digest, state: target, now: this.now(), ...(target === "unknown_finality" ? {} : { outcomeDigest: hashObject({ operationId: o.operationId, target, receipt: o.receipt }) }) });
    }
}
