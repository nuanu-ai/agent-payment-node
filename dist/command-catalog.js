import { OUTPUT_VERSION, PRODUCT_VERSION } from "./constants.js";
import { renderHelp, renderReadmeCommandReference } from "./command-help.js";
import { assertCompatibleManifestEvolution, validateCommandManifest } from "./command-manifest-validation.js";
export { renderHelp, renderReadmeCommandReference };
export { assertCompatibleManifestEvolution, validateCommandManifest };
export * from "./command-catalog-parser.js";
const noDefault = { kind: "none" };
const defaultProfile = { kind: "literal", value: "default" };
const completedStates = { terminal: ["completed", "classified_failure"], non_terminal: [] };
const mcpServerStates = { terminal: ["server_closed", "classified_failure"], non_terminal: ["serving"] };
const directStates = {
    terminal: ["completed", "failed_before_effect", "failed_provider_rejected", "failed_confirmed_revert", "failed_proven_superseded"],
    non_terminal: [
        "awaiting_approval", "started", "provider_pending", "provider_acknowledged", "evidence_pending", "ambiguous_effect",
        "signed_not_submitted", "submitted_pending", "unknown_finality",
    ],
};
const x402States = {
    terminal: ["completed", "failed_before_effect", "failed_expired_unused", "failed_settled_without_result"],
    non_terminal: [
        "preparing",
        "awaiting_approval",
        "started",
        "authorization_material_pending",
        "authorized_not_sent",
        "paid_request_pending",
        "settlement_pending",
        "effect_unknown",
        "ambiguous_effect",
        "seller_result_recovery_pending",
    ],
};
const allOperationStates = {
    terminal: [...directStates.terminal, ...x402States.terminal.filter((state) => !directStates.terminal.includes(state))],
    non_terminal: [...directStates.non_terminal, ...x402States.non_terminal.filter((state) => !directStates.non_terminal.includes(state))],
};
const permissionStates = {
    terminal: ["active", "disabled", "expired", "revoked", "drift_blocked", "forgotten", "classified_failure"],
    non_terminal: ["pending_consent", "grant_committed_pending_profile"],
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
    { path: ["wallet", "permission"], summary: "Inspect and manage bounded provider permission state.", kind: "group" },
    { path: ["wallet", "policy"], summary: "Inspect or change owner-approved wallet policy.", kind: "group" },
    { path: ["x402"], summary: "Inspect and pay standard x402 resources.", kind: "group" },
    { path: ["x402", "fetch"], summary: "Prepare and authorize a durable x402 fetch.", kind: "group" },
    { path: ["pay"], summary: "Prepare and submit direct payments.", kind: "group" },
    { path: ["pay", "transfer"], summary: "Prepare and submit Base-USDC transfers.", kind: "group" },
    { path: ["operation"], summary: "Read or recover durable operations.", kind: "group" },
    { path: ["receipt"], summary: "Read durable terminal receipts.", kind: "group" },
];
export const COMMANDS = [
    command(["--version"], "apn --version", "Report installed APN and CLI contract versions.", [], "none", "Reads immutable build metadata only.", "none", "Never.", completedStates, [], ["apn --version"]),
    command(["mcp", "serve"], "apn mcp serve", "Serve the selected APN commands over local MCP stdio.", [], "none", "Starts only a local child-process stdio session.", "none", "Never.", mcpServerStates, [], ["apn mcp serve"], "text"),
    command(["mcp", "config"], "apn mcp config", "Print the provider-neutral APN MCP launch descriptor.", [], "none", "Returns immutable launch metadata without reading or changing client configuration.", "none", "Never.", completedStates, [], ["apn mcp config"], "text"),
    command(["doctor", "keychain"], "apn doctor keychain", "Check whether the ordinary login Keychain command path is usable.", [], "local_read", "Reads Keychain availability without creating wallet material.", "none", "Never.", completedStates, [], ["apn doctor keychain"]),
    command(["wallet", "ensure"], "apn wallet ensure [--profile <profile>]", "Create or reuse one encrypted disposable wallet.", [profileOptional], "local_write", "May create ~/.apn state and one Keychain wrapping secret.", "none", "Wallet creation itself is non-interactive.", completedStates, [], ["apn wallet ensure --profile default"]),
    command(["wallet", "connect"], "apn wallet connect --profile <profile> --provider <provider-id> [--auth-method <method>] [--expected-revision <positive-integer>] [--permission-cap-usdc-atomic <atomic>] [--permission-expires-at <unix-seconds>] [--idempotency-key <key>]", "Create, reuse or explicitly rebind a foreground-authenticated provider wallet profile.", [
        profileRequired,
        option("--provider", "provider_id", true, noDefault, ["registered_provider_identifier"], "public"),
        option("--auth-method", "provider_auth_method", false, noDefault, [
            "provider_declared_authentication_method",
            "metamask_agent_wallet_values_qr_or_browser",
        ], "public"),
        option("--expected-revision", "positive_integer", false, noDefault, ["required_for_rebind", "omitted_for_initial_connect"], "public"),
        option("--permission-cap-usdc-atomic", "atomic_usdc", false, noDefault, [
            "required_only_for_permission_lifecycle_providers",
            "caller_supplied_without_default",
        ], "operator_input"),
        option("--permission-expires-at", "positive_integer", false, noDefault, [
            "future_absolute_unix_seconds",
            "required_only_for_permission_lifecycle_providers",
            "caller_supplied_without_default",
        ], "operator_input"),
        option("--idempotency-key", "idempotency_key", false, noDefault, [
            "required_only_for_permission_lifecycle_providers",
            "never_echoed_in_safe_output",
        ], "operator_input"),
    ], "local_write", "Runs foreground provider authentication and may persist an encrypted local session plus exact provider grant and safe public binding facts.", "foreground_tty", "Authentication stays foreground: terminal-native providers use the CLI terminal and Smart Account permission consent opens the browser.", completedStates, [], [
        "apn wallet connect --profile provider-one --provider coinbase-agentic-wallet",
        "apn wallet connect --profile metamask --provider metamask-agent-wallet",
        "apn wallet connect --profile metamask --provider metamask-agent-wallet --auth-method browser",
        "apn wallet connect --profile smart-account --provider metamask-smart-account --auth-method browser --permission-cap-usdc-atomic 2000000 --permission-expires-at 2000000000 --idempotency-key smart-account-connect-0001",
    ]),
    command(["wallet", "permission", "list"], "apn wallet permission list --profile <profile>", "Read the locally persisted bounded provider permission without contacting the provider.", [profileRequired], "local_read", "Reads only safe permission identity, bounds, lifecycle, revision and freshness metadata.", "none", "Never.", permissionStates, [], ["apn wallet permission list --profile smart-account"]),
    command(["wallet", "permission", "sync"], "apn wallet permission sync --profile <profile> --expected-revision <positive-integer>", "Foreground-sync the exact persisted permission against MetaMask granted permissions.", [profileRequired, option("--expected-revision", "positive_integer", true, noDefault, ["must_equal_current_permission_revision"], "public")], "local_write", "Opens bounded foreground provider consent, then records only confirmed presence, absence, drift or unverified freshness.", "foreground_tty", "The human selects the bound account in the foreground MetaMask browser; MCP returns a CLI handoff.", permissionStates, [], ["apn wallet permission sync --profile smart-account --expected-revision 1"]),
    command(["wallet", "permission", "disable"], "apn wallet permission disable --profile <profile> --expected-revision <positive-integer>", "Disable one local provider permission binding without claiming provider-side revocation.", [profileRequired, option("--expected-revision", "positive_integer", true, noDefault, ["must_equal_current_permission_revision"], "public")], "local_write", "Revision-guards and durably disables future APN effects while retaining safe audit metadata.", "none", "Never; this is local disable, not provider revoke.", permissionStates, [], ["apn wallet permission disable --profile smart-account --expected-revision 1"]),
    command(["wallet", "permission", "forget"], "apn wallet permission forget --profile <profile> --expected-revision <positive-integer>", "Delete the local session, permission material and profile binding.", [profileRequired, option("--expected-revision", "positive_integer", true, noDefault, ["must_equal_current_permission_revision"], "public")], "local_write", "Deletes only local protected state and warns that MetaMask-side authority may remain.", "none", "Caller must intentionally name the current revision; no provider revoke is implied.", { terminal: ["forgotten", "classified_failure"], non_terminal: [] }, [], ["apn wallet permission forget --profile smart-account --expected-revision 1"]),
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
    command(["x402", "fetch", "approve"], "apn x402 fetch approve --operation <operation-id> --rpc-url <https-url>", "Advance one frozen x402 request under its stored policy.", [operationRequired, rpcRequired], "payment_submit", "Rechecks frozen intent and policy, then obtains one local or provider-detached authorization, or executes one provider-owned paid fetch.", "prior_profile_policy", "APN adds no per-payment prompt; a detached provider signer may still require its own MFA.", x402States, [
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
    command(["operation", "resume"], "apn operation resume --operation <operation-id> --rpc-url <https-url> [--wait-seconds <1..300>]", "Perform only the next legal durable recovery transition.", [operationRequired, rpcRequired, option("--wait-seconds", "integer_seconds", false, noDefault, ["canonical_integer_1_through_300", "x402_or_provider_approval_watch"], "operator_input")], "recovery", "Reuses protected effect material and may reconcile or resubmit only when the stored state permits.", "prior_operation_authorization", "Uses the authorization already bound to the durable operation; it cannot widen the frozen effect.", allOperationStates, [
        { command_path: ["operation", "status"], when: "To inspect the resulting durable state." },
        { command_path: ["receipt", "get"], when: "After terminal completion." },
    ], ["apn operation resume --operation <operation-id> --rpc-url <https-base-rpc-url> --wait-seconds 60"]),
    command(["operation", "recover-provider-request"], "apn operation recover-provider-request --operation <operation-id> --provider-request-id <provider-request-id>", "Bind one independently known provider request to an eligible ambiguous direct transfer without replaying it.", [
        operationRequired,
        option("--provider-request-id", "provider_request_id", true, noDefault, ["1_to_256_safe_ascii_characters"], "operator_input"),
    ], "recovery", "Writes only the opaque provider request reference; it never creates, signs or submits a payment.", "prior_operation_authorization", "The existing frozen transfer and independently obtained provider request ID are the authorization boundary.", allOperationStates, [
        { command_path: ["operation", "resume"], when: "To watch the exact recovered provider request and verify on-chain evidence." },
        { command_path: ["operation", "status"], when: "To inspect the resulting durable state." },
    ], ["apn operation recover-provider-request --operation <operation-id> --provider-request-id <provider-request-id>"]),
    command(["operation", "recover-transaction-settlement"], "apn operation recover-transaction-settlement --operation <operation-id> --transaction-hash <transaction-hash> --idempotency-key <key> --rpc-url <https-url>", "Terminalize one eligible legacy x402 operation from an independently known exact Base transaction.", [
        operationRequired,
        option("--transaction-hash", "transaction_hash", true, noDefault, ["32_byte_evm_transaction_hash", "canonicalized_to_lowercase"], "public"),
        option("--idempotency-key", "idempotency_key", true, noDefault, ["8_to_200_safe_ascii_characters"], "operator_input"),
        rpcRequired,
    ], "recovery", "Reads only the named Base transaction receipt and canonical block facts, then durably terminalizes an eligible already-settled operation.", "prior_operation_authorization", "The existing frozen operation and caller-supplied immutable recovery binding are the authorization boundary; no payment is submitted.", allOperationStates, [
        { command_path: ["operation", "status"], when: "To inspect the resulting durable state." },
        { command_path: ["receipt", "get"], when: "After terminal recovery." },
    ], ["apn operation recover-transaction-settlement --operation <operation-id> --transaction-hash <transaction-hash> --idempotency-key <idempotency-key> --rpc-url <https-base-rpc-url>"]),
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
//# sourceMappingURL=command-catalog.js.map