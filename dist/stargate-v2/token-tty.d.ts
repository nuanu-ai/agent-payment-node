import { type TtyTransferApprovalOptions } from "../tty-approval.js";
import type { StargateTokenExecutionPorts, StargateTokenOperation } from "./token-execution.js";
export declare class TtyStargateTokenApproval implements Pick<StargateTokenExecutionPorts, "approve"> {
    private readonly options;
    constructor(options?: TtyTransferApprovalOptions);
    approve(op: StargateTokenOperation): Promise<void>;
}
