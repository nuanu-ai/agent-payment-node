import { MEGA_FUNDING_COMMANDS, SEI_FUNDING_COMMANDS } from "./lifi/gaszip-direct-command-catalog.js";
import { CIRCLE_EVM_COMMANDS, CIRCLE_EVM_GROUPS } from "./circle-v2-evm/command-catalog.js";
import { MERCHANT_COMMANDS } from "./x402-merchant/command-catalog.js";
import { PERMIT2_COMMANDS } from "./x402-permit2/command-catalog.js";
import { X402_SOLANA_COMMAND_GROUPS, X402_SOLANA_COMMANDS } from "./x402-solana/command-catalog.js";
import { PERMIT2_ALLOWANCE_COMMANDS, PERMIT2_ALLOWANCE_GROUPS } from "./x402-permit2/allowance/catalog.js";
import { WALLET_ALLOWANCE_COMMANDS, WALLET_ALLOWANCE_GROUPS } from "./wallet-allowance/catalog.js";
import { RELAY_COMMANDS, RELAY_COMMAND_GROUPS } from "./relay/command-catalog.js";
import { command, option } from "./command-catalog-builders.js";
import { OUTPUT_VERSION, PRODUCT_VERSION } from "./constants.js";import { EVM_COMMANDS } from "./evm-command-catalog.js";import { BRIDGE_COMMANDS, includeBridgeRecovery } from "./lifi/command-catalog.js";import { ONECLICK_COMMANDS } from "./lifi/near-oneclick-command-catalog.js";import { CIRCLE_COMMANDS } from "./lifi/circle-command-catalog.js";import { GASLESS_COMMANDS, includeGaslessRecovery } from "./gasless/command-catalog.js";import { ALLOWLIST_COMMANDS, ALLOWLIST_COMMAND_GROUPS } from "./allowlist-command-catalog.js";import { UNISWAP_COMMANDS, UNISWAP_COMMAND_GROUPS } from "./swap/uniswap-command-catalog.js";import { SUNSWAP_COMMANDS, SUNSWAP_COMMAND_GROUPS } from "./swap/sunswap-tron/command-catalog.js";import { JUPITER_COMMANDS, JUPITER_COMMAND_GROUPS } from "./swap/jupiter-solana/command-catalog.js";import { ORCA_COMMANDS, ORCA_COMMAND_GROUPS } from "./swap/orca-solana/command-catalog.js";import { CHAIN_COMMANDS, includeRailRecovery } from "./chain-command-catalog.js";import { PORTFOLIO_COMMANDS } from "./portfolio/command-catalog.js";
import { removedV1Commands } from "./command-manifest-migration.js";
import { UNISWAP_TOKEN_COMMANDS, UNISWAP_TOKEN_COMMAND_GROUPS } from "./swap/uniswap-token-command-catalog.js";
import { renderHelp, renderReadmeCommandReference } from "./command-help.js";
import type { CommandDefinition, CommandGroup } from "./command-catalog-types.js";
export { renderHelp, renderReadmeCommandReference };
export * from "./command-catalog-parser.js";
export type { ApprovalClass, CommandDefinition, CommandGroup, CommandOption, EffectClass, ScalarType } from "./command-catalog-types.js";
const noDefault = { kind: "none" } as const;
const defaultProfile = { kind: "literal", value: "default" } as const;
const defaultZero = { kind: "literal", value: "0" } as const;
const completedStates = { terminal: ["completed", "classified_failure"], non_terminal: [] } as const;
const mcpServerStates = { terminal: ["server_closed", "classified_failure"], non_terminal: ["serving"] } as const;
const directStates = {
  terminal: ["completed", "failed_before_effect", "failed_provider_rejected", "failed_confirmed_revert", "failed_proven_superseded", "abandoned_unknown"],
  non_terminal: [
    "awaiting_approval", "started", "provider_pending", "provider_acknowledged", "evidence_pending", "ambiguous_effect",
    "signed_not_submitted", "submitted_pending", "unknown_finality",
  ],
} as const;
const x402States = {
  terminal: ["completed", "failed_before_effect", "failed_expired_unused", "failed_settled_without_result", "abandoned_unknown"],
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
} as const;
const allOperationStates = {
  terminal: [...directStates.terminal, ...x402States.terminal.filter((state) => !directStates.terminal.includes(state as never))],
  non_terminal: [...directStates.non_terminal, ...x402States.non_terminal.filter((state) => !directStates.non_terminal.includes(state as never))],
} as const;
const permissionStates = {
  terminal: ["active", "disabled", "expired", "revoked", "drift_blocked", "forgotten", "classified_failure"],
  non_terminal: ["pending_consent", "grant_committed_pending_profile"],
} as const;
const profileOptional = option("--profile", "profile", false, defaultProfile, ["matches_[a-z0-9][a-z0-9._-]{0,63}"], "public");
const profileRequired = option("--profile", "profile", true, noDefault, ["matches_[a-z0-9][a-z0-9._-]{0,63}"], "public");
const rpcRequired = option("--rpc-url", "https_url", true, noDefault, [
  "credential_free_https_without_fragment",
  "public_target_required_at_runtime",
], "operator_input");
const operationRequired = option("--operation", "operation_id", true, noDefault, ["64_lowercase_hex_characters"], "public");
/** Selects the local-wallet x402 network; omission keeps the original Base meaning of these commands (no inheritance). */
const chainOptional = option("--chain", "string", false, noDefault, ["eip155_caip2_of_any_evm_chain", "rpc_chain_id_must_match", "omitted_means_eip155:8453"], "operator_input");
/** The x402 token; the owner admits each chain+token pair in its own policy, and prepare proves its EIP-3009 identity on chain. */
const assetOptional = option("--asset", "address", false, noDefault, ["exact_erc20_contract_address", "admitted_by_owner_x402_policy_for_this_chain",
  "omitted_means_usdc_on_eip155:8453_eip155:1_eip155:42161_only"], "operator_input");
