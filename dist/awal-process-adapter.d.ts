import type { ForegroundAuthenticationPort, ProviderAdapterBundle, ProviderBalanceObservation, DirectExecutionPort, ProviderLifecyclePort, ProviderWalletReadPort, X402ExecutionPort } from "./provider-ports.js";
import type { Address } from "./model.js";
export declare const AWAL_PROVIDER_ID: "coinbase-agentic-wallet";
export { AWAL_BIN, AWAL_INTEGRITY, AWAL_PROCESS_TIMEOUT_MS, AWAL_SHASUM, AWAL_VERSION, resolveAwalBin, } from "./awal-package.js";
export interface AwalProcessResult {
    readonly exitCode: number;
    readonly stdout: Buffer;
    readonly optionalFailure?: "unsupported" | "unavailable";
    readonly loginDisposition?: "already_authenticated";
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
    private readonly direct;
    private readonly x402;
    readonly capabilities: import("./provider-profile.js").ProviderCapabilitySnapshot;
    constructor(runner?: AwalProcessRunnerPort, direct?: DirectExecutionPort, x402?: X402ExecutionPort);
    bundle(): ProviderAdapterBundle;
    connect(foreground: ForegroundAuthenticationPort): Promise<void>;
    logout(): Promise<void>;
    observeBalance(): Promise<ProviderBalanceObservation>;
    probeStatus(): Promise<void>;
    crossCheckAddress(expected: Address): Promise<void>;
    private runSensitive;
}
