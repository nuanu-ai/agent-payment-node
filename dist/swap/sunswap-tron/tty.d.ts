import type { ClockPort } from "../../ports.js";
import { type TtyTransferApprovalOptions } from "../../tty-approval.js";
import { type GuardedSwapApprovalArtifact, type GuardedSwapApprovalIntent, type GuardedSwapForegroundApprovalPort } from "../runtime.js";
import type { SunSwapPreparedMaterialPort } from "./prepared.js";
/** The exact foreground screen for one guarded SunSwap swap. The owner types a short code bound to every line. */
export declare class TtySunSwapApproval implements GuardedSwapForegroundApprovalPort {
    private readonly store;
    private readonly clock;
    private readonly options;
    constructor(store: Pick<SunSwapPreparedMaterialPort, "load">, clock: ClockPort, options?: TtyTransferApprovalOptions);
    approve(intent: GuardedSwapApprovalIntent): Promise<GuardedSwapApprovalArtifact>;
}
export declare function sunSwapApprovalCode(intent: GuardedSwapApprovalIntent, lines: readonly string[]): string;
export declare function sunSwapApprovalScreen(store: Pick<SunSwapPreparedMaterialPort, "load">, intent: GuardedSwapApprovalIntent): Promise<readonly string[]>;
