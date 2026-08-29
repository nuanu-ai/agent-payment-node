import type { ForegroundAuthenticationPort, ProviderAdapterBundle, ProviderBalanceObservation, ProviderLifecyclePort, ProviderWalletReadPort } from "./provider-ports.js";
import type { Address } from "./model.js";
export declare const AWAL_PROVIDER_ID: "coinbase-agentic-wallet";
export declare const AWAL_VERSION: "2.12.1";
export declare const AWAL_BIN: "dist/index.js";
export declare const AWAL_INTEGRITY: "sha512-z4whchSMbUhDuhwoI/+7vZ1ArwG9e8C9yIX9Y3W+JXJkR3E95iIZ1vIBZ6nPWSzakCw21YuZhFvOpGKEXtN6kQ==";
export declare const AWAL_SHASUM: "9c4c077983d608e278ed84053199427026ebbaa8";
export declare const AWAL_PROCESS_TIMEOUT_MS = 30000;
export interface AwalProcessResult {
    readonly exitCode: number;
    readonly stdout: Buffer;
    readonly optionalFailure?: "unsupported" | "unavailable";
}
export interface AwalProcessRunnerPort {
    run(argv: readonly string[], sensitive: boolean): Promise<AwalProcessResult>;
}
interface AwalStream {
    on(event: "data", listener: (chunk: Buffer | string) => void): unknown;
    removeListener(event: "data", listener: (chunk: Buffer | string) => void): unknown;
}
interface AwalChild {
    readonly stdout: AwalStream;
    readonly stderr: AwalStream;
    once(event: "error", listener: (error: Error) => void): unknown;
    once(event: "close", listener: (code: number | null) => void): unknown;
    removeListener(event: "error", listener: (error: Error) => void): unknown;
    removeListener(event: "close", listener: (code: number | null) => void): unknown;
    kill(): unknown;
}
export type AwalLaunchPort = (executable: string, args: readonly string[], options: {
    readonly shell: false;
    readonly stdio: readonly ["ignore", "pipe", "pipe"];
}) => AwalChild;
export declare class NodeAwalProcessRunner implements AwalProcessRunnerPort {
    private readonly binResolver;
    private readonly launch;
    private readonly timeoutMs;
    constructor(binResolver?: () => Promise<string>, launch?: AwalLaunchPort, timeoutMs?: number);
    run(argv: readonly string[], sensitive: boolean): Promise<AwalProcessResult>;
}
export declare class AwalProcessAdapter implements ProviderLifecyclePort, ProviderWalletReadPort {
    private readonly runner;
    readonly capabilities: import("./provider-profile.js").ProviderCapabilitySnapshot;
    constructor(runner?: AwalProcessRunnerPort);
    bundle(): ProviderAdapterBundle;
    connect(foreground: ForegroundAuthenticationPort): Promise<void>;
    logout(): Promise<void>;
    observeBalance(): Promise<ProviderBalanceObservation>;
    probeStatus(): Promise<void>;
    crossCheckAddress(expected: Address): Promise<void>;
    private runSensitive;
}
export declare function resolveAwalBin(): Promise<string>;
export {};
