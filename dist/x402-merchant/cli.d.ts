import type { BoundCommand } from "../command-binder.js";
import type { OutputEnvelope } from "../commands.js";
import type { RuntimeFactoryOptions } from "../runtime-factory-options.js";
export declare function executeMerchantCli(bound: BoundCommand, options: RuntimeFactoryOptions, root: string): Promise<OutputEnvelope>;
