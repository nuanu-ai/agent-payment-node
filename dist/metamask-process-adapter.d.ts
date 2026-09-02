import type { Address } from "./model.js";
import type { DirectExecutionPort, ForegroundAuthenticationPort, ProviderAdapterBundle, ProviderBalanceObservation, ProviderLifecyclePort, ProviderWalletReadPort } from "./provider-ports.js";
import { type MetaMaskProcessRunnerPort } from "./metamask-process-runner.js";
export declare const METAMASK_AGENT_WALLET_PROVIDER_ID: "metamask-agent-wallet";
export type ProviderExclusivePort = <T>(work: () => Promise<T>) => Promise<T>;
export declare class MetaMaskProcessAdapter implements ProviderLifecyclePort, ProviderWalletReadPort {
    private readonly runner;
    private readonly exclusive;
    private readonly now;
    private readonly direct;
    readonly capabilities: import("./provider-profile.js").ProviderCapabilitySnapshot;
    constructor(runner?: MetaMaskProcessRunnerPort, exclusive?: ProviderExclusivePort, now?: () => Date, direct?: DirectExecutionPort);
    bundle(): ProviderAdapterBundle;
    connect(_foreground: ForegroundAuthenticationPort): Promise<void>;
    probeStatus(): Promise<void>;
    logout(): Promise<void>;
    observeBalance(): Promise<ProviderBalanceObservation>;
    crossCheckAddress(expected: Address): Promise<void>;
    private doctor;
    private readAddressUnlocked;
}
