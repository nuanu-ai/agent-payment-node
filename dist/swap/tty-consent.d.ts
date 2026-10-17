import type { ClockPort } from "../ports.js";
import { type TtyTransferApprovalOptions } from "../tty-approval.js";
import type { SwapFamily } from "./family-guards.js";
import type { SwapQuoteSnapshot } from "./quote.js";
import { type GuardedSwapApprovalArtifact, type GuardedSwapApprovalIntent, type GuardedSwapForegroundApprovalPort } from "./runtime.js";
/**
 * The exact foreground screen for one guarded keyless swap. The owner types a short code bound to every line. The hash
 * domains are `apn.<family>-approval-screen.v1` and `apn.<family>-tty-consent.v1`, the bytes each family used before.
 */
export declare class TtyGuardedSwapApproval implements GuardedSwapForegroundApprovalPort {
    private readonly family;
    private readonly screen;
    private readonly clock;
    private readonly options;
    constructor(family: SwapFamily, screen: (intent: GuardedSwapApprovalIntent) => Promise<readonly string[]>, clock: ClockPort, options?: TtyTransferApprovalOptions);
    approve(intent: GuardedSwapApprovalIntent): Promise<GuardedSwapApprovalArtifact>;
}
export declare function guardedSwapApprovalCode(family: SwapFamily, intent: GuardedSwapApprovalIntent, lines: readonly string[]): string;
/** The saved material must be exactly what the approval intent shows; `deadline` also binds the quote expiry to it. */
export declare function assertSwapMaterialMatchesIntent(material: {
    readonly quote: SwapQuoteSnapshot;
    readonly gasOrEnergy: unknown;
}, intent: GuardedSwapApprovalIntent, options: {
    readonly deadline: boolean;
}): void;
export declare function requiredDisplay(record: Readonly<Record<string, string>>, key: string): string;
