/** One MCP tool stands in for every foreground-only command. MCP never approves, signs, sends, authenticates or
 * consents: this tool validates the arguments exactly as the CLI would, touches no state, network, custody or
 * terminal, and returns the argv a human runs in a foreground terminal. */
import { randomUUID } from "node:crypto";
import { isPlainRecord } from "./canonical.js";
import { cliHandoffDetails, createCliHandoff } from "./cli-handoff.js";
import { bindMcpInput, mcpFieldName } from "./command-binder.js";
import { ApnError } from "./errors.js";
import { failureEnvelope } from "./output.js";
export const FOREGROUND_HANDOFF_TOOL_NAME = "apn_foreground_handoff";
/** Provider authentication rather than a money approval; the classified code says which boundary applies. */
const AUTHENTICATION_PATHS = new Set(["wallet connect", "wallet permission sync"]);
export function projectForegroundHandoff(commands) {
    if (commands.some((command) => command.approval.class !== "foreground_tty")) {
        throw new ApnError("APN_INTERNAL", "Only foreground commands may be handed off.");
    }
    return {
        name: FOREGROUND_HANDOFF_TOOL_NAME,
        description: [
            "Return the exact apn command a human must run in a foreground terminal to approve, sign, authenticate or consent.",
            "MCP never performs these steps. Arguments are that command's options as snake_case fields (for example operation) and are validated exactly as the CLI validates them; nothing is read or written.",
            "Commands:",
            ...commands.map((command) => `- ${command.synopsis.replace(/^apn /u, "")}`),
        ].join("\n"),
        inputSchema: {
            type: "object",
            properties: {
                command: { type: "string", enum: commands.map((command) => command.path.join(" ")), description: "Command path." },
                arguments: { type: "object", description: "The command's options as snake_case fields." },
            },
            required: ["command", "arguments"],
            additionalProperties: false,
        },
        commands,
    };
}
export function foregroundHandoffEnvelope(tool, input) {
    try {
        if (!isPlainRecord(input) || Object.keys(input).some((key) => key !== "command" && key !== "arguments")) {
            throw new ApnError("APN_INVALID_INPUT", "Tool input must contain only command and arguments.");
        }
        const command = tool.commands.find((candidate) => candidate.path.join(" ") === input.command);
        if (command === undefined)
            throw new ApnError("APN_INVALID_INPUT", "The command is not a foreground command of this tool.");
        if (!isPlainRecord(input.arguments))
            throw new ApnError("APN_INVALID_INPUT", "Tool arguments must be an object.");
        const args = input.arguments;
        const bound = bindMcpInput(command, args);
        const argv = ["apn", ...command.path];
        for (const option of command.options) {
            const value = args[mcpFieldName(option.name)];
            if (value !== undefined)
                argv.push(option.name, handoffValue(option, value));
        }
        const handoff = createCliHandoff(argv);
        const code = AUTHENTICATION_PATHS.has(command.path.join(" ")) ? "APN_FOREGROUND_AUTH_REQUIRED" : "APN_FOREGROUND_APPROVAL_REQUIRED";
        return failureEnvelope(bound.request.command, randomUUID(), new ApnError(code, "Run this exact command in a foreground terminal; MCP cannot approve, sign, send or authenticate.", { approval_boundary: "foreground_tty", foreground_auth: true, ...cliHandoffDetails(handoff) }));
    }
    catch (error) {
        return failureEnvelope("invalid", randomUUID(), error);
    }
}
/** Values the catalog marks as never echoed stay placeholders; URLs are rendered in canonical form. */
function handoffValue(option, value) {
    if (option.constraints.includes("never_echoed_in_safe_output"))
        return `<same-${option.name.slice(2)}>`;
    if (typeof value === "boolean")
        return String(value);
    if (typeof value !== "string")
        throw new ApnError("APN_INVALID_INPUT", `${option.name} must be a string.`);
    return option.type === "https_url" ? new URL(value).toString() : value;
}
//# sourceMappingURL=mcp-foreground-handoff.js.map