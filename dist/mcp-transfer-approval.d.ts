import type { CommandRequest } from "./commands.js";
import type { TransferApprovalIntent, TransferApprovalPort } from "./tty-approval.js";
type TransferApproveRequest = Extract<CommandRequest, {
    readonly command: "transfer.approve";
}>;
export declare class RejectingMcpTransferApproval implements TransferApprovalPort {
    private readonly request;
    private readonly rpcUrl;
    constructor(request: TransferApproveRequest, rpcUrl: string);
    approve(intent: TransferApprovalIntent): Promise<void>;
}
export {};
