import { type TtyTransferApprovalOptions } from "../tty-approval.js";
import type { BridgeApprovalPort } from "./ports.js";
export declare class TtyBridgeApproval implements BridgeApprovalPort {
    private readonly options;
    constructor(options?: TtyTransferApprovalOptions);
    confirm(input: Parameters<BridgeApprovalPort["confirm"]>[0]): Promise<boolean>;
}
/** What the pre-send fee check bounds on the source network, by its fee model (each source names its own network, never Base for all). */
export declare function sourceFeeNote(chainId: number): string;
