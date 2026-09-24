import { EVM_NETWORKS } from "./evm-asset.js";
import { DIRECT_EVM_NETWORKS } from "./evm-direct-networks.js";
import type { CommandDefinition, CommandOption } from "./command-catalog.js";

const required = (name: CommandOption["name"], type: CommandOption["type"], constraints: readonly string[]): CommandOption => ({
  name, type, required: true, default: { kind: "none" }, constraints, sensitivity: "operator_input",
});
const selection: readonly CommandOption[] = [
  required("--profile", "profile", ["canonical_profile"]),
  required("--chain", "string", ["enabled_mainnet_caip2", ...EVM_NETWORKS.map((network) => network.caip2)]),
  required("--asset", "string", ["native_or_nonzero_erc20_contract"]),
  { ...required("--decimals", "string", ["canonical_integer_0_through_255", "must_match_observed_metadata"]), required: false },
  required("--rpc-url", "https_url", ["credential_free_https_without_fragment", "public_target_required_at_runtime", "selected_chain_verified"]),
];
const failures = ["Classified APN error; no implicit token, chain, decimals or spending approval."];
const selectorSynopsis = "--profile <profile> --chain <caip2> --asset <native-or-contract> --rpc-url <https-url> [--decimals <integer>]";
const balanceSelection: readonly CommandOption[] = selection.map((option) => option.name === "--chain"
  ? { ...option, constraints: ["direct_read_mainnet_caip2", ...DIRECT_EVM_NETWORKS.map((network) => network.caip2)] }
  : option);

export const EVM_COMMANDS: readonly CommandDefinition[] = [
  {
    path: ["wallet", "balance-asset"],
    synopsis: `apn wallet balance-asset ${selectorSynopsis}`,
    summary: "Read one explicitly selected local-wallet EVM asset and native gas balance.",
    options: balanceSelection,
    effect: { class: "network_read", summary: "Reads chain-verified balances and metadata without signing or submitting." },
    approval: { class: "none", when: "Never." },
    output: { contract: "apn.cli.v1", success_exit: 0, failure_exit: 1, success: "Exact asset, atomic and decimal balances, RPC provenance and asset-specific funding posture.", failures },
    states: { terminal: ["completed", "classified_failure"], non_terminal: [] },
    recovery: [],
    examples: ["apn wallet balance-asset --profile default --chain eip155:8453 --asset native --rpc-url <https-base-rpc-url>"],
  },
  {
    path: ["pay", "transfer", "prepare-asset"],
    synopsis: `apn pay transfer prepare-asset ${selectorSynopsis} --to <address> --amount <decimal> --max-fee-wei <wei> [--priority-fee-wei <wei>] [--rpc-read-mode batch] --idempotency-key <key>`,
    summary: "Freeze a local-wallet native-coin or frozen-allowlist token direct transfer within the owner's active allowlist caps and an explicit fee quote budget.",
    options: [
      ...selection.map((option) => option.name === "--asset" ? { ...option, constraints: ["native_or_frozen_allowlist_contract"] }
        : option.name === "--chain" ? { ...option, constraints: ["direct_transfer_mainnet_caip2", ...DIRECT_EVM_NETWORKS.map((network) => network.caip2)] }
        : option.name === "--decimals" ? { ...option, constraints: ["canonical_integer_0_through_255", "must_match_frozen_allowlist_row"] } : option),
      required("--to", "address", ["nonzero_recipient_address"]),
      required("--amount", "string", ["positive_exact_asset_decimal", "uint256_without_rounding"]),
      required("--max-fee-wei", "wei", ["positive_canonical_integer", "total_presubmission_quote_budget_not_onchain_total_cap"]),
      { ...required("--priority-fee-wei", "wei", ["canonical_integer", "owner_tip_per_gas_replaces_rpc_suggestion", "max_fee_per_gas_is_twice_base_fee_plus_tip",
        "counts_toward_max_fee_wei", "refused_on_arbitrum_inclusive_fees", "part_of_idempotency"]), required: false },
      { ...required("--rpc-read-mode", "string", ["batch_only", "linea_native_only", "prepare_only", "default_scalar"]), required: false },
      required("--idempotency-key", "idempotency_key", ["8_to_200_safe_ascii_characters"]),
    ],
    effect: { class: "payment_prepare", summary: "Persists one exact chain, asset, amount, fee budget and transaction intent; never signs or submits." },
    approval: { class: "none", when: "Preparation does not authorize payment; the existing approve command requires exact foreground TTY consent." },
    output: { contract: "apn.cli.v1", success_exit: 0, failure_exit: 1, success: "A durable operation with frozen asset metadata, transaction economics and explicit fee quote budget.", failures },
    states: { terminal: ["classified_failure"], non_terminal: ["awaiting_approval"] },
    recovery: [{ command_path: ["pay", "transfer", "approve"], when: "After reviewing the exact frozen operation." }, { command_path: ["operation", "status"], when: "To inspect the existing operation without payment." }],
    examples: ["apn pay transfer prepare-asset --profile default --chain eip155:8453 --asset native --rpc-url <https-base-rpc-url> --to <recipient> --amount 0.000001 --max-fee-wei <owner-fee-budget> --idempotency-key <key>"],
  },
];
