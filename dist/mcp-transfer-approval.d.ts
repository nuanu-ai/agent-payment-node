import type { CommandRequest } from "./commands.js";
import type { ApnCore } from "./core.js";
import type { TransferApprovalIntent, TransferApprovalPort } from "./tty-approval.js";
import type { RailApprovalPort } from "./direct-rail-ports.js";
type TransferApproveRequest = Extract<CommandRequest, {
    readonly command: "transfer.approve";
}>;
export declare function genericTransferHandoff(core: ApnCore, request: TransferApproveRequest, approval: RejectingMcpTransferApproval): Promise<void>;
export declare class RejectingMcpTransferApproval implements TransferApprovalPort {
    private readonly request;
    private readonly rpcUrl?;
    constructor(request: TransferApproveRequest, rpcUrl?: string | undefined);
    approve(intent: TransferApprovalIntent): Promise<void>;
}
export declare class RejectingMcpRailApproval implements RailApprovalPort {
    approve(input: Parameters<RailApprovalPort["approve"]>[0]): Promise<void>;
}
export {};
