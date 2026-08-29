import { OUTPUT_VERSION, PRODUCT_VERSION } from "./constants.js";
import { ApnError, asApnError } from "./errors.js";
import { usageFailureEnvelope } from "./command-discovery-output.js";
import { renderHelp, renderReadmeCommandReference } from "./command-help.js";
import { assertCompatibleManifestEvolution, validateCommandManifest } from "./command-manifest-validation.js";
export { renderHelp, renderReadmeCommandReference };
export { assertCompatibleManifestEvolution, validateCommandManifest };
const noDefault = { kind: "none" };
const defaultProfile = { kind: "literal", value: "default" };
const completedStates = { terminal: ["completed", "classified_failure"], non_terminal: [] };
const mcpServerStates = { terminal: ["server_closed", "classified_failure"], non_terminal: ["serving"] };
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
    { path: ["mcp"], summary: "Serve and discover the local APN MCP transport.", kind: "group" },
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
    command(["mcp", "serve"], "apn mcp serve", "Serve the selected APN commands over local MCP stdio.", [], "none", "Starts only a local child-process stdio session.", "none", "Never.", mcpServerStates, [], ["apn mcp serve"], "text"),
    command(["mcp", "config"], "apn mcp config", "Print the provider-neutral APN MCP launch descriptor.", [], "none", "Returns immutable launch metadata without reading or changing client configuration.", "none", "Never.", completedStates, [], ["apn mcp config"], "text"),
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
    command(["x402", "fetch", "approve"], "apn x402 fetch approve --operation <operation-id> --rpc-url <https-url>", "Authorize one frozen x402 request for durable resume.", [operationRequired, rpcRequired], "payment_submit", "Creates one policy-bounded authorization; operation resume owns the next paid-request transition.", "prior_profile_policy", "No per-payment prompt; the frozen operation and existing profile policy are the authorization boundary.", x402States, [
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
        if (token in values) {
            throw new ApnError("APN_INVALID_INPUT", "Command contains an unknown or duplicate option.");
        }
        values[token] = value;
    }
    return parseCatalogInput(definition, values);
}
export function parseCatalogInput(definition, input) {
    const values = {};
    for (const [name, rawValue] of Object.entries(input)) {
        const optionDefinition = definition.options.find((candidate) => candidate.name === name);
        if (optionDefinition === undefined) {
            throw new ApnError("APN_INVALID_INPUT", "Command contains an unknown or duplicate option.");
        }
        if (typeof rawValue !== "string") {
            throw new ApnError("APN_INVALID_INPUT", `${optionDefinition.name} must be a string.`);
        }
        validateOptionValue(optionDefinition, rawValue);
        values[name] = rawValue;
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
function command(path, synopsis, summary, options, effectClass, effectSummary, approvalClass, approvalWhen, states, recovery, examples, outputContract = "apn.cli.v1") {
    return {
        path,
        synopsis,
        summary,
        options,
        effect: { class: effectClass, summary: effectSummary },
        approval: { class: approvalClass, when: approvalWhen },
        output: {
            contract: outputContract,
            success_exit: 0,
            failure_exit: 1,
            success: outputContract === "apn.cli.v1" ? "One successful apn.cli.v1 envelope." : "The command-specific raw transport output.",
            failures: [outputContract === "apn.cli.v1" ? "One classified-failure apn.cli.v1 envelope." : "A classified command failure."],
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
//# sourceMappingURL=command-catalog.js.map