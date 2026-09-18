import type { ClockPort } from "../../ports.js";
import { type TtyTransferApprovalOptions } from "../../tty-approval.js";
import { type GuardedSwapApprovalArtifact, type GuardedSwapApprovalIntent, type GuardedSwapForegroundApprovalPort } from "../runtime.js";
import type { SavedUniswapQuoteStore } from "./material.js";
/** The exact foreground screen for one guarded Uniswap swap. The owner types a short code bound to every line. */
export declare class TtyUniswapSwapApproval implements GuardedSwapForegroundApprovalPort {
    private readonly quotes;
    private readonly clock;
    private readonly options;
    constructor(quotes: Pick<SavedUniswapQuoteStore, "load">, clock: ClockPort, options?: TtyTransferApprovalOptions);
    approve(intent: GuardedSwapApprovalIntent): Promise<GuardedSwapApprovalArtifact>;
}
export declare function uniswapApprovalCode(intent: GuardedSwapApprovalIntent, lines: readonly string[]): string;
export declare function uniswapApprovalScreen(quotes: Pick<SavedUniswapQuoteStore, "load">, intent: GuardedSwapApprovalIntent): Promise<readonly string[]>;
