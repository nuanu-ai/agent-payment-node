import { exactKeys, isPlainRecord } from "../canonical.js";
import { ApnError } from "../errors.js";
import { getAddress } from "viem";
import { requiredOptionsExample } from "../command-example.js";
const opt = (name, type, constraints) => ({ name, type, constraints, required: true, default: { kind: "none" }, sensitivity: "operator_input" });
const operation = opt("--operation", "operation_id", ["64_lowercase_hex_characters"]), profile = opt("--profile", "profile", ["existing_profile_name"]);
const EXAMPLE_VALUES = { "--profile": "<profile>", "--account": "<account-address>", "--to": "<recipient-address>", "--source-token": "<usdc-or-usdt-address>",
    "--output-token": "<the-other-usdc-or-usdt-address>", "--amount": "1000000", "--minimum-output": "990000", "--approval-cap": "1000000",
    "--deadline": "<unix-seconds>", "--max-approval-gas-limit": "100000", "--max-swap-gas-limit": "300000", "--max-cleanup-gas-limit": "100000",
    "--max-fee-per-gas": "30000000000", "--max-priority-fee-per-gas": "1000000000", "--max-native-debit": "15000000000000000",
    "--quote": "<quote-hash>", "--idempotency-key": "token-swap-0001", "--operation": "<operation-id>" };
const output = { contract: "apn.cli.v1", success_exit: 0, failure_exit: 1, success: "Pinned token quote or durable operation.", failures: ["Classified refusal."] };
const states = { terminal: ["observed", "cleaned", "abandoned_unknown"], non_terminal: ["prepared", "approved", "approval_submission_started", "approval_submitted", "approval_unknown_finality", "approval_observed", "submission_started", "submitted", "unknown_finality", "cleanup_required", "cleanup_submission_started", "cleanup_submitted", "cleanup_unknown_finality"] };
export const UNISWAP_TOKEN_COMMAND_GROUPS = [{ path: ["swap", "ethereum", "uniswap-token"], summary: "Guarded canonical USDC and USDT swaps through pinned V3 SwapRouter.", kind: "group" }];
const command = (name, options, summary, effect, approval = { class: "none", when: "Never signs or broadcasts." }) => ({ path: ["swap", "ethereum", "uniswap-token", name], synopsis: `apn swap ethereum uniswap-token ${name}${options.map(o => o.required ? ` ${o.name} <${o.type}>` : ` [${o.name} <${o.type}>]`).join("")}`, summary, options, effect: { class: effect, summary }, approval, output, states, recovery: [], examples: [requiredOptionsExample(["swap", "ethereum", "uniswap-token", name], options, EXAMPLE_VALUES)] });
const quote = [profile, opt("--account", "address", ["checksummed_ethereum_address"]), opt("--to", "address", ["checksummed_recipient"]), opt("--source-token", "address", ["canonical_usdc_or_usdt"]), opt("--output-token", "address", ["other_canonical_usdc_or_usdt"]), opt("--amount", "string", ["positive_atomic"]), opt("--minimum-output", "string", ["positive_atomic"]), opt("--approval-cap", "string", ["equals_amount"]), opt("--deadline", "string", ["unix_seconds"]), opt("--max-approval-gas-limit", "wei", ["positive"]), opt("--max-swap-gas-limit", "wei", ["positive"]), opt("--max-cleanup-gas-limit", "wei", ["positive"]), opt("--max-fee-per-gas", "wei", ["positive"]), opt("--max-priority-fee-per-gas", "wei", ["canonical"]), opt("--max-native-debit", "wei", ["covers_all_effects"])];
const cleanupFees = [{ ...opt("--max-fee-per-gas", "wei", ["positive", "with_max_priority_fee_per_gas", "covers_fresh_fee_quote"]), required: false },
    { ...opt("--max-priority-fee-per-gas", "wei", ["canonical", "at_most_max_fee_per_gas", "with_max_fee_per_gas"]), required: false }];
