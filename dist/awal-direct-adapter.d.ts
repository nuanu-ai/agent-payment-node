import type { Address } from "./model.js";
import type { DirectExecutionPort } from "./provider-ports.js";
interface AwalSendStream {
    on(event: "data", listener: (chunk: Buffer | string) => void): unknown;
    removeListener(event: "data", listener: (chunk: Buffer | string) => void): unknown;
}
interface AwalSendChild {
    readonly stdout: AwalSendStream;
    readonly stderr: AwalSendStream;
    once(event: "spawn", listener: () => void): unknown;
    once(event: "error", listener: () => void): unknown;
    once(event: "close", listener: (code: number | null) => void): unknown;
    removeListener(event: "spawn", listener: () => void): unknown;
    removeListener(event: "error", listener: () => void): unknown;
    removeListener(event: "close", listener: (code: number | null) => void): unknown;
    kill(): unknown;
}
export type AwalSendLaunchPort = (executable: string, args: readonly string[], options: {
    readonly shell: false;
    readonly stdio: readonly ["ignore", "pipe", "pipe"];
}) => AwalSendChild;
type DirectResult = Awaited<ReturnType<NonNullable<DirectExecutionPort["execute"]>>>;
export declare class AwalDirectAdapter implements DirectExecutionPort {
    private readonly binResolver;
    private readonly launch;
    private readonly timeoutMs;
    readonly mode: "provider_atomic_send";
    constructor(binResolver?: () => Promise<string>, launch?: AwalSendLaunchPort, timeoutMs?: number);
    assertCompatibleIntent(input: {
        readonly amountAtomic: string;
        readonly amountDecimal: string;
        readonly recipient: Address;
    }): void;
    execute(input: {
        readonly amountDecimal: string;
        readonly recipient: Address;
        readonly sender: Address;
    }): Promise<DirectResult>;
}
export {};
