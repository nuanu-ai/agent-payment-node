import { type TtyTransferApprovalOptions } from "../tty-approval.js";
import type { CircleV2SourceApprovalPort } from "./circle-v2-source-service.js";
export declare class TtyCircleV2SourceApproval implements CircleV2SourceApprovalPort {
    private readonly options;
    constructor(options?: TtyTransferApprovalOptions);
    approve(p: Parameters<CircleV2SourceApprovalPort["approve"]>[0]): Promise<void>;
}
