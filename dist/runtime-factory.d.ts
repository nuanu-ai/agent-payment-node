import type { BoundCommand } from "./command-binder.js";
import type { OutputEnvelope } from "./commands.js";
import { ApnCore } from "./core.js";
import type { RuntimeFactoryOptions } from "./runtime-factory-options.js";
export type { RuntimeFactoryOptions } from "./runtime-factory-options.js";
export declare function createApnCore(bound: BoundCommand, options?: RuntimeFactoryOptions): ApnCore;
export declare function executeBoundCommand(bound: BoundCommand, options?: RuntimeFactoryOptions): Promise<OutputEnvelope>;
export declare function effectiveStateRoot(): string;
