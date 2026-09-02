import type { Address } from "./model.js";
import type { DirectExecutionPort } from "./provider-ports.js";
import type { MetaMaskProcessRunnerPort } from "./metamask-process-runner.js";
type DirectResult = Awaited<ReturnType<NonNullable<DirectExecutionPort["execute"]>>>;
type ObserveResult = Awaited<ReturnType<NonNullable<DirectExecutionPort["observe"]>>>;
type Exclusive = <T>(work: () => Promise<T>) => Promise<T>;
export declare class MetaMaskDirectAdapter implements DirectExecutionPort {
    private readonly runner;
    private readonly exclusive;
    readonly mode: "provider_atomic_send";
    constructor(runner: MetaMaskProcessRunnerPort, exclusive?: Exclusive);
    execute(input: {
        readonly amountDecimal: string;
        readonly recipient: Address;
        readonly sender: Address;
    }): Promise<DirectResult>;
    observe(input: {
        readonly recoveryToken: string;
        readonly sender: Address;
        readonly waitSeconds?: number;
    }): Promise<ObserveResult>;
    private selectAndCrossCheck;
}
export {};
