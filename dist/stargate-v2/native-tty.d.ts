import { type TtyTransferApprovalOptions } from "../tty-approval.js";
import type { StargateNativeExecutionPorts, StargateNativeOperation } from "./native-execution.js";
/** Exact foreground screen for the first admitted native lane. */
export declare class TtyStargateNativeApproval implements Pick<StargateNativeExecutionPorts, "approve"> {
    private readonly options;
    constructor(options?: TtyTransferApprovalOptions);
    approve(operation: StargateNativeOperation): Promise<void>;
}
