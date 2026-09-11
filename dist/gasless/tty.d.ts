import { type TtyTransferApprovalOptions } from "../tty-approval.js";
import type { GaslessApprovalPort } from "./ports.js";
export declare class TtyGaslessApproval implements GaslessApprovalPort {
    private readonly options;
    constructor(options?: TtyTransferApprovalOptions);
    confirm(input: Parameters<GaslessApprovalPort["confirm"]>[0]): Promise<boolean>;
}