/** Wallet policy also names Solana x402 for one SPL mint (`--chain solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp --asset <mint>`). */
const policyChainOptional = option("--chain", "string", false, noDefault, ["eip155_caip2_of_any_evm_chain_or_solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
  "rpc_chain_id_must_match", "omitted_means_eip155:8453"], "operator_input");
const policyAssetOptional = option("--asset", "string", false, noDefault, ["exact_erc20_contract_address_or_solana_spl_mint",
  "admitted_by_owner_x402_policy_for_this_chain", "omitted_means_usdc_on_eip155:8453_eip155:1_eip155:42161_only", "required_for_solana"], "operator_input");
const httpOptions = [
  option("--method", "string", false, noDefault, ["http_token_except_connect_and_trace", "default_GET"], "operator_input"),
  option("--headers-json", "string", false, noDefault, ["bounded_safe_header_object", "no_credentials_or_payment_headers"], "operator_input"),
  option("--body-base64", "base64", false, noDefault, ["maximum_65536_decoded_bytes", "empty_is_present_zero_bytes", "omission_is_absent"], "operator_input"),
];
const httpSynopsis = " [--method <method>] [--headers-json <json>] [--body-base64 <base64>]";
export const COMMAND_GROUPS: readonly CommandGroup[] = [
  ...ALLOWLIST_COMMAND_GROUPS, ...UNISWAP_COMMAND_GROUPS, ...UNISWAP_TOKEN_COMMAND_GROUPS,
  ...SUNSWAP_COMMAND_GROUPS, ...JUPITER_COMMAND_GROUPS, ...ORCA_COMMAND_GROUPS,
  ...RELAY_COMMAND_GROUPS,
  { path: ["mega"], summary: "Finite Mega native funding.", kind: "group" },
  { path: ["mega", "funding"], summary: "GasZip direct Base ETH to Mega ETH, self only.", kind: "group" },
  { path: ["sei"], summary: "Finite Sei native funding.", kind: "group" },
  { path: ["sei", "funding"], summary: "GasZip direct Base ETH to Sei SEI, self only.", kind: "group" },
  { path: ["stargate"], summary: "Execute the pinned Stargate V2 Ethereum ETH to Unichain ETH lane.", kind: "group" },
  { path: ["stargate", "native"], summary: "Prepare, submit and observe one exact self transfer.", kind: "group" },
  { path: ["stargate", "token"], summary: "Bridge pinned Optimism USDC to Polygon with an optional native drop.", kind: "group" },
  { path: ["gasless"], summary: "Transfer USDC with gas paid from the total USDC budget.", kind: "group" },
  { path: ["gasless", "transfer"], summary: "Prepare and approve a USDC fee transfer.", kind: "group" },
  { path: ["bridge"], summary: "Discover, prepare and recover finite LI.FI cross-chain routes.", kind: "group" },
  { path: ["oneclick"], summary: "Direct NEAR 1Click deposits on pinned lanes to TRON and Solana.", kind: "group" },{ path: ["oneclick", "source"], summary: "One Base USDC or Ethereum ETH source deposit.", kind: "group" },
  { path: ["circle"], summary: "Bounded Circle V2 Base to Solana USDC operations.", kind: "group" },
  { path: ["circle", "approval"], summary: "Prepare and execute an exact Base USDC allowance.", kind: "group" },
  { path: ["circle", "source"], summary: "Submit one Base CCTP V2 source transfer.", kind: "group" },
  ...CIRCLE_EVM_GROUPS,
  { path: ["policy"], summary: "Explicit human admission of mainnet chain assets.", kind: "group" },
  { path: ["mcp"], summary: "Serve and discover the local APN MCP transport.", kind: "group" },
  { path: ["doctor"], summary: "Inspect local APN prerequisites.", kind: "group" },
  { path: ["wallet"], summary: "Create, inspect and configure the disposable wallet.", kind: "group" },
  { path: ["wallet", "permission"], summary: "Inspect and manage bounded provider permission state.", kind: "group" },
  { path: ["wallet", "metamask"], summary: "Guarded MetaMask Agent Wallet USDC transfer that pays its network fee in the native coin.", kind: "group" },
  { path: ["wallet", "policy"], summary: "Inspect or change owner-approved wallet policy.", kind: "group" },
  ...WALLET_ALLOWANCE_GROUPS,
  { path: ["x402"], summary: "Inspect and pay standard x402 resources.", kind: "group" },
  { path: ["x402", "merchant"], summary: "x402 ERC-20 transfer-proof merchant payment and delivery.", kind: "group" },
  { path: ["x402", "permit2"], summary: "Read owner admission and intents, approve one foreground Permit2 GET and observe chain evidence.", kind: "group" },
  ...X402_SOLANA_COMMAND_GROUPS,
  ...PERMIT2_ALLOWANCE_GROUPS,
  { path: ["x402", "fetch"], summary: "Prepare and authorize a durable x402 fetch.", kind: "group" },
  { path: ["pay"], summary: "Prepare and submit direct payments.", kind: "group" },
  { path: ["pay", "transfer"], summary: "Prepare and submit Base-USDC transfers.", kind: "group" },
  { path: ["operation"], summary: "Read, recover or explicitly abandon eligible durable operations.", kind: "group" },
  { path: ["receipt"], summary: "Read durable terminal receipts.", kind: "group" },
] as const;
const BASE_COMMANDS: readonly CommandDefinition[] = [
  ...PERMIT2_COMMANDS,
  ...X402_SOLANA_COMMANDS,
  ...PERMIT2_ALLOWANCE_COMMANDS,
  ...WALLET_ALLOWANCE_COMMANDS,
  ...MERCHANT_COMMANDS,
  ...RELAY_COMMANDS,
  command(["stargate", "native", "prepare"], "apn stargate native prepare --profile <profile> --amount-atomic <wei> --max-native-debit-atomic <wei> --idempotency-key <key>", "Freeze a fresh quote and exact Ethereum Stargate sendToken envelope.", [profileRequired, option("--amount-atomic", "wei", true, noDefault, ["positive_integer", "dust_free_quote_amount"], "operator_input"), option("--max-native-debit-atomic", "wei", true, noDefault, ["positive_integer"], "operator_input"), option("--idempotency-key", "idempotency_key", true, noDefault, ["8_to_128_safe_ascii_characters"], "operator_input")], "payment_prepare", "Reads both chains and writes a crash-durable unsigned operation.", "none", "Never.", { terminal: [], non_terminal: ["prepared"] }, [{ command_path: ["stargate", "native", "execute"], when: "After reviewing the frozen operation." }], ["apn stargate native prepare --profile owner --amount-atomic 10000000000000000 --max-native-debit-atomic 12000000000000000 --idempotency-key eth-unichain-0001"]),
  command(["stargate", "native", "execute"], "apn stargate native execute --operation <operation-id>", "Foreground-confirm and submit or observe an exact prepared transfer.", [operationRequired], "payment_submit", "May sign and submit exactly once after fresh preflight checks.", "foreground_tty", "Immediately before the attempt marker and signing.", { terminal: ["observed"], non_terminal: ["approved", "submission_started", "submitted", "unknown_finality"] }, [{ command_path: ["stargate", "native", "status"], when: "To inspect durable state without signing or resending." }], ["apn stargate native execute --operation <operation-id>"]),
  command(["stargate", "native", "observe"], "apn stargate native observe --operation <operation-id>", "Observe safe source and destination evidence for one prior submission attempt.", [operationRequired], "network_read", "Reads both chains and may durably advance only the named attempted operation; never signs or resends.", "prior_operation_authorization", "The immutable submission_started marker and transaction hash are the authorization boundary.", { terminal: ["observed"], non_terminal: ["submitted", "unknown_finality"] }, [], ["apn stargate native observe --operation <operation-id>"]),
  command(["stargate", "native", "status"], "apn stargate native status --operation <operation-id>", "Read one durable Stargate native operation; a non-terminal record of the unreleased schema v1 is closed once its signing nonce is past at the finalized block.", [operationRequired], "local_write", "Reads one journal record. For a non-terminal unreleased-schema record only, reads the Ethereum nonce at the finalized block and its own transaction hashes (APN_ETHEREUM_RPC_URL) and writes a closure file beside the record; never signs or sends.", "none", "Never.", { terminal: ["observed"], non_terminal: ["prepared", "approved", "submission_started", "submitted", "unknown_finality"] }, [], ["apn stargate native status --operation <operation-id>"]),
  command(["stargate", "native", "receipt"], "apn stargate native receipt --operation <operation-id>", "Read the canonical receipt after exact safe source and destination events.", [operationRequired], "local_read", "Reads one observed journal record.", "none", "Never.", { terminal: ["observed"], non_terminal: [] }, [], ["apn stargate native receipt --operation <operation-id>"]),
  command(["stargate", "token", "prepare"], "apn stargate token prepare --profile <profile> --amount-atomic <usdc> [--native-drop-atomic <wei>] --min-output-atomic <usdc> --max-native-debit-atomic <wei> [--max-fee-per-gas-wei <wei> --max-priority-fee-per-gas-wei <wei>] --idempotency-key <key>", "Freeze the Optimism USDC to Polygon USDC plus native-drop operation with optional owner-approved EIP-1559 ceilings.", [profileRequired, option("--amount-atomic", "atomic_usdc", true, noDefault, ["positive_integer"], "operator_input"), option("--native-drop-atomic", "string", false, defaultZero, ["canonical_uint128", "default_zero", "executor_cap_when_nonzero"], "operator_input"), option("--min-output-atomic", "atomic_usdc", true, noDefault, ["positive_integer"], "operator_input"), option("--max-native-debit-atomic", "wei", true, noDefault, ["positive_integer"], "operator_input"), option("--max-fee-per-gas-wei", "wei", false, noDefault, ["positive_integer", "requires_max_priority_fee_per_gas_wei", "at_least_fresh_quote"], "operator_input"), option("--max-priority-fee-per-gas-wei", "wei", false, noDefault, ["positive_integer", "requires_max_fee_per_gas_wei", "not_above_max_fee_per_gas_wei", "at_least_fresh_quote"], "operator_input"), option("--idempotency-key", "idempotency_key", true, noDefault, ["8_to_128_safe_ascii_characters"], "operator_input")], "payment_prepare", "Reads both chains, the Executor cap, policy and allowance; writes exact unsigned approval/send envelopes at the approved fee pair.", "none", "Never.", { terminal: [], non_terminal: ["prepared"] }, [{ command_path: ["stargate", "token", "execute"], when: "After reviewing the frozen operation." }], ["apn stargate token prepare --profile owner --amount-atomic 100000 --native-drop-atomic 50000000000000000 --min-output-atomic 99000 --max-native-debit-atomic 20000000000000000 --max-fee-per-gas-wei 30000000 --max-priority-fee-per-gas-wei 1000000 --idempotency-key op-polygon-usdc-0001"]),
  command(["stargate", "token", "execute"], "apn stargate token execute --operation <operation-id>", "Foreground-confirm and execute the exact durable approval and bridge effects.", [operationRequired], "payment_submit", "May sign each frozen effect once after fresh quote, cap, policy, allowance and simulation checks.", "foreground_tty", "Before any signature.", { terminal: ["observed", "cleaned", "abandoned_unknown"], non_terminal: ["approved", "allowance_submission_started", "allowance_unknown_finality", "allowance_submitted", "allowance_observed", "submission_started", "submitted", "unknown_finality", "cleanup_required"] }, [{ command_path: ["stargate", "token", "status"], when: "Inspect local durable state." }], ["apn stargate token execute --operation <operation-id>"]),
  command(["stargate", "token", "cleanup"], "apn stargate token cleanup --operation <operation-id>", "Explicitly revoke a stranded exact Stargate token allowance.", [operationRequired], "payment_submit", "Freshly freezes, foreground-confirms, marks and submits one approve-zero transaction; ambiguous results are never resent.", "foreground_tty", "Immediately before signing the revoke transaction.", { terminal: ["observed", "cleaned", "abandoned_unknown"], non_terminal: ["cleanup_required", "cleanup_submission_started", "cleanup_submitted", "cleanup_unknown_finality"] }, [{ command_path: ["stargate", "token", "observe"], when: "Observe an attempted cleanup without signing." }], ["apn stargate token cleanup --operation <operation-id>"]),
  command(["stargate", "token", "observe"], "apn stargate token observe --operation <operation-id>", "Observe safe approval, source, destination, or cleanup evidence without resending.", [operationRequired], "network_read", "Reads both chains and only advances an attempted operation.", "prior_operation_authorization", "A durable attempt marker, transaction hash, or pending usage reservation target already exists.", { terminal: ["observed", "cleaned", "abandoned_unknown"], non_terminal: ["allowance_unknown_finality", "allowance_submitted", "submitted", "unknown_finality", "cleanup_required", "cleanup_submission_started", "cleanup_submitted", "cleanup_unknown_finality"] }, [], ["apn stargate token observe --operation <operation-id>"]),
  command(["stargate", "token", "status"], "apn stargate token status --operation <operation-id>", "Read the local Stargate token journal and reconcile any pending local usage-ledger transition; a non-terminal record of an unreleased schema (v1..v4) is closed once its signing nonce is past at the finalized block.", [operationRequired], "local_write", "Reads one owner-only journal record and may idempotently reconcile its local usage reservation. For a non-terminal unreleased-schema record only, reads the Optimism nonce at the finalized block and its own transaction hashes (APN_OPTIMISM_RPC_URL) and writes a closure file beside the record; never signs or sends.", "prior_operation_authorization", "The operation-bound usage target authorizes only its matching idempotent ledger transition.", { terminal: ["observed", "cleaned", "abandoned_unknown"], non_terminal: ["prepared", "approved", "allowance_submission_started", "allowance_unknown_finality", "allowance_submitted", "allowance_observed", "submission_started", "submitted", "unknown_finality", "cleanup_required", "cleanup_submission_started", "cleanup_submitted", "cleanup_unknown_finality"] }, [], ["apn stargate token status --operation <operation-id>"]),
  command(["stargate", "token", "receipt"], "apn stargate token receipt --operation <operation-id>", "Read the local canonical receipt after exact destination proof and finalized usage accounting.", [operationRequired], "local_write", "May idempotently reconcile the operation-bound local usage transition before reading the receipt; performs no RPC.", "prior_operation_authorization", "The operation-bound usage target authorizes only its matching idempotent ledger transition.", { terminal: ["observed"], non_terminal: [] }, [], ["apn stargate token receipt --operation <operation-id>"]),
  ...EVM_COMMANDS,
  command(["--version"], "apn --version", "Report installed APN and CLI contract versions.", [], "none", "Reads immutable build metadata only.", "none", "Never.", completedStates, [], ["apn --version"]),
  command(["mcp", "serve"], "apn mcp serve", "Serve the selected APN commands over local MCP stdio.", [], "none", "Starts only a local child-process stdio session.", "none", "Never.", mcpServerStates, [], ["apn mcp serve"], "text"),
  command(["mcp", "config"], "apn mcp config", "Print the provider-neutral APN MCP launch descriptor.", [], "none", "Returns immutable launch metadata without reading or changing client configuration.", "none", "Never.", completedStates, [], ["apn mcp config"], "text"),
  command(["doctor", "keychain"], "apn doctor keychain [--profile <profile>]", "Check whether the ordinary login Keychain command path is usable.", [profileOptional], "local_read", "Reads Keychain availability without creating wallet material.", "none", "Never.", completedStates, [], ["apn doctor keychain"]),
  command(["wallet", "ensure"], "apn wallet ensure [--profile <profile>]", "Create or reuse one encrypted disposable wallet.", [profileOptional], "local_write", "May create ~/.apn state and one Keychain wrapping secret.", "none", "Wallet creation itself is non-interactive.", completedStates, [], ["apn wallet ensure --profile default"]),
  command(["wallet", "import"], "apn wallet import --profile <profile> --key-file <absolute-path> --key-name <env-name> --expected-address <checksummed-address>", "Import a private key from an owner-only file into a new encrypted local wallet profile.", [profileRequired, option("--key-file", "string", true, noDefault, ["absolute_owner_only_regular_file_mode_0600"], "operator_input"), option("--key-name", "string", true, noDefault, ["environment_variable_name"], "public"), option("--expected-address", "address", true, noDefault, ["exact_checksum_match"], "public")], "local_write", "Creates a new encrypted wallet envelope and public profile metadata without overwriting existing state.", "none", "The operator supplies the private key file path and expected public address.", completedStates, [], ["apn wallet import --profile test-payer --key-file /secure/evm.env --key-name EVM_SIGNER --expected-address <checksummed-address>"]),
  command(
    ["wallet", "connect"],
    "apn wallet connect --profile <profile> --provider <provider-id> [--auth-method <method>] [--expected-revision <positive-integer>] [--permission-cap-usdc-atomic <atomic>] [--permission-expires-at <unix-seconds>] [--idempotency-key <key>]",
    "Create, reuse or explicitly rebind a foreground-authenticated provider wallet profile.",
    [
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
    ],
    "local_write",
    "Runs foreground provider authentication and may persist an encrypted local session plus exact provider grant and safe public binding facts.",
    "foreground_tty",
    "Authentication stays foreground: terminal-native providers use the CLI terminal and Smart Account permission consent opens the browser.",
    completedStates,
    [],
    [
      "apn wallet connect --profile provider-one --provider coinbase-agentic-wallet",
      "apn wallet connect --profile metamask --provider metamask-agent-wallet",
      "apn wallet connect --profile metamask --provider metamask-agent-wallet --auth-method browser",
      "apn wallet connect --profile smart-account --provider metamask-smart-account --auth-method browser --permission-cap-usdc-atomic 2000000 --permission-expires-at 2000000000 --idempotency-key smart-account-connect-0001",
    ],
  ),
  command(
    ["wallet", "permission", "list"],
    "apn wallet permission list --profile <profile>",
    "Read the locally persisted bounded provider permission without contacting the provider.",
    [profileRequired],
    "local_read",
    "Reads only safe permission identity, bounds, lifecycle, revision and freshness metadata.",
    "none",
    "Never.",
    permissionStates,
    [
      {
        command_path: ["wallet", "connect"],
        when: "status is pending_consent and the caller can retry the exact original provider, cap, expiry and idempotency key",
      },
      {
        command_path: ["wallet", "permission", "forget"],
        when: "status is pending_consent and the caller has reviewed possible provider-side authority before cancelling the exact local revision",
      },
    ],
    ["apn wallet permission list --profile smart-account"],
  ),
  command(
    ["wallet", "permission", "sync"],
    "apn wallet permission sync --profile <profile> --expected-revision <positive-integer>",
    "Foreground-sync the exact persisted permission against MetaMask granted permissions.",
    [profileRequired, option("--expected-revision", "positive_integer", true, noDefault, ["must_equal_current_permission_revision"], "public")],
    "local_write",
    "Opens bounded foreground provider consent, then records only confirmed presence, absence, drift or unverified freshness.",
    "foreground_tty",
    "The human selects the bound account in the foreground MetaMask browser; MCP returns a CLI handoff.",
    permissionStates,
    [],
    ["apn wallet permission sync --profile smart-account --expected-revision 1"],
  ),
  command(
    ["wallet", "permission", "disable"],
    "apn wallet permission disable --profile <profile> --expected-revision <positive-integer>",
    "Disable one local provider permission binding without claiming provider-side revocation.",
    [profileRequired, option("--expected-revision", "positive_integer", true, noDefault, ["must_equal_current_permission_revision"], "public")],
    "local_write",
    "Revision-guards and durably disables future APN effects while retaining safe audit metadata.",
    "none",
    "Never; this is local disable, not provider revoke.",
    permissionStates,
    [],
    ["apn wallet permission disable --profile smart-account --expected-revision 1"],
  ),
  command(
    ["wallet", "permission", "forget"],
    "apn wallet permission forget --profile <profile> --expected-revision <positive-integer>",
    "Delete the local session, permission material and profile binding.",
    [profileRequired, option("--expected-revision", "positive_integer", true, noDefault, ["must_equal_current_permission_revision"], "public")],
    "local_write",
    "Deletes only local protected state and warns that MetaMask-side authority may remain.",
    "none",
    "Caller must intentionally name the current revision; no provider revoke is implied.",
    { terminal: ["forgotten", "classified_failure"], non_terminal: [] },
    [],
    ["apn wallet permission forget --profile smart-account --expected-revision 1"],
  ),
  command(["wallet","metamask","native-transfer"],"apn wallet metamask native-transfer --profile <profile> --chain <chain> --recipient <address> --amount-atomic <usdc> --idempotency-key <key>","Transfer an exact USDC amount from the profile's MetaMask Agent Wallet to a recipient, paying the network fee in the native coin.",[profileRequired,option("--chain","string",true,noDefault,["ethereum","optimism","monad","linea","sei"],"public"),option("--recipient","address",true,noDefault,["nonzero_evm_address","allowlisted_in_metamask_guard_policy_for_chain","admitted_by_owner_recipient_pin_when_set"],"public"),option("--amount-atomic","atomic_usdc",true,noDefault,["positive_integer","within_owner_direct_usdc_caps"],"operator_input"),option("--idempotency-key","string",true,noDefault,["canonical_idempotency_key"],"public")],"payment_submit","Connected MetaMask profile, active owner direct-rail USDC and native policy (caps, optional recipient pin), MetaMask Guard policy naming the wallet, allowlisting the recipient on the chain and carrying an outflow limit, physical balances and durable single effect marker.","foreground_tty","Genuine foreground stdin/stderr approval within 60 seconds.",{terminal:["confirmed","confirmed_reverted","failed_before_effect","abandoned_unknown"],non_terminal:["prepared","effect_started","acknowledged","unknown"]},[{command_path:["wallet","metamask","native-transfer-observe"],when:"After an acknowledged or unknown outcome, to prove the receipt and settle the actual fee."}],["apn wallet metamask native-transfer --profile <profile> --chain ethereum --recipient <address> --amount-atomic 1000 --idempotency-key native-0001"]),
  command(["wallet","metamask","native-transfer-status"],"apn wallet metamask native-transfer-status --operation <id>","Read the durable native transfer journal.",[operationRequired],"local_read","Reads public journal without private wallet action.","none","Never.",completedStates,[],["apn wallet metamask native-transfer-status --operation <operation-id>"]),
  command(["wallet","metamask","native-transfer-observe"],"apn wallet metamask native-transfer-observe --operation <id>","Observe stored exact transaction and settle actual full native fees.",[operationRequired],"network_read","Public canonical RPC observation of the saved quote; never sends again.","none","Never.",completedStates,[],["apn wallet metamask native-transfer-observe --operation <operation-id>"]),
  command(["wallet", "status"], "apn wallet status [--profile <profile>]", "Read wallet presence and public identity.", [profileOptional], "local_read", "Returns absent without creating state or accessing Keychain material.", "none", "Never.", completedStates, [], ["apn wallet status --profile default"]),
  command(["wallet", "policy", "show"], "apn wallet policy show --profile <profile> [--chain <caip2>] [--asset <token>]", "Read the encrypted owner-approved profile policy.", [profileRequired, policyChainOptional, policyAssetOptional], "local_read", "Reads wallet-bound policy state.", "none", "Never.", completedStates, [], ["apn wallet policy show --profile default", "apn wallet policy show --profile default --chain eip155:1"]),
  command(
    ["wallet", "policy", "set"],
    "apn wallet policy set --profile <profile> [--chain <caip2>] [--asset <token>] --max-balance-usdc-atomic <atomic> --max-x402-amount-atomic <atomic> [--max-balance-eth-wei <wei>] [--x402-payees <address,...|unrestricted>]",
    "Create, lower or raise owner-approved balance and x402 limits.",
    [
      profileRequired,
      policyChainOptional,
      policyAssetOptional,
      option("--max-balance-usdc-atomic", "atomic_usdc", true, noDefault, ["positive_canonical_integer"], "operator_input"),
      option("--max-x402-amount-atomic", "atomic_usdc", true, noDefault, ["positive_canonical_integer", "not_greater_than_max_balance_usdc_atomic"], "operator_input"),
      option("--max-balance-eth-wei", "wei", false, noDefault, ["positive_canonical_integer", "omission_preserves_existing_value"], "operator_input"),
      option("--x402-payees", "string", false, noDefault, ["comma_separated_1_to_16_unique_nonzero_evm_addresses_or_unrestricted", "omission_preserves_existing_value", "widening_requires_foreground_tty"], "operator_input"),
    ],
    "local_write",
    "Writes an encrypted wallet-bound profile policy.",
    "foreground_tty",
    "Required when a policy is created, any limit increases or the x402 payee pin widens; a pure decrease or a new pin is non-interactive.",
    completedStates,
    [],
    ["apn wallet policy set --profile default --max-balance-usdc-atomic <owner-limit-atomic> --max-x402-amount-atomic <owner-limit-atomic>",
      "apn wallet policy set --profile default --chain eip155:1 --max-balance-usdc-atomic <owner-limit-atomic> --max-x402-amount-atomic <owner-limit-atomic>",
      "apn wallet policy set --profile default --chain eip155:137 --asset <token-contract> --max-balance-usdc-atomic <owner-limit-atomic> --max-x402-amount-atomic <owner-limit-atomic>"],
  ),
  command(["x402", "inspect"], "apn x402 inspect [--chain <caip2>] [--asset <token>] --url <https-url>" + httpSynopsis + " [--payer <address>]", "Inspect supported offers using an unpaid request; an offer APN cannot sign is refused by its deciding field (payment window above 3600 s, an understood extra key such as spenderAddress or chainId); a seller may still process its application payload.", [
    chainOptional,
    assetOptional,
    ...httpOptions,
    option("--payer", "address", false, noDefault, ["canonical_evm_address"], "public"),
    option("--url", "https_url", true, noDefault, ["credential_free_https_without_fragment", "maximum_2048_utf8_bytes", "canonical_whatwg_serialization", "public_target_required_at_runtime"], "public"),
  ], "network_request", "Performs one unpaid HTTPS request; application side effects depend on the seller.", "none", "Never signs or pays; caller must authorize the application request.", completedStates, [], ["apn x402 inspect --url https://seller.example/resource", "apn x402 inspect --chain eip155:1 --url https://seller.example/resource"]),
  command(
    ["x402", "fetch", "prepare"],
    "apn x402 fetch prepare --profile <profile> [--chain <caip2>] [--asset <token>] --url <https-url> --idempotency-key <key> --rpc-url <https-url> [--max-amount-atomic <atomic>]" + httpSynopsis,
    "Freeze a policy-bounded standard x402 purchase (seller payment window at most 3600 s; unknown offer extra keys are echoed unchanged).",
    [
      profileRequired,
      chainOptional,
      assetOptional,
      ...httpOptions,
      option("--url", "https_url", true, noDefault, ["credential_free_https_without_fragment", "maximum_2048_utf8_bytes", "canonical_whatwg_serialization", "public_target_required_at_runtime"], "public"),
      option("--idempotency-key", "idempotency_key", true, noDefault, ["8_to_200_safe_ascii_characters"], "operator_input"),
      rpcRequired,
      option("--max-amount-atomic", "atomic_usdc", false, noDefault, ["positive_canonical_integer", "may_only_lower_profile_limit"], "operator_input"),
    ],
    "payment_prepare",
    "Reads the seller challenge and the selected network's token evidence, then durably freezes one purchase intent without signing.",
    "prior_profile_policy",
    "An owner-approved profile policy must already bound the purchase.",
    x402States,
    [{ command_path: ["x402", "fetch", "approve"], when: "After a successful prepare returns an operation ID." }],
    ["apn x402 fetch prepare --profile default --url https://seller.example/resource --idempotency-key <idempotency-key> --rpc-url <https-base-rpc-url>",
      "apn x402 fetch prepare --profile default --chain eip155:42161 --url https://seller.example/resource --idempotency-key <idempotency-key> --rpc-url <https-arbitrum-rpc-url>",
      "apn x402 fetch prepare --profile default --chain eip155:137 --asset <token-contract> --url https://seller.example/resource --idempotency-key <idempotency-key> --rpc-url <https-polygon-rpc-url>"],
  ),
  command(
    ["x402", "fetch", "approve"],
    "apn x402 fetch approve --operation <operation-id> --rpc-url <https-url>",
    "Advance one frozen x402 request under its stored policy.",
    [operationRequired, rpcRequired],
    "payment_submit",
    "Rechecks frozen intent and policy, then obtains one local or provider-detached authorization, or executes one provider-owned paid fetch.",
    "prior_profile_policy",
    "APN adds no per-payment prompt; a detached provider signer may still require its own MFA.",
    x402States,
    [
      { command_path: ["operation", "status"], when: "To inspect any returned non-terminal state." },
      { command_path: ["operation", "resume"], when: "When documented durable recovery is permitted." },
      { command_path: ["receipt", "get"], when: "After terminal completion." },
    ],
    ["apn x402 fetch approve --operation <operation-id> --rpc-url <https-base-rpc-url>"],
  ),
  command(
    ["pay", "transfer", "prepare"],
    "apn pay transfer prepare --profile <profile> --idempotency-key <key> --to <address> --amount-usdc <decimal> --rpc-url <https-url>",
    "Freeze one exact direct Base-USDC transfer.",
    [
      profileRequired,
      option("--idempotency-key", "idempotency_key", true, noDefault, ["8_to_200_safe_ascii_characters"], "operator_input"),
      option("--to", "address", true, noDefault, ["canonical_evm_address"], "public"),
      option("--amount-usdc", "decimal_usdc", true, noDefault, ["positive_canonical_decimal", "maximum_6_fractional_digits"], "operator_input"),
      rpcRequired,
    ],
    "payment_prepare",
    "Reads Base evidence and provider authority and balances where applicable, then durably freezes one exact intent without child creation or signing.",
    "none",
    "Prepare does not authorize submission.",
    directStates,
    [{ command_path: ["pay", "transfer", "approve"], when: "After a successful prepare returns an operation ID." }],
    ["apn pay transfer prepare --profile default --idempotency-key <idempotency-key> --to <recipient-address> --amount-usdc 0.01 --rpc-url <https-base-rpc-url>"],
  ),
  command(
    ["pay", "transfer", "approve"],
    "apn pay transfer approve --operation <operation-id> --rpc-url <https-url>",
    "Approve, sign and submit one frozen direct transfer.",
    [operationRequired, rpcRequired],
    "payment_submit",
    "After an exact foreground approval, provider-atomic profiles invoke their bound sender; Smart Account profiles derive one exact child authority, seal one DelegationManager transaction and submit it.",
    "foreground_tty",
    "Always requires the exact operation-bound phrase in foreground stdin/stderr TTYs. It never reopens MetaMask permission consent or widens the root grant.",
    directStates,
    [
      { command_path: ["operation", "status"], when: "To inspect any returned non-terminal state." },
      { command_path: ["operation", "resume"], when: "When documented durable recovery is permitted." },
      { command_path: ["receipt", "get"], when: "After terminal completion." },
    ],
    ["apn pay transfer approve --operation <operation-id> --rpc-url <https-base-rpc-url>"],
  ),
  command(["operation", "status"], "apn operation status --operation <operation-id> [--refresh-allowance]", "Inspect one durable operation of any family through its own status, which observes the chain only where that family's status does (swaps, Uniswap token, 1Click, Circle approval, a Circle Base to Solana burn until its finalized receipt and residual wrapper allowance are stored, and the closure check of a Stargate record of an unreleased schema).", [operationRequired,
    option("--refresh-allowance", "boolean", false, { kind: "literal", value: "false" }, ["circle_base_to_solana_source_only", "one_finalized_allowance_read_replaces_the_stored_value"], "public")], "local_write", "May initialize local state, index saved operations and repair saved operation or direct receipt records; never signs, submits, or resumes a payment effect.", "none", "Never.", allOperationStates, [
    { command_path: ["operation", "resume"], when: "When the returned state documents resumable recovery; a family recovered by its own command names that command." },
    { command_path: ["operation", "abandon"], when: "Only for an operation its family lets the owner close (a provider-atomic ambiguous effect with no transaction hash or provider recovery reference, a local EVM transfer APN signed but never dispatched or dispatched and still undecided after its approval window, a Circle funding route a possibly-sent effect keeps open past its expiry, a local Solana/TRON transfer whose validity window passed with no RPC history, a gasless or x402 effect still unknown after its window), or for a record APN cannot read, after accepting the unresolved financial risk." },
    { command_path: ["receipt", "get"], when: "When the operation is terminal." },
  ], ["apn operation status --operation <operation-id>"]),
  command(["operation", "abandon"], "apn operation abandon --operation <operation-id>",
    "Administratively close one strictly eligible unresolved operation through its family's owner exit, or release the account claims of a record APN cannot read.", [operationRequired], "local_write",
    "After exact owner confirmation, the family's exit appends an abandonment transition and its receipt; a local EVM signature without a dispatch record releases its hold, while a dispatched local EVM transfer or a Circle funding route that no proof decided stays charged, expired local rail eligibility uses read-only RPC checks, gasless eligibility first retries read-only observation. A record APN cannot read (or an admission whose prepare crashed) only loses its account claims: the file and any ledger reservation stay as they are, still charged. A family without an owner exit names its own exit command. It never signs, submits or relays.",
    "foreground_tty", "Requires the exact operation-bound phrase and acknowledgement that the financial outcome remains unknown.",
    { terminal: ["abandoned_unknown"], non_terminal: ["ambiguous_effect", "signed_not_submitted", "unknown_finality", "submitted_pending"] }, [
      { command_path: ["operation", "status"], when: "To inspect the immutable administrative terminal state." },
      { command_path: ["receipt", "get"], when: "To read the owner-acknowledgement receipt." },
    ], ["apn operation abandon --operation <operation-id>"]),
  command(
    ["operation", "resume"],
    "apn operation resume --operation <operation-id> --rpc-url <https-url> [--wait-seconds <1..300>] [--observe-only true] [--coinbase-observation-rpc publicnode-base]",
    "Perform only the next legal durable recovery transition.",
    [operationRequired, rpcRequired, option("--coinbase-observation-rpc", "string", false, noDefault, ["publicnode-base", "saved_started_or_ambiguous_awal_gasless_only", "fixed_secondary_bounded_logs_only"], "public"), option("--wait-seconds", "integer_seconds", false, noDefault, ["canonical_integer_1_through_300", "x402_or_provider_approval_watch"], "operator_input"),
      option("--observe-only", "string", false, noDefault, ["literal_true", "already_submitted_local_direct_only", "receipt_observation_without_rebroadcast"], "public")],
    "recovery",
    "Reuses protected effect material and may reconcile or resubmit only when the stored state permits. --observe-only true inspects one already submitted local direct receipt without custody access or resubmission.",
    "prior_operation_authorization",
    "Uses the authorization already bound to the durable operation; it cannot widen the frozen effect.",
    allOperationStates,
    [
      { command_path: ["operation", "status"], when: "To inspect the resulting durable state." },
      { command_path: ["receipt", "get"], when: "After terminal completion." },
    ],
    ["apn operation resume --operation <operation-id> --rpc-url <https-base-rpc-url> --wait-seconds 60"],
  ),
  command(
    ["operation", "recover-provider-request"],
    "apn operation recover-provider-request --operation <operation-id> --provider-request-id <provider-request-id>",
    "Bind one independently known provider request to an eligible ambiguous direct transfer without replaying it.",
    [
      operationRequired,
      option("--provider-request-id", "provider_request_id", true, noDefault, ["1_to_256_safe_ascii_characters"], "operator_input"),
    ],
    "recovery",
    "Writes only the opaque provider request reference; it never creates, signs or submits a payment.",
    "prior_operation_authorization",
    "The existing frozen transfer and independently obtained provider request ID are the authorization boundary.",
    allOperationStates,
    [
      { command_path: ["operation", "resume"], when: "To watch the exact recovered provider request and verify on-chain evidence." },
      { command_path: ["operation", "status"], when: "To inspect the resulting durable state." },
    ],
    ["apn operation recover-provider-request --operation <operation-id> --provider-request-id <provider-request-id>"],
  ),
  command(
    ["operation", "recover-transaction-settlement"],
    "apn operation recover-transaction-settlement --operation <operation-id> --transaction-hash <transaction-hash> --idempotency-key <key> --rpc-url <https-url>",
    "Terminalize one eligible legacy x402 operation from an independently known exact Base transaction.",
    [
      operationRequired,
      option("--transaction-hash", "transaction_hash", true, noDefault, ["32_byte_evm_transaction_hash", "canonicalized_to_lowercase"], "public"),
      option("--idempotency-key", "idempotency_key", true, noDefault, ["8_to_200_safe_ascii_characters"], "operator_input"),
      rpcRequired,
    ],
    "recovery",
    "Reads only the named Base transaction receipt and canonical block facts, then durably terminalizes an eligible already-settled operation.",
    "prior_operation_authorization",
    "The existing frozen operation and caller-supplied immutable recovery binding are the authorization boundary; no payment is submitted.",
    allOperationStates,
    [
      { command_path: ["operation", "status"], when: "To inspect the resulting durable state." },
      { command_path: ["receipt", "get"], when: "After terminal recovery." },
    ],
    ["apn operation recover-transaction-settlement --operation <operation-id> --transaction-hash <transaction-hash> --idempotency-key <idempotency-key> --rpc-url <https-base-rpc-url>"],
  ),
  command(["receipt", "get"], "apn receipt get --operation <operation-id>", "Inspect one durable receipt of any family; gasless, bridge and Solana/TRON receipts are derived from their operation.", [operationRequired], "local_write", "May initialize local state, index saved operations and repair saved operation or direct receipt records; never signs, submits, or resumes a payment effect.", "none", "Never.", { terminal: allOperationStates.terminal, non_terminal: [] }, [], ["apn receipt get --operation <operation-id>"]),
] as const;
export const COMMANDS: readonly CommandDefinition[] = [...includeGaslessRecovery(includeBridgeRecovery(includeRailRecovery(BASE_COMMANDS))), ...CHAIN_COMMANDS, ...PORTFOLIO_COMMANDS, ...BRIDGE_COMMANDS, ...CIRCLE_COMMANDS, ...SEI_FUNDING_COMMANDS, ...CIRCLE_EVM_COMMANDS, ...MEGA_FUNDING_COMMANDS, ...ONECLICK_COMMANDS, ...GASLESS_COMMANDS, ...ALLOWLIST_COMMANDS, ...UNISWAP_COMMANDS, ...UNISWAP_TOKEN_COMMANDS, ...SUNSWAP_COMMANDS, ...JUPITER_COMMANDS, ...ORCA_COMMANDS];
export const COMMAND_MANIFEST = {
  schema_version: "apn.command-manifest.v2",
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
  removed_v1_commands: removedV1Commands(new Set(COMMANDS.map((entry) => entry.path.join(" ")))),
} as const;
