import type { CommandDefinition, CommandOption } from "../command-catalog.js";
import type { CommandRequest } from "../commands.js";
import { bridgeAddress, bridgeHash, bridgeUint } from "./validation.js";
import { solanaAddress } from "../solana/rpc.js";
import { ApnError } from "../errors.js";

const option = (name: CommandOption["name"], type: CommandOption["type"]): CommandOption => ({
  name, type, required: true, default: { kind: "none" }, constraints: ["explicit_bounded_input"], sensitivity: "operator_input",
});
const profile = option("--profile", "profile"), operation = option("--operation", "operation_id");
const output = { contract: "apn.cli.v1", success_exit: 0, failure_exit: 1,
  success: "Saved exact Circle V2 Base approval state.", failures: ["Classified APN failure; no automatic resend."] } as const;
const states = { terminal: ["completed", "confirmed_revert", "failed_before_effect"],
  non_terminal: ["prepared", "signing_started", "sealed", "submitting", "unknown_finality"] };
const limits = [option("--max-gas-limit-atomic", "string"), option("--max-fee-per-gas-wei", "wei"),
  option("--max-priority-fee-per-gas-wei", "wei"), option("--max-native-debit-wei", "wei")];
export const CIRCLE_COMMANDS: readonly CommandDefinition[] = [
  { path: ["circle", "approval", "prepare"], synopsis: "apn circle approval prepare --profile <profile> --cap-atomic <USDC atomic> --max-gas-limit-atomic <uint> --max-fee-per-gas-wei <wei> --max-priority-fee-per-gas-wei <wei> --max-native-debit-wei <wei>",
    summary: "Save one Base USDC approval intent for the exact Circle V2 WithFees wrapper.",
    options: [profile, option("--cap-atomic", "atomic_usdc"), ...limits],
    effect: { class: "payment_prepare", summary: "Reads same-block Base allowance and balance, nonce, gas and fee; saves an unsigned bounded intent." },
    approval: { class: "none", when: "Unsigned; no approval needed." }, output, states,
    recovery: [{ command_path: ["circle", "approval", "execute"], when: "After reviewing this exact preparation." }], examples: ["apn circle approval prepare --profile default --cap-atomic 430000 --max-gas-limit-atomic 100000 --max-fee-per-gas-wei 2000000000 --max-priority-fee-per-gas-wei 100000000 --max-native-debit-wei 200000000000000"] },
  { path: ["circle", "approval", "execute"], synopsis: "apn circle approval execute --operation <approval-id>",
    summary: "Confirm one exact allowance in a foreground terminal and attempt its signed Base transaction once.",
    options: [operation], effect: { class: "payment_submit", summary: "One approval transaction may cost Base ETH. No automatic retry." },
    approval: { class: "foreground_tty", when: "Before signing the exact saved intent." }, output, states,
    recovery: [{ command_path: ["circle", "approval", "status"], when: "Observe the exact signed transaction at safe finality." }], examples: ["apn circle approval execute --operation <approval-id>"] },
  { path: ["circle", "approval", "status"], synopsis: "apn circle approval status --operation <approval-id>",
    summary: "Observe a saved approval without any resend.", options: [operation],
    effect: { class: "network_read", summary: "Reads the exact saved Base transaction and fresh allowance." },
    approval: { class: "none", when: "Observation only." }, output, states, recovery: [], examples: ["apn circle approval status --operation <approval-id>"] },
  { path: ["circle", "source", "submit"], synopsis: "apn circle source submit --profile <profile> --expected-payer <base-address> --recipient-owner <solana-address> --recipient-setup <existing_ata|create_ata> --amount-atomic <uint> --max-source-fee-atomic <uint> --max-allowance-atomic <uint> --max-gas-limit-atomic <uint> --max-fee-per-gas-wei <wei> --max-priority-fee-per-gas-wei <wei> --max-native-debit-wei <wei> --idempotency-key <key>",
    summary: "Prepare, confirm and submit one bounded Circle V2 Base USDC source transfer.",
    options: [profile, option("--expected-payer", "address"), option("--recipient-owner", "string"),
      option("--recipient-setup", "string"), option("--amount-atomic", "atomic_usdc"),
      option("--max-source-fee-atomic", "atomic_usdc"), option("--max-allowance-atomic", "atomic_usdc"), ...limits,
      option("--idempotency-key", "idempotency_key")],
    effect: { class: "payment_submit", summary: "After exact foreground approval, may send a Base CCTP V2 source effect once." },
    approval: { class: "foreground_tty", when: "Every new source operation." }, output,
    states: { terminal: ["completed", "failed_before_effect", "confirmed_revert"], non_terminal: ["prepared", "unknown_finality", "source_pending"] },
    recovery: [], examples: ["apn circle source submit --profile default --expected-payer <base-payer> --recipient-owner <solana-owner> --recipient-setup existing_ata --amount-atomic 430000 --max-source-fee-atomic 10000 --max-allowance-atomic 430000 --max-gas-limit-atomic 300000 --max-fee-per-gas-wei 2000000000 --max-priority-fee-per-gas-wei 100000000 --max-native-debit-wei 600000000000000 --idempotency-key circle-first"] },
];
function v(o: Record<string, string>, key: string): string { return o[key]!; }
function uint(o: Record<string, string>, key: string): string { return bridgeUint(v(o, key), false, "APN_INVALID_INPUT").toString(); }
export function bindCircleCommand(path: string, o: Record<string, string>): CommandRequest {
  if (path === "circle approval execute" || path === "circle approval status") return {
    command: path === "circle approval execute" ? "circle.approval.execute" : "circle.approval.status",
    operationId: bridgeHash(v(o, "--operation"), "APN_INVALID_INPUT"),
  };
  if (path === "circle approval prepare") return { command: "circle.approval.prepare", profile: v(o, "--profile"),
    approvalCapAtomic: uint(o, "--cap-atomic"), maxGasLimitAtomic: uint(o, "--max-gas-limit-atomic"),
    maxFeePerGasWei: uint(o, "--max-fee-per-gas-wei"), maxPriorityFeePerGasWei: uint(o, "--max-priority-fee-per-gas-wei"),
    maxNativeDebitWei: uint(o, "--max-native-debit-wei") };
  if (path !== "circle source submit") throw new Error("Unknown Circle command");
  const setup = v(o, "--recipient-setup");
  if (setup !== "existing_ata" && setup !== "create_ata") throw new ApnError("APN_INVALID_INPUT", "Unknown Circle recipient setup.");
  return { command: "circle.source.submit", profile: v(o, "--profile"), expectedPayer: bridgeAddress(v(o, "--expected-payer"), "APN_INVALID_INPUT"),
    recipientOwner: solanaAddress(v(o, "--recipient-owner")), recipientSetup: setup,
    amountAtomic: uint(o, "--amount-atomic"), maxSourceFeeAtomic: uint(o, "--max-source-fee-atomic"),
    maxAllowanceAtomic: uint(o, "--max-allowance-atomic"), maxGasLimitAtomic: uint(o, "--max-gas-limit-atomic"),
    maxFeePerGasWei: uint(o, "--max-fee-per-gas-wei"), maxPriorityFeePerGasWei: uint(o, "--max-priority-fee-per-gas-wei"),
    maxNativeDebitWei: uint(o, "--max-native-debit-wei"), idempotencyKey: v(o, "--idempotency-key") };
}
