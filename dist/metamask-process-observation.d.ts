import type { MetaMaskNativeDiagnostic } from "./metamask-native-diagnostic.js";
type JsonType = "object" | "array" | "string" | "number" | "boolean" | "null";
export interface MetaMaskObjectShape {
    readonly keys: readonly MetaMaskKeyShape[];
    readonly otherKeys: number;
}
/** A key's name and value type; a value only for the provider's own enum fields, never ids, addresses, hashes or text. */
export interface MetaMaskKeyShape {
    readonly key: string;
    readonly type: JsonType;
    readonly value?: string | boolean;
    readonly object?: MetaMaskObjectShape;
}
export type MetaMaskFrameShape = {
    readonly json: false;
    readonly bytes: number;
} | {
    readonly json: true;
    readonly type: JsonType;
    readonly object?: MetaMaskObjectShape;
};
export interface MetaMaskStreamShape {
    readonly bytes: number;
    /** "truncated": APN kept only the first bytes (stderr 4 KiB, stdout 1 MiB); the hash covers complete captures only. */
    readonly captured: "empty" | "complete" | "truncated";
    readonly sha256: string | null;
    readonly frames: readonly MetaMaskFrameShape[];
    readonly framesOmitted: number;
}
/**
 * What one `mm` child process answered, taken before its bytes are zeroed: exit, both streams' sizes, SHA-256 and JSON
 * shape. The package is the one the resolver admits (it refuses any other version or tarball). Diagnosis only: it
 * never changes a classification and is never a reason to send again.
 */
export interface MetaMaskProcessObservation {
    readonly provider: {
        readonly package: "@metamask/agent-wallet";
        readonly version: string;
        readonly shasum: string;
    };
    readonly outcome: "exit" | "signal" | "timeout" | "start" | "protocol" | "deadline";
    readonly exitCode: number | null;
    readonly signal: MetaMaskNativeDiagnostic["signal"];
    readonly durationMs: number;
    readonly stdout: MetaMaskStreamShape;
    readonly stderr: MetaMaskStreamShape;
}
export interface MetaMaskCapturedStream {
    readonly bytes: Buffer;
    readonly total: number;
}
export declare function observeMetaMaskProcess(input: Omit<MetaMaskProcessObservation, "provider" | "stdout" | "stderr"> & {
    readonly stdout: MetaMaskCapturedStream;
    readonly stderr: MetaMaskCapturedStream;
}): MetaMaskProcessObservation;
export {};
