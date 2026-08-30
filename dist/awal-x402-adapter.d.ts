import type { X402ExecutionPort } from "./provider-ports.js";
export declare const AWAL_X402_PROCESS_TIMEOUT_MS = 210000;
export declare const AWAL_X402_INTERNAL_TIMEOUT_MS = 180000;
export declare const AWAL_X402_SHUTDOWN_MARGIN_MS = 30000;
interface AwalX402Stream {
    on(event: "data", listener: (chunk: Buffer | string) => void): unknown;
    removeListener(event: "data", listener: (chunk: Buffer | string) => void): unknown;
}
interface AwalX402Child {
    readonly pid?: number;
    readonly stdout: AwalX402Stream;
    readonly stderr: AwalX402Stream;
    once(event: "spawn", listener: () => void): unknown;
    once(event: "error", listener: () => void): unknown;
    once(event: "close", listener: (code: number | null) => void): unknown;
    removeListener(event: "spawn", listener: () => void): unknown;
    removeListener(event: "error", listener: () => void): unknown;
    removeListener(event: "close", listener: (code: number | null) => void): unknown;
    kill(): unknown;
}
export type AwalX402LaunchPort = (executable: string, args: readonly string[], options: {
    readonly shell: false;
    readonly stdio: readonly ["ignore", "pipe", "pipe"];
}) => AwalX402Child;
type ExecutionResult = Awaited<ReturnType<NonNullable<X402ExecutionPort["execute"]>>>;
export declare class AwalX402Adapter implements X402ExecutionPort {
    private readonly binResolver;
    private readonly launch;
    private readonly timeoutMs;
    readonly mode: "provider_atomic_paid_fetch";
    private script;
    constructor(binResolver?: () => Promise<string>, launch?: AwalX402LaunchPort, timeoutMs?: number);
    assertCompatibleIntent(input: {
        readonly amountAtomic: string;
    }): void;
    prime(): Promise<void>;
    execute(input: {
        readonly url: string;
        readonly amountAtomic: string;
        readonly correlationId: string;
        readonly requestDigest: string;
    }): Promise<ExecutionResult>;
    private runChild;
}
export {};
