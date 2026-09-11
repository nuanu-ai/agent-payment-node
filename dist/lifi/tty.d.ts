import { type TtyTransferApprovalOptions } from "../tty-approval.js";
import type { BridgeApprovalPort } from "./ports.js";
export declare class TtyBridgeApproval implements BridgeApprovalPort {
    private readonly options;
    constructor(options?: TtyTransferApprovalOptions);
    confirm(input: Parameters<BridgeApprovalPort["confirm"]>[0]): Promise<boolean>;
}
