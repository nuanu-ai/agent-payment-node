import { getAddress } from "viem";
import { exactKeys, isPlainRecord } from "../../canonical.js";
import type { CommandDefinition, CommandGroup, CommandOption } from "../../command-catalog-types.js";
import { requiredOptionsExample } from "../../command-example.js";
import type { CommandRequest } from "../../commands.js";
import { ApnError } from "../../errors.js";

const opt = (name: CommandOption["name"], type: CommandOption["type"], constraints: readonly string[]): CommandOption =>
  ({ name, type, constraints, required: true, default: { kind: "none" }, sensitivity: "operator_input" });
const operation = opt("--operation", "operation_id", ["64_lowercase_hex_characters"]), profile = opt("--profile", "profile", ["existing_profile_name"]);
const EXAMPLE_VALUES = { "--profile": "<profile>", "--account": "<account-address>", "--to": "<recipient-address>",
  "--source-token": "<bnb-usdt-or-usdc-address>", "--output-token": "native", "--amount": "10000000000000000000",
  "--minimum-output": "17000000000000000", "--approval-cap": "10000000000000000000", "--deadline": "<unix-seconds-within-30-minutes>",
  "--max-approval-gas-limit": "80000", "--max-swap-gas-limit": "300000", "--max-cleanup-gas-limit": "80000", "--max-fee-per-gas": "1000000000",
  "--max-priority-fee-per-gas": "100000000", "--max-native-debit": "460000000000000", "--quote": "<quote-hash>",
  "--idempotency-key": "bnb-token-swap-0001", "--operation": "<operation-id>" };
const output = { contract: "apn.cli.v1", success_exit: 0, failure_exit: 1, success: "Pinned token quote or durable operation.", failures: ["Classified refusal."] } as const;
const states = { terminal: ["observed", "cleaned", "abandoned_unknown"], non_terminal: ["prepared", "approved", "approval_submission_started",
  "approval_submitted", "approval_unknown_finality", "approval_observed", "submission_started", "submitted", "unknown_finality", "cleanup_required",
  "cleanup_submission_started", "cleanup_submitted", "cleanup_unknown_finality"] } as const;
const PATH = ["swap", "bnb", "uniswap-token"] as const;

export const UNISWAP_BNB_TOKEN_COMMAND_GROUPS: readonly CommandGroup[] = [{ path: [...PATH],
  summary: "Guarded Binance-Peg USDT and USDC input on BNB Smart Chain: into native BNB, or USDT into USDC and back, through pinned SwapRouter02.", kind: "group" }];
const command = (name: string, options: readonly CommandOption[], summary: string, effect: CommandDefinition["effect"]["class"],
  approval: CommandDefinition["approval"] = { class: "none", when: "Never signs or broadcasts." }): CommandDefinition => ({ path: [...PATH, name],
  synopsis: `apn ${PATH.join(" ")} ${name}${options.map(o => o.required ? ` ${o.name} <${o.type}>` : ` [${o.name} <${o.type}>]`).join("")}`, summary, options,
  effect: { class: effect, summary }, approval, output, states, recovery: [], examples: [requiredOptionsExample([...PATH, name], options, EXAMPLE_VALUES)] });
const quote = [profile, opt("--account", "address", ["checksummed_bnb_smart_chain_address"]), opt("--to", "address", ["checksummed_recipient_account"]),
  opt("--source-token", "address", ["binance_peg_usdt_or_usdc"]), opt("--output-token", "string", ["native_or_the_other_binance_peg_usdt_or_usdc"]),
  opt("--amount", "string", ["positive_atomic_18_decimals"]), opt("--minimum-output", "string", ["positive_atomic_18_decimals_or_wei"]),
  opt("--approval-cap", "string", ["equals_amount"]), opt("--deadline", "string", ["unix_seconds_within_30_minutes"]),
  opt("--max-approval-gas-limit", "wei", ["positive"]), opt("--max-swap-gas-limit", "wei", ["positive"]), opt("--max-cleanup-gas-limit", "wei", ["positive"]),
  opt("--max-fee-per-gas", "wei", ["positive"]), opt("--max-priority-fee-per-gas", "wei", ["positive_on_bnb_smart_chain"]),
  opt("--max-native-debit", "wei", ["covers_all_effects"])] as const;
const cleanupFees = [{ ...opt("--max-fee-per-gas", "wei", ["positive", "with_max_priority_fee_per_gas", "covers_fresh_fee_quote"]), required: false },
  { ...opt("--max-priority-fee-per-gas", "wei", ["canonical", "at_most_max_fee_per_gas", "with_max_fee_per_gas"]), required: false }] as const;
