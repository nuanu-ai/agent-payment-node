import { approvalCode } from "../approval-code.js";
import { canonicalJson, domainHash } from "../canonical.js";
import { ApnError } from "../errors.js";
import { formatAtomic } from "../money.js";
import { exactChainConsent } from "../tty-approval.js";
import { PERMIT2_ADDRESS, X402_EXACT_PERMIT2_PROXY } from "./registry.js";
const FINGERPRINT_DOMAIN = "apn.x402-permit2.approval.v1";
/** Everything the owner authorizes, bound into one fingerprint and its six-character code. Pure; nothing is signed here. */
export function permit2ApprovalScreen(summary) {
    const { plan } = summary, asset = plan.selection.listAsset, auth = plan.authorization;
    const units = (atomic) => `${formatAtomic(atomic, asset.decimals)} ${asset.symbol} (${atomic} atomic)`;
    const deadline = new Date(Number(auth.deadline) * 1000).toISOString();
    const fingerprint = domainHash(FINGERPRINT_DOMAIN, canonicalJson({
        profile: summary.profile, operationId: summary.operationId, resourceOrigin: summary.resourceOrigin, planHash: plan.planHash,
        offerHash: plan.selection.offerHash, binding: summary.binding, caps: summary.caps, dailyUsageAtomic: summary.dailyUsageAtomic,
        approveBefore: summary.approveBefore,
    }));
    const lines = [
        `Agent Payment Node — x402 payment in ${asset.symbol} (exact scheme, Permit2 transfer)`,
        `Profile: ${summary.profile}; local software custody`,
        `Seller resource: ${summary.resourceOrigin}`,
        `Chain: ${asset.chain} (${asset.networkName})`,
        `${asset.symbol} contract: ${asset.token}`,
        `Payer: ${auth.from}`,
        `Pay to: ${auth.witness.to}`,
        `Amount: ${units(auth.permitted.amount)}`,
        `You sign one Permit2 transfer for exactly this payee and amount, spendable only by the x402 exact proxy ${X402_EXACT_PERMIT2_PROXY}.`,
        ...(plan.eip2612 === null
            ? ["Your existing Permit2 allowance covers this amount; no token permit is signed."]
            : [`You also sign one EIP-2612 permit letting Permit2 (${PERMIT2_ADDRESS}) pull exactly ${units(plan.eip2612.info.amount)}; never an unlimited approval.`]),
        `Both signatures stop working at ${deadline}. The seller's facilitator submits the transaction and pays the gas.`,
        "APN proves settlement from the chain; a seller or facilitator claim alone never completes the payment.",
        `Owner policy revision ${summary.binding.policyRevision}: per payment ${units(summary.caps.maximumPerTransferAtomic)}; ` +
            `daily ${units(summary.caps.dailyLimitAtomic)}; used today ${units(summary.dailyUsageAtomic)}`,
        `Operation: ${summary.operationId}`,
        `Fingerprint: ${fingerprint}`,
        `Approve before: ${summary.approveBefore}`,
    ];
    return { lines, fingerprint, code: approvalCode("transfer", "x402-permit2", fingerprint) };
}
/** Foreground-only decision. A refused or wrong code returns false; a missing terminal fails closed. */
export class TtyPermit2Approval {
    options;
    constructor(options = {}) {
        this.options = options;
    }
    async confirm(screen, approveBefore) {
        try {
            await exactChainConsent(screen.lines, screen.code, approveBefore, this.options);
            return true;
        }
        catch (error) {
            if (error instanceof ApnError && error.code === "APN_NATIVE_REJECTED" && error.details?.nativeCode !== "APN_TTY_UNAVAILABLE")
                return false;
            throw error;
        }
    }
}
//# sourceMappingURL=approval.js.map