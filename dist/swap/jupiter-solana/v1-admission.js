import { canonicalJson, domainHash } from "../../canonical.js";
import { evaluateAssetPolicy } from "../../asset-policy-registry.js";
import { ApnError } from "../../errors.js";
import { validateSwapOperation } from "../model.js";
import { swapMechanismDigest } from "../pin.js";
import { validateJupiterV1PreparedMaterial } from "./v1-material.js";
import { JUPITER_V1_WHIRLPOOL_MECHANISM_PIN } from "./v1-pins.js";
export const JUPITER_V1_MECHANISM_DIGEST = swapMechanismDigest(JUPITER_V1_WHIRLPOOL_MECHANISM_PIN);
/** Resolves the owner-activated sealed policy and both public/envelope identities before any custody access. */
export class JupiterV1OwnerAdmission {
    accounts;
    activePolicy;
    usage;
    now;
    constructor(accounts, activePolicy, usage, now) {
        this.accounts = accounts;
        this.activePolicy = activePolicy;
        this.usage = usage;
        this.now = now;
    }
    async localAccount(profile, expected) {
        const publicAccount = await this.accounts.account(profile, "solana"), envelopeAccount = await this.accounts.ownerBinding(profile, "solana");
        if (publicAccount === null || envelopeAccount === null || canonicalJson(publicAccount) !== canonicalJson(envelopeAccount) ||
            publicAccount.profile !== profile || publicAccount.rail !== "solana" || publicAccount.network !== "mainnet" || publicAccount.provider !== "local" ||
            publicAccount.custody !== "local_software" || expected !== undefined && publicAccount.address !== expected)
            blocked("The profile's public and encrypted Solana owner binding changed.");
        return detached(publicAccount);
    }
    async resolve(profile, amountAtomic, minimumOutputAtomic, expected, ownReservationAtomic = "0") {
        const account = await this.localAccount(profile, expected), active = await this.activePolicy(profile), now = this.now(), at = now.toISOString();
        if (active === null || active.profile !== profile || active.accounts.solana !== account.address || active.digest !== active.registry.policyDigest)
            blocked("The exact active owner policy is required.");
        for (const [asset, amount] of [[{ kind: "native", identifier: null }, amountAtomic], [{ kind: "token", identifier: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" }, minimumOutputAtomic]]) {
            const used = await this.usage.usage({ account: account.address, chain: JUPITER_V1_WHIRLPOOL_MECHANISM_PIN.chain, asset }, now);
            const admitted = evaluateAssetPolicy(active.registry, { chain: JUPITER_V1_WHIRLPOOL_MECHANISM_PIN.chain, asset, rail: "swap", amountAtomic: amount,
                dailyUsageAtomic: asset.kind === "native" ? (BigInt(used.amountAtomic) - BigInt(ownReservationAtomic)).toString() : used.amountAtomic, asOfDate: at.slice(0, 10), asOf: at });
            if (admitted.asset.mechanismPins?.swap === undefined || swapMechanismDigest(admitted.asset.mechanismPins.swap) !== JUPITER_V1_MECHANISM_DIGEST)
                blocked("Both assets require the exact Jupiter V1 Whirlpool mechanism admission.");
        }
        const body = { account, accountBindingHash: jupiterV1AccountBindingHash(account), policyDigest: active.digest, activationDigest: active.activationDigest };
        return detached({ ...body, admissionHash: domainHash("apn.jupiter-v1-owner-admission.v1", canonicalJson(body)) });
    }
    async assert(operationValue, materialValue) {
        const op = validateSwapOperation(operationValue), material = validateJupiterV1PreparedMaterial(materialValue);
        if (op.mechanismDigest !== JUPITER_V1_MECHANISM_DIGEST || canonicalJson(op.quote) !== canonicalJson(material.quote) ||
            op.approvalCapAtomic !== material.approvalCapAtomic)
            blocked("The prepared Jupiter operation or material changed.");
        const admission = await this.resolve(op.quote.profile, op.quote.inputAmountAtomic, op.quote.minimumOutputAtomic, op.quote.account, op.usageLease !== null && ["reserved", "submitted", "unknown_finality"].includes(op.usageLease.state) ? op.usageLease.amountAtomic : "0");
        if (admission.policyDigest !== op.policyDigest)
            blocked("The active Jupiter owner policy changed after preparation.");
        return admission;
    }
}
export function jupiterV1AccountBindingHash(account) { return domainHash("apn.jupiter-v1-owner-account.v1", canonicalJson(account)); }
export function detached(value) { const copy = JSON.parse(JSON.stringify(value)); const freeze = (v) => { if (v !== null && typeof v === "object") {
    for (const child of Object.values(v))
        freeze(child);
    Object.freeze(v);
} }; freeze(copy); return copy; }
function blocked(message) { throw new ApnError("APN_OPERATION_BLOCKED", message, { reason: "jupiter_v1_owner_admission" }); }
//# sourceMappingURL=v1-admission.js.map