import { canonicalJson, hashObject } from "../canonical.js";
import { activeAssetPolicyFromState, loadActiveAssetPolicyRegistry } from "../allowlist-active-policy.js";
import { AllowlistPolicyStore } from "../allowlist-policy-store.js";
import { allowlistProfileHash } from "../allowlist-policy-overlay.js";
import { evaluateAssetPolicy } from "../asset-policy-registry.js";
import { AssetUsageLedger, assetUsageReservationId } from "../asset-usage-ledger.js";
import { assertEvmNativeCustody } from "../evm-native-custody.js";
import { assertExclusiveEvmRawSigner } from "../evm-address-ownership.js";
import { merchantTerms } from "./terms.js";
import { merchantHoldBinding } from "./authority.js";
import { refuse } from "./protocol.js";
/** The payer's token usage bucket; the payer is the operation's own custody wallet. */
export function merchantUsageIdentity(t) { return { account: t.payer, chain: t.chain, asset: { kind: "token", identifier: t.token } }; }
/** The payer's native fee bucket on the payment chain. */
export function merchantNativeUsageIdentity(t) { return { account: t.payer, chain: t.chain, asset: { kind: "native", identifier: null } }; }
export function merchantUsageKey(id) { return `apn.merchant-x402:${id}`; }
export function merchantNativeUsageKey(id) { return `apn.merchant-native:${id}`; }
export class MerchantOwner {
    state;
    now;
    policyLocked;
    ledger;
    constructor(state, now, policyLocked = false) {
        this.state = state;
        this.now = now;
        this.policyLocked = policyLocked;
        this.ledger = new AssetUsageLedger(state.root);
    }
    async withPolicyLock(profile, action) {
        // Wallet/operation/address outer locks precede the distinct real allowlist profile lock.
        return this.state.withLocks([`profile:${allowlistProfileHash(profile)}`], () => action(new MerchantOwner(this.state, this.now, true)));
    }
    /** The profile's active policy, whose EVM account must be the payer (custody of the same profile). */
    async active(profile, payer) {
        const active = this.policyLocked ? activeAssetPolicyFromState(await new AllowlistPolicyStore(this.state.root).readUnderProfileLock(profile), this.now()) : await loadActiveAssetPolicyRegistry(this.state.root, profile, this.now());
        if (active === null || active.accounts.evm !== payer)
            refuse("merchant_owner_policy_required");
        return active;
    }
    async evaluate(active, terms, identity, amount, operation) {
        const at = this.now(), usage = await this.ledger.usage(identity, at), key = identity.asset.kind === "native" ? merchantNativeUsageKey : merchantUsageKey;
        const reservation = operation === undefined ? null : await this.ledger.load(identity, assetUsageReservationId(identity, key(operation.operationId)));
        if (reservation !== null && (reservation.amountAtomic !== amount || reservation.policyDigest !== operation.policy.digest || reservation.rail !== "x402"))
            refuse("merchant_usage_binding");
        const own = reservation !== null && ["reserved", "submitted", "unknown_finality"].includes(reservation.state) ? BigInt(amount) : 0n;
        if (own > BigInt(usage.amountAtomic))
            refuse("merchant_usage_accounting");
        const admission = evaluateAssetPolicy(active.registry, { chain: identity.chain, asset: identity.asset, rail: "x402", amountAtomic: amount, dailyUsageAtomic: (BigInt(usage.amountAtomic) - own).toString(), asOfDate: at.toISOString().slice(0, 10), asOf: at.toISOString() });
        if (admission.asset.decimals !== 18 || canonicalJson(admission.asset.mechanismPins?.x402 ?? null) !== canonicalJson(terms.mechanism))
            refuse("merchant_mechanism_pin_required");
        return reservation;
    }
    /** Token and (when given) native fee admission of `terms` under the profile's active policy. */
    async admit(profile, terms, operation, nativeAmount) {
        const active = await this.active(profile, terms.payer);
        await this.evaluate(active, terms, merchantUsageIdentity(terms), terms.amount, operation);
        const amount = operation?.effectBinding?.nativeAmountAtomic ?? nativeAmount;
        if (amount !== undefined)
            await this.evaluate(active, terms, merchantNativeUsageIdentity(terms), amount, operation);
        return { digest: active.digest, revision: active.revision, activationDigest: active.activationDigest };
    }
    async effectBinding(profile, terms, nativeAmountAtomic, expiresAt) {
        const active = await this.active(profile, terms.payer);
        await this.evaluate(active, terms, merchantNativeUsageIdentity(terms), nativeAmountAtomic);
        return { nativeAmountAtomic, policyEndsAt: active.registry.expiresAt ?? expiresAt };
    }
    async confirm(o) {
        const terms = merchantTerms(o);
        await assertEvmNativeCustody(this.state, o.profile, o.custody);
        await assertExclusiveEvmRawSigner(this.state, terms.payer, o.profileHash);
        if (canonicalJson(await this.admit(o.profile, terms, o)) !== canonicalJson(o.policy))
            refuse("merchant_active_policy_changed");
        if (o.effectBinding !== undefined && this.now().toISOString() >= o.effectBinding.policyEndsAt)
            refuse("merchant_policy_window_expired");
    }
    async reserve(o) {
        if (!this.policyLocked || o.effectBinding === undefined)
            refuse("merchant_new_effect_binding_required");
        const terms = merchantTerms(o);
        await this.confirm(o);
        const active = await this.active(o.profile, terms.payer);
        // Reserve both effects before any key access. Failure leaves any partial hold charged; it does not authorize effects.
        for (const [identity, amount, key] of [[merchantUsageIdentity(terms), terms.amount, merchantUsageKey(o.operationId)], [merchantNativeUsageIdentity(terms), o.effectBinding.nativeAmountAtomic, merchantNativeUsageKey(o.operationId)]]) {
            const r = await this.ledger.reserve({ ...identity, registry: active.registry, rail: "x402", amountAtomic: amount, idempotencyKey: key, now: this.now() });
            if (r.state !== "reserved")
                refuse("merchant_usage_already_crossed_boundary");
        }
    }
    async held(o) {
        if (o.effectBinding === undefined)
            refuse("merchant_new_effect_binding_required");
        const digests = [], terms = merchantTerms(o);
        for (const [identity, amount, key] of [[merchantUsageIdentity(terms), terms.amount, merchantUsageKey(o.operationId)], [merchantNativeUsageIdentity(terms), o.effectBinding.nativeAmountAtomic, merchantNativeUsageKey(o.operationId)]]) {
            const r = await this.ledger.load(identity, assetUsageReservationId(identity, key));
            if (r === null || r.amountAtomic !== amount || r.policyDigest !== o.policy.digest || r.rail !== "x402" || !["reserved", "submitted", "unknown_finality"].includes(r.state))
                refuse("merchant_effect_hold_required");
            digests.push(merchantHoldBinding(o, r.reservationDigest));
        }
        return { token: digests[0], native: digests[1] };
    }
    async follow(o, target, freshReceipt) {
        const terms = merchantTerms(o), token = [merchantUsageIdentity(terms), terms.amount, merchantUsageKey(o.operationId)];
        const entries = o.effectBinding === undefined ? [token] : [token, [merchantNativeUsageIdentity(terms), o.effectBinding.nativeAmountAtomic, merchantNativeUsageKey(o.operationId)]];
        for (const [identity, amount, key] of entries) {
            if (target === "finalized" && identity.asset.kind === "native" && o.envelope.nativeFeeReserveWei !== undefined) {
                if (freshReceipt === undefined)
                    refuse("merchant_native_actual_fee_authority_required");
                await this.ledger.settleMerchantNativeActualFee(o, freshReceipt, this.now());
                continue;
            }
            const reservationId = assetUsageReservationId(identity, key), r = await this.ledger.load(identity, reservationId);
            if (r === null || r.policyDigest !== o.policy.digest || r.amountAtomic !== amount || r.rail !== "x402")
                refuse("merchant_usage_binding");
            if (r.state === target)
                continue;
            if (["finalized", "failed_before_effect", "failed_confirmed_revert", "released_unsubmitted"].includes(r.state))
                refuse("merchant_usage_terminal_conflict");
            await this.ledger.transition({ ...identity, reservationId, policyDigest: o.policy.digest, state: target, now: this.now(), ...(target === "unknown_finality" ? {} : { outcomeDigest: hashObject({ operationId: o.operationId, target, receipt: o.receipt }) }), ...(target === "failed_confirmed_revert" && identity.asset.kind === "native" ? { consumedAtomic: o.receipt.networkFeeWei } : {}) });
        }
    }
}
//# sourceMappingURL=owner.js.map