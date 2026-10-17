import type { GuardedSwapApprovalIntent } from "../runtime.js";
import type { SunSwapPreparedMaterialPort } from "./prepared.js";
/** The exact foreground screen for one guarded SunSwap swap (consent: TtyGuardedSwapApproval "sunswap"). */
export declare function sunSwapApprovalScreen(store: Pick<SunSwapPreparedMaterialPort, "load">, intent: GuardedSwapApprovalIntent): Promise<readonly string[]>;
