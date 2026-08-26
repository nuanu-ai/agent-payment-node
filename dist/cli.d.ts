import type { CommandRequest, OutputEnvelope } from "./core.js";
interface ParsedCli {
    readonly request: CommandRequest;
    readonly rpcUrl?: string;
}
export declare function parseArgv(argv: readonly string[]): ParsedCli;
export declare function runCli(argv: readonly string[], environment?: NodeJS.ProcessEnv): Promise<OutputEnvelope>;
export declare function effectiveStateRoot(): string;
export {};
