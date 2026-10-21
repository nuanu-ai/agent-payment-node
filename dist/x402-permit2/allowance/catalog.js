import { command, option } from "../../command-catalog-builders.js";
import { ApnError } from "../../errors.js";
import { evmToken } from "../../evm-asset.js";
import { x402Chain } from "../../x402-network.js";
const none = { kind: "none" };
const states = { terminal: ["completed", "reverted", "superseded", "failed_before_effect", "abandoned_unknown"], non_terminal: ["prepared", "signed", "submitted"] };
const operation = option("--operation", "operation_id", true, none, ["64_lowercase_hex_characters"], "public");
const rpcUrl = option("--rpc-url", "https_url", true, none, ["credential_free_https_without_fragment", "serves_the_selected_chain"], "operator_input");
const shared = [
    option("--profile", "profile", true, none, ["matches_[a-z0-9][a-z0-9._-]{0,63}"], "public"),
    option("--chain", "string", true, none, ["eip155_caip2_of_any_evm_chain"], "operator_input"),
    option("--asset", "address", true, none, ["exact_erc20_contract_address", "admitted_by_owner_x402_policy_or_allowlist_permit2_row"], "operator_input"),
    rpcUrl,
    option("--max-gas-limit", "positive_integer", true, none, ["owner_cap_at_least_the_estimate"], "operator_input"),
    option("--max-fee-per-gas-wei", "wei", true, none, ["owner_cap_at_least_base_fee_plus_priority"], "operator_input"),
    option("--max-priority-fee-per-gas-wei", "wei", true, none, ["not_greater_than_max_fee_per_gas"], "operator_input"),
    option("--idempotency-key", "idempotency_key", true, none, ["8_to_200_safe_ascii_characters"], "operator_input"),
];
const synopsis = (action, amount) => `apn x402 permit2 allowance ${action} --profile <profile> --chain <caip2> --asset <token>${amount} ` +
    "--rpc-url <https-rpc> --max-gas-limit <uint> --max-fee-per-gas-wei <wei> --max-priority-fee-per-gas-wei <wei> --idempotency-key <key>";
const observeRecovery = [{ command_path: ["x402", "permit2", "allowance", "observe"], when: "Prove the receipt at the chain's proof tag or that it can never land." }];
export const PERMIT2_ALLOWANCE_GROUPS = [
    { path: ["x402", "permit2", "allowance"], summary: "Set or revoke the wallet's bounded ERC-20 allowance to Permit2 for an owner-admitted chain and token.", kind: "group" },
];
export const PERMIT2_ALLOWANCE_COMMANDS = [
    command(["x402", "permit2", "allowance", "set"], synopsis("set", " --amount <atomic>"), "Approve an owner-specified amount of the token to the canonical Permit2 contract from the local wallet: one transaction, sent once.", [...shared.slice(0, 3), option("--amount", "atomic", true, none, ["positive_atomic_units", "at_most_the_owner_x402_balance_cap_or_allowlist_daily_cap"], "operator_input"),
        ...shared.slice(3)], "payment_submit", "Reads the chain (nonce with nothing pending, allowance, balance, estimate), freezes the approve and the owner's gas caps, takes foreground consent, seals, marks and sends once. Never unlimited.", "foreground_tty", "The owner approves the exact chain, token, spender, amount and gas caps in the foreground TTY; MCP returns the CLI handoff.", states, observeRecovery, ["apn x402 permit2 allowance set --profile default --chain eip155:8453 --asset <token> --amount 5000000 --rpc-url https://rpc.example --max-gas-limit 80000 --max-fee-per-gas-wei 2000000000 --max-priority-fee-per-gas-wei 1000000 --idempotency-key allow-0001"]),
    command(["x402", "permit2", "allowance", "revoke"], synopsis("revoke", ""), "Set the wallet's allowance of the token to Permit2 back to zero: the same owned one-send operation.", shared, "payment_submit", "Same reads, consent, seal, mark and single send as set, with amount zero.", "foreground_tty", "The owner approves the exact revoke and gas caps in the foreground TTY; MCP returns the CLI handoff.", states, observeRecovery, ["apn x402 permit2 allowance revoke --profile default --chain eip155:8453 --asset <token> --rpc-url https://rpc.example --max-gas-limit 80000 --max-fee-per-gas-wei 2000000000 --max-priority-fee-per-gas-wei 1000000 --idempotency-key revoke-0001"]),
    command(["x402", "permit2", "allowance", "observe"], "apn x402 permit2 allowance observe --operation <operation-id> --rpc-url <https-rpc>", "Observe one allowance operation: its receipt at the chain's proof tag, or the finalized proof that it can never land.", [operation, rpcUrl], "network_read", "One bounded observation that may finalize the local journal; never signs or sends.", "prior_operation_authorization", "Only the saved operation is observed.", states, [], ["apn x402 permit2 allowance observe --operation <operation-id> --rpc-url https://rpc.example"]),
    command(["x402", "permit2", "allowance", "status"], "apn x402 permit2 allowance status --operation <operation-id>", "Read one allowance operation from its local journal.", [operation], "local_read", "Reads local state only.", "none", "Never.", states, [], ["apn x402 permit2 allowance status --operation <operation-id>"]),
];
export function bindPermit2AllowanceCommand(path, options) {
    const value = (name) => {
        const found = options[name];
        if (found === undefined)
            throw new ApnError("APN_INVALID_INPUT", `${name} is required.`);
        return found;
    };
    if (path === "x402 permit2 allowance status")
        return { request: { command: "x402.permit2.allowance.status", operationId: value("--operation") } };
    if (path === "x402 permit2 allowance observe")
        return { request: { command: "x402.permit2.allowance.observe", operationId: value("--operation") }, rpcUrl: value("--rpc-url") };
    const action = path === "x402 permit2 allowance set" ? "set" : path === "x402 permit2 allowance revoke" ? "revoke" : null;
    if (action === null)
        throw new ApnError("APN_UNSUPPORTED_COMMAND", "Unsupported Permit2 allowance command.");
    const token = evmToken(value("--asset"));
    if (token === "native")
        throw new ApnError("APN_INVALID_INPUT", "--asset is an exact ERC-20 contract address.");
    return { request: { command: `x402.permit2.allowance.${action}`, profile: value("--profile"), chainId: x402Chain(value("--chain")), token: token,
            amountAtomic: action === "set" ? value("--amount") : "0", maxGasLimit: value("--max-gas-limit"), maxFeePerGasWei: value("--max-fee-per-gas-wei"),
            maxPriorityFeePerGasWei: value("--max-priority-fee-per-gas-wei"), idempotencyKey: value("--idempotency-key") }, rpcUrl: value("--rpc-url") };
}
//# sourceMappingURL=catalog.js.map