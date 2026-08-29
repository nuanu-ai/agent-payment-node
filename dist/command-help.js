import { COMMAND_GROUPS, COMMANDS, } from "./command-catalog.js";
import { PRODUCT_VERSION } from "./constants.js";
import { ApnError } from "./errors.js";
export function renderReadmeCommandReference() {
    return COMMANDS.map((definition) => definition.synopsis).join("\n");
}
export function renderHelp(path) {
    if (path.length === 0)
        return renderRootHelp();
    const group = COMMAND_GROUPS.find((candidate) => samePath(candidate.path, path));
    if (group !== undefined)
        return renderGroupHelp(group);
    const commandDefinition = COMMANDS.find((candidate) => samePath(candidate.path, path));
    if (commandDefinition !== undefined)
        return renderCommandHelp(commandDefinition);
    throw new ApnError("APN_UNSUPPORTED_COMMAND", "Unknown APN help path.");
}
function renderRootHelp() {
    const lines = [
        `Agent Payment Node ${PRODUCT_VERSION}`,
        "Local-first payments for AI agents.",
        "",
        "Usage:",
        "  apn <command> [options]",
        "",
        "Top-level groups:",
    ];
    for (const group of COMMAND_GROUPS.filter((candidate) => candidate.path.length === 1)) {
        lines.push(`  ${group.path.join(" ").padEnd(12)} ${group.summary}`);
    }
    lines.push("", "Top-level commands:");
    for (const commandDefinition of COMMANDS.filter((candidate) => candidate.path.length === 1)) {
        lines.push(`  ${commandDefinition.synopsis.padEnd(24)} ${commandDefinition.summary}`);
    }
    lines.push("", "Discovery:", "  apn help <path...>", "  apn <path...> --help", "  apn help --json    Exact apn.command-manifest.v1 contract");
    return lines.join("\n");
}
function renderGroupHelp(group) {
    const lines = [group.summary, "", "Usage:", `  apn ${group.path.join(" ")} <command> [options]`, "", "Subgroups:"];
    const childGroups = COMMAND_GROUPS.filter((candidate) => candidate.path.length === group.path.length + 1 && hasPrefix(candidate.path, group.path));
    const childCommands = COMMANDS.filter((candidate) => candidate.path.length === group.path.length + 1 && hasPrefix(candidate.path, group.path));
    if (childGroups.length === 0)
        lines.push("  (none)");
    for (const child of childGroups)
        lines.push(`  apn ${child.path.join(" ")} <command> [options] — ${child.summary}`);
    lines.push("", "Commands:");
    if (childCommands.length === 0)
        lines.push("  (none)");
    for (const child of childCommands)
        lines.push(`  ${child.synopsis} — ${child.summary}`);
    lines.push("", "Machine contract: apn help --json", `Detailed help: apn help ${group.path.join(" ")} <child>`);
    return lines.join("\n");
}
function renderCommandHelp(definition) {
    const lines = [definition.summary, "", "Usage:", `  ${definition.synopsis}`, "", "Options:"];
    if (definition.options.length === 0)
        lines.push("  (none)");
    for (const commandOption of definition.options) {
        const required = commandOption.required ? "required" : "optional";
        const defaultValue = commandOption.default.kind === "literal" ? `; default=${commandOption.default.value}` : "";
        lines.push(`  ${commandOption.name} <${commandOption.type}>  ${required}${defaultValue}; ${commandOption.constraints.join(", ")}`);
    }
    lines.push("", `Effect: ${definition.effect.class} — ${definition.effect.summary}`, `Approval: ${definition.approval.class} — ${definition.approval.when}`, `Output: ${definition.output.contract}; success exit ${definition.output.success_exit}; failure exit ${definition.output.failure_exit}`, `Terminal states: ${definition.states.terminal.length === 0 ? "(none)" : definition.states.terminal.join(", ")}`, `Non-terminal states: ${definition.states.non_terminal.length === 0 ? "(none)" : definition.states.non_terminal.join(", ")}`, "Recovery:");
    if (definition.recovery.length === 0)
        lines.push("  (none)");
    for (const recovery of definition.recovery)
        lines.push(`  apn ${recovery.command_path.join(" ")} — ${recovery.when}`);
    lines.push("", "Examples:");
    for (const example of definition.examples)
        lines.push(`  ${example}`);
    return lines.join("\n");
}
function hasPrefix(value, prefix) {
    return prefix.length <= value.length && prefix.every((token, index) => value[index] === token);
}
function samePath(left, right) {
    return left.length === right.length && left.every((token, index) => right[index] === token);
}
//# sourceMappingURL=command-help.js.map