import { ApnError } from "../errors.js";
const option = (name, type, constraints) => ({ name, type, constraints, required: true, default: { kind: "none" }, sensitivity: "operator_input" });
const output = { contract: "apn.cli.v1", success_exit: 0, failure_exit: 1,
    success: "Pinned Uniswap inventory, unsigned quote, prepared operation, or durable status.",
    failures: ["Classified refusal; no signing, broadcast, approval, or provider fallback."] };
const states = { terminal: ["finalized", "failed_before_effect"], non_terminal: ["quoted", "prepared", "awaiting_approval",
        "reserved", "submitting", "submitted", "unknown_finality"] };
const profile = option("--profile", "profile", ["existing_profile_name"]), account = option("--account", "address", ["checksummed_ethereum_address"]);
const operation = option("--operation", "operation_id", ["64_lowercase_hex_characters"]);
export const UNISWAP_COMMAND_GROUPS = [
    { path: ["swap"], summary: "Separately admitted guarded swaps.", kind: "group" },
    { path: ["swap", "ethereum"], summary: "Ethereum guarded swaps.", kind: "group" },
    { path: ["swap", "ethereum", "uniswap"], summary: "Pinned Universal Router native ETH to USDC exact input.", kind: "group" },
];
export const UNISWAP_COMMANDS = [
    command("inventory", [], "Read the immutable official Uniswap pin and frozen pair without admitting it.", "none"),
    command("quote", [profile, account, option("--to", "address", ["checksummed_recipient"]), option("--amount", "wei", ["positive_native_wei"]),
        option("--slippage-bps", "string", ["integer_0_through_owner_cap"]), option("--owner-slippage-cap-bps", "string", ["integer_0_through_10000"]),
        option("--deadline", "string", ["unix_seconds_within_30_minutes"]), option("--max-gas-limit", "wei", ["positive_bound"]),
        option("--max-fee-per-gas", "wei", ["positive_bound"]), option("--max-priority-fee-per-gas", "wei", ["positive_bound"])], "Construct, decode, and exactly simulate one unsigned quote.", "network_read"),
    command("prepare", [profile, option("--quote", "string", ["64_lowercase_hex_quote_hash"]), option("--idempotency-key", "idempotency_key", ["global_payment_key"])], "Prepare only after separate owner admission of both assets and the exact mechanism.", "payment_prepare"),
    command("status", [operation], "Read one durable guarded swap operation without resending.", "local_read"),
    command("approve", [operation], "Foreground approval is dormant until the complete signer and sender adapter exists.", "none"),
    command("execute", [operation], "Execution is dormant until the complete signer, sender, and observer adapter exists.", "none"),
];
function command(name, options, summary, effect) {
    const suffix = options.map((row) => ` ${row.name} <${row.type}>`).join("");
    return { path: ["swap", "ethereum", "uniswap", name], synopsis: `apn swap ethereum uniswap ${name}${suffix}`, summary, options,
        effect: { class: effect, summary }, approval: { class: "none", when: "Never signs or broadcasts." }, output, states,
        recovery: [], examples: [`apn swap ethereum uniswap ${name}`] };
}
export function bindUniswapCommand(path, o) {
    const action = path.slice("swap ethereum uniswap ".length);
    if (action === "inventory")
        return { command: "swap.uniswap.inventory" };
    if (action === "status")
        return { command: "swap.uniswap.status", operationId: hash(o["--operation"]) };
    if (action === "approve")
        return { command: "swap.uniswap.approve", operationId: hash(o["--operation"]) };
    if (action === "execute")
        return { command: "swap.uniswap.execute", operationId: hash(o["--operation"]) };
    if (action === "prepare")
        return { command: "swap.uniswap.prepare", profile: o["--profile"], quoteHash: hash(o["--quote"]), idempotencyKey: o["--idempotency-key"] };
    return { command: "swap.uniswap.quote", profile: o["--profile"], account: o["--account"], recipient: o["--to"], amountAtomic: o["--amount"],
        slippageBps: safeInteger(o["--slippage-bps"]), ownerSlippageCapBps: safeInteger(o["--owner-slippage-cap-bps"]),
        deadline: safeInteger(o["--deadline"]),
        maxGasLimit: o["--max-gas-limit"], maxFeePerGas: o["--max-fee-per-gas"], maxPriorityFeePerGas: o["--max-priority-fee-per-gas"] };
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