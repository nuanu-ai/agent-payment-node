import type { Address } from "./model.js";
import type { X402SigningIntent, X402SigningPort, X402SigningResult } from "./provider-ports.js";
import type { MetaMaskProcessRunnerPort } from "./metamask-process-runner.js";
type Exclusive = <T>(work: () => Promise<T>) => Promise<T>;
export declare class MetaMaskX402Adapter implements X402SigningPort {
    private readonly runner;
    private readonly exclusive;
    readonly mode: "provider_detached_eip3009_apn_paid_retry";
    constructor(runner: MetaMaskProcessRunnerPort, exclusive?: Exclusive);
    request(input: X402SigningIntent): Promise<X402SigningResult>;
    observe(input: {
        readonly recoveryToken: string;
        readonly sender: Address;
        readonly waitSeconds?: number;
    }): Promise<X402SigningResult>;
    private selectAndCrossCheck;
}
export {};
