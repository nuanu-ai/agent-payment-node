import { type MetaMaskNativeDeadlineInput, type MetaMaskNativeDiagnostic } from "./metamask-native-diagnostic.js";
import { type MetaMaskRequestNotFound } from "./metamask-process-output.js";
export declare function takeMetaMaskNativeProcessFailureDiagnostic(error: unknown): MetaMaskNativeDiagnostic | undefined;
interface CapturedStream {
    on(event: "data", listener: (chunk: Buffer | string) => void): unknown;
    removeListener(event: "data", listener: (chunk: Buffer | string) => void): unknown;
}
interface CapturedChild {
    readonly stdout: CapturedStream;
    readonly stderr: CapturedStream;
    once(event: "error", listener: () => void): unknown;
    once(event: "close", listener: (code: number | null) => void): unknown;
    removeListener(event: "error", listener: () => void): unknown;
    removeListener(event: "close", listener: (code: number | null) => void): unknown;
    kill(): unknown;
}
interface ForegroundChild {
    once(event: "error", listener: () => void): unknown;
    once(event: "close", listener: (code: number | null) => void): unknown;
    removeListener(event: "error", listener: () => void): unknown;
    removeListener(event: "close", listener: (code: number | null) => void): unknown;
    kill(): unknown;
}
export type MetaMaskCapturedLaunchPort = (executable: string, args: readonly string[], options: {
    readonly shell: false;
    readonly stdio: readonly ["ignore", "pipe", "pipe"];
}) => CapturedChild;
export type MetaMaskForegroundLaunchPort = (executable: string, args: readonly string[], options: {
    readonly shell: false;
    readonly stdio: readonly [number, number, number];
}) => ForegroundChild;
export interface MetaMaskProcessResult {
    readonly exitCode: number;
    readonly stdout: Buffer;
    readonly nativeDiagnostic?: MetaMaskNativeDiagnostic;
    /**
     * `wallet requests watch <id>` only: where its REQUEST_NOT_FOUND answer on stderr says the request was not found
     * (metamask-process-output.ts). Absent for every other command and answer. A fact about mm's lookup, never an outcome.
     */
    readonly requestNotFound?: MetaMaskRequestNotFound;
}
export interface MetaMaskProcessRunnerPort {
    runJson(argv: readonly string[], timeoutMs?: number, absoluteDeadline?: MetaMaskNativeDeadlineInput): Promise<MetaMaskProcessResult>;
    runForeground(argv: readonly string[]): Promise<number>;
}
export declare class NodeMetaMaskProcessRunner implements MetaMaskProcessRunnerPort {
    private readonly binResolver;
    private readonly capturedLaunch;
    private readonly foregroundLaunch;
    private readonly jsonTimeoutMs;
    private readonly foregroundTimeoutMs;
    private readonly openTerminal;
    private readonly closeTerminal;
    constructor(binResolver?: () => Promise<string>, capturedLaunch?: MetaMaskCapturedLaunchPort, foregroundLaunch?: MetaMaskForegroundLaunchPort, jsonTimeoutMs?: number, foregroundTimeoutMs?: number, openTerminal?: () => number, closeTerminal?: (fd: number) => void);
    runJson(argv: readonly string[], timeoutMs?: number, absoluteDeadline?: MetaMaskNativeDeadlineInput): Promise<MetaMaskProcessResult>;
    runForeground(argv: readonly string[]): Promise<number>;
}
export {};
