import { type TtyTransferApprovalOptions } from "../tty-approval.js";
import type { MetaMaskGaslessApprovalPort } from "./ports.js";
export declare class TtyMetaMaskGaslessApproval implements MetaMaskGaslessApprovalPort {
    private readonly options;
    constructor(options?: TtyTransferApprovalOptions);
    confirm(input: Parameters<MetaMaskGaslessApprovalPort["confirm"]>[0]): Promise<boolean>;
}
