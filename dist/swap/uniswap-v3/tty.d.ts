import type { GuardedSwapApprovalIntent } from "../runtime.js";
import type { SavedUniswapQuoteStore } from "./material.js";
/**
 * The exact foreground screen for one guarded native-input Uniswap swap (consent: TtyGuardedSwapApproval "uniswap"). The
 * quote's own chain names the lane: its network, native coin, wrapped token, router and token standard.
 */
export declare function uniswapApprovalScreen(quotes: Pick<SavedUniswapQuoteStore, "load">, intent: GuardedSwapApprovalIntent): Promise<readonly string[]>;
