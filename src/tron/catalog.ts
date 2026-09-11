import type { CommandDefinition, CommandOption } from "../command-catalog.js";
import { chainAsset } from "../chain-policy.js";

const option = (name: CommandOption["name"], constraints: readonly string[], required = true): CommandOption => ({
  name, type: "string", constraints, required, default: { kind: "none" }, sensitivity: "operator_input",
});
const profile: CommandOption = { ...option("--profile", ["explicit_canonical_profile"]), type: "profile" };
const asset = option("--asset", ["trx_or_usdt", "exact_mainnet_asset_identity"]);
const maximumFee = option("--max-fee-trx", ["positive_canonical_trx_decimal", "at_most_six_decimals", "bandwidth_energy_activation_total_cap"]);
const output = { contract: "apn.cli.v1", success_exit: 0, failure_exit: 1,
  success: "Exact TRON mainnet identity, frozen resource bounds and classified recovery.", failures: ["Classified APN error; no provider or native-funding fallback."] } as const;
const states = { terminal: ["completed", "classified_failure"], non_terminal: [] };
export const TRON_COMMANDS: readonly CommandDefinition[] = [
  { path: ["wallet", "ensure-tron"], synopsis: "apn wallet ensure-tron --profile <profile> --provider local --accept-risk true",
    summary: "Ensure a separate encrypted local secp256k1 TRON wallet without funding or activation.", options: [profile, option("--provider", ["literal_local"]), option("--accept-risk", ["literal_true_required_for_local_custody"])],
    effect: { class: "local_write", summary: "Binds local execution ownership before generating a distinct encrypted TRON key." },
    approval: { class: "none", when: "Explicit local custody risk acknowledgement is required." }, output, states, recovery: [],
    examples: ["apn wallet ensure-tron --profile tron-local --provider local --accept-risk true"] },
  { path: ["wallet", "balance-tron"], synopsis: "apn wallet balance-tron --profile <profile> --asset <trx-or-usdt>",
    summary: "Read solidified TRX or canonical USDT and the separate TRX fee balance through APN_TRON_RPC_URL.", options: [profile, asset],
    effect: { class: "network_read", summary: "Verifies mainnet and exact asset identity; no activation, signing or submission." },
    approval: { class: "none", when: "Never." }, output, states, recovery: [], examples: ["apn wallet balance-tron --profile tron-local --asset usdt"] },
  { path: ["wallet", "capabilities-tron"], synopsis: "apn wallet capabilities-tron [--profile <profile>]",
    summary: "Inspect all four provider capabilities and unavailable TRON x402, sponsorship and bridge execution.", options: [{ ...profile, required: false }],
    effect: { class: "local_read", summary: "Static discovery is offline; an explicit profile adds its public stored binding." },
    approval: { class: "none", when: "Never." }, output, states, recovery: [], examples: ["apn wallet capabilities-tron"] },
  { path: ["policy", "admit-tron"], synopsis: "apn policy admit-tron --profile <profile> --asset <trx-or-usdt> --max-per-transfer <decimal> --daily-limit <decimal> --max-fee-trx <decimal>",
    summary: "Admit one mainnet asset with principal limits and a separate total TRX fee/resource cap after foreground consent.",
    options: [profile, asset, option("--max-per-transfer", ["positive_canonical_asset_decimal"]), option("--daily-limit", ["positive_canonical_asset_decimal", "utc_daily_budget"]), maximumFee],
    effect: { class: "local_write", summary: "Writes the exact human-approved account and asset policy under the common profile lock." },
    approval: { class: "foreground_tty", when: "Every policy admission or replacement." }, output, states, recovery: [],
    examples: ["apn policy admit-tron --profile tron-local --asset usdt --max-per-transfer 1 --daily-limit 3 --max-fee-trx 30"] },
  { path: ["pay", "transfer", "prepare-tron"], synopsis: "apn pay transfer prepare-tron --profile <profile> --asset <trx-or-usdt> --to <tron-address> --amount <decimal> --max-fee-trx <decimal> --idempotency-key <key>",
    summary: "Freeze one TRON mainnet transfer, exact signed resource window and total native debit cap within the admitted policy.",
    options: [profile, asset, option("--to", ["canonical_base58check_or_41_hex_address"]), option("--amount", ["positive_canonical_asset_decimal"]), maximumFee,
      { ...option("--idempotency-key", ["8_to_200_safe_ascii_characters"]), type: "idempotency_key" }],
    effect: { class: "payment_prepare", summary: "Reserves one immutable intent; no signing or submission." },
    approval: { class: "none", when: "The existing transfer approve command requires exact foreground consent." }, output,
    states: { terminal: ["classified_failure"], non_terminal: ["awaiting_approval"] },
    recovery: [{ command_path: ["pay", "transfer", "approve"], when: "After reviewing the frozen intent and costs." }, { command_path: ["operation", "resume"], when: "To observe the same transaction after an interruption." }],
    examples: ["apn pay transfer prepare-tron --profile tron-local --asset usdt --to <tron-recipient> --amount 1 --max-fee-trx 30 --idempotency-key <key>"] },
];
export function tronCapabilities() {
  return { rail: "tron", network: "mainnet", assets: [chainAsset("tron", "trx"), chainAsset("tron", "usdt")],
    x402: { available: false }, sponsorship: { available: false }, bridge: { available: false },
    profiles: [
      { provider: "local", direct: true, execution: "local_signed", requires: ["separate_encrypted_wallet", "activated_sender", "explicit_rpc", "supported_protocol_price_window", "foreground_policy", "foreground_transfer_approval"] },
      { provider: "coinbase-awal", direct: false, blocker: "pinned_provider_has_no_tron_rail" },
      { provider: "metamask-smart-account", direct: false, blocker: "pinned_provider_has_no_tron_rail" },
      { provider: "metamask-agent-wallet", direct: false, blocker: "pinned_provider_has_no_tron_rail" },
    ] };
}
