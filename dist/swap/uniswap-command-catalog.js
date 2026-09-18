import { exactKeys, isPlainRecord } from "../canonical.js";
import { ApnError } from "../errors.js";
import { getAddress } from "viem";
const option = (name, type, constraints) => ({ name, type, constraints, required: true, default: { kind: "none" }, sensitivity: "operator_input" });
const output = { contract: "apn.cli.v1", success_exit: 0, failure_exit: 1,
    success: "Pinned Uniswap inventory, unsigned quote, prepared operation, or durable status.",
    failures: ["Classified refusal; no signing, broadcast, approval, or provider fallback."] };
const states = { terminal: ["finalized", "failed_before_effect", "failed_confirmed_revert"], non_terminal: ["quoted", "prepared", "awaiting_approval",
        "reserved", "submitting", "submitted", "unknown_finality"] };
const profile = option("--profile", "profile", ["existing_profile_name"]), account = option("--account", "address", ["checksummed_ethereum_address"]);
const operation = option("--operation", "operation_id", ["64_lowercase_hex_characters"]);
export const UNISWAP_COMMAND_GROUPS = [
    { path: ["swap"], summary: "Separately admitted guarded swaps.", kind: "group" },
    { path: ["swap", "ethereum"], summary: "Ethereum guarded swaps.", kind: "group" },
    { path: ["swap", "ethereum", "uniswap"], summary: "Keyless Uniswap V3 native ETH to USDC or USDT exact input via pinned Universal Router 2.2.0.", kind: "group" },
];
export const UNISWAP_COMMANDS = [
    command("inventory", [], "Read the immutable official Uniswap pin and frozen pair without admitting it.", "none"),
    command("quote", [profile, account, option("--to", "address", ["checksummed_recipient"]),
        option("--output-token", "address", ["pinned_checksummed_usdc_or_usdt"]), option("--amount", "wei", ["positive_native_wei"]),
        option("--slippage-bps", "string", ["integer_0_through_owner_cap"]), option("--owner-slippage-cap-bps", "string", ["integer_0_through_10000"]),
        option("--deadline", "string", ["unix_seconds_within_30_minutes"]), option("--max-gas-limit", "wei", ["positive_bound"]),
        option("--max-fee-per-gas", "wei", ["positive_bound"]), option("--max-priority-fee-per-gas", "wei", ["positive_bound"])], "Quote from the pinned pool and QuoterV2 on-chain, encode locally, and exactly simulate one unsigned transaction. Uses APN_ETHEREUM_RPC_URL.", "network_read"),
    command("prepare", [profile, option("--quote", "string", ["64_lowercase_hex_quote_hash"]), option("--idempotency-key", "idempotency_key", ["global_payment_key"])], "Prepare only after separate owner admission of both assets and the exact mechanism.", "payment_prepare"),
    command("status", [operation], "Read one durable guarded swap operation without resending.", "local_read"),
    command("approve", [operation], "Show the exact swap screen, take the typed approval code, then sign locally and send exactly once.", "payment_submit", { class: "foreground_tty", when: "Every guarded swap; MCP returns the exact CLI handoff only." }),
    command("execute", [operation], "Continue an approved reservation with its single send, or observe an already marked swap without resending.", "payment_submit", { class: "foreground_tty", when: "Only an unexpired stored foreground approval; MCP returns the exact CLI handoff only." }),
];
function command(name, options, summary, effect, approval = { class: "none", when: "Never signs or broadcasts." }) {
    const suffix = options.map((row) => ` ${row.name} <${row.type}>`).join("");
    return { path: ["swap", "ethereum", "uniswap", name], synopsis: `apn swap ethereum uniswap ${name}${suffix}`, summary, options,
        effect: { class: effect, summary }, approval, output, states,
        recovery: [], examples: [`apn swap ethereum uniswap ${name}`] };
}
export function bindUniswapCommand(path, o) {
    const action = path.slice("swap ethereum uniswap ".length);
    if (!isPlainRecord(o))
        invalid("Uniswap options must be a plain object.");
    if (action === "inventory") {
        exact(o, []);
        return { command: "swap.uniswap.inventory" };
    }
    if (action === "status" || action === "approve" || action === "execute") {
        exact(o, ["--operation"]);
        return { command: `swap.uniswap.${action}`, operationId: hash(o["--operation"]) };
    }
    if (action === "prepare") {
        exact(o, ["--profile", "--quote", "--idempotency-key"]);
        return { command: "swap.uniswap.prepare", profile: o["--profile"], quoteHash: hash(o["--quote"]), idempotencyKey: o["--idempotency-key"] };
    }
    if (action !== "quote")
        invalid("Unsupported Uniswap action.");
    exact(o, ["--profile", "--account", "--to", "--output-token", "--amount", "--slippage-bps", "--owner-slippage-cap-bps", "--deadline",
        "--max-gas-limit", "--max-fee-per-gas", "--max-priority-fee-per-gas"]);
    const slippageBps = safeInteger(o["--slippage-bps"]), ownerSlippageCapBps = safeInteger(o["--owner-slippage-cap-bps"]);
    if (slippageBps > ownerSlippageCapBps || ownerSlippageCapBps > 10_000)
        invalid("Uniswap slippage exceeds the owner cap.");
    return { command: "swap.uniswap.quote", profile: o["--profile"], account: evmAddress(o["--account"]), recipient: evmAddress(o["--to"]),
        outputToken: evmAddress(o["--output-token"]), amountAtomic: o["--amount"],
        slippageBps, ownerSlippageCapBps,
        deadline: safeInteger(o["--deadline"]),
        maxGasLimit: o["--max-gas-limit"], maxFeePerGas: o["--max-fee-per-gas"], maxPriorityFeePerGas: o["--max-priority-fee-per-gas"] };
}
function exact(value, keys) {
    if (!exactKeys(value, keys))
        invalid("Uniswap options contain an unknown or missing field.");
}
function evmAddress(value) {
    if (value === undefined)
        invalid("Uniswap address is required.");
    try {
        const canonical = getAddress(value);
        if (canonical !== value)
            invalid("Uniswap address must use its canonical checksum.");
        return canonical;
    }
    catch {
        return invalid("Uniswap address must use its canonical checksum.");
    }
}
function safeInteger(value) {
    if (value === undefined || !/^(?:0|[1-9][0-9]*)$/u.test(value))
        invalid("Uniswap integer option must be canonical.");
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed))
        invalid("Uniswap integer option exceeds the safe range.");
    return parsed;
}
function hash(value) {
    if (value === undefined || !/^[a-f0-9]{64}$/u.test(value))
        invalid("Uniswap hash option must be 64 lowercase hexadecimal characters.");
    return value;
}
function invalid(message) { throw new ApnError("APN_INVALID_INPUT", message); }
//# sourceMappingURL=uniswap-command-catalog.js.map