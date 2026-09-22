import { exactKeys, isPlainRecord } from "../canonical.js";
import { ApnError } from "../errors.js";
import { getAddress } from "viem";
const opt = (name, type, constraints) => ({ name, type, constraints, required: true, default: { kind: "none" }, sensitivity: "operator_input" });
const operation = opt("--operation", "operation_id", ["64_lowercase_hex_characters"]), profile = opt("--profile", "profile", ["existing_profile_name"]);
const output = { contract: "apn.cli.v1", success_exit: 0, failure_exit: 1, success: "Pinned token quote or durable operation.", failures: ["Classified refusal."] };
const states = { terminal: ["observed", "cleaned"], non_terminal: ["prepared", "approved", "approval_submission_started", "approval_submitted", "approval_unknown_finality", "approval_observed", "submission_started", "submitted", "unknown_finality", "cleanup_required", "cleanup_submission_started", "cleanup_submitted", "cleanup_unknown_finality"] };
export const UNISWAP_TOKEN_COMMAND_GROUPS = [{ path: ["swap", "ethereum", "uniswap-token"], summary: "Guarded canonical USDC and USDT swaps through pinned V3 SwapRouter.", kind: "group" }];
const command = (name, options, summary, effect, approval = { class: "none", when: "Never signs or broadcasts." }) => ({ path: ["swap", "ethereum", "uniswap-token", name], synopsis: `apn swap ethereum uniswap-token ${name}${options.map(o => ` ${o.name} <${o.type}>`).join("")}`, summary, options, effect: { class: effect, summary }, approval, output, states, recovery: [], examples: [`apn swap ethereum uniswap-token ${name}`] });
const quote = [profile, opt("--account", "address", ["checksummed_ethereum_address"]), opt("--to", "address", ["checksummed_recipient"]), opt("--source-token", "address", ["canonical_usdc_or_usdt"]), opt("--output-token", "address", ["other_canonical_usdc_or_usdt"]), opt("--amount", "string", ["positive_atomic"]), opt("--minimum-output", "string", ["positive_atomic"]), opt("--approval-cap", "string", ["equals_amount"]), opt("--deadline", "string", ["unix_seconds"]), opt("--max-approval-gas-limit", "wei", ["positive"]), opt("--max-swap-gas-limit", "wei", ["positive"]), opt("--max-cleanup-gas-limit", "wei", ["positive"]), opt("--max-fee-per-gas", "wei", ["positive"]), opt("--max-priority-fee-per-gas", "wei", ["canonical"]), opt("--max-native-debit", "wei", ["covers_all_effects"])];
export const UNISWAP_TOKEN_COMMANDS = [command("inventory", [], "Read immutable token route pins.", "none"), command("quote", quote, "Quote and simulate the exact token route.", "network_read"), command("prepare", [profile, opt("--quote", "string", ["64_lowercase_hex_quote_hash"]), opt("--idempotency-key", "idempotency_key", ["global_payment_key"])], "Prepare from one saved quote.", "payment_prepare"), command("status", [operation], "Observe only.", "local_read"), command("approve", [operation], "Foreground consent and exact approval.", "payment_submit", { class: "foreground_tty", when: "Exact token operation." }), command("execute", [operation], "Continue the exact approved swap without replay.", "payment_submit", { class: "foreground_tty", when: "Previously approved operation." }), command("cleanup", [operation], "Explicitly clear a residual exact allowance after a failed swap.", "payment_submit", { class: "foreground_tty", when: "Operation is cleanup_required." })];
export function bindUniswapTokenCommand(path, o) {
    const action = path.slice("swap ethereum uniswap-token ".length);
    if (!isPlainRecord(o))
        invalid();
    if (action === "inventory") {
        exact(o, []);
        return { command: "swap.uniswap-token.inventory" };
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