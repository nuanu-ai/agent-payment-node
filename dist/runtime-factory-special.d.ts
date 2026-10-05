import { ApnCore } from "./core.js";
import type { RuntimeFactoryOptions } from "./runtime-factory-options.js";
import type { BoundCommand } from "./command-binder.js";
import type { StateStore } from "./state.js";
export declare function createSpecialApnCore(bound: BoundCommand, options: RuntimeFactoryOptions, state: StateStore): ApnCore | null;
