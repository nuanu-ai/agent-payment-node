/** Relay CLI commands (manifest v2): one prepare/execute/observe/status/retire surface for every route. `relay prepare`
 * picks the route from the source chain, asset and destination chain; the other commands take it from the saved
 * operation. Every command names its profile explicitly; payer, recipient, amounts and fee ceilings are per-operation
 * inputs shown on foreground consent, and admission is the profile's own active owner policy. */
import { command, option } from "../command-catalog-builders.js";
import type { CommandDefinition, CommandGroup } from "../command-catalog-types.js";

const noDefault = { kind: "none" } as const;
const profile = option("--profile", "profile", true, noDefault, ["matches_[a-z0-9][a-z0-9._-]{0,63}"], "public");
const operation = option("--operation", "operation_id", true, noDefault, ["64_lowercase_hex_characters"], "public");
const https = (name: `--${string}`, required: boolean, ...extra: readonly string[]) =>
  option(name, "https_url", required, noDefault, ["credential_free_https_without_fragment", "public_target_required_at_runtime", ...extra], "operator_input");
const positive = (name: `--${string}`, type: "wei" | "atomic_usdc" | "atomic", ...extra: readonly string[]) =>
  option(name, type, true, noDefault, ["positive_integer", ...extra], "operator_input");
const routeOnly = (name: `--${string}`, type: "wei" | "atomic_usdc" | "address" | "string", ...constraints: readonly string[]) =>
  option(name, type, false, noDefault, constraints, "operator_input");
const ADMISSION = "the profile's active owner policy: account equal to the profile wallet, exact asset, rail bridge, relay mechanism pin and caps, and the optional recipient pin";
const ROUTES = "Ethereum USDC to BNB native (ethereum-usdc-bnb-native-v1) or Base ETH (ethereum-usdc-base-eth-v1); BNB native to Polygon POL (bnb-native-polygon-native-v1) or Monad MON (bnb-native-monad-native-v1); Base ETH to MegaETH USDm (base-native-megaeth-usdm-v1) or Polygon POL (base-native-polygon-native-v1); Arbitrum USDC to Ethereum USDC (arbitrum-usdc-ethereum-usdc-source-draft-v1)";
const inspect = [{ command_path: ["operation", "status"], when: "Inspect the retained quote and retirement proof." }];

export const RELAY_COMMAND_GROUPS: readonly CommandGroup[] = [
  { path: ["relay"], summary: "Prepare, execute, observe and retire Relay bridge operations of any profile under its owner policy.", kind: "group" },
];

