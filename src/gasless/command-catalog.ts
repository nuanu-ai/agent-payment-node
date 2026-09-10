import type { CommandDefinition, CommandOption } from "../command-catalog.js";
import type { CommandRequest } from "../commands.js";
import { gaslessAddress, gaslessDecimal, gaslessFailure } from "./validation.js";
import { gaslessCommandChain, gaslessCommandRequest } from "./command-input.js";
import { GASLESS_TERMINAL } from "./operation-model.js";

const option = (name: CommandOption["name"], type: CommandOption["type"], constraints: readonly string[], required = true): CommandOption => ({
  name, type, constraints, required, default: { kind: "none" }, sensitivity: "operator_input",
});
const profile = option("--profile", "profile", ["existing_bound_profile_required_for_balance_and_prepare"]);
const chain = option("--chain", "string", ["numeric_mainnet_id_1_10_130_137_143_1329_8453_42161_43114_59144", "provider_specific_chain_admission"]);
const operation = option("--operation", "operation_id", ["64_lowercase_hex_characters"]);
const output = { contract: "apn.cli.v1", success_exit: 0, failure_exit: 1,
  success: "USDC gross, fee budget, recipient amount, permission state and independently verified settlement.",
  failures: ["Classified APN error with no automatic fallback or replacement signature."] } as const;
const states = { terminal: GASLESS_TERMINAL,
  non_terminal: ["awaiting_approval", "execution_pending", "bootstrap_pending", "user_operation_pending", "submitted_pending",
    "included_success", "included_revert", "unknown_finality", "failed_effects_pending", "dispatch_pending"] } as const;
const readApproval = { class: "none", when: "Never signs or submits." } as const;
const done = { terminal: ["completed", "classified_failure"], non_terminal: [] };
export const GASLESS_COMMANDS: readonly CommandDefinition[] = [
  { path: ["gasless", "capabilities"], synopsis: "apn gasless capabilities [--profile <profile>]",
    summary: "Show exact mainnet USDC fee-transfer adapters and separate acceptance for all four profile types.",
    options: [{ ...profile, required: false }], effect: { class: "none", summary: "Static discovery; no wallet, state, Keychain, RPC or provider access." },
    approval: readApproval, output, states: done, recovery: [], examples: ["apn gasless capabilities"] },
  { path: ["gasless", "balance"], synopsis: "apn gasless balance --profile <profile> --chain <chain-id>",
    summary: "Read canonical USDC and current gasless permission state for the bound provider.",
    options: [profile, chain], effect: { class: "network_read", summary: "Uses the selected chain's explicit APN_*_RPC_URL and pinned deployment identities; never signs." },
    approval: readApproval, output, states: done, recovery: [], examples: ["apn gasless balance --profile default --chain 8453"] },
  { path: ["gasless", "transfer", "prepare"],
    synopsis: "apn gasless transfer prepare --profile <profile> --chain <chain-id> --to <address> --amount <gross-USDC> --max-fee <USDC> --min-received <USDC> --idempotency-key <key>",
    summary: "Freeze one same-chain USDC transfer with gas deducted from its total budget.",
    options: [profile, chain, option("--to", "address", ["nonzero_distinct_recipient"]),
      option("--amount", "string", ["positive_gross_USDC_at_most_six_decimal_places"]),
      option("--max-fee", "string", ["nonnegative_USDC_at_most_six_decimal_places"]),
      option("--min-received", "string", ["positive_USDC_recipient_floor_at_most_six_decimal_places"]),
      option("--idempotency-key", "idempotency_key", ["global_across_all_money_families"])],
    effect: { class: "payment_prepare", summary: "Checks the existing bound wallet, provider-specific deployment and USDC fee contract; freezes gross, net, fee and an unsigned intent." },
    approval: readApproval, output, states, recovery: [{ command_path: ["gasless", "transfer", "approve"], when: "Review the frozen recipient amount, fee and persistent permission before expiry." }],
    examples: ["apn gasless transfer prepare --profile default --chain 8453 --to <recipient> --amount 10 --max-fee 0.2 --min-received 9.8 --idempotency-key <key>"] },
  { path: ["gasless", "transfer", "approve"], synopsis: "apn gasless transfer approve --operation <operation-id>",
    summary: "Approve the exact USDC fee budget and persistent permission in a foreground terminal.",
    options: [operation], effect: { class: "payment_submit", summary: "Local profiles sign the frozen Circle bootstrap/UserOperation. MetaMask server wallets request one provider-signed exact batch after an irreversible dispatch marker. Persistent permission may survive failure." },
    approval: { class: "foreground_tty", when: "Each new operation; MCP always returns a CLI handoff." }, output, states,
    recovery: [{ command_path: ["operation", "resume"], when: "Continue an approved unattempted phase or observe the original operation; omit --wait-seconds." },
      { command_path: ["receipt", "get"], when: "Read saved delivery, fees and remaining permissions." }],
    examples: ["apn gasless transfer approve --operation <operation-id>"] },
];
export function includeGaslessRecovery(commands: readonly CommandDefinition[]): readonly CommandDefinition[] {
  return commands.map((c) => !["operation resume", "operation status", "receipt get"].includes(c.path.join(" ")) ? c : {
    ...c, states: { terminal: [...new Set([...c.states.terminal, ...states.terminal])],
      non_terminal: [...new Set([...c.states.non_terminal, ...states.non_terminal])] },
    effect: { ...c.effect, summary: `${c.effect.summary} Gasless operations retain USDC fee and persistent permission evidence; each attempted disclosure/send is never repeated. MetaMask recovery is read-only after its single dispatch marker and remains available after the APN deadline. Recovery uses the frozen chain's APN_*_RPC_URL; local Circle also supports APN_*_BUNDLER_RPC_URL.` },
  });
}
export function bindGaslessCommand(path: string, o: Readonly<Record<string, string>>): CommandRequest {
  if (path === "gasless capabilities") return { command: "gasless.capabilities", ...(o["--profile"] === undefined ? {} : { profile: o["--profile"] }) };
  if (path === "gasless transfer approve") return { command: "gasless.transfer.approve", operationId: o["--operation"]! };
  if (!/^[1-9][0-9]{0,5}$/u.test(o["--chain"] ?? "")) gaslessFailure("APN_INVALID_INPUT", "gasless_chain_identity");
  const chainId = gaslessCommandChain(Number(o["--chain"]));
  if (path === "gasless balance") return { command: "gasless.balance", profile: o["--profile"]!, chainId };
  if (path !== "gasless transfer prepare") gaslessFailure("APN_INVALID_INPUT", "gasless_command");
  return { command: "gasless.transfer.prepare", profile: o["--profile"]!, idempotencyKey: o["--idempotency-key"]!,
    request: gaslessCommandRequest({ chainId, recipient: gaslessAddress(o["--to"], "APN_INVALID_INPUT"),
      grossAtomic: gaslessDecimal(o["--amount"], true), maxFeeAtomic: gaslessDecimal(o["--max-fee"]),
      minReceivedAtomic: gaslessDecimal(o["--min-received"], true) }) };
}
