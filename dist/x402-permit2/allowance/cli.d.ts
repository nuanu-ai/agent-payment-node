import type { BoundCommand } from "../../command-binder.js";
import type { OutputEnvelope } from "../../commands.js";
import type { RuntimeFactoryOptions } from "../../runtime-factory-options.js";
/** `apn x402 permit2 allowance set|revoke|observe|status` on the CLI path; MCP reaches set and revoke only as a handoff. */
export declare function executePermit2AllowanceCli(bound: BoundCommand, options: RuntimeFactoryOptions, root: string): Promise<OutputEnvelope>;
