import { canonicalJson, domainHash } from "../canonical.js";
import { approvalCode } from "../approval-code.js";
import { ApnError } from "../errors.js";
import { exactChainConsent } from "../tty-approval.js";
import { sealGuardedSwapApproval } from "./runtime.js";
/**
 * The exact foreground screen for one guarded keyless swap. The owner types a short code bound to every line. The hash
 * domains are `apn.<family>-approval-screen.v1` and `apn.<family>-tty-consent.v1`, the bytes each family used before.
 */
export class TtyGuardedSwapApproval {
    family;
    screen;
    clock;
    options;
    constructor(family, screen, clock, options = {}) {
        this.family = family;
        this.screen = screen;
        this.clock = clock;
        this.options = options;
    }
    async approve(intent) {
        const lines = await this.screen(intent), code = guardedSwapApprovalCode(this.family, intent, lines);
        await exactChainConsent(lines, code, intent.deadline, this.options);
        // Consent time is read after the human answered, never the command start time.
        return sealGuardedSwapApproval(intent, this.clock.now(), domainHash(`apn.${this.family}-tty-consent.v1`, canonicalJson({ lines, code })));
    }
}
export function guardedSwapApprovalCode(family, intent, lines) {
    return approvalCode("swap", intent.operationId, domainHash(`apn.${family}-approval-screen.v1`, canonicalJson({ intent, lines })));
}
/** The saved material must be exactly what the approval intent shows; `deadline` also binds the quote expiry to it. */
export function assertSwapMaterialMatchesIntent(material, intent, options) {
    const quote = material.quote;
    if (quote.quoteHash !== intent.quoteHash || quote.inputAmountAtomic !== intent.inputAmountAtomic ||
        quote.expectedOutputAtomic !== intent.expectedOutputAtomic || quote.minimumOutputAtomic !== intent.minimumOutputAtomic ||
        quote.slippageBps !== intent.slippageBps || quote.account !== intent.account || quote.recipient !== intent.recipient ||
        (options.deadline && quote.expiresAt !== intent.deadline) || canonicalJson(material.gasOrEnergy) !== canonicalJson(intent.gasOrEnergy)) {
        throw new ApnError("APN_OPERATION_BLOCKED", "Prepared swap material does not match the approval intent.", { reason: "swap_material_drift" });
    }
}
export function requiredDisplay(record, key) {
    const value = record[key];
    if (value === undefined)
        throw new ApnError("APN_STATE_CORRUPT", `Guarded swap display lacks ${key}.`);
    return value;
}
//# sourceMappingURL=tty-consent.js.map