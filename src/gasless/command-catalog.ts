import type { CommandDefinition, CommandOption } from "../command-catalog.js";
import type { CommandRequest } from "../commands.js";
import { gaslessAddress, gaslessDecimal, gaslessFailure } from "./validation.js";
import { gaslessCommandChain, gaslessCommandRequest, type GaslessCommandChainId } from "./command-input.js";
import { GASLESS_DEPLOYMENTS, gaslessAsset } from "./registry.js";
import { mmRegistry } from "../metamask-gasless/registry.js";
import { GASLESS_TERMINAL } from "./operation-model.js";
import { SA_TERMINAL } from "../smart-account-gasless/operation-model.js";
import { FACILITATOR_TERMINAL } from "../facilitator-gasless/operation-model.js";

const option = (name: CommandOption["name"], type: CommandOption["type"], constraints: readonly string[], required = true): CommandOption => ({
  name, type, constraints, required, default: { kind: "none" }, sensitivity: "operator_input",
});
const profile = option("--profile", "profile", ["existing_bound_profile_required_for_balance_and_prepare"]);
const chain = option("--chain", "string", ["numeric_mainnet_id_1_10_130_137_143_1329_8453_42161_43114_59144", "provider_specific_chain_admission"]);
const operation = option("--operation", "operation_id", ["64_lowercase_hex_characters"]);
const profileHash = option("--profile-hash", "string", ["64_lowercase_hex_characters"]);
const output = { contract: "apn.cli.v1", success_exit: 0, failure_exit: 1,
  success: "USDC gross, fee budget, recipient amount, permission state and independently verified settlement.",
  failures: ["Classified APN error with no automatic fallback or replacement signature."] } as const;
const states = { terminal: [...new Set([...GASLESS_TERMINAL, ...SA_TERMINAL, ...FACILITATOR_TERMINAL])],
  non_terminal: ["awaiting_approval", "execution_pending", "bootstrap_pending", "user_operation_pending", "submitted_pending",
    "included_success", "included_revert", "unknown_finality", "failed_effects_pending", "dispatch_pending",
    "material_pending", "material_sealed", "exposure_pending", "verified_pending",
    "approved", "verify_started", "settle_started", "settle_submitted"] } as const;
const readApproval = { class: "none", when: "Never signs or submits." } as const;
const done = { terminal: ["completed", "classified_failure"], non_terminal: [] };
export const GASLESS_COMMANDS: readonly CommandDefinition[] = [
  { path: ["gasless", "usdt", "prepare"],
    synopsis: "apn gasless usdt prepare --profile <profile> --to <address> --amount <gross-USDT> --max-fee <USDT> --min-received <USDT> --idempotency-key <key>",
    summary: "Save an unsigned Ethereum USDT gasless preparation under the active owner asset policy.",
    options: [profile, option("--to", "address", ["nonzero_distinct_recipient"]),
      option("--amount", "string", ["positive_USDT_at_most_six_decimal_places"]),
      option("--max-fee", "string", ["nonnegative_USDT_at_most_six_decimal_places"]),
      option("--min-received", "string", ["positive_USDT_at_most_six_decimal_places"]),
      option("--idempotency-key", "idempotency_key", ["gasless_usdt_bound_journal_only_across_profiles"])],
    effect: { class: "payment_prepare", summary: "Reads the active owner policy, safe Ethereum account and fixed public sponsor, then saves only unsigned material." },
    approval: readApproval, output, states: { terminal: [], non_terminal: ["prepared"] }, recovery: [],
    examples: ["apn gasless usdt prepare --profile default --to <recipient> --amount 1 --max-fee 0.5 --min-received 0.5 --idempotency-key <key>"] },
  { path: ["gasless", "usdt", "status"], synopsis: "apn gasless usdt status --profile-hash <hash> --operation <operation-id>",
    summary: "Read a saved gasless USDT operation without creating or changing state.", options: [profileHash, operation],
    effect: { class: "local_read", summary: "Reads the explicitly bound gasless USDT journal; never signs or submits." }, approval: readApproval, output,
    states: done, recovery: [], examples: ["apn gasless usdt status --profile-hash <hash> --operation <operation-id>"] },
  { path: ["gasless", "usdt", "resume"], synopsis: "apn gasless usdt resume --profile-hash <hash> --operation <operation-id>",
    summary: "Re-read a saved gasless USDT operation; no state transition is performed.", options: [profileHash, operation],
    effect: { class: "local_read", summary: "Reads the explicitly bound gasless USDT journal; never signs or submits." }, approval: readApproval, output,
    states: done, recovery: [], examples: ["apn gasless usdt resume --profile-hash <hash> --operation <operation-id>"] },
  { path: ["gasless", "usdt", "execute"], synopsis: "apn gasless usdt execute --profile-hash <hash> --operation <operation-id>",
    summary: "Approve and send one existing bound Ethereum USDT operation from a foreground terminal.", options: [profileHash, operation],
    effect: { class: "payment_submit", summary: "Rechecks owner policy, usage, safe account and quote; locally signs, journals the UserOperation hash, and makes at most one keyless Pimlico send." },
    approval: { class: "foreground_tty", when: "Each new bound operation; CLI only." }, output,
    states: { terminal: ["finalized", "failed_confirmed_revert"], non_terminal: ["submitted_pending", "unknown_finality"] },
    recovery: [{ command_path: ["gasless", "usdt", "observe"], when: "Observe the original hash through finalized Ethereum evidence; never resubmit." }],
    examples: ["apn gasless usdt execute --profile-hash <hash> --operation <operation-id>"] },
  { path: ["gasless", "usdt", "execution-status"], synopsis: "apn gasless usdt execution-status --profile-hash <hash> --operation <operation-id>",
    summary: "Read the local execution journal for a bound gasless USDT operation.", options: [profileHash, operation],
    effect: { class: "local_read", summary: "Reads local bound and execution journals only." }, approval: readApproval, output,
    states: done, recovery: [], examples: ["apn gasless usdt execution-status --profile-hash <hash> --operation <operation-id>"] },
  { path: ["gasless", "usdt", "observe"], synopsis: "apn gasless usdt observe --profile-hash <hash> --operation <operation-id>",
    summary: "Observe the original submitted hash through finalized Ethereum receipts.", options: [profileHash, operation],
    effect: { class: "network_read", summary: "Reads the keyless bundler and public Ethereum RPC; records a verified outcome or unknown finality, never signs or sends." },
    approval: readApproval, output, states: done, recovery: [],
    examples: ["apn gasless usdt observe --profile-hash <hash> --operation <operation-id>"] },
  { path: ["gasless", "capabilities"], synopsis: "apn gasless capabilities [--profile <profile>]",
    summary: "Show exact mainnet USDC fee-transfer adapters and separate acceptance for all four profile types.",
    options: [{ ...profile, required: false }], effect: { class: "none", summary: "Static discovery; no wallet, state, Keychain, RPC or provider access." },
    approval: readApproval, output, states: done, recovery: [], examples: ["apn gasless capabilities"] },
  { path: ["gasless", "balance"], synopsis: "apn gasless balance --profile <profile> --chain <chain-id>",
    summary: "Read canonical USDC and current gasless permission state for the bound provider.",
    options: [profile, chain], effect: { class: "network_read", summary: "Uses the selected chain's explicit APN_*_RPC_URL and pinned deployment identities; never signs." },
    approval: readApproval, output, states: done, recovery: [], examples: ["apn gasless balance --profile default --chain 8453"] },
  { path: ["gasless", "transfer", "quote"],
    synopsis: "apn gasless transfer quote --profile <profile> --chain 1 --owner <address> --to <address> --amount <gross-USDC> --max-fee <USDC> --min-received <USDC> --rpc-url <public-ethereum-rpc> [--rpc-max-batch-items <2-30>]",
    summary: "Read the current local Ethereum USDC gasless fee snapshot and compare it with input limits.",
    options: [profile, chain, option("--owner", "address", ["explicit_local_owner_for_fee_snapshot"]), option("--to", "address", ["nonzero_distinct_recipient"]),
      option("--amount", "string", ["positive_USDC_at_most_six_decimal_places"]),
      option("--max-fee", "string", ["nonnegative_USDC_at_most_six_decimal_places"]),
      option("--min-received", "string", ["positive_USDC_at_most_six_decimal_places"]),
      option("--rpc-url", "https_url", ["explicit_public_ethereum_RPC_for_this_invocation"]),
      option("--rpc-max-batch-items", "string", ["optional_per_invocation_ethereum_RPC_batch_cap_2_to_30"], false)],
    effect: { class: "network_read", summary: "Reads one verified Ethereum gasless snapshot for an explicit owner; profile binding, policy, usage and operation admission are unchecked. Never creates an operation, reserves, signs or sends." },
    approval: readApproval, output, states: done, recovery: [],
    examples: ["apn gasless transfer quote --profile default --chain 1 --owner <owner> --to <recipient> --amount 0.005 --max-fee 0.004 --min-received 0.001 --rpc-url https://ethereum-rpc.example"] },
  { path: ["gasless", "transfer", "prepare"],
    synopsis: "apn gasless transfer prepare --profile <profile> --chain <chain-id> --to <address> --amount <gross-USDC> --max-fee <USDC> --min-received <USDC> --idempotency-key <key>",
    summary: "Freeze one same-chain USDC transfer and its exact provider fee, including externally sponsored zero-fee transfers.",
    options: [profile, chain, option("--to", "address", ["nonzero_distinct_recipient"]),
      option("--amount", "string", ["positive_gross_USDC_at_most_six_decimal_places"]),
      option("--max-fee", "string", ["nonnegative_USDC_at_most_six_decimal_places"]),
      option("--min-received", "string", ["positive_USDC_recipient_floor_at_most_six_decimal_places"]),
      option("--idempotency-key", "idempotency_key", ["global_across_all_money_families"])],
    effect: { class: "payment_prepare", summary: "Checks the existing bound wallet, provider-specific deployment and USDC fee contract; freezes gross, net, fee and an unsigned intent." },
    approval: readApproval, output, states, recovery: [{ command_path: ["gasless", "transfer", "approve"], when: "Review the frozen recipient amount, fee and provider-specific permission before expiry." }],
    examples: ["apn gasless transfer prepare --profile default --chain 8453 --to <recipient> --amount 10 --max-fee 0.2 --min-received 9.8 --idempotency-key <key>"] },
  { path: ["gasless", "transfer", "approve"], synopsis: "apn gasless transfer approve --operation <operation-id>",
    summary: "Approve the exact USDC transfer, fee and permission in a foreground terminal.",
    options: [operation], effect: { class: "payment_submit", summary: "Local profiles sign the frozen Circle bootstrap/UserOperation. MetaMask server wallets request one provider-signed exact batch. Smart Account profiles sign and disclose one expiring ERC-7710 child, then request one externally sponsored settlement. Local profiles on Avalanche sign one expiring EIP-3009 authorization that the public PayAI x402 facilitator verifies and settles once. Disclosure/send markers are durable; recovery never repeats them." },
    approval: { class: "foreground_tty", when: "Each new operation; MCP always returns a CLI handoff." }, output, states,
    recovery: [{ command_path: ["operation", "resume"], when: "Continue an approved unattempted phase or observe the original operation; omit --wait-seconds." },
      { command_path: ["receipt", "get"], when: "Read saved delivery, fees and remaining permissions." }],
    examples: ["apn gasless transfer approve --operation <operation-id>"] },
];
export function includeGaslessRecovery(commands: readonly CommandDefinition[]): readonly CommandDefinition[] {
  return commands.map((c) => !["operation resume", "operation status", "receipt get"].includes(c.path.join(" ")) ? c : {
    ...c,
    ...(c.path.join(" ") !== "operation resume" ? {} : {
      synopsis: `${c.synopsis.includes("[--rpc-url <https-url>]") ? c.synopsis : c.synopsis.replace("--rpc-url <https-url>", "[--rpc-url <https-url>]")} [--observation-rpc-env <APN_ENV_RPC_URL>]`,
      options: [...c.options.map(entry => entry.name === "--rpc-url" ? { ...entry, required: false,
        constraints: [...entry.constraints, "optional_for_gasless_operations_using_frozen_APN_chain_RPC_environment"] } : entry), option("--observation-rpc-env", "string",
        ["explicit_APN_environment_variable_for_gasless_readonly_observation", "cannot_combine_with_rpc_url_or_wait_seconds"], false)],
    }),
    states: { terminal: [...new Set([...c.states.terminal, ...states.terminal])],
      non_terminal: [...new Set([...c.states.non_terminal, ...states.non_terminal])] },
    effect: { ...c.effect, summary: `${c.effect.summary} Gasless operations retain USDC fee and permission evidence; each attempted disclosure/send is never repeated. Coinbase and MetaMask server-wallet recovery are read-only after dispatch. Smart Account recovery uses independent RPC only after disclosure, including verify rejection or a lost response; only correlated settlement or finalized unused expiry releases its guard. Avalanche facilitator recovery reads only APN_AVALANCHE_RPC_URL; a correlated finalized settlement or a finalized unused expiry releases its guard. Recovery uses the frozen chain's APN_*_RPC_URL; local Circle also supports APN_*_BUNDLER_RPC_URL. Local operation resume optionally accepts --observation-rpc-env for verified read-only recovery through an explicitly selected RPC; it cannot sign, estimate or submit.` },
  });
}
/**
 * Operator amount scale for one command chain, read from the registry row of the rail that admits it — the local rail's
 * asset where it has one, otherwise the MetaMask rail's. A chain no admitted rail carries fails closed.
 */
function commandDecimals(chainId: GaslessCommandChainId): number {
  const local = GASLESS_DEPLOYMENTS.find((r) => r.chainId === chainId);
  return local === undefined ? mmRegistry(chainId).row.decimals : gaslessAsset(local.chainId, local.token).decimals;
}
export function bindGaslessCommand(path: string, o: Readonly<Record<string, string>>): CommandRequest {
  if (path === "gasless capabilities") return { command: "gasless.capabilities", ...(o["--profile"] === undefined ? {} : { profile: o["--profile"] }) };
  if (path === "gasless usdt prepare") return { command: "gasless.usdt.prepare", profile: o["--profile"]!, idempotencyKey: o["--idempotency-key"]!,
    recipient: gaslessAddress(o["--to"], "APN_INVALID_INPUT"), grossAtomic: gaslessDecimal(o["--amount"], 6, true),
    maxFeeAtomic: gaslessDecimal(o["--max-fee"], 6), minReceivedAtomic: gaslessDecimal(o["--min-received"], 6, true) };
  if (["gasless usdt status", "gasless usdt resume", "gasless usdt execute", "gasless usdt execution-status", "gasless usdt observe"].includes(path)) {
    const profileHash = o["--profile-hash"]!;
    if (!/^[a-f0-9]{64}$/u.test(profileHash)) gaslessFailure("APN_INVALID_INPUT", "gasless_usdt_profile_hash");
    return { command: `gasless.usdt.${path.split(" ").at(-1)!}` as "gasless.usdt.status" | "gasless.usdt.resume" | "gasless.usdt.execute" | "gasless.usdt.execution-status" | "gasless.usdt.observe", profileHash,
      operationId: o["--operation"]! };
  }
  if (path === "gasless transfer approve") return { command: "gasless.transfer.approve", operationId: o["--operation"]! };
  if (!/^[1-9][0-9]{0,5}$/u.test(o["--chain"] ?? "")) gaslessFailure("APN_INVALID_INPUT", "gasless_chain_identity");
  const chainId = gaslessCommandChain(Number(o["--chain"]));
  if (path === "gasless balance") return { command: "gasless.balance", profile: o["--profile"]!, chainId };
  if (path !== "gasless transfer prepare" && path !== "gasless transfer quote") gaslessFailure("APN_INVALID_INPUT", "gasless_command");
  const decimals = commandDecimals(chainId);
  if (path === "gasless transfer quote") {
    const batchCap = o["--rpc-max-batch-items"];
    if (batchCap !== undefined && !/^(?:[2-9]|[12][0-9]|30)$/u.test(batchCap)) {
      gaslessFailure("APN_INVALID_INPUT", "gasless_RPC_batch_cap");
    }
    return { command: "gasless.transfer.quote", profile: o["--profile"]!,
    owner: gaslessAddress(o["--owner"], "APN_INVALID_INPUT"),
    ...(batchCap === undefined ? {} : { rpcMaxBatchItems: Number(batchCap) }),
    request: gaslessCommandRequest({ chainId, recipient: gaslessAddress(o["--to"], "APN_INVALID_INPUT"),
      grossAtomic: gaslessDecimal(o["--amount"], decimals, true), maxFeeAtomic: gaslessDecimal(o["--max-fee"], decimals),
      minReceivedAtomic: gaslessDecimal(o["--min-received"], decimals, true) }) };
  }
  return { command: "gasless.transfer.prepare", profile: o["--profile"]!, idempotencyKey: o["--idempotency-key"]!,
    request: gaslessCommandRequest({ chainId, recipient: gaslessAddress(o["--to"], "APN_INVALID_INPUT"),
      grossAtomic: gaslessDecimal(o["--amount"], decimals, true), maxFeeAtomic: gaslessDecimal(o["--max-fee"], decimals),
      minReceivedAtomic: gaslessDecimal(o["--min-received"], decimals, true) }) };
}
