const option = (name, type, constraints, required = true) => ({
    name, type, constraints, required, default: { kind: "none" }, sensitivity: "operator_input",
});
const profile = option("--profile", "profile", ["explicit_canonical_profile"]);
const asset = option("--asset", "string", ["sol_or_usdc", "exact_mainnet_asset_identity"]);
const maximumFee = option("--max-fee-sol", "string", ["positive_canonical_sol_decimal", "at_most_nine_decimals", "fee_plus_rent_cap"]);
const output = { contract: "apn.cli.v1", success_exit: 0, failure_exit: 1,
    success: "Exact Solana mainnet identity with bounded public data and classified recovery.", failures: ["Classified APN error; unavailable providers never fall back to another wallet."] };
const completed = { terminal: ["completed", "classified_failure"], non_terminal: [] };
export const CHAIN_COMMANDS = [
    { path: ["wallet", "ensure-solana"], synopsis: "apn wallet ensure-solana --profile <profile> --provider <local-or-coinbase-awal> [--accept-risk true]",
        summary: "Ensure a separate local ed25519 wallet or link an existing authenticated awal Solana account.",
        options: [profile, option("--provider", "string", ["local_or_coinbase_awal"]), option("--accept-risk", "string", ["literal_true_required_for_local_custody"], false)],
        effect: { class: "local_write", summary: "Local creation encrypts a separate seed; provider linking reads its existing account and never logs in." },
        approval: { class: "none", when: "Explicit local custody risk acknowledgement is required." }, output, states: completed, recovery: [],
        examples: ["apn wallet ensure-solana --profile solana-local --provider local --accept-risk true"] },
    { path: ["wallet", "balance-solana"], synopsis: "apn wallet balance-solana --profile <profile> --asset <sol-or-usdc>",
        summary: "Read SOL or canonical USDC and the separate SOL fee balance through APN_SOLANA_RPC_URL.", options: [profile, asset],
        effect: { class: "network_read", summary: "Verifies mainnet, exact mint and account identities; no signing." },
        approval: { class: "none", when: "Never." }, output, states: completed, recovery: [], examples: ["apn wallet balance-solana --profile solana-local --asset usdc"] },
    { path: ["wallet", "capabilities-solana"], synopsis: "apn wallet capabilities-solana [--profile <profile>]",
        summary: "Inspect all four provider capabilities, fee-contract gates and unavailable Solana x402.",
        options: [{ ...profile, required: false }], effect: { class: "local_read", summary: "Static capability discovery is offline; an explicit profile adds its public stored binding." },
        approval: { class: "none", when: "Never." }, output, states: completed, recovery: [], examples: ["apn wallet capabilities-solana"] },
    { path: ["policy", "admit-solana"], synopsis: "apn policy admit-solana --profile <profile> --asset <sol-or-usdc> --max-per-transfer <decimal> --daily-limit <decimal> --max-fee-sol <decimal>",
        summary: "Admit one mainnet asset with exact principal and separate SOL fee/rent caps after foreground consent.",
        options: [profile, asset, option("--max-per-transfer", "string", ["positive_canonical_asset_decimal"]), option("--daily-limit", "string", ["positive_canonical_asset_decimal", "utc_daily_budget"]), maximumFee],
        effect: { class: "local_write", summary: "Writes the human-approved exact account and asset policy under the shared profile lock." },
        approval: { class: "foreground_tty", when: "Every policy admission or replacement." }, output, states: completed, recovery: [],
        examples: ["apn policy admit-solana --profile solana-local --asset usdc --max-per-transfer 1 --daily-limit 3 --max-fee-sol 0.003"] },
    { path: ["pay", "transfer", "prepare-solana"], synopsis: "apn pay transfer prepare-solana --profile <profile> --asset <sol-or-usdc> --to <solana-address> --amount <decimal> --max-fee-sol <decimal> --idempotency-key <key>",
        summary: "Freeze one Solana mainnet direct transfer within an existing human-admitted asset policy.",
        options: [profile, asset, option("--to", "string", ["canonical_32_byte_base58_solana_address"]), option("--amount", "string", ["positive_canonical_asset_decimal"]), maximumFee, option("--idempotency-key", "idempotency_key", ["8_to_200_safe_ascii_characters"])],
        effect: { class: "payment_prepare", summary: "Reserves the exact intent and bounds; no signing or submission." },
        approval: { class: "none", when: "The existing transfer approve command requires exact foreground consent." }, output,
        states: { terminal: ["classified_failure"], non_terminal: ["awaiting_approval"] },
        recovery: [{ command_path: ["pay", "transfer", "approve"], when: "After reviewing the frozen transfer." }, { command_path: ["operation", "resume"], when: "To reconcile the same effect after an interruption." }],
        examples: ["apn pay transfer prepare-solana --profile solana-local --asset usdc --to <solana-recipient> --amount 1 --max-fee-sol 0.003 --idempotency-key <key>"] },
];
export function includeRailRecovery(commands) {
    return commands.map((command) => {
        const path = command.path.join(" ");
        if (!["pay transfer approve", "operation resume", "operation status", "receipt get"].includes(path))
            return command;
        const usesRpc = path === "pay transfer approve" || path === "operation resume";
        return { ...command, ...(usesRpc ? {
                synopsis: command.synopsis.replace("--rpc-url <https-url>", "[--rpc-url <https-url>]"),
                options: command.options.map((entry) => entry.name === "--rpc-url" ? { ...entry, required: false, constraints: [...entry.constraints, "required_for_evm_operations", "solana_uses_explicit_APN_SOLANA_RPC_URL"] } : entry),
            } : {}), states: { ...command.states, non_terminal: [...command.states.non_terminal, ...(command.states.non_terminal.includes("signing_started") ? [] : ["signing_started"])] } };
    });
}
//# sourceMappingURL=chain-command-catalog.js.map