import { getAddress } from "viem";
import { exactKeys, isPlainRecord } from "../../canonical.js";
import { requiredOptionsExample } from "../../command-example.js";
import { ApnError } from "../../errors.js";
import { slippageAboveCap } from "../slippage-refusal.js";
const option = (name, type, constraints) => ({ name, type, constraints, required: true, default: { kind: "none" }, sensitivity: "operator_input" });
const output = { contract: "apn.cli.v1", success_exit: 0, failure_exit: 1,
    success: "Pinned BNB Uniswap inventory, unsigned quote, prepared operation, or durable status.",
    failures: ["Classified refusal; no signing, broadcast, approval, or provider fallback."] };
const states = { terminal: ["finalized", "failed_before_effect", "failed_confirmed_revert", "expired_unlanded", "abandoned_unknown"], non_terminal: ["quoted",
        "prepared", "awaiting_approval", "reserved", "submitting", "submitted", "unknown_finality"] };
const profile = option("--profile", "profile", ["existing_profile_name"]), account = option("--account", "address", ["checksummed_bnb_smart_chain_address"]);
const operation = option("--operation", "operation_id", ["64_lowercase_hex_characters"]);
const EXAMPLE_VALUES = { "--profile": "<profile>", "--account": "<account-address>", "--to": "<recipient-address>",
    "--output-token": "<bnb-usdt-or-usdc-address>", "--amount": "10000000000000000", "--slippage-bps": "50", "--owner-slippage-cap-bps": "100",
    "--deadline": "<unix-seconds-within-30-minutes>", "--max-gas-limit": "300000", "--max-fee-per-gas": "1000000000",
    "--max-priority-fee-per-gas": "100000000", "--quote": "<quote-hash>", "--idempotency-key": "bnb-swap-0001", "--operation": "<operation-id>" };
const PATH = ["swap", "bnb", "uniswap"];
export const UNISWAP_BNB_COMMAND_GROUPS = [
    { path: ["swap", "bnb"], summary: "BNB Smart Chain guarded swaps.", kind: "group" },
    { path: [...PATH], summary: "Keyless Uniswap V3 native BNB to Binance-Peg USDT or USDC exact input via pinned SwapRouter02.", kind: "group" },
];
export const UNISWAP_BNB_COMMANDS = [
    command("inventory", [], "Read immutable BNB Uniswap pins and the two reviewed pairs without admitting them.", "none"),
    command("quote", [profile, account, option("--to", "address", ["checksummed_recipient_account"]),
        option("--output-token", "address", ["pinned_checksummed_binance_peg_usdt_or_usdc"]), option("--amount", "wei", ["positive_native_wei"]),
        option("--slippage-bps", "string", ["integer_0_through_owner_cap"]), option("--owner-slippage-cap-bps", "string", ["integer_0_through_10000"]),
        option("--deadline", "string", ["unix_seconds_within_30_minutes"]), option("--max-gas-limit", "wei", ["positive_bound"]),
        option("--max-fee-per-gas", "wei", ["positive_bound"]), option("--max-priority-fee-per-gas", "wei", ["positive_bound"])], "Quote from the pinned pool and QuoterV2 on-chain, encode SwapRouter02 calldata locally, and exactly simulate one unsigned transaction. " +
        "Uses APN_BNB_RPC_URL; approve within 256 blocks (about two minutes) of the quote.", "network_read"),
    command("prepare", [profile, option("--quote", "string", ["64_lowercase_hex_quote_hash"]), option("--idempotency-key", "idempotency_key", ["global_payment_key", "8_to_200_safe_ascii_characters"])], "Prepare only after separate owner admission of native BNB, the output token and this route.", "payment_prepare"),
    command("status", [operation], "Read one durable BNB guarded swap operation without resending.", "local_read"),
    command("approve", [operation], "Show the exact swap screen, take the typed approval code, then sign locally and send exactly once.", "payment_submit", { class: "foreground_tty", when: "Every guarded swap; MCP returns the exact CLI handoff only." }),
    command("execute", [operation], "Continue an approved reservation with its single send, or observe an already marked swap without resending.", "payment_submit", { class: "foreground_tty", when: "Only an unexpired stored foreground approval; MCP returns the exact CLI handoff only." }),
];
function command(name, options, summary, effect, approval = { class: "none", when: "Never signs or broadcasts." }) {
    const suffix = options.map((row) => ` ${row.name} <${row.type}>`).join("");
    return { path: [...PATH, name], synopsis: `apn ${PATH.join(" ")} ${name}${suffix}`, summary, options, effect: { class: effect, summary },
        approval, output, states, recovery: [], examples: [requiredOptionsExample([...PATH, name], options, EXAMPLE_VALUES)] };
}
export function bindUniswapBnbCommand(path, o) {
    const action = path.slice("swap bnb uniswap ".length);
    if (!isPlainRecord(o))
        invalid("BNB Uniswap options must be a plain object.");
    if (action === "inventory") {
        exact(o, []);
        return { command: "swap.uniswap-bnb.inventory" };
    }
    if (action === "status" || action === "approve" || action === "execute") {
        exact(o, ["--operation"]);
        return { command: `swap.uniswap-bnb.${action}`, operationId: hash(o["--operation"]) };
    }
    if (action === "prepare") {
        exact(o, ["--profile", "--quote", "--idempotency-key"]);
        return { command: "swap.uniswap-bnb.prepare", profile: o["--profile"], quoteHash: hash(o["--quote"]), idempotencyKey: o["--idempotency-key"] };
    }
    if (action !== "quote")
        invalid("Unsupported BNB Uniswap action.");
    exact(o, ["--profile", "--account", "--to", "--output-token", "--amount", "--slippage-bps", "--owner-slippage-cap-bps", "--deadline",
        "--max-gas-limit", "--max-fee-per-gas", "--max-priority-fee-per-gas"]);
    const slippageBps = safeInteger(o["--slippage-bps"]), ownerSlippageCapBps = safeInteger(o["--owner-slippage-cap-bps"]);
    if (ownerSlippageCapBps > 10_000)
        invalid("BNB Uniswap owner slippage cap must be at most 10000 bps.");
    if (slippageBps > ownerSlippageCapBps)
        slippageAboveCap("Uniswap", slippageBps, ownerSlippageCapBps);
    return { command: "swap.uniswap-bnb.quote", profile: o["--profile"], account: evmAddress(o["--account"]), recipient: evmAddress(o["--to"]),
        outputToken: evmAddress(o["--output-token"]), amountAtomic: o["--amount"], slippageBps, ownerSlippageCapBps,
        deadline: safeInteger(o["--deadline"]), maxGasLimit: o["--max-gas-limit"], maxFeePerGas: o["--max-fee-per-gas"],
        maxPriorityFeePerGas: o["--max-priority-fee-per-gas"] };
}
function exact(value, keys) {
    if (!exactKeys(value, keys))
        invalid("BNB Uniswap options contain an unknown or missing field.");
}
function evmAddress(value) {
    if (value === undefined)
        invalid("BNB Uniswap address is required.");
    try {
        const canonical = getAddress(value);
        if (canonical !== value)
            invalid("BNB Uniswap address must use its canonical checksum.");
        return canonical;
    }
    catch {
        return invalid("BNB Uniswap address must use its canonical checksum.");
    }
}
function safeInteger(value) {
    if (value === undefined || !/^(?:0|[1-9][0-9]*)$/u.test(value))
        invalid("BNB Uniswap integer option must be canonical.");
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed))
        invalid("BNB Uniswap integer option exceeds the safe range.");
    return parsed;
}
function hash(value) {
    if (value === undefined || !/^[a-f0-9]{64}$/u.test(value))
        invalid("BNB Uniswap hash option must be 64 lowercase hexadecimal characters.");
    return value;
}
function invalid(message) { throw new ApnError("APN_INVALID_INPUT", message); }
//# sourceMappingURL=command-catalog.js.map