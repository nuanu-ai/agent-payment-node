import { type TtyTransferApprovalOptions } from "../../tty-approval.js";
import type { MetaMaskDisableCall } from "./call.js";
import type { MetaMaskRevocationChain } from "./chain.js";
/** Everything the owner confirms; the code binds the screen to the exact call and its gas fields. */
export interface MetaMaskRevocationSummary {
    readonly operationId: string;
    readonly chainId: number;
    readonly call: MetaMaskDisableCall;
    readonly chain: MetaMaskRevocationChain;
    readonly fingerprint: string;
    readonly exactPhrase: string;
}
export interface MetaMaskRevocationApprovalPort {
    confirm(summary: MetaMaskRevocationSummary): Promise<boolean>;
}
export declare function metaMaskRevocationSummary(operationId: string, chainId: number, call: MetaMaskDisableCall, chain: MetaMaskRevocationChain): MetaMaskRevocationSummary;
export declare class TtyMetaMaskRevocationApproval implements MetaMaskRevocationApprovalPort {
    private readonly options;
    constructor(options?: TtyTransferApprovalOptions);
    confirm(s: MetaMaskRevocationSummary): Promise<boolean>;
}
