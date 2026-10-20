import type { BoundCommand } from "../command-binder.js";
import type { OutputEnvelope } from "../commands.js";
import type { RuntimeFactoryOptions } from "../runtime-factory-options.js";
/** `apn x402 solana pay|observe|status`, CLI and MCP alike: `pay` runs unattended under the owner's Solana x402 policy. */
export declare function executeX402SolanaCli(bound: BoundCommand, options: RuntimeFactoryOptions, root: string): Promise<OutputEnvelope>;
