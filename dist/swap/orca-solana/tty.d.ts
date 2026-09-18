import type { ClockPort } from "../../ports.js";
import { type TtyTransferApprovalOptions } from "../../tty-approval.js";
import { type GuardedSwapApprovalArtifact, type GuardedSwapApprovalIntent, type GuardedSwapForegroundApprovalPort } from "../runtime.js";
import type { SavedOrcaQuoteStore } from "./material.js";
/** The exact foreground screen for one guarded Orca swap. The owner types a short code bound to every line. */
export declare class TtyOrcaSwapApproval implements GuardedSwapForegroundApprovalPort {
    private readonly quotes;
    private readonly clock;
    private readonly options;
    constructor(quotes: Pick<SavedOrcaQuoteStore, "load">, clock: ClockPort, options?: TtyTransferApprovalOptions);
    approve(intent: GuardedSwapApprovalIntent): Promise<GuardedSwapApprovalArtifact>;
}
export declare function orcaApprovalCode(intent: GuardedSwapApprovalIntent, lines: readonly string[]): string;
export declare function orcaApprovalScreen(quotes: Pick<SavedOrcaQuoteStore, "load">, intent: GuardedSwapApprovalIntent): Promise<readonly string[]>;
