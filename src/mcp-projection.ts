import {
  COMMAND_MANIFEST,
  validateCommandManifest,
  type CommandDefinition,
  type CommandOption,
} from "./command-catalog.js";
import { mcpFieldName } from "./command-binder.js";
import { ApnError } from "./errors.js";

const SELECTED_PATHS = [
  "--version",
  "doctor keychain",
  "wallet ensure",
  "wallet connect",
  "wallet status",
  "wallet balance",
  "wallet policy show",
  "wallet policy set",
  "x402 inspect",
  "x402 fetch prepare",
  "x402 fetch approve",
  "pay transfer prepare",
  "pay transfer approve",
  "operation status",
  "operation resume",
  "receipt get",
] as const;

export interface ProjectedMcpTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: {
    readonly type: "object";
    readonly properties: Record<string, JsonValue>;
    readonly required: string[];
    readonly additionalProperties: false;
  };
  readonly command: CommandDefinition;
}

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export function projectMcpTools(manifest: unknown = COMMAND_MANIFEST): readonly ProjectedMcpTool[] {
  validateCommandManifest(manifest);
  const commands = (manifest as { readonly commands: readonly CommandDefinition[] }).commands;
  const byPath = new Map(commands.map((command) => [command.path.join(" "), command]));
  const names = new Set<string>();
  const projected = SELECTED_PATHS.map((path) => {
    const command = byPath.get(path);
    if (command === undefined) throw projectionFailure("A selected command is absent from the manifest.");
    if (command.output.contract !== "apn.cli.v1") throw projectionFailure("A selected command has unsupported output metadata.");
    const name = toolName(command.path);
    if (names.has(name)) throw projectionFailure("Selected commands collide after MCP name projection.");
    names.add(name);
    return {
      name,
      description: toolDescription(command),
      inputSchema: inputSchema(command),
      command,
    };
  });
  if (projected.length !== SELECTED_PATHS.length) throw projectionFailure("The selected MCP tool set is incomplete.");
  return projected;
}

export const MCP_TOOLS = projectMcpTools();

function toolName(path: readonly string[]): string {
  if (path.length === 1 && path[0] === "--version") return "apn_version";
  if (path.length === 0 || path.some((token) => !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(token))) {
    throw projectionFailure("A selected command path cannot be projected to a safe MCP name.");
  }
  return `apn_${path.map((token) => token.replaceAll("-", "_")).join("_")}`;
}

function toolDescription(command: CommandDefinition): string {
  const recovery = command.recovery.length === 0
    ? "none"
    : command.recovery.map((item) => `apn ${item.command_path.join(" ")} when ${item.when}`).join("; ");
  return [
    command.summary,
    `Effect: ${command.effect.class} — ${command.effect.summary}`,
    `Approval: ${command.approval.class} — ${command.approval.when}`,
    `Terminal states: ${command.states.terminal.join(", ") || "none"}`,
    `Non-terminal states: ${command.states.non_terminal.join(", ") || "none"}`,
    `Recovery: ${recovery}`,
  ].join("\n");
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
  return { type: "object", properties, required, additionalProperties: false };
}

function optionSchema(option: CommandOption): { [key: string]: JsonValue } {
  if (!new Set(["public", "operator_input"]).has(option.sensitivity)) {
    throw projectionFailure("A selected command uses unsupported MCP sensitivity metadata.");
  }
  const pattern = scalarPattern(option.type);
  return {
    type: "string",
    description: `Catalog type ${option.type}; constraints ${option.constraints.join(", ") || "none"}; sensitivity ${option.sensitivity}.`,
    ...(pattern === undefined ? {} : { pattern }),
    ...(option.default.kind === "literal" ? { default: option.default.value } : {}),
  };
}

function scalarPattern(type: CommandOption["type"]): string | undefined {
  switch (type) {
    case "profile": return "^[a-z0-9][a-z0-9._-]{0,63}$";
    case "provider_id": return "^[a-z0-9][a-z0-9._-]{0,63}$";
    case "positive_integer": return "^[1-9][0-9]*$";
    case "atomic_usdc":
    case "wei": return "^[1-9][0-9]*$";
    case "address": return "^0x[0-9a-fA-F]{40}$";
    case "decimal_usdc": return "^(?:[1-9][0-9]*(?:\\.[0-9]{0,5}[1-9])?|0\\.[0-9]{0,5}[1-9])$";
    case "idempotency_key": return "^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$";
    case "operation_id": return "^[a-f0-9]{64}$";
    case "integer_seconds": return "^(?:[1-9]|[1-9][0-9]|[12][0-9]{2}|300)$";
    case "https_url": return undefined;
    default: throw projectionFailure("A selected command uses an unsupported MCP scalar type.");
  }
}

function projectionFailure(message: string): ApnError {
  return new ApnError("APN_INTERNAL", message);
}
