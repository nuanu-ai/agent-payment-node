import type { CommandDefinition, CommandOption } from "../command-catalog.js";
import type { CommandRequest } from "../commands.js";
import { bridgeAddress, bridgeCaip2, bridgeDecimal, bridgeHash, bridgeOpaque, bridgeUint, validateBridgeRequest } from "./validation.js";

const option = (name: CommandOption["name"], type: CommandOption["type"], constraints: readonly string[], required = true): CommandOption => ({
  name, type, constraints, required, default: { kind: "none" }, sensitivity: "operator_input",
});
const profile = option("--profile", "profile", ["existing_local_profile_required_for_routes_and_prepare"]);
const operation = option("--operation", "operation_id", ["64_lowercase_hex_characters"]);
const output = { contract: "apn.cli.v1", success_exit: 0, failure_exit: 1,
  success: "Bounded bridge capability, quote, operation or combined receipt with separate mainnet acceptance.",
  failures: ["Classified APN error; no provider fallback or automatic replacement effect."] } as const;
const bridgeStates = { terminal: ["completed", "failed_before_effect", "failed_after_approval", "failed_confirmed_revert"],
  non_terminal: ["awaiting_approval", "execution_pending", "source_pending", "destination_pending", "unknown_finality"] } as const;
const done = { terminal: ["completed", "classified_failure"], non_terminal: [] };
const readApproval = { class: "none", when: "Never signs or submits." } as const;
export const BRIDGE_COMMANDS: readonly CommandDefinition[] = [
  { path: ["bridge", "capabilities"], synopsis: "apn bridge capabilities [--profile <profile>]",
    summary: "Offline bridge capability rows for all four profiles, exact RPC environment names and open acceptance gates.",
    options: [{ ...profile, required: false }], effect: { class: "none", summary: "Static only; even a profile argument does not read APN state, providers, RPC or Keychain." },
    approval: readApproval, output, states: done, recovery: [], examples: ["apn bridge capabilities"] },
  { path: ["bridge", "inventory"], synopsis: "apn bridge inventory", summary: "Read anonymous LI.FI chains, tokens, tools and connections as provider inventory.",
    options: [], effect: { class: "network_read", summary: "Bounded public LI.FI inventory; it grants no execution authority." },
    approval: readApproval, output, states: done, recovery: [], examples: ["apn bridge inventory"] },
  { path: ["bridge", "routes"], synopsis: "apn bridge routes --profile <profile> --from-chain <caip2> --to-chain <caip2> --from-token <address> --to-token <address> --amount <decimal> --to <address> --min-output <decimal> --max-native-debit-wei <uint> --max-route-fee <decimal> --slippage-bps <uint>",
    summary: "Save bounded LI.FI alternatives for canonical USDC between Ethereum, Base and Arbitrum.",
    options: [profile, option("--from-chain", "string", ["eip155:1_or_eip155:8453_or_eip155:42161"]), option("--to-chain", "string", ["different_admitted_eip155_chain"]),
      option("--from-token", "address", ["canonical_source_USDC"]), option("--to-token", "address", ["canonical_destination_USDC"]),
      option("--amount", "string", ["positive_USDC_decimal_at_most_six_places"]), option("--to", "address", ["nonzero_recipient"]),
      option("--min-output", "string", ["positive_USDC_decimal_floor"]), option("--max-native-debit-wei", "wei", ["aggregate_source_native_debit_including_approval_and_messaging"]),
      option("--max-route-fee", "string", ["USDC_source_minus_minimum_output_cap"]), option("--slippage-bps", "string", ["integer_0_through_1000"])],
    effect: { class: "local_write", summary: "Reads LI.FI and the existing public local wallet binding; saves a profile-bound quote without signing." },
    approval: readApproval, output, states: done, recovery: [{ command_path: ["bridge", "prepare"], when: "Select one returned route ID with its quote hash." }],
    examples: ["apn bridge routes --profile default --from-chain eip155:1 --to-chain eip155:8453 --from-token <ethereum-usdc> --to-token <base-usdc> --amount 1 --to <recipient> --min-output 0.99 --max-native-debit-wei 1000000000000000 --max-route-fee 0.01 --slippage-bps 50"] },
  { path: ["bridge", "prepare"], synopsis: "apn bridge prepare --profile <profile> --quote <snapshot-hash> --route <route-id> --idempotency-key <key>",
    summary: "Materialize one selected route and freeze exact effects under shared money-operation locks.",
    options: [profile, option("--quote", "string", ["64_lowercase_hex_snapshot_hash"]), option("--route", "string", ["bounded_selected_route_id"]), option("--idempotency-key", "idempotency_key", ["global_all_payment_kinds"])],
    effect: { class: "payment_prepare", summary: "Materializes and independently verifies source and destination deployments, nonce, allowance and fees. Uses APN_ETHEREUM_RPC_URL, APN_BASE_RPC_URL and APN_ARBITRUM_RPC_URL for the selected pair." },
    approval: readApproval, output, states: bridgeStates, recovery: [{ command_path: ["bridge", "approve"], when: "After reviewing the exact intent before its expiry." }],
    examples: ["apn bridge prepare --profile default --quote <snapshot-hash> --route <route-id> --idempotency-key <key>"] },
  { path: ["bridge", "approve"], synopsis: "apn bridge approve --operation <operation-id>", summary: "Approve one exact bridge intent in a foreground terminal and attempt each frozen source effect once.",
    options: [operation], effect: { class: "payment_submit", summary: "May pay a separate approval fee and send the selected bridge. Recovered submissions are observed without resend. Uses the frozen pair's explicit APN_ETHEREUM_RPC_URL, APN_BASE_RPC_URL or APN_ARBITRUM_RPC_URL." },
    approval: { class: "foreground_tty", when: "Every new bridge operation; MCP returns the exact CLI handoff only." }, output, states: bridgeStates,
    recovery: [{ command_path: ["operation", "resume"], when: "Observe saved effects and destination delivery after an interruption; omit --wait-seconds." }, { command_path: ["receipt", "get"], when: "Read the combined source and destination evidence." }],
    examples: ["apn bridge approve --operation <operation-id>"] },
];
export function includeBridgeRecovery(commands: readonly CommandDefinition[]): readonly CommandDefinition[] {
  return commands.map((c) => !["operation resume", "operation status", "receipt get"].includes(c.path.join(" ")) ? c : {
    ...c, states: { terminal: [...new Set([...c.states.terminal, ...bridgeStates.terminal])], non_terminal: [...new Set([...c.states.non_terminal, ...bridgeStates.non_terminal])] },
    effect: { ...c.effect, summary: `${c.effect.summary} Bridge operations retain both chains' evidence; recovery never resends a submitted effect. Bridge RPCs use APN_ETHEREUM_RPC_URL, APN_BASE_RPC_URL and APN_ARBITRUM_RPC_URL.` },
  });
}
export function bindBridgeCommand(path: string, o: Readonly<Record<string, string>>): CommandRequest {
  if (path === "bridge capabilities") return { command: "bridge.capabilities", ...(o["--profile"] === undefined ? {} : { profile: o["--profile"] }) };
  if (path === "bridge inventory") return { command: "bridge.inventory" };
  if (path === "bridge prepare") return { command: "bridge.prepare", profile: o["--profile"]!, quote: bridgeHash(o["--quote"], "APN_INVALID_INPUT"),
    route: bridgeOpaque(o["--route"], "APN_INVALID_INPUT"), idempotencyKey: o["--idempotency-key"]! };
  if (path === "bridge approve") return { command: "bridge.approve", operationId: o["--operation"]! };
  const slippage = bridgeUint(o["--slippage-bps"], false, "APN_INVALID_INPUT");
  const request = validateBridgeRequest({ fromChainId: bridgeCaip2(o["--from-chain"]), toChainId: bridgeCaip2(o["--to-chain"]),
    fromToken: bridgeAddress(o["--from-token"], "APN_INVALID_INPUT"), toToken: bridgeAddress(o["--to-token"], "APN_INVALID_INPUT"),
    amountAtomic: bridgeDecimal(o["--amount"], true), recipient: bridgeAddress(o["--to"], "APN_INVALID_INPUT"),
    minOutputAtomic: bridgeDecimal(o["--min-output"], true), maxNativeDebitWei: bridgeUint(o["--max-native-debit-wei"], true, "APN_INVALID_INPUT").toString(),
    maxRouteFeeAtomic: bridgeDecimal(o["--max-route-fee"]), slippageBps: slippage > 1000n ? -1 : Number(slippage) });
  return { command: "bridge.routes", profile: o["--profile"]!, request };
}