export const RELAY_COMMANDS: readonly CommandDefinition[] = [
  command(["relay", "prepare"],
    "apn relay prepare --profile <profile> --source-chain <caip2> --asset <usdc|native> --destination-chain <caip2> --recipient <address> --amount-atomic <source-atomic> --min-output-atomic <destination-atomic> --max-deposit-network-fee-wei <wei> [--max-approval-network-fee-wei <wei>] [--payer <address> --max-provider-fee-atomic <usdc> --quote-file <absolute-json-path>] --idempotency-key <key>",
    "Freeze one unsigned Relay quote; the route is chosen by source chain, asset and destination chain.",
    [profile,
      option("--source-chain", "string", true, noDefault, ["eip155:1_eip155:56_eip155:8453_or_eip155:42161"], "public"),
      option("--asset", "string", true, noDefault, ["usdc_from_eip155:1_or_eip155:42161", "native_from_eip155:56_or_eip155:8453"], "public"),
      option("--destination-chain", "string", true, noDefault, ["eip155:56_or_eip155:8453_from_ethereum_usdc", "eip155:137_or_eip155:143_from_bnb", "eip155:137_or_eip155:4326_from_base", "eip155:1_from_arbitrum_usdc"], "public"),
      option("--recipient", "address", true, noDefault, ["canonical_nonzero_evm_address"], "public"),
      positive("--amount-atomic", "atomic", "source_asset_atomic_units"), positive("--min-output-atomic", "atomic", "destination_asset_atomic_units"),
      positive("--max-deposit-network-fee-wei", "wei", "on_base_the_full_op_stack_fee_budget"),
      routeOnly("--max-approval-network-fee-wei", "wei", "positive_integer", "required_for_usdc_sources", "refused_for_native_sources"),
      routeOnly("--payer", "address", "canonical_evm_address", "required_for_arbitrum_usdc_only", "must_equal_the_policy_account"),
      routeOnly("--max-provider-fee-atomic", "atomic_usdc", "positive_integer", "required_for_arbitrum_usdc_only"),
      routeOnly("--quote-file", "string", "absolute_regular_json_file_maximum_65536_bytes", "required_for_arbitrum_usdc_only"),
      option("--idempotency-key", "idempotency_key", true, noDefault, ["8_to_128_safe_ascii_characters"], "operator_input")],
    "payment_prepare",
    `Routes and their relay mechanism pins: ${ROUTES}. Reads ${ADMISSION} and one keyless public Relay quote (Arbitrum USDC reads the local --quote-file instead); writes an immutable unsigned operation. The signed order pays the named recipient; the source refund goes to the payer and the destination refund to the recipient. No signing or send occurs.`,
    "none", "Never.", { terminal: [], non_terminal: ["prepared"] },
    [{ command_path: ["relay", "execute"], when: "After reviewing the frozen quote." }],
    ["apn relay prepare --profile <profile> --source-chain eip155:1 --asset usdc --destination-chain eip155:56 --recipient <address> --amount-atomic 1000000 --min-output-atomic 1000000000000000 --max-approval-network-fee-wei 1000000000000000 --max-deposit-network-fee-wei 1000000000000000 --idempotency-key relay-quote-0001",
      "apn relay prepare --profile <profile> --source-chain eip155:56 --asset native --destination-chain eip155:137 --recipient <address> --amount-atomic 1500000000000000 --min-output-atomic 9000000000000000000 --max-deposit-network-fee-wei 30000000000000 --idempotency-key relay-bnb-pol-0001",
      "apn relay prepare --profile <profile> --source-chain eip155:42161 --asset usdc --destination-chain eip155:1 --recipient <address> --payer <account> --amount-atomic 500000 --min-output-atomic 441888 --max-provider-fee-atomic 60000 --max-approval-network-fee-wei 2000000000000 --max-deposit-network-fee-wei 2000000000000 --quote-file /absolute/quote.json --idempotency-key relay-arb-eth-0001"]),
  command(["relay", "execute"], "apn relay execute --profile <profile> --operation <operation-id> --rpc-url <source-rpc>",
    "Foreground-confirm and run the next source effect of the saved route.", [profile, operation, https("--rpc-url", true, "source_chain_of_the_saved_route")],
    "payment_submit",
    `Requires the operation's own profile and saved route, ${ADMISSION}, fresh funding, allowance and nonce, the encrypted local wallet and a durable single-send marker per effect. Ethereum USDC routes sign the approval and then the deposit; native routes sign one deposit (Base simulates it and bounds the full OP Stack fee by the consented ceiling); Arbitrum USDC runs one step per call: a canonical allowance check that may persist an approval skip, else the approval, and after the approval is observed final, the deposit. An ambiguous send is observed by its saved hash and never repeated. Destination delivery and paid acceptance remain unproven.`,
    "foreground_tty", "Before every signature; an Arbitrum allowance check that only persists a verified skip needs none.",
    { terminal: ["confirmed", "failed", "failed_before_effect"],
      non_terminal: ["pending", "signing_started", "sealed", "submitting", "approval_required", "approval_skipped", "preflight_blocked", "approval_submitted", "deposit_submitted", "observation_only"] },
    [{ command_path: ["relay", "observe"], when: "After a source effect was sent, to prove it final and look for the destination credit." }],
    ["apn relay execute --profile <profile> --operation <operation-id> --rpc-url https://source-rpc.example"]),
  command(["relay", "observe"], "apn relay observe --profile <profile> --operation <operation-id> --rpc-url <source-rpc> [--destination-rpc-url <destination-rpc>]",
    "Read source finality and the destination credit to the operation's own recipient.",
    [profile, operation, https("--rpc-url", true, "source_chain_of_the_saved_route"),
      https("--destination-rpc-url", false, "required_except_arbitrum_usdc_to_ethereum", "omitted_there_proves_the_arbitrum_source_only")],
    "network_read",
    "Never signs or sends. Proves the saved source effects at finality (Ethereum finalized, BNB 15 blocks, Base and Arbitrum safe), reads one keyless Relay status GET as a discovery hint, and proves one safe credit to the operation's own recipient per destination chain (Polygon at its milestone checkpoint, Monad at 15 blocks, BNB, Base, MegaETH and Ethereum at safe). Physical RPC starts share persisted 750 ms provider-family pacing with bounded POSTs per chain. One payout can accept one operation; an accepted Arbitrum credit is recorded create-only and later observations need no network. paidAcceptance stays false.",
    "prior_operation_authorization", "Only an attempted source effect or a saved quote of this profile is observed.",
    { terminal: ["operational_acceptance"],
      non_terminal: ["prepared", "prepared_waiting", "source_effect_not_recorded", "observation_only", "source_proof_pending", "approval_source_confirmed", "approval_skipped", "deposit_source_confirmed", "source_finalized", "provider_candidate_unproven", "recipient_credit_observed"] },
    [], ["apn relay observe --profile <profile> --operation <operation-id> --rpc-url https://source-rpc.example --destination-rpc-url https://destination-rpc.example"]),
  command(["relay", "retire"], "apn relay retire --profile <profile> --operation <operation-id>",
    "Retire an untouched Relay quote, or abandon a token route whose only sent effect is a confirmed approval.", [profile, operation], "local_write",
    "Writes a durable retirement marker for an untouched quote of this profile (no signing marker), an exact native attempt proven to have failed before any effect, or a token route whose only sent effect is a confirmed or verified-skipped approval; the principal usage hold is released and that approval stays on chain. Never retires a signing marker, signed-but-unsent bytes or an unresolved send. Does not sign or use the network.",
    "foreground_tty", "Only to abandon a route after its confirmed approval; an untouched quote needs none.",
    { terminal: ["retired"], non_terminal: [] }, inspect,
    ["apn relay retire --profile <profile> --operation <operation-id>"]),
  command(["relay", "status"], "apn relay status --profile <profile> --operation <operation-id>",
    "Read one keyless Relay provider status for a saved quote.", [profile, operation], "network_read",
    "Checks the retirement marker and makes one bounded GET to Relay status/v3; reads saved operation and makes no journal or usage changes. Provider hashes are candidates, not onchain proof or paid acceptance.",
    "none", "Never.", { terminal: [], non_terminal: ["prepared"] }, [], ["apn relay status --profile <profile> --operation <operation-id>"]),
];
