import type { CommandDefinition } from "../command-catalog.js";
import type { CommandRequest } from "../commands.js";
import { type CliHandoff } from "../cli-handoff.js";
export declare const ONECLICK_COMMANDS: readonly CommandDefinition[];
export declare function bindOneClickCommand(path: string, o: Record<string, string>): CommandRequest;
/** MCP never approves money: it returns the exact foreground command for the owner to run. */
export declare function oneClickSubmitHandoff(r: Extract<CommandRequest, {
    readonly command: "oneclick.source.submit";
}>): CliHandoff;
