import type { GaslessApprovalPort } from "../gasless/ports.js";
import { type TtyTransferApprovalOptions } from "../tty-approval.js";
export declare class TtyFacilitatorApproval implements GaslessApprovalPort {
    private readonly options;
    constructor(options?: TtyTransferApprovalOptions);
    confirm(input: Parameters<GaslessApprovalPort["confirm"]>[0]): Promise<boolean>;
}
