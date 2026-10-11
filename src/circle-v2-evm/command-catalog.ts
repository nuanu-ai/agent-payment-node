import { deriveCircleFundingParameters } from "./funding-binding.js";
import type { CommandDefinition, CommandGroup, CommandOption } from "../command-catalog.js";
import type { CommandRequest } from "../commands.js";
import { exactKeys, isPlainRecord } from "../canonical.js";
import { ApnError } from "../errors.js";
import type { CircleDestinationChain } from "./catalog.js";
const option = (name: CommandOption["name"], type: CommandOption["type"], constraints: readonly string[], required = true): CommandOption => ({ name, type, required,
  default: { kind: "none" }, constraints, sensitivity: "operator_input" });
const operation = option("--operation", "operation_id", ["64_lowercase_hex_characters"]);
export const CIRCLE_EVM_GROUPS: readonly CommandGroup[] = [{ path: ["circle", "evm"], summary: "Finite CCTP V2 Fast Arbitrum USDC to Sei, Linea or Monad, with separate destination gas consent.", kind: "group" }];
export const CIRCLE_EVM_COMMANDS: readonly CommandDefinition[] = [
  command("prepare", [option("--profile", "profile", ["evm-live-buyer"]), option("--destination-profile", "profile", ["explicit_owned_gas_profile"]),
    option("--destination-chain", "string", ["1329_or_59144_or_143"]), option("--idempotency-key", "idempotency_key", ["global_payment_key"]),
    option("--beneficiary", "address", ["canonical_nonzero_address", "all_four_funding_options_or_none"], false),
    option("--gross-atomic", "atomic_usdc", ["positive_uint256", "all_four_funding_options_or_none"], false),
    option("--max-issuer-fee-atomic", "atomic_usdc", ["positive_less_than_gross", "all_four_funding_options_or_none"], false),
    option("--min-mint-atomic", "atomic_usdc", ["positive_at_most_gross_minus_max_fee", "all_four_funding_options_or_none"], false)], "Freeze V1 fixed 40100/100/40000 intent when all funding options are absent; all four explicit options select finite V2 funding with exact circle-cctp-v2 / circle-v2-evm-fast-42161-<destination>.v2 policy admission.", "payment_prepare"),
  command("approve-source", [operation], "Foreground-confirm, sign and send exact bounded approval and burn at most once.", "payment_submit"),
  command("adopt-external-mint", [operation, option("--transaction-hash", "string", ["0x_64_lowercase_hex_characters"])], "Verify one explicit third-party mint and close unused holds without signing or sending.", "recovery"),
  command("approve-mint", [operation], "Foreground-confirm the destination gas owner and mint the issuer-verified same burn nonce once.", "payment_submit"),
  command("observe", [operation], "Observe canonical source, issuer signature, destination mint and independent finality without signing or resending.", "network_read"),
  command("refresh-attestation", [operation], "Read-only issuer refresh for the same burn and nonce before mint; never reburn.", "network_read"),
  command("cleanup", [operation], "Explicit foreground approve-zero cleanup after confirmed approval/revert, or cancellation before private entry.", "payment_submit"),
  command("cleanup-nonce", [operation], "Foreground-confirm one exact approve-zero for an expired unknown Monad approval or the retained Sei sealed burn nonce; finalized canonical retirement proof closes unused holds.", "payment_submit"),
  command("cleanup85-prepare", [operation], "Prepare the finite retained cleanup85 recovery frame without signing or sending.", "payment_prepare"),
  command("cleanup85-cancel", [operation], "Foreground-confirm one distinct native1wei cancellation85; the verified native backend is required.", "payment_submit"),
  command("cleanup86-approve", [operation], "After canonical FINALIZED cancellation85, foreground-confirm one zero approval86; only strictly unsigned v3 orphan or prepared generation1 may capture the finite next generation.", "payment_submit"),
  command("status", [operation], "Read the checked durable local Circle operation with both signing profiles.", "local_read"),
];
function command(action: string, options: readonly CommandOption[], summary: string, effect: CommandDefinition["effect"]["class"]): CommandDefinition {
  const foreground = effect === "payment_submit";
  return { path: ["circle", "evm", action], synopsis: `apn circle evm ${action}${options.map(o => o.required ? ` ${o.name} <${o.type}>` : ` [${o.name} <${o.type}>]`).join("")}`, summary, options,
    effect: { class: effect, summary }, approval: { class: foreground ? "foreground_tty" : "none", when: foreground ? "Exact physical foreground TTY consent before signing; MCP provides the CLI handoff." : "No financial effect." },
    output: { contract: "apn.cli.v1", success_exit: 0, failure_exit: 1, success: "Checked Circle operation, receipts and usage state.", failures: ["Classified refusal; ambiguous effects hold all reservations and are never resent."] },
    states: { terminal: ["completed", "cleaned", "cancelled_unsubmitted", "nonce_retired", "external_fulfilled"], non_terminal: ["awaiting_source", "source_unknown", "awaiting_mint", "mint_unknown", "awaiting_finality", "cleanup_required"] },
    recovery: [{ command_path: ["circle", "evm", "observe"], when: "Any prior effect marker exists." }], examples: [`apn circle evm ${action}`] };
}
export function bindCircleEvmCommand(path: string, input: Readonly<Record<string, string>>): CommandRequest {
  const action = path.slice("circle evm ".length);
  if (!isPlainRecord(input)) invalid();
  if (["cleanup85-prepare", "cleanup85-cancel", "cleanup86-approve"].includes(action) && input["--operation"] !== "4ee24e4501478193bd84aa89463eb673d539db23cbb7cdbf56f8fe197d792a33") invalid();
  if (action === "adopt-external-mint") { if (!exactKeys(input, ["--operation", "--transaction-hash"]) || !/^[a-f0-9]{64}$/u.test(input["--operation"]!) || !/^0x[a-f0-9]{64}$/u.test(input["--transaction-hash"]!)) invalid(); return {command:"circle.evm.adopt-external-mint",operationId:input["--operation"]!,transactionHash:input["--transaction-hash"]! as `0x${string}`}; }
  if (action === "prepare") {
    const base = ["--profile", "--destination-profile", "--destination-chain", "--idempotency-key"], fields = ["--beneficiary", "--gross-atomic", "--max-issuer-fee-atomic", "--min-mint-atomic"];
    if (!exactKeys(input, base) && !exactKeys(input, [...base, ...fields])) invalid();
    const funding = deriveCircleFundingParameters(Object.fromEntries(fields.filter(k => input[k] !== undefined).map((k, i) => [["recipient", "amountAtomic", "maxFeeAtomic", "minMintAtomic"][i]!, input[k]])));
    const chain = input["--destination-chain"]; if (chain !== "1329" && chain !== "59144" && chain !== "143") invalid();
    return { command: "circle.evm.prepare", profile: input["--profile"]!, destinationProfile: input["--destination-profile"]!, destinationChain: Number(chain) as CircleDestinationChain, idempotencyKey: input["--idempotency-key"]!, ...(funding === null ? {} : { funding }) };
  }
  if (!["approve-source", "approve-mint", "observe", "refresh-attestation", "cleanup", "cleanup-nonce", "cleanup85-prepare", "cleanup85-cancel", "cleanup86-approve", "status"].includes(action) || !exactKeys(input, ["--operation"]) || !/^[a-f0-9]{64}$/u.test(input["--operation"]!)) invalid();
  return { command: `circle.evm.${action}` as "circle.evm.approve-source", operationId: input["--operation"]! };
}
function invalid(): never { throw new ApnError("APN_INVALID_INPUT", "Circle EVM options are invalid."); }
