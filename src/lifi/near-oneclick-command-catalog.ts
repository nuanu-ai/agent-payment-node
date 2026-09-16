import type { CommandDefinition, CommandOption } from "../command-catalog.js";
import type { CommandRequest } from "../commands.js";
import { bridgeAddress, bridgeHash, bridgeUint } from "./validation.js";
const option = (name: CommandOption["name"], type: CommandOption["type"]): CommandOption => ({
  name, type, required: true, default: { kind: "none" }, constraints: ["explicit_bounded_input"], sensitivity: "operator_input" });
const output = { contract: "apn.cli.v1", success_exit: 0, failure_exit: 1,
  success: "OneClick source state saved.", failures: ["Classified APN failure; no automatic resend."] } as const;
const states = { terminal: ["source_observed"], non_terminal: ["prepared", "signing_started", "sealed", "submitting", "submitted_pending", "unknown_finality"] };
export const ONECLICK_COMMANDS: readonly CommandDefinition[] = [
  { path: ["oneclick", "source", "submit"], synopsis: "apn oneclick source submit --profile <profile> --expected-payer <base-address> --recipient <tron-address> --amount-atomic <USDC atomic> --min-output-atomic <USDT atomic> --max-quoted-loss-atomic <USDC atomic> --max-gas-limit-atomic <uint> --max-fee-per-gas-wei <wei> --max-priority-fee-per-gas-wei <wei> --max-native-debit-wei <wei> --idempotency-key <key>",
    summary: "Prepare, confirm and submit one direct Base USDC deposit to NEAR 1Click for TRON USDT.",
    options: [option("--profile", "profile"), option("--expected-payer", "address"), option("--recipient", "string"),
      option("--amount-atomic", "atomic_usdc"), option("--min-output-atomic", "string"), option("--max-quoted-loss-atomic", "atomic_usdc"),
      option("--max-gas-limit-atomic", "string"), option("--max-fee-per-gas-wei", "wei"),
      option("--max-priority-fee-per-gas-wei", "wei"), option("--max-native-debit-wei", "wei"),
      option("--idempotency-key", "idempotency_key")],
    effect: { class: "payment_submit", summary: "After exact foreground approval, may send one Base USDC ERC20 transfer to the quote deposit address." },
    approval: { class: "foreground_tty", when: "Before signing the exact saved deposit." }, output, states,
    recovery: [{ command_path: ["oneclick", "source", "status"], when: "Observe source and 1Click state without resending." }],
    examples: ["apn oneclick source submit --profile evm-live-buyer --expected-payer <base-payer> --recipient <tron-recipient> --amount-atomic 3000000 --min-output-atomic 1000000 --max-quoted-loss-atomic 2000000 --max-gas-limit-atomic 100000 --max-fee-per-gas-wei 2000000000 --max-priority-fee-per-gas-wei 100000000 --max-native-debit-wei 200000000000000 --idempotency-key tron-first"] },
  { path: ["oneclick", "source", "status"], synopsis: "apn oneclick source status --operation <operation-id>",
    summary: "Read the saved source record, Base receipt and 1Click status without resending.",
    options: [option("--operation", "operation_id")], effect: { class: "network_read", summary: "Read-only Base and 1Click observation." },
    approval: { class: "none", when: "Observation only." }, output, states, recovery: [],
    examples: ["apn oneclick source status --operation <operation-id>"] },
];
function v(o: Record<string,string>, key: string): string { return o[key]!; }
function u(o: Record<string,string>, key: string): string { return bridgeUint(v(o,key), false, "APN_INVALID_INPUT").toString(); }
export function bindOneClickCommand(path: string, o: Record<string,string>): CommandRequest {
  if (path === "oneclick source status") return { command: "oneclick.source.status", operationId: bridgeHash(v(o,"--operation"), "APN_INVALID_INPUT") };
  if (path !== "oneclick source submit") throw new Error("Unknown 1Click command");
  return { command: "oneclick.source.submit", profile: v(o,"--profile"), expectedPayer: bridgeAddress(v(o,"--expected-payer"), "APN_INVALID_INPUT"),
    recipient: v(o,"--recipient"), amountAtomic: u(o,"--amount-atomic"), minOutputAtomic: u(o,"--min-output-atomic"),
    maxQuotedLossAtomic: u(o,"--max-quoted-loss-atomic"), maxGasLimitAtomic: u(o,"--max-gas-limit-atomic"),
    maxFeePerGasWei: u(o,"--max-fee-per-gas-wei"), maxPriorityFeePerGasWei: u(o,"--max-priority-fee-per-gas-wei"),
    maxNativeDebitWei: u(o,"--max-native-debit-wei"), idempotencyKey: v(o,"--idempotency-key") };
}
