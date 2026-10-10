import type { BoundCommand } from "../command-binder.js";
import type { OutputEnvelope } from "../commands.js";
import type { RuntimeFactoryOptions } from "../runtime-factory-options.js";
/** CLI-only same-process wiring. Generic Core and MCP cannot reach this paid path. */
export declare function executePermit2ProductionCli(bound: BoundCommand, options: RuntimeFactoryOptions, root: string): Promise<OutputEnvelope>;
