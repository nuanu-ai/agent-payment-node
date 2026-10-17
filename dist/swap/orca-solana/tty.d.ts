import type { GuardedSwapApprovalIntent } from "../runtime.js";
import { type SavedOrcaQuoteStore } from "./material.js";
/** The exact foreground screen for one guarded Orca swap (consent: TtyGuardedSwapApproval "orca"). */
export declare function orcaApprovalScreen(quotes: Pick<SavedOrcaQuoteStore, "load">, intent: GuardedSwapApprovalIntent): Promise<readonly string[]>;
