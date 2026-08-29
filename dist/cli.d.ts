import { type BoundCommand } from "./command-binder.js";
import type { OutputEnvelope } from "./commands.js";
import { effectiveStateRoot, type RuntimeFactoryOptions } from "./runtime-factory.js";
export type CliRuntimeOptions = RuntimeFactoryOptions;
export { effectiveStateRoot };
export declare function parseArgv(argv: readonly string[]): BoundCommand;
export declare function runCli(argv: readonly string[], _environment?: NodeJS.ProcessEnv, options?: CliRuntimeOptions): Promise<OutputEnvelope>;
