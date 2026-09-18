import type { CommandDefinition, CommandOption } from "../command-catalog.js";
import type { CommandRequest } from "../commands.js";
import { createCliHandoff, type CliHandoff } from "../cli-handoff.js";
import { ONECLICK_LANE_IDS, oneClickLane, oneClickRecipient } from "./near-oneclick-lanes.js";
import { bridgeAddress, bridgeHash, bridgeUint } from "./validation.js";
const option = (name: CommandOption["name"], type: CommandOption["type"], ...extra: readonly string[]): CommandOption => ({
  name, type, required: true, default: { kind: "none" }, constraints: ["explicit_bounded_input", ...extra], sensitivity: "operator_input" });
const output = { contract: "apn.cli.v1", success_exit: 0, failure_exit: 1,
  success: "OneClick source state saved.", failures: ["Classified APN failure; no automatic resend."] } as const;
const states = { terminal: ["source_observed"], non_terminal: ["prepared", "signing_started", "sealed", "submitting", "submitted_pending", "unknown_finality"] };
export const ONECLICK_COMMANDS: readonly CommandDefinition[] = [
  { path: ["oneclick", "source", "submit"], synopsis: "apn oneclick source submit --lane <lane> --profile <profile> --expected-payer <evm-address> --recipient <tron-or-solana-address> --amount-atomic <origin atomic> --min-output-atomic <destination atomic> --max-quoted-loss-atomic <lane loss atomic> --max-gas-limit-atomic <uint> --max-fee-per-gas-wei <wei> --max-priority-fee-per-gas-wei <wei> --max-native-debit-wei <wei> --idempotency-key <key>",
    summary: "Prepare, confirm and submit one direct deposit on a pinned NEAR 1Click lane: Base USDC to TRON USDT, or Ethereum ETH to TRON TRX, Solana SOL or TRON USDT.",
    options: [option("--lane", "string", `one_of_${ONECLICK_LANE_IDS.join("|")}`, "unlisted_pairs_refused"),
      option("--profile", "profile"), option("--expected-payer", "address"),
      option("--recipient", "string", "tron_base58check_for_trx_or_usdt", "solana_32_byte_base58_for_sol"),
      option("--amount-atomic", "string", "positive_origin_asset_atomic_integer"),
      option("--min-output-atomic", "string", "positive_destination_asset_atomic_integer"),
      option("--max-quoted-loss-atomic", "string", "usdc_input_minus_minimum_for_base_usdc_lane", "destination_quoted_minus_minimum_for_ethereum_lanes"),
      option("--max-gas-limit-atomic", "string"), option("--max-fee-per-gas-wei", "wei"),
      option("--max-priority-fee-per-gas-wei", "wei"), option("--max-native-debit-wei", "wei", "native_lanes_include_value"),
      option("--idempotency-key", "idempotency_key")],
    effect: { class: "payment_submit", summary: "After exact foreground approval, may send one Base USDC transfer or one plain Ethereum ETH value transfer to the fresh 1Click quote deposit address. Uses the lane's APN_BASE_RPC_URL or APN_ETHEREUM_RPC_URL." },
    approval: { class: "foreground_tty", when: "Before signing the exact saved deposit." }, output, states,
    recovery: [{ command_path: ["oneclick", "source", "status"], when: "Observe source and 1Click state without resending." }],
    examples: ["apn oneclick source submit --lane base-usdc-to-tron-usdt --profile evm-live-buyer --expected-payer <base-payer> --recipient <tron-recipient> --amount-atomic 3000000 --min-output-atomic 1000000 --max-quoted-loss-atomic 2000000 --max-gas-limit-atomic 100000 --max-fee-per-gas-wei 2000000000 --max-priority-fee-per-gas-wei 100000000 --max-native-debit-wei 200000000000000 --idempotency-key tron-first",
      "apn oneclick source submit --lane ethereum-eth-to-tron-trx --profile evm-live-buyer --expected-payer <ethereum-payer> --recipient <tron-recipient> --amount-atomic 2000000000000000 --min-output-atomic 12500000 --max-quoted-loss-atomic 200000 --max-gas-limit-atomic 60000 --max-fee-per-gas-wei 20000000000 --max-priority-fee-per-gas-wei 2000000000 --max-native-debit-wei 2600000000000000 --idempotency-key trx-fund-1"] },
  { path: ["oneclick", "source", "status"], synopsis: "apn oneclick source status --operation <operation-id>",
    summary: "Read the saved source record, source receipt, 1Click status claim and independent TRON or Solana destination proof without resending.",
    options: [option("--operation", "operation_id")], effect: { class: "network_read", summary: "Read-only source-chain, 1Click and destination-chain observation; destination reads use APN_TRON_RPC_URL or APN_SOLANA_RPC_URL." },
    approval: { class: "none", when: "Observation only." }, output, states, recovery: [],
    examples: ["apn oneclick source status --operation <operation-id>"] },
];
function v(o: Record<string,string>, key: string): string { return o[key]!; }
function u(o: Record<string,string>, key: string): string { return bridgeUint(v(o,key), false, "APN_INVALID_INPUT").toString(); }
export function bindOneClickCommand(path: string, o: Record<string,string>): CommandRequest {
  if (path === "oneclick source status") return { command: "oneclick.source.status", operationId: bridgeHash(v(o,"--operation"), "APN_INVALID_INPUT") };
  if (path !== "oneclick source submit") throw new Error("Unknown 1Click command");
  const lane = oneClickLane(v(o,"--lane"));
  return { command: "oneclick.source.submit", lane: lane.id, profile: v(o,"--profile"), expectedPayer: bridgeAddress(v(o,"--expected-payer"), "APN_INVALID_INPUT"),
    recipient: oneClickRecipient(lane, v(o,"--recipient")), amountAtomic: u(o,"--amount-atomic"), minOutputAtomic: u(o,"--min-output-atomic"),
    maxQuotedLossAtomic: u(o,"--max-quoted-loss-atomic"), maxGasLimitAtomic: u(o,"--max-gas-limit-atomic"),
    maxFeePerGasWei: u(o,"--max-fee-per-gas-wei"), maxPriorityFeePerGasWei: u(o,"--max-priority-fee-per-gas-wei"),
    maxNativeDebitWei: u(o,"--max-native-debit-wei"), idempotencyKey: v(o,"--idempotency-key") };
}
/** MCP never approves money: it returns the exact foreground command for the owner to run. */
export function oneClickSubmitHandoff(r: Extract<CommandRequest, { readonly command: "oneclick.source.submit" }>): CliHandoff {
  return createCliHandoff(["apn", "oneclick", "source", "submit", "--lane", r.lane, "--profile", r.profile, "--expected-payer", r.expectedPayer,
    "--recipient", r.recipient, "--amount-atomic", r.amountAtomic, "--min-output-atomic", r.minOutputAtomic,
    "--max-quoted-loss-atomic", r.maxQuotedLossAtomic, "--max-gas-limit-atomic", r.maxGasLimitAtomic,
    "--max-fee-per-gas-wei", r.maxFeePerGasWei, "--max-priority-fee-per-gas-wei", r.maxPriorityFeePerGasWei,
    "--max-native-debit-wei", r.maxNativeDebitWei, "--idempotency-key", r.idempotencyKey]);
}
