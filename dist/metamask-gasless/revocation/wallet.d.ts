import type { Address, Hex } from "../../model.js";
import type { MetaMaskProcessObservation } from "../../metamask-process-observation.js";
import { type MetaMaskProcessRunnerPort } from "../../metamask-process-runner.js";
/**
 * What the wallet answered; an unknown answer is never a reason to send again (the pinned nonce allows one landing).
 * An unknown answer carries the child process's exit and stream shape (`provider`), so its cause can be read later.
 */
export type MetaMaskRevocationSubmission = {
    readonly disposition: "acknowledged";
    readonly transactionHash: Hex;
    readonly requestIdHash: string | null;
} | {
    readonly disposition: "pending";
    readonly requestIdHash: string;
} | {
    readonly disposition: "unknown";
    readonly reason: string;
    readonly provider?: MetaMaskProcessObservation;
};
export interface MetaMaskRevocationWalletPort {
    send(input: {
        readonly chainId: number;
        readonly from: Address;
        readonly payload: Readonly<Record<string, Hex>>;
        readonly intent: string;
    }): Promise<MetaMaskRevocationSubmission>;
}
/**
 * The owner's MetaMask Agent Wallet CLI signs and broadcasts (`mm wallet send-transaction`, the path the native lane
 * uses), after its own Guard policy and MFA. APN first checks that the selected wallet is the delegator; a selected
 * wallet that differs refuses before anything is handed over.
 */
export declare class MetaMaskCliRevocationWallet implements MetaMaskRevocationWalletPort {
    private readonly runner;
    constructor(runner?: MetaMaskProcessRunnerPort);
    send(input: Parameters<MetaMaskRevocationWalletPort["send"]>[0]): Promise<MetaMaskRevocationSubmission>;
}
