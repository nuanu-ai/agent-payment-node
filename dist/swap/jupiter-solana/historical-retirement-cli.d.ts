import type { OutputEnvelope } from "../../commands.js";
/** CLI-only finite route; no command catalog, SDK or MCP admission. */
export declare function isHistoricalJupiterRetirementCli(argv: readonly string[]): boolean;
/** Validate before resolving a root, constructing custody or opening any state. */
export declare function executeHistoricalJupiterRetirementCli(argv: readonly string[], stateRoot: () => string): Promise<OutputEnvelope>;
