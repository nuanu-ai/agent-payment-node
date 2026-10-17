import type { GuardedSwapApprovalIntent } from "../runtime.js";
import type { SavedUniswapQuoteStore } from "./material.js";
/** The exact foreground screen for one guarded Uniswap swap (consent: TtyGuardedSwapApproval "uniswap"). */
export declare function uniswapApprovalScreen(quotes: Pick<SavedUniswapQuoteStore, "load">, intent: GuardedSwapApprovalIntent): Promise<readonly string[]>;