export const UNISWAP_BNB_TOKEN_COMMANDS: readonly CommandDefinition[] = [
  command("inventory", [], "Read the immutable BNB token route pins: SwapRouter02, the three pools and the four directions.", "none"),
  command("quote", quote, "Quote on chain and simulate the exact BNB token route over APN_BNB_RPC_URL. --output-token native swaps into BNB " +
    "(the router unwraps WBNB); a Binance-Peg address swaps USDT into USDC or USDC into USDT. Both tokens have 18 decimals.", "network_read"),
  command("prepare", [profile, opt("--quote", "string", ["64_lowercase_hex_quote_hash"]), opt("--idempotency-key", "idempotency_key",
    ["global_payment_key", "8_to_200_safe_ascii_characters"])], "Prepare from one saved quote after owner admission of both assets with this route.",
  "payment_prepare"),
  command("status", [operation], "Observe effects and reconcile durable state; expired prepared operations with no effects may be cleaned after a zero-allowance RPC read.", "local_write"),
  command("approve", [operation], "Foreground consent and the exact token approval of SwapRouter02.", "payment_submit", { class: "foreground_tty", when: "Exact token operation." }),
  command("execute", [operation], "Continue the exact approved swap without replay.", "payment_submit", { class: "foreground_tty", when: "Previously approved operation." }),
  command("cleanup", [operation, ...cleanupFees], "Explicitly clear a residual exact allowance after a failed swap. When the cleanup's frozen fee caps are below " +
    "the market, --max-fee-per-gas with --max-priority-fee-per-gas re-quote this cleanup only: checked against a fresh fee quote and shown, with the new " +
    "native debit cap, at the foreground consent; never raised automatically.", "payment_submit", { class: "foreground_tty", when: "Operation is cleanup_required." }),
];

export function bindUniswapBnbTokenCommand(path: string, o: Readonly<Record<string, string>>): CommandRequest {
  const action = path.slice("swap bnb uniswap-token ".length);
  if (!isPlainRecord(o)) invalid();
  if (action === "inventory") { exact(o, []); return { command: "swap.uniswap-bnb-token.inventory" }; }
  if (action === "cleanup" && Object.hasOwn(o, "--max-fee-per-gas")) {
    exact(o, ["--operation", "--max-fee-per-gas", "--max-priority-fee-per-gas"]);
    const maxFeePerGas = wei(o["--max-fee-per-gas"], true), maxPriorityFeePerGas = wei(o["--max-priority-fee-per-gas"], false);
    if (BigInt(maxPriorityFeePerGas) > BigInt(maxFeePerGas)) invalid();
    return { command: "swap.uniswap-bnb-token.cleanup", operationId: hash(o["--operation"]), cleanupFees: { maxFeePerGas, maxPriorityFeePerGas } };
  }
  if (action === "status" || action === "approve" || action === "execute" || action === "cleanup") {
    exact(o, ["--operation"]); return { command: `swap.uniswap-bnb-token.${action}`, operationId: hash(o["--operation"]) };
  }
  if (action === "prepare") {
    exact(o, ["--profile", "--quote", "--idempotency-key"]);
    return { command: "swap.uniswap-bnb-token.prepare", profile: o["--profile"]!, quoteHash: hash(o["--quote"]), idempotencyKey: o["--idempotency-key"]! };
  }
  if (action !== "quote") invalid();
  exact(o, quote.map(v => v.name));
  const output = o["--output-token"] === "native" ? "native" : address(o["--output-token"]);
  return { command: "swap.uniswap-bnb-token.quote", profile: o["--profile"]!, account: address(o["--account"]), recipient: address(o["--to"]),
    sourceToken: address(o["--source-token"]), outputToken: output, amountAtomic: o["--amount"]!, minimumOutputAtomic: o["--minimum-output"]!,
    approvalCapAtomic: o["--approval-cap"]!, deadline: integer(o["--deadline"]), maxApprovalGasLimit: o["--max-approval-gas-limit"]!,
    maxSwapGasLimit: o["--max-swap-gas-limit"]!, maxCleanupGasLimit: o["--max-cleanup-gas-limit"]!, maxFeePerGas: o["--max-fee-per-gas"]!,
    maxPriorityFeePerGas: o["--max-priority-fee-per-gas"]!, maxNativeDebitWei: o["--max-native-debit"]! };
}
function exact(o: Record<string, unknown>, keys: readonly string[]) { if (!exactKeys(o, keys)) invalid(); }
function hash(v?: string) { if (!v || !/^[a-f0-9]{64}$/u.test(v)) invalid(); return v; }
function wei(v: string | undefined, positive: boolean) { if (!v || !/^(?:0|[1-9][0-9]{0,77})$/u.test(v) || positive && v === "0") invalid(); return v; }
function integer(v?: string) { if (!v || !/^[1-9][0-9]*$/u.test(v) || !Number.isSafeInteger(Number(v))) invalid(); return Number(v); }
function address(v?: string) { try { if (!v || getAddress(v) !== v) throw new Error(); return v; } catch { return invalid(); } }
function invalid(): never { throw new ApnError("APN_INVALID_INPUT", "BNB Uniswap token command options are invalid."); }
