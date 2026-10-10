import { canonicalJson, domainHash, sha256 } from "../canonical.js";
import { ApnError } from "../errors.js";
import { approvalCode } from "../approval-code.js";
import { exactChainConsent } from "../tty-approval.js";
import { reconstructPermit2ProductionMaterial } from "./production-material.js";
import { productionApprovalFingerprint, productionRiskBinding } from "./production-journal-codec.js";
import { PERMIT2_ADDRESS, X402_EXACT_PERMIT2_PROXY } from "./registry.js";
export function permit2ApprovalPurpose(value) {
    if (value !== "sign-only" && value !== "sign-and-submit-once")
        throw new ApnError("APN_OPERATION_BLOCKED", "Permit2 approval purpose is unsupported.");
    return value;
}
/** Pure sanitized disclosure. This is binding, never current-owner or chain authority. */
export function permit2ApprovalDisplay(record, purpose = "sign-only") {
    const p = reconstructPermit2ProductionMaterial(record.material), r = record.material.checked.request;
    const approvedPurpose = permit2ApprovalPurpose(purpose);
    const body = { purpose: approvedPurpose, operationId: record.operationId, profile: record.material.wallet.profile, payer: p.payer, chain: "eip155:43114",
        token: p.token, payTo: p.payTo, amountAtomic: p.amountAtomic, spender: PERMIT2_ADDRESS, proxy: X402_EXACT_PERMIT2_PROXY,
        tokenPermit: p.plan.eip2612 === null ? "not_requested" : "requested",
        permit2Deadline: p.plan.authorization.deadline, eip2612Deadline: p.plan.eip2612?.info.deadline ?? null,
        origin: new URL(r.url).origin, urlHash: sha256(r.url), requestHash: record.material.checked.requestHash,
        headersHash: sha256(canonicalJson(r.headers)), bodyHash: sha256(canonicalJson(r.bodyBase64)), materialHash: record.material.materialHash,
        typedDataDigest: record.material.typedDataDigest, eip2612Digest: record.material.eip2612Digest,
        ownerPolicyDigest: record.material.owner.policyDigest, policyRevision: record.material.checkpoint.policyRevision,
        maximumPerTransferAtomic: record.material.owner.maximumPerTransferAtomic, dailyLimitAtomic: record.material.owner.dailyLimitAtomic,
        fingerprint: domainHash("apn.x402-permit2-production.approval-purpose.v1", canonicalJson({ fingerprint: productionApprovalFingerprint(record), purpose: approvedPurpose })), riskBinding: productionRiskBinding(record) };
    return Object.freeze({ ...body, displayHash: domainHash("apn.x402-permit2-production.approval-display.v1", canonicalJson(body)) });
}
/** Foreground only; no key/custody lock is acquired here. */
export class TtyPermit2ForegroundApproval {
    options;
    constructor(options = {}) {
        this.options = options;
    }
    async approve(d) {
        await exactChainConsent([
            "Agent Payment Node Avalanche USDT Permit2 approval", `Operation: ${d.operationId}`, `Profile: ${d.profile}`,
            `Chain: ${d.chain}`, `Local payer: ${d.payer}`, `Token: ${d.token}`, `Payee: ${d.payTo}`, `Maximum token debit: ${d.amountAtomic} atomic USDT`,
            `Permit2 spender: ${d.spender}`, `Exact proxy: ${d.proxy}`, `Token permit: ${d.tokenPermit}`,
            `Permit2 deadline: ${d.permit2Deadline}`, `Token permit deadline: ${d.eip2612Deadline ?? "none"}`,
            `Merchant origin: ${d.origin}`, `Whole URL hash: ${d.urlHash}`, `Request hash: ${d.requestHash}`,
            `Headers hash: ${d.headersHash}`, `Body hash: ${d.bodyHash}`, `Material hash: ${d.materialHash}`,
            `Permit2 typed-data digest: ${d.typedDataDigest}`, `Token typed-data digest: ${d.eip2612Digest ?? "none"}`,
            `Owner policy: ${d.ownerPolicyDigest}; revision ${d.policyRevision}`, `Owner per-operation cap: ${d.maximumPerTransferAtomic}; daily cap ${d.dailyLimitAtomic}`,
            `Fingerprint: ${d.fingerprint}`, `Display hash: ${d.displayHash}`,
            d.purpose === "sign-and-submit-once"
                ? "Approval permits one guarded signature bundle and exactly one paid request for the frozen request, maximum token debit and payee shown above."
                : "Approval permits one guarded signing continuation only; it does not prove payment or authorize a merchant request.",
        ], approvalCode("gasless", "x402-permit2-production.v2", d.fingerprint), new Date(Number(BigInt(d.eip2612Deadline ?? d.permit2Deadline) < BigInt(d.permit2Deadline) ? d.eip2612Deadline : d.permit2Deadline) * 1000).toISOString(), this.options);
    }
}
//# sourceMappingURL=production-approval.js.map