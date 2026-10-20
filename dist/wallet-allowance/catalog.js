import { getAddress } from "viem";
import { command, option } from "../command-catalog-builders.js";
import { ApnError } from "../errors.js";
import { x402Chain } from "../x402-network.js";
import { WALLET_ALLOWANCE_REVOKE_STATES, WALLET_ALLOWANCE_REVOKE_TERMINAL_STATES } from "./model.js";
const none = { kind: "none" };
const states = { terminal: [...WALLET_ALLOWANCE_REVOKE_TERMINAL_STATES],
    non_terminal: WALLET_ALLOWANCE_REVOKE_STATES.filter((state) => !WALLET_ALLOWANCE_REVOKE_TERMINAL_STATES.includes(state)) };
const target = [
    option("--profile", "profile", true, none, ["matches_[a-z0-9][a-z0-9._-]{0,63}", "has_a_local_evm_wallet"], "public"),
    option("--chain", "string", true, none, ["eip155_caip2", "the_chain_has_an_APN_<CHAIN>_RPC_URL_setting_and_it_is_set"], "operator_input"),
    option("--asset", "address", true, none, ["exact_erc20_contract_address"], "operator_input"),
    option("--spender", "address", true, none, ["exact_spender_address"], "operator_input"),
];
const caps = [
    option("--max-gas-limit", "positive_integer", true, none, ["owner_cap_at_least_the_estimate"], "operator_input"),
    option("--max-fee-per-gas-wei", "wei", true, none, ["owner_cap_at_least_base_fee_plus_priority"], "operator_input"),
    option("--max-priority-fee-per-gas-wei", "wei", true, none, ["not_greater_than_max_fee_per_gas"], "operator_input"),
];
const targetSynopsis = "--profile <profile> --chain eip155:<id> --asset <token-address> --spender <address>";
const example = "--profile default --chain eip155:1 --asset <token-address> --spender <spender-address>";
export const WALLET_ALLOWANCE_GROUPS = [
    { path: ["wallet", "allowance"], summary: "Read or revoke an ERC-20 allowance the local wallet granted.", kind: "group" },
];
export const WALLET_ALLOWANCE_COMMANDS = [
    command(["wallet", "allowance", "revoke"], `apn wallet allowance revoke ${targetSynopsis} --max-gas-limit <uint> --max-fee-per-gas-wei <wei> --max-priority-fee-per-gas-wei <wei>`, "Set one ERC-20 allowance of the local wallet back to zero: approve(spender, 0), one transaction, sent once and observed to proof.", [...target, ...caps], "payment_submit", "Reads the current allowance at one block (refuses when it is already zero), freezes the revoke and the owner's gas caps, takes foreground consent, seals, marks and sends once; a repeat continues the open revoke and never sends twice. Never sets a nonzero amount or calls anything else.", "foreground_tty", "The owner approves the exact chain, token, spender, current allowance and maximum gas debit in the foreground TTY; MCP returns the CLI handoff.", states, [{ command_path: ["operation", "status"], when: "Prove the revoke's receipt at the chain's proof tag, or that it can never land." }], [`apn wallet allowance revoke ${example} --max-gas-limit 60000 --max-fee-per-gas-wei 2000000000 --max-priority-fee-per-gas-wei 1000000`]),
    command(["wallet", "allowance", "status"], `apn wallet allowance status ${targetSynopsis}`, "Read one ERC-20 allowance of the local wallet at the chain's latest block.", target, "network_read", "One read-only allowance read through the chain's own RPC setting; never signs or sends.", "none", "Never.", { terminal: [], non_terminal: [] }, [], [`apn wallet allowance status ${example}`]),
];
export function bindWalletAllowanceCommand(path, options) {
    const value = (name) => {
        const found = options[name];
        if (found === undefined)
            throw new ApnError("APN_INVALID_INPUT", `${name} is required.`);
        return found;
    };
    const target = { profile: value("--profile"), chainId: x402Chain(value("--chain")), token: address(value("--asset"), "--asset"),
        spender: address(value("--spender"), "--spender") };
    if (target.token === target.spender)
        throw new ApnError("APN_INVALID_INPUT", "--spender must differ from --asset.");
    if (path === "wallet allowance status")
        return { request: { command: "wallet.allowance.status", ...target } };
    if (path !== "wallet allowance revoke")
        throw new ApnError("APN_UNSUPPORTED_COMMAND", "Unsupported wallet allowance command.");
    return { request: { command: "wallet.allowance.revoke", ...target, maxGasLimit: value("--max-gas-limit"), maxFeePerGasWei: value("--max-fee-per-gas-wei"),
            maxPriorityFeePerGasWei: value("--max-priority-fee-per-gas-wei") } };
}
function address(value, name) {
    let checked;
    try {
        checked = getAddress(value);
    }
    catch {
        throw new ApnError("APN_INVALID_INPUT", `${name} is not a valid EVM address.`);
    }
    if (/^0x0{40}$/u.test(checked))
        throw new ApnError("APN_INVALID_INPUT", `${name} cannot be the zero address.`);
    return checked;
}
//# sourceMappingURL=catalog.js.map