import type { OutputEnvelope } from "../../commands.js";
/** This route is deliberately absent from the command catalog, SDK and MCP projection. */
export declare function isHistoricalJupiterCli(argv: readonly string[]): boolean;
/** Only the fixed authenticator can issue and consume authority; the CLI never exports it. */
export declare function executeHistoricalJupiterCli(argv: readonly string[], stateRoot: () => string): Promise<OutputEnvelope>;
