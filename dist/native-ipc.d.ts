import type { Readable } from "node:stream";
import type { NativePort, NativeRequest } from "./ports.js";
export declare function encodeFrame(value: unknown): Buffer;
export declare function decodeSingleFrame(frame: Buffer): unknown;
export declare class InheritedNativeIpc implements NativePort {
    readonly requestFd: number;
    readonly responseFd: number;
    readonly timeoutMs: number;
    private used;
    constructor(requestFd: number, responseFd: number, timeoutMs?: number);
    static fromEnvironment(environment?: NodeJS.ProcessEnv): InheritedNativeIpc;
    request(request: NativeRequest): Promise<unknown>;
}
export declare function readFrameStream(stream: Readable, timeoutMs?: number): Promise<unknown>;
