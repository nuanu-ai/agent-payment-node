import { randomUUID } from "node:crypto";
import { isPlainRecord } from "./canonical.js";
import { OUTPUT_VERSION, PRODUCT_VERSION } from "./constants.js";
import { ApnError, asApnError } from "./errors.js";
const noDefault = { kind: "none" };
const defaultProfile = { kind: "literal", value: "default" };
const scalarTypes = new Set(["string", "profile", "https_url", "address", "decimal_usdc", "atomic_usdc", "wei", "operation_id", "idempotency_key", "integer_seconds"]);
const effectClasses = new Set(["none", "local_read", "network_read", "local_write", "payment_prepare", "payment_submit", "recovery"]);
const approvalClasses = new Set(["none", "foreground_tty", "prior_profile_policy", "prior_operation_authorization"]);
const sensitivities = new Set(["public", "operator_input", "sensitive_input"]);
const protectedExampleContent = /private[-_ ]?key|mnemonic|wrapping[-_ ]?secret|raw[-_ ]?signed[-_ ]?transaction|payment[-_ ]?header|reusable[-_ ]?authorization/iu;
const completedStates = { terminal: ["completed", "classified_failure"], non_terminal: [] };
const directStates = {
    terminal: ["completed", "failed_before_effect", "failed_confirmed_revert", "failed_proven_superseded"],
    non_terminal: ["awaiting_approval", "signed_not_submitted", "submitted_pending", "unknown_finality"],
};
const x402States = {
    terminal: ["completed", "failed_before_effect", "failed_expired_unused", "failed_settled_without_result"],
    non_terminal: [
        "awaiting_approval",
        "authorization_material_pending",
        "authorized_not_sent",
        "paid_request_pending",
        "settlement_pending",
        "effect_unknown",
        "seller_result_recovery_pending",
    ],
};
const allOperationStates = {
    terminal: [...directStates.terminal, ...x402States.terminal.filter((state) => !directStates.terminal.includes(state))],
    non_terminal: [...directStates.non_terminal, ...x402States.non_terminal.filter((state) => !directStates.non_terminal.includes(state))],
};
const profileOptional = option("--profile", "profile", false, defaultProfile, ["matches_[a-z0-9][a-z0-9._-]{0,63}"], "public");
const profileRequired = option("--profile", "profile", true, noDefault, ["matches_[a-z0-9][a-z0-9._-]{0,63}"], "public");
const rpcRequired = option("--rpc-url", "https_url", true, noDefault, [
    "credential_free_https_without_fragment",
    "public_target_required_at_runtime",
], "operator_input");
const operationRequired = option("--operation", "operation_id", true, noDefault, ["64_lowercase_hex_characters"], "public");
export const COMMAND_GROUPS = [
    { path: ["doctor"], summary: "Inspect local APN prerequisites.", kind: "group" },
    { path: ["wallet"], summary: "Create, inspect and configure the disposable wallet.", kind: "group" },
    { path: ["wallet", "policy"], summary: "Inspect or change owner-approved wallet policy.", kind: "group" },
    { path: ["x402"], summary: "Inspect and pay standard x402 resources.", kind: "group" },
    { path: ["x402", "fetch"], summary: "Prepare and authorize a durable x402 fetch.", kind: "group" },
    { path: ["pay"], summary: "Prepare and submit direct payments.", kind: "group" },
    { path: ["pay", "transfer"], summary: "Prepare and submit Base-USDC transfers.", kind: "group" },
    { path: ["operation"], summary: "Read or resume durable operations.", kind: "group" },
    { path: ["receipt"], summary: "Read durable terminal receipts.", kind: "group" },
];
export const COMMANDS = [
    command(["--version"], "apn --version", "Report installed APN and CLI contract versions.", [], "none", "Reads immutable build metadata only.", "none", "Never.", completedStates, [], ["apn --version"]),
    command(["doctor", "keychain"], "apn doctor keychain", "Check whether the ordinary login Keychain command path is usable.", [], "local_read", "Reads Keychain availability without creating wallet material.", "none", "Never.", completedStates, [], ["apn doctor keychain"]),
    command(["wallet", "ensure"], "apn wallet ensure [--profile <profile>]", "Create or reuse one encrypted disposable wallet.", [profileOptional], "local_write", "May create ~/.apn state and one Keychain wrapping secret.", "none", "Wallet creation itself is non-interactive.", completedStates, [], ["apn wallet ensure --profile default"]),
    command(["wallet", "status"], "apn wallet status [--profile <profile>]", "Read wallet presence and public identity.", [profileOptional], "local_read", "Returns absent without creating state or accessing Keychain material.", "none", "Never.", completedStates, [], ["apn wallet status --profile default"]),
    command(["wallet", "balance"], "apn wallet balance [--profile <profile>] --rpc-url <https-url>", "Read Base ETH and canonical Base-USDC balances.", [profileOptional, rpcRequired], "network_read", "Reads the configured public Base RPC; never signs or submits.", "none", "Never.", completedStates, [], ["apn wallet balance --profile default --rpc-url <https-base-rpc-url>"]),
    command(["wallet", "policy", "show"], "apn wallet policy show --profile <profile>", "Read the encrypted owner-approved profile policy.", [profileRequired], "local_read", "Reads wallet-bound policy state.", "none", "Never.", completedStates, [], ["apn wallet policy show --profile default"]),
    command(["wallet", "policy", "set"], "apn wallet policy set --profile <profile> --max-balance-usdc-atomic <atomic> --max-x402-amount-atomic <atomic> [--max-balance-eth-wei <wei>]", "Create, lower or raise owner-approved balance and x402 limits.", [
        profileRequired,
        option("--max-balance-usdc-atomic", "atomic_usdc", true, noDefault, ["positive_canonical_integer"], "operator_input"),
        option("--max-x402-amount-atomic", "atomic_usdc", true, noDefault, ["positive_canonical_integer", "not_greater_than_max_balance_usdc_atomic"], "operator_input"),
        option("--max-balance-eth-wei", "wei", false, noDefault, ["positive_canonical_integer", "omission_preserves_existing_value"], "operator_input"),
    ], "local_write", "Writes an encrypted wallet-bound profile policy.", "foreground_tty", "Required when a policy is created or any limit increases; a pure decrease is non-interactive.", completedStates, [], ["apn wallet policy set --profile default --max-balance-usdc-atomic <owner-limit-atomic> --max-x402-amount-atomic <owner-limit-atomic>"]),
    command(["x402", "inspect"], "apn x402 inspect --url <https-url>", "Inspect supported offers in a standard x402 challenge.", [
        option("--url", "https_url", true, noDefault, ["credential_free_https_without_fragment", "maximum_2048_utf8_bytes", "canonical_whatwg_serialization", "public_target_required_at_runtime"], "public"),
    ], "network_read", "Performs one unpaid HTTPS inspection request.", "none", "Never.", completedStates, [], ["apn x402 inspect --url https://seller.example/resource"]),
    command(["x402", "fetch", "prepare"], "apn x402 fetch prepare --profile <profile> --url <https-url> --idempotency-key <key> --rpc-url <https-url> [--max-amount-atomic <atomic>]", "Freeze a policy-bounded standard x402 purchase.", [
        profileRequired,
        option("--url", "https_url", true, noDefault, ["credential_free_https_without_fragment", "maximum_2048_utf8_bytes", "canonical_whatwg_serialization", "public_target_required_at_runtime"], "public"),
        option("--idempotency-key", "idempotency_key", true, noDefault, ["8_to_200_safe_ascii_characters"], "operator_input"),
        rpcRequired,
        option("--max-amount-atomic", "atomic_usdc", false, noDefault, ["positive_canonical_integer", "may_only_lower_profile_limit"], "operator_input"),
    ], "payment_prepare", "Reads seller and Base evidence, then durably freezes one purchase intent without signing.", "prior_profile_policy", "An owner-approved profile policy must already bound the purchase.", x402States, [{ command_path: ["x402", "fetch", "approve"], when: "After a successful prepare returns an operation ID." }], ["apn x402 fetch prepare --profile default --url https://seller.example/resource --idempotency-key <idempotency-key> --rpc-url <https-base-rpc-url>"]),
    command(["x402", "fetch", "approve"], "apn x402 fetch approve --operation <operation-id> --rpc-url <https-url>", "Authorize and send the one frozen x402 request.", [operationRequired, rpcRequired], "payment_submit", "Creates one policy-bounded authorization and sends only the frozen paid request.", "prior_profile_policy", "No per-payment prompt; the frozen operation and existing profile policy are the authorization boundary.", x402States, [
        { command_path: ["operation", "status"], when: "To inspect any returned non-terminal state." },
        { command_path: ["operation", "resume"], when: "When documented durable recovery is permitted." },
        { command_path: ["receipt", "get"], when: "After terminal completion." },
    ], ["apn x402 fetch approve --operation <operation-id> --rpc-url <https-base-rpc-url>"]),
    command(["pay", "transfer", "prepare"], "apn pay transfer prepare --profile <profile> --idempotency-key <key> --to <address> --amount-usdc <decimal> --rpc-url <https-url>", "Freeze one exact direct Base-USDC transfer.", [
        profileRequired,
        option("--idempotency-key", "idempotency_key", true, noDefault, ["8_to_200_safe_ascii_characters"], "operator_input"),
        option("--to", "address", true, noDefault, ["canonical_evm_address"], "public"),
        option("--amount-usdc", "decimal_usdc", true, noDefault, ["positive_canonical_decimal", "maximum_6_fractional_digits"], "operator_input"),
        rpcRequired,
    ], "payment_prepare", "Reads Base evidence and durably freezes recipient, amount, nonce, fees, calldata and expiry without signing.", "none", "Prepare does not authorize submission.", directStates, [{ command_path: ["pay", "transfer", "approve"], when: "After a successful prepare returns an operation ID." }], ["apn pay transfer prepare --profile default --idempotency-key <idempotency-key> --to <recipient-address> --amount-usdc 0.01 --rpc-url <https-base-rpc-url>"]),
    command(["pay", "transfer", "approve"], "apn pay transfer approve --operation <operation-id> --rpc-url <https-url>", "Approve, sign and submit one frozen direct transfer.", [operationRequired, rpcRequired], "payment_submit", "After an exact foreground approval, signs and submits only the frozen transfer.", "foreground_tty", "Always requires the exact operation-bound phrase in foreground stdin/stderr TTYs.", directStates, [
        { command_path: ["operation", "status"], when: "To inspect any returned non-terminal state." },
        { command_path: ["operation", "resume"], when: "When documented durable recovery is permitted." },
        { command_path: ["receipt", "get"], when: "After terminal completion." },
    ], ["apn pay transfer approve --operation <operation-id> --rpc-url <https-base-rpc-url>"]),
    command(["operation", "status"], "apn operation status --operation <operation-id>", "Read one durable operation without network access.", [operationRequired], "local_read", "Reads public operation state and never resumes an effect.", "none", "Never.", allOperationStates, [
        { command_path: ["operation", "resume"], when: "When the returned state documents resumable recovery." },
        { command_path: ["receipt", "get"], when: "When the operation is terminal." },
    ], ["apn operation status --operation <operation-id>"]),
    command(["operation", "resume"], "apn operation resume --operation <operation-id> --rpc-url <https-url> [--wait-seconds <1..300>]", "Perform only the next legal durable recovery transition.", [operationRequired, rpcRequired, option("--wait-seconds", "integer_seconds", false, noDefault, ["canonical_integer_1_through_300", "x402_only"], "operator_input")], "recovery", "Reuses protected effect material and may reconcile or resubmit only when the stored state permits.", "prior_operation_authorization", "Uses the authorization already bound to the durable operation; it cannot widen the frozen effect.", allOperationStates, [
        { command_path: ["operation", "status"], when: "To inspect the resulting durable state." },
        { command_path: ["receipt", "get"], when: "After terminal completion." },
    ], ["apn operation resume --operation <operation-id> --rpc-url <https-base-rpc-url> --wait-seconds 60"]),
    command(["receipt", "get"], "apn receipt get --operation <operation-id>", "Read one durable terminal receipt.", [operationRequired], "local_read", "Reads a terminal receipt and never resumes an operation.", "none", "Never.", { terminal: allOperationStates.terminal, non_terminal: [] }, [], ["apn receipt get --operation <operation-id>"]),
];
export const COMMAND_MANIFEST = {
    schema_version: "apn.command-manifest.v1",
    product: "agent-payment-node",
    product_version: PRODUCT_VERSION,
    cli_envelope_version: OUTPUT_VERSION,
    compatibility: {
        additive_optional_within_version: true,
        breaking_change_requires_new_schema: [
            "field_remove_or_rename",
            "meaning_or_unit_change",
            "optional_to_required",
            "enum_contraction",
        ],
    },
    discovery: {
        root_text_forms: ["apn --help", "apn help"],
        scoped_text_forms: ["apn <path...> --help", "apn help <path...>"],
        machine_form: "apn help --json",
        options: [
            { name: "--help", type: "flag", scope: "root_group_or_command" },
            { name: "--json", type: "flag", scope: "root_help_only" },
        ],
    },
    groups: COMMAND_GROUPS,
    commands: COMMANDS,
};
validateCommandManifest(COMMAND_MANIFEST);
export function parseCatalogArgv(argv) {
    const definition = longestCommandPrefix(argv);
    if (definition === undefined)
        throw new ApnError("APN_UNSUPPORTED_COMMAND", "Unsupported APN command.");
    const values = {};
    const tail = argv.slice(definition.path.length);
    for (let index = 0; index < tail.length; index += 2) {
        const token = tail[index];
        const value = tail[index + 1];
        if (token === undefined || value === undefined || !token.startsWith("--") || value.startsWith("--")) {
            throw new ApnError("APN_INVALID_INPUT", "Options must use complete `--name value` pairs.");
        }
        const optionDefinition = definition.options.find((candidate) => candidate.name === token);
        if (optionDefinition === undefined || token in values) {
            throw new ApnError("APN_INVALID_INPUT", "Command contains an unknown or duplicate option.");
        }
        validateOptionValue(optionDefinition, value);
        values[token] = value;
    }
    for (const optionDefinition of definition.options) {
        if (values[optionDefinition.name] !== undefined)
            continue;
        if (optionDefinition.required) {
            throw new ApnError("APN_INVALID_INPUT", `Missing required ${optionDefinition.name} option.`);
        }
        if (optionDefinition.default.kind === "literal")
            values[optionDefinition.name] = optionDefinition.default.value;
    }
    validateCrossOptionConstraints(definition, values);
    return { command: definition, values };
}
export function dispatchDiscovery(argv) {
    const hasDiscoveryToken = argv.includes("--help") || argv.includes("--json") || argv[0] === "help";
    if (!hasDiscoveryToken)
        return null;
    try {
        if (samePath(argv, ["--help"]) || samePath(argv, ["help"])) {
            return { ok: true, output: renderHelp([]), exitCode: 0, presentation: "text" };
        }
        if (samePath(argv, ["help", "--json"])) {
            return { ok: true, output: JSON.stringify(COMMAND_MANIFEST), exitCode: 0, presentation: "json" };
        }
        if (argv[0] === "help") {
            const path = argv.slice(1);
            if (path.length === 0 || path.includes("--help") || path.includes("--json"))
                invalidDiscovery();
            return { ok: true, output: renderHelp(path), exitCode: 0, presentation: "text" };
        }
        if (argv.at(-1) === "--help") {
            const path = argv.slice(0, -1);
            if (path.length === 0 || path.includes("--help") || path.includes("--json"))
                invalidDiscovery();
            return { ok: true, output: renderHelp(path), exitCode: 0, presentation: "text" };
        }
        invalidDiscovery();
    }
    catch (error) {
        const safe = asApnError(error);
        return {
            ok: false,
            error: { code: safe.code, message: safe.message },
            nextActions: catalogNextActions(argv),
            exitCode: 1,
            presentation: "json",
        };
    }
}
export function renderDiscoveryOutput(dispatch) {
    if (dispatch.ok)
        return dispatch.output;
    return JSON.stringify(usageFailureEnvelope(dispatch.error, dispatch.nextActions));
}
export function catalogNextActions(argv) {
    const candidate = argv[0] === "help" ? argv.slice(1) : argv.at(-1) === "--help" ? argv.slice(0, -1) : argv;
    const prefix = longestCatalogPrefix(candidate);
    return prefix === undefined ? ["apn help"] : [`apn help ${prefix.path.join(" ")}`, "apn help"];
}
export function renderReadmeCommandReference() {
    return COMMANDS.map((definition) => definition.synopsis).join("\n");
}
export function validateCommandManifest(value) {
    validateCommandManifestShape(value, PRODUCT_VERSION);
}
function validateCommandManifestShape(value, installedProductVersion) {
    if (!isPlainRecord(value) || !hasRequiredKeys(value, [
        "schema_version", "product", "product_version", "cli_envelope_version", "compatibility", "discovery", "groups", "commands",
    ]))
        manifestInvalid();
    if (value.schema_version !== "apn.command-manifest.v1" || value.product !== "agent-payment-node" ||
        !isSemanticVersion(value.product_version) ||
        (installedProductVersion !== undefined && value.product_version !== installedProductVersion) ||
        value.cli_envelope_version !== OUTPUT_VERSION)
        manifestInvalid();
    const compatibility = recordWithKeys(value.compatibility, ["additive_optional_within_version", "breaking_change_requires_new_schema"]);
    if (compatibility.additive_optional_within_version !== true || !sameStrings(compatibility.breaking_change_requires_new_schema, [
        "field_remove_or_rename", "meaning_or_unit_change", "optional_to_required", "enum_contraction",
    ]))
        manifestInvalid();
    const discovery = recordWithKeys(value.discovery, ["root_text_forms", "scoped_text_forms", "machine_form", "options"]);
    if (!sameStrings(discovery.root_text_forms, ["apn --help", "apn help"]) ||
        !sameStrings(discovery.scoped_text_forms, ["apn <path...> --help", "apn help <path...>"]) ||
        discovery.machine_form !== "apn help --json" || !Array.isArray(discovery.options) || discovery.options.length !== 2)
        manifestInvalid();
    for (const [index, expected] of [[0, ["--help", "flag", "root_group_or_command"]], [1, ["--json", "flag", "root_help_only"]]]) {
        const item = recordWithKeys(discovery.options[index], ["name", "type", "scope"]);
        if (item.name !== expected[0] || item.type !== expected[1] || item.scope !== expected[2])
            manifestInvalid();
    }
    if (!Array.isArray(value.groups) || !Array.isArray(value.commands) || value.groups.length === 0 || value.commands.length === 0)
        manifestInvalid();
    const knownPaths = new Set();
    for (const rawGroup of value.groups) {
        const group = recordWithKeys(rawGroup, ["path", "summary", "kind"]);
        const path = manifestPath(group.path);
        if (group.kind !== "group" || !nonempty(group.summary) || knownPaths.has(path))
            manifestInvalid();
        knownPaths.add(path);
    }
    const commandPaths = new Set();
    const recoveryTargets = [];
    for (const rawCommand of value.commands) {
        const commandValue = recordWithKeys(rawCommand, [
            "path", "synopsis", "summary", "options", "effect", "approval", "output", "states", "recovery", "examples",
        ]);
        const path = manifestPath(commandValue.path);
        if (knownPaths.has(path) || commandPaths.has(path) || !nonempty(commandValue.synopsis) || !nonempty(commandValue.summary))
            manifestInvalid();
        commandPaths.add(path);
        if (!Array.isArray(commandValue.options))
            manifestInvalid();
        const optionNames = new Set();
        for (const rawOption of commandValue.options) {
            const manifestOption = recordWithKeys(rawOption, ["name", "type", "required", "default", "constraints", "sensitivity"]);
            if (typeof manifestOption.name !== "string" || !manifestOption.name.startsWith("--") || optionNames.has(manifestOption.name) ||
                !scalarTypes.has(manifestOption.type) || typeof manifestOption.required !== "boolean" ||
                !Array.isArray(manifestOption.constraints) || !manifestOption.constraints.every(nonempty) ||
                !sensitivities.has(manifestOption.sensitivity))
                manifestInvalid();
            optionNames.add(manifestOption.name);
            const defaultValue = isPlainRecord(manifestOption.default) ? manifestOption.default : manifestInvalid();
            if (defaultValue.kind === "none") {
                if (!hasRequiredKeys(defaultValue, ["kind"]))
                    manifestInvalid();
            }
            else if (defaultValue.kind === "literal") {
                if (!hasRequiredKeys(defaultValue, ["kind", "value"]) || !nonempty(defaultValue.value) || manifestOption.required)
                    manifestInvalid();
            }
            else
                manifestInvalid();
        }
        const effect = recordWithKeys(commandValue.effect, ["class", "summary"]);
        const approval = recordWithKeys(commandValue.approval, ["class", "when"]);
        if (!effectClasses.has(effect.class) || !nonempty(effect.summary) || !approvalClasses.has(approval.class) || !nonempty(approval.when))
            manifestInvalid();
        const output = recordWithKeys(commandValue.output, ["contract", "success_exit", "failure_exit", "success", "failures"]);
        if (output.contract !== "apn.cli.v1" || output.success_exit !== 0 || output.failure_exit !== 1 || !nonempty(output.success) || !Array.isArray(output.failures) || !output.failures.every(nonempty))
            manifestInvalid();
        const states = recordWithKeys(commandValue.states, ["terminal", "non_terminal"]);
        if (!uniqueStrings(states.terminal) || !uniqueStrings(states.non_terminal))
            manifestInvalid();
        if (!Array.isArray(commandValue.recovery))
            manifestInvalid();
        for (const rawRecovery of commandValue.recovery) {
            const recovery = recordWithKeys(rawRecovery, ["command_path", "when"]);
            recoveryTargets.push(manifestPath(recovery.command_path));
            if (!nonempty(recovery.when))
                manifestInvalid();
        }
        if (!Array.isArray(commandValue.examples) || commandValue.examples.length === 0 || !commandValue.examples.every(nonempty))
            manifestInvalid();
        if (commandValue.examples.some((example) => /0x[0-9a-fA-F]{40}/u.test(String(example)) || protectedExampleContent.test(String(example))))
            manifestInvalid();
    }
    if (recoveryTargets.some((target) => !commandPaths.has(target)))
        manifestInvalid();
}
export function assertCompatibleManifestEvolution(previous, next) {
    validateCommandManifestShape(previous);
    validateCommandManifestShape(next);
    const before = previous;
    const after = next;
    const afterGroups = new Map(after.groups.map((group) => [manifestPath(group.path), group]));
    for (const group of before.groups) {
        const nextGroup = afterGroups.get(manifestPath(group.path));
        if (nextGroup === undefined || group.kind !== nextGroup.kind || group.summary !== nextGroup.summary)
            manifestInvalid();
    }
    const afterCommands = new Map(after.commands.map((commandValue) => [manifestPath(commandValue.path), commandValue]));
    for (const previousCommand of before.commands) {
        const nextCommand = afterCommands.get(manifestPath(previousCommand.path));
        if (nextCommand === undefined)
            manifestInvalid();
        if (JSON.stringify(commandSemantics(previousCommand)) !== JSON.stringify(commandSemantics(nextCommand)))
            manifestInvalid();
        const previousOptions = previousCommand.options;
        const nextOptions = new Map(nextCommand.options.map((item) => [String(item.name), item]));
        for (const previousOption of previousOptions) {
            const nextOption = nextOptions.get(String(previousOption.name));
            if (nextOption === undefined || JSON.stringify(optionSemantics(previousOption)) !== JSON.stringify(optionSemantics(nextOption)))
                manifestInvalid();
        }
        for (const nextOption of nextOptions.values()) {
            if (!previousOptions.some((item) => item.name === nextOption.name) && nextOption.required === true)
                manifestInvalid();
        }
    }
    for (const requiredMarker of before.compatibility.breaking_change_requires_new_schema) {
        if (!after.compatibility.breaking_change_requires_new_schema.includes(requiredMarker))
            manifestInvalid();
    }
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
    lines.push("", `Machine contract: apn help --json`, `Detailed help: apn help ${group.path.join(" ")} <child>`);
    return lines.join("\n");
}
function renderCommandHelp(definition) {
    const lines = [
        definition.summary,
        "",
        "Usage:",
        `  ${definition.synopsis}`,
        "",
        "Options:",
    ];
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
function usageFailureEnvelope(error, nextActions) {
    return {
        version: OUTPUT_VERSION,
        request_id: randomUUID(),
        command: "invalid",
        ok: false,
        proof_class: "classified_failure",
        data: null,
        operation: null,
        receipt: null,
        error,
        next_actions: nextActions,
    };
}
function longestCommandPrefix(argv) {
    return COMMANDS.reduce((selected, candidate) => {
        if (!hasPrefix(argv, candidate.path))
            return selected;
        return selected === undefined || candidate.path.length > selected.path.length ? candidate : selected;
    }, undefined);
}
function longestCatalogPrefix(argv) {
    const entries = [...COMMAND_GROUPS, ...COMMANDS];
    return entries.reduce((selected, candidate) => {
        if (!hasPrefix(argv, candidate.path))
            return selected;
        return selected === undefined || candidate.path.length > selected.path.length ? candidate : selected;
    }, undefined);
}
function validateOptionValue(definition, value) {
    const invalid = () => { throw new ApnError("APN_INVALID_INPUT", `${definition.name} does not satisfy its declared ${definition.type} contract.`); };
    switch (definition.type) {
        case "string":
            if (value.length === 0)
                invalid();
            return;
        case "profile":
            if (!/^[a-z0-9][a-z0-9._-]{0,63}$/u.test(value))
                invalid();
            return;
        case "https_url": {
            const parsed = (() => {
                try {
                    return new URL(value);
                }
                catch {
                    return invalid();
                }
            })();
            const constraints = new Set(definition.constraints);
            if (constraints.has("credential_free_https_without_fragment") &&
                (parsed.protocol !== "https:" || parsed.username !== "" || parsed.password !== "" || parsed.hash !== ""))
                invalid();
            const canonical = parsed.toString();
            if (constraints.has("maximum_2048_utf8_bytes") && Buffer.byteLength(canonical, "utf8") > 2048)
                invalid();
            if (constraints.has("canonical_whatwg_serialization") && canonical !== value)
                invalid();
            return;
        }
        case "address":
            if (!/^0x[0-9a-fA-F]{40}$/u.test(value))
                invalid();
            return;
        case "decimal_usdc": {
            const match = /^(?:0|[1-9][0-9]*)(?:\.([0-9]*[1-9]))?$/u.exec(value);
            if (match === null || (match[1]?.length ?? 0) > 6 || value === "0")
                invalid();
            return;
        }
        case "atomic_usdc":
        case "wei":
            if (!/^[1-9][0-9]*$/u.test(value))
                invalid();
            return;
        case "operation_id":
            if (!/^[a-f0-9]{64}$/u.test(value))
                invalid();
            return;
        case "idempotency_key":
            if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$/u.test(value))
                invalid();
            return;
        case "integer_seconds":
            if (!/^[1-9][0-9]*$/u.test(value) || Number(value) > 300)
                invalid();
            return;
    }
}
function validateCrossOptionConstraints(definition, values) {
    for (const optionDefinition of definition.options) {
        if (!optionDefinition.constraints.includes("not_greater_than_max_balance_usdc_atomic"))
            continue;
        const selected = values[optionDefinition.name];
        const maximum = values["--max-balance-usdc-atomic"];
        if (selected === undefined || maximum === undefined || !/^[1-9][0-9]*$/u.test(selected) || !/^[1-9][0-9]*$/u.test(maximum)) {
            throw new ApnError("APN_INTERNAL", "The command catalog has an invalid cross-option constraint binding.");
        }
        if (BigInt(selected) > BigInt(maximum)) {
            throw new ApnError("APN_INVALID_INPUT", `${optionDefinition.name} does not satisfy its declared ${optionDefinition.type} contract.`);
        }
    }
}
function invalidDiscovery() {
    throw new ApnError("APN_INVALID_INPUT", "Discovery options are misplaced, duplicated, incomplete or unknown.");
}
function command(path, synopsis, summary, options, effectClass, effectSummary, approvalClass, approvalWhen, states, recovery, examples) {
    return {
        path,
        synopsis,
        summary,
        options,
        effect: { class: effectClass, summary: effectSummary },
        approval: { class: approvalClass, when: approvalWhen },
        output: {
            contract: "apn.cli.v1",
            success_exit: 0,
            failure_exit: 1,
            success: "One successful apn.cli.v1 envelope.",
            failures: ["One classified-failure apn.cli.v1 envelope."],
        },
        states,
        recovery,
        examples,
    };
}
function option(name, type, required, defaultValue, constraints, sensitivity) {
    return { name, type, required, default: defaultValue, constraints, sensitivity };
}
function hasPrefix(value, prefix) {
    return prefix.length <= value.length && prefix.every((token, index) => value[index] === token);
}
function samePath(left, right) {
    return left.length === right.length && left.every((token, index) => right[index] === token);
}
function recordWithKeys(value, keys) {
    if (!isPlainRecord(value) || !hasRequiredKeys(value, keys))
        return manifestInvalid();
    return value;
}
function hasRequiredKeys(value, keys) {
    return keys.every((key) => Object.hasOwn(value, key));
}
function commandSemantics(value) {
    const effect = value.effect;
    const approval = value.approval;
    const output = value.output;
    const states = value.states;
    const recovery = value.recovery;
    return {
        synopsis: value.synopsis,
        summary: value.summary,
        effect: { class: effect.class, summary: effect.summary },
        approval: { class: approval.class, when: approval.when },
        output: {
            contract: output.contract,
            success_exit: output.success_exit,
            failure_exit: output.failure_exit,
            success: output.success,
            failures: output.failures,
        },
        states: { terminal: states.terminal, non_terminal: states.non_terminal },
        recovery: recovery.map((item) => ({ command_path: item.command_path, when: item.when })),
        examples: value.examples,
    };
}
function optionSemantics(value) {
    const defaultValue = value.default;
    return {
        name: value.name,
        type: value.type,
        required: value.required,
        default: defaultValue.kind === "literal" ? { kind: defaultValue.kind, value: defaultValue.value } : { kind: defaultValue.kind },
        constraints: value.constraints,
        sensitivity: value.sensitivity,
    };
}
function manifestPath(value) {
    if (!Array.isArray(value) || value.length === 0 || !value.every(nonempty))
        return manifestInvalid();
    return value.join(" ");
}
function uniqueStrings(value) {
    return Array.isArray(value) && value.every(nonempty) && new Set(value).size === value.length;
}
function sameStrings(value, expected) {
    return Array.isArray(value) && value.length === expected.length && value.every((item, index) => item === expected[index]);
}
function nonempty(value) {
    return typeof value === "string" && value.length > 0;
}
function isSemanticVersion(value) {
    return typeof value === "string" && /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-(?:0|[1-9][0-9]*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9][0-9]*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u.test(value);
}
function manifestInvalid() {
    throw new ApnError("APN_INTERNAL", "Command manifest validation failed.");
}
//# sourceMappingURL=command-catalog.js.map