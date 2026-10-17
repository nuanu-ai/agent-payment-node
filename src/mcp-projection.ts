import {
  COMMAND_MANIFEST,
  type CommandDefinition,
  type CommandOption,
} from "./command-catalog.js";
import { mcpFieldName } from "./command-binder.js";
import { ApnError } from "./errors.js";
import { projectForegroundHandoff, type ForegroundHandoffTool } from "./mcp-foreground-handoff.js";

const SELECTED_PATHS = [
  "circle evm adopt-external-mint", "circle evm prepare", "circle evm approve-source", "circle evm approve-mint", "circle evm observe", "circle evm refresh-attestation", "circle evm cleanup", "circle evm status",
  "swap ethereum uniswap inventory", "swap ethereum uniswap quote", "swap ethereum uniswap prepare",
  "swap ethereum uniswap status", "swap ethereum uniswap approve", "swap ethereum uniswap execute",
  "swap ethereum uniswap-token inventory", "swap ethereum uniswap-token quote", "swap ethereum uniswap-token prepare",
  "swap ethereum uniswap-token status", "swap ethereum uniswap-token approve", "swap ethereum uniswap-token execute", "swap ethereum uniswap-token cleanup",
  "swap tron sunswap inventory", "swap tron sunswap quote", "swap tron sunswap prepare",
  "swap tron sunswap status", "swap tron sunswap approve", "swap tron sunswap execute",
  "swap solana jupiter inventory", "swap solana jupiter quote", "swap solana jupiter prepare",
  "swap solana jupiter status", "swap solana jupiter approve", "swap solana jupiter execute",
  "swap solana orca stable-status", "swap solana orca stable-release", "swap solana orca stable-recover-no-send", "swap solana orca stable-observe",
  "swap solana orca inventory", "swap solana orca quote", "swap solana orca prepare",
  "swap solana orca status", "swap solana orca approve", "swap solana orca execute",
  "allowlist inventory",
  "allowlist resolve",
  "allowlist policy prepare",
  "allowlist policy stage",
  "allowlist policy activate",
  "allowlist policy revoke",
  "allowlist policy status",
  "--version",
  "doctor keychain",
  "wallet ensure",
  "wallet connect",
  "wallet permission list",
  "wallet permission sync",
  "wallet permission disable",
  "wallet permission forget",
  "wallet status",
  "wallet balance",
  "wallet portfolio",
  "wallet ensure-solana",
  "wallet balance-solana",
  "wallet capabilities-solana",
  "policy admit-solana",
  "pay transfer prepare-solana",
  "wallet ensure-tron",
  "wallet balance-tron",
  "wallet capabilities-tron",
  "policy admit-tron",
  "pay transfer prepare-tron",
  "wallet policy show",
  "wallet policy set",
  "x402 permit2 status",
  "x402 merchant prepare", "x402 merchant approve", "x402 merchant observe", "x402 merchant status", "x402 merchant retire-unsent",
  "x402 inspect",
  "x402 fetch prepare",
  "x402 fetch approve",
  "pay transfer prepare",
  "pay transfer prepare-asset",
  "pay transfer approve",
  "operation status",
  "operation abandon",
  "operation resume",
  "operation recover-provider-request",
  "operation recover-transaction-settlement",
  "receipt get",
  "bridge capabilities", "bridge inventory", "bridge routes", "bridge prepare", "bridge approve",
  "gasless usdt prepare", "gasless usdt status", "gasless usdt resume",
  "gasless capabilities", "gasless balance", "gasless transfer quote", "gasless transfer prepare", "gasless transfer approve", "gasless transfer approve-sealed",
  "oneclick source submit", "oneclick source status",
] as const;

/** Foreground commands MCP still runs: their non-interactive part (a pure policy decrease) needs no consent, and the
 * consent part is refused by RejectingMcpPolicyApproval with a CLI handoff. Every other selected foreground command is
 * reachable only through the single foreground handoff tool, which never executes anything. */
const MCP_RUNS_FOREGROUND = new Set(["wallet policy set"]);

export interface ProjectedMcpTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: {
    readonly type: "object";
    readonly properties: Record<string, JsonValue>;
    readonly required: string[];
    readonly additionalProperties: false;
    readonly oneOf?: JsonValue[];
  };
  readonly command: CommandDefinition;
}

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export function projectMcpTools(manifest: unknown = COMMAND_MANIFEST): readonly ProjectedMcpTool[] {
  const names = new Set<string>();
  return selectedCommands(manifest).filter(runsInMcp).map((command) => {
    if (command.output.contract !== "apn.cli.v1") throw projectionFailure("A selected command has unsupported output metadata.");
    const name = toolName(command.path);
    if (names.has(name)) throw projectionFailure("Selected commands collide after MCP name projection.");
    names.add(name);
    return { name, description: toolDescription(command), inputSchema: inputSchema(command), command };
  });
}

/** The one tool that names the exact foreground CLI command for every selected command MCP cannot run. */
export function projectMcpForegroundHandoff(manifest: unknown = COMMAND_MANIFEST): ForegroundHandoffTool {
  return projectForegroundHandoff(selectedCommands(manifest).filter((command) => !runsInMcp(command)));
}

function selectedCommands(manifest: unknown): readonly CommandDefinition[] {
  const commands = (manifest as { readonly commands: readonly CommandDefinition[] }).commands;
  const byPath = new Map(commands.map((command) => [command.path.join(" "), command]));
  return SELECTED_PATHS.map((path) => {
    const command = byPath.get(path);
    if (command === undefined) throw projectionFailure("A selected command is absent from the manifest.");
    return command;
  });
}

function runsInMcp(command: CommandDefinition): boolean {
  return command.approval.class !== "foreground_tty" || MCP_RUNS_FOREGROUND.has(command.path.join(" "));
}

export const MCP_TOOLS = projectMcpTools();
export const MCP_FOREGROUND_HANDOFF = projectMcpForegroundHandoff();

function toolName(path: readonly string[]): string {
  if (path.length === 1 && path[0] === "--version") return "apn_version";
  if (path.length === 0 || path.some((token) => !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(token))) {
    throw projectionFailure("A selected command path cannot be projected to a safe MCP name.");
  }
  return `apn_${path.map((token) => token.replaceAll("-", "_")).join("_")}`;
}

function toolDescription(command: CommandDefinition): string {
  const lines = [command.summary, `Effect: ${command.effect.class} — ${command.effect.summary}`];
  if (command.approval.class !== "none") lines.push(`Approval: ${command.approval.class} — ${command.approval.when}`);
  if (command.states.terminal.length + command.states.non_terminal.length > 0) {
    lines.push(`States: terminal ${command.states.terminal.join(", ") || "none"}; non-terminal ${command.states.non_terminal.join(", ") || "none"}.`);
  }
  if (command.recovery.length > 0) {
    lines.push(`Next: ${command.recovery.map((item) => `apn ${item.command_path.join(" ")} (${item.when})`).join("; ")}`);
  }
  return lines.join("\n");
}

function inputSchema(command: CommandDefinition): ProjectedMcpTool["inputSchema"] {
  const properties: Record<string, JsonValue> = {};
  const required: string[] = [];
  for (const option of command.options) {
    const field = mcpFieldName(option.name);
    if (properties[field] !== undefined) throw projectionFailure("Command options collide after MCP field projection.");
    properties[field] = optionSchema(option);
    if (option.required) required.push(field);
  }
  return { type: "object", properties, required, additionalProperties: false,
    ...(command.path.join(" ") === "gasless transfer prepare" ? { oneOf: [
      { required: ["amount", "max_fee", "min_received"], not: { anyOf: ["net_amount_atomic", "max_gross_atomic", "max_fee_atomic"].map(field => ({ required: [field] })) } },
      { required: ["net_amount_atomic", "max_gross_atomic", "max_fee_atomic"], not: { anyOf: ["amount", "max_fee", "min_received"].map(field => ({ required: [field] })) } },
    ] } : {}) };
}

function optionSchema(option: CommandOption): { [key: string]: JsonValue } {
  if (!new Set(["public", "operator_input"]).has(option.sensitivity)) {
    throw projectionFailure("A selected command uses unsupported MCP sensitivity metadata.");
  }
  const pattern = scalarPattern(option);
  return {
    type: option.type === "boolean" ? "boolean" : "string",
    description: `${option.type}${option.constraints.length === 0 ? "" : `: ${option.constraints.join(", ")}`}`,
    ...(pattern === undefined ? {} : { pattern }),
    ...(option.default.kind === "literal" ? { default: option.type === "boolean" ? option.default.value === "true" : option.default.value } : {}),
  };
}

function scalarPattern(option: CommandOption): string | undefined {
  if (option.type === "boolean") return undefined;
  if (option.type === "string" && option.constraints.includes("64_lowercase_hex_characters")) {
    return "^[a-f0-9]{64}$";
  }
  switch (option.type) {
    case "profile": return "^[a-z0-9][a-z0-9._-]{0,63}$";
    case "provider_id": return "^[a-z0-9][a-z0-9._-]{0,63}$";
    case "provider_auth_method": return "^[a-z][a-z0-9-]{0,31}$";
    case "positive_integer": return "^[1-9][0-9]*$";
    case "atomic_usdc":
    case "wei": return "^[1-9][0-9]*$";
    case "address": return "^0x[0-9a-fA-F]{40}$";
    case "decimal_usdc": return "^(?:[1-9][0-9]*(?:\\.[0-9]{0,5}[1-9])?|0\\.[0-9]{0,5}[1-9])$";
    case "idempotency_key": return "^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$";
    case "operation_id": return "^[a-f0-9]{64}$";
    case "transaction_hash": return "^0x[0-9a-fA-F]{64}$";
    case "provider_request_id": return "^[A-Za-z0-9._:-]{1,256}$";
    case "integer_seconds": return "^(?:[1-9]|[1-9][0-9]|[12][0-9]{2}|300)$";
    case "string":
    case "base64":
    case "https_url": return undefined;
    default: throw projectionFailure("A selected command uses an unsupported MCP scalar type.");
  }
}

function projectionFailure(message: string): ApnError {
  return new ApnError("APN_INTERNAL", message);
}
