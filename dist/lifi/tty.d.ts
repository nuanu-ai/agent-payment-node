import { type TtyTransferApprovalOptions } from "../tty-approval.js";
import type { BridgeApprovalPort } from "./ports.js";
export declare class TtyBridgeApproval implements BridgeApprovalPort {
    private readonly options;
    constructor(options?: TtyTransferApprovalOptions);
    confirm(input: Parameters<BridgeApprovalPort["confirm"]>[0]): Promise<boolean>;
}
/** What the pre-send fee check bounds on the source network, by its fee model (QA 0.5.68: the line named Base for every source). */
export declare function sourceFeeNote(chainId: number): string;