export const UNISWAP_TOKEN_COMMANDS = [command("inventory", [], "Read immutable token route pins.", "none"), command("quote", quote, "Quote and simulate the exact token route.", "network_read"), command("prepare", [profile, opt("--quote", "string", ["64_lowercase_hex_quote_hash"]), opt("--idempotency-key", "idempotency_key", ["global_payment_key", "8_to_200_safe_ascii_characters"])], "Prepare from one saved quote.", "payment_prepare"), command("status", [operation], "Observe effects and reconcile durable state; expired prepared operations with no effects may be cleaned after a zero-allowance RPC read.", "local_write"), command("approve", [operation], "Foreground consent and exact approval.", "payment_submit", { class: "foreground_tty", when: "Exact token operation." }), command("execute", [operation], "Continue the exact approved swap without replay.", "payment_submit", { class: "foreground_tty", when: "Previously approved operation." }), command("cleanup", [operation, ...cleanupFees], "Explicitly clear a residual exact allowance after a failed swap. When the cleanup's frozen fee caps are below the market, --max-fee-per-gas with --max-priority-fee-per-gas re-quote this cleanup only: checked against a fresh fee quote and shown, with the new native debit cap, at the foreground consent; never raised automatically.", "payment_submit", { class: "foreground_tty", when: "Operation is cleanup_required." })];
export function bindUniswapTokenCommand(path, o) {
    const action = path.slice("swap ethereum uniswap-token ".length);
    if (!isPlainRecord(o))
        invalid();
    if (action === "inventory") {
        exact(o, []);
        return { command: "swap.uniswap-token.inventory" };
    }
    if (action === "cleanup" && Object.hasOwn(o, "--max-fee-per-gas")) {
        exact(o, ["--operation", "--max-fee-per-gas", "--max-priority-fee-per-gas"]);
        const maxFeePerGas = wei(o["--max-fee-per-gas"], true), maxPriorityFeePerGas = wei(o["--max-priority-fee-per-gas"], false);
        if (BigInt(maxPriorityFeePerGas) > BigInt(maxFeePerGas))
            invalid();
        return { command: "swap.uniswap-token.cleanup", operationId: hash(o["--operation"]), cleanupFees: { maxFeePerGas, maxPriorityFeePerGas } };
    }
    if (["status", "approve", "execute", "cleanup"].includes(action)) {
        exact(o, ["--operation"]);
        return { command: `swap.uniswap-token.${action}`, operationId: hash(o["--operation"]) };
    }
    if (action === "prepare") {
        exact(o, ["--profile", "--quote", "--idempotency-key"]);
        return { command: "swap.uniswap-token.prepare", profile: o["--profile"], quoteHash: hash(o["--quote"]), idempotencyKey: o["--idempotency-key"] };
    }
    if (action !== "quote")
        invalid();
    exact(o, quote.map(v => v.name));
    return { command: "swap.uniswap-token.quote", profile: o["--profile"], account: address(o["--account"]), recipient: address(o["--to"]), sourceToken: address(o["--source-token"]), outputToken: address(o["--output-token"]), amountAtomic: o["--amount"], minimumOutputAtomic: o["--minimum-output"], approvalCapAtomic: o["--approval-cap"], deadline: integer(o["--deadline"]), maxApprovalGasLimit: o["--max-approval-gas-limit"], maxSwapGasLimit: o["--max-swap-gas-limit"], maxCleanupGasLimit: o["--max-cleanup-gas-limit"], maxFeePerGas: o["--max-fee-per-gas"], maxPriorityFeePerGas: o["--max-priority-fee-per-gas"], maxNativeDebitWei: o["--max-native-debit"] };
}
function exact(o, keys) {
    if (!exactKeys(o, keys))
        invalid();
}
function hash(v) {
    if (!v || !/^[a-f0-9]{64}$/u.test(v))
        invalid();
    return v;
}
function wei(v, positive) {
    if (!v || !/^(?:0|[1-9][0-9]{0,77})$/u.test(v) || positive && v === "0")
        invalid();
    return v;
}
function integer(v) {
    if (!v || !/^[1-9][0-9]*$/u.test(v) || !Number.isSafeInteger(Number(v)))
        invalid();
    return Number(v);
}
function address(v) {
    try {
        if (!v || getAddress(v) !== v)
            throw new Error();
        return v;
    }
    catch {
        return invalid();
    }
}
function invalid() { throw new ApnError("APN_INVALID_INPUT", "Uniswap token command options are invalid."); }
//# sourceMappingURL=uniswap-token-command-catalog.js.map