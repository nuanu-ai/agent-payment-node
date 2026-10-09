import type { CommandDefinition, CommandGroup, CommandOption } from "../command-catalog.js";
import type { CommandRequest } from "../commands.js";
import { exactKeys, isPlainRecord } from "../canonical.js";
import { ApnError } from "../errors.js";
import type { CircleDestinationChain } from "./catalog.js";
const option = (name: CommandOption["name"], type: CommandOption["type"], constraints: readonly string[]): CommandOption => ({ name, type, required: true,
  default: { kind: "none" }, constraints, sensitivity: "operator_input" });
const operation = option("--operation", "operation_id", ["64_lowercase_hex_characters"]);
export const CIRCLE_EVM_GROUPS: readonly CommandGroup[] = [{ path: ["circle", "evm"], summary: "Finite CCTP V2 Fast Arbitrum USDC to Sei, Linea or Monad, with separate destination gas consent.", kind: "group" }];
export const CIRCLE_EVM_COMMANDS: readonly CommandDefinition[] = [
  command("prepare", [option("--profile", "profile", ["evm-live-buyer"]), option("--destination-profile", "profile", ["explicit_owned_gas_profile"]),
    option("--destination-chain", "string", ["1329_or_59144_or_143"]), option("--idempotency-key", "idempotency_key", ["global_payment_key"])], "Freeze exact 40100 USDC Fast burn with max fee 100, minimum mint 40000 and both owner policy holds.", "payment_prepare"),
  command("approve-source", [operation], "Foreground-confirm, sign and send exact bounded approval and burn at most once.", "payment_submit"),
  command("approve-mint", [operation], "Foreground-confirm the destination gas owner and mint the issuer-verified same burn nonce once.", "payment_submit"),
  command("observe", [operation], "Observe canonical source, issuer signature, destination mint and independent finality without signing or resending.", "network_read"),
  command("refresh-attestation", [operation], "Read-only issuer refresh for the same burn and nonce before mint; never reburn.", "network_read"),
  command("cleanup", [operation], "Explicit foreground approve-zero cleanup after confirmed approval/revert, or cancellation before private entry.", "payment_submit"),
  command("cleanup-nonce", [operation], "Foreground-confirm one exact approve-zero for an expired unknown Monad approval or the retained Sei sealed burn nonce; finalized canonical retirement proof closes unused holds.", "payment_submit"),
  command("status", [operation], "Read the checked durable local Circle operation with both signing profiles.", "local_read"),
];
function command(action: string, options: readonly CommandOption[], summary: string, effect: CommandDefinition["effect"]["class"]): CommandDefinition {
  const foreground = effect === "payment_submit";
  return { path: ["circle", "evm", action], synopsis: `apn circle evm ${action}${options.map(o => ` ${o.name} <${o.type}>`).join("")}`, summary, options,
    effect: { class: effect, summary }, approval: { class: foreground ? "foreground_tty" : "none", when: foreground ? "Exact physical foreground TTY consent before signing; MCP provides the CLI handoff." : "No financial effect." },
    output: { contract: "apn.cli.v1", success_exit: 0, failure_exit: 1, success: "Checked Circle operation, receipts and usage state.", failures: ["Classified refusal; ambiguous effects hold all reservations and are never resent."] },
    states: { terminal: ["completed", "cleaned", "cancelled_unsubmitted", "nonce_retired"], non_terminal: ["awaiting_source", "source_unknown", "awaiting_mint", "mint_unknown", "awaiting_finality", "cleanup_required"] },
    recovery: [{ command_path: ["circle", "evm", "observe"], when: "Any prior effect marker exists." }], examples: [`apn circle evm ${action}`] };
}
export function bindCircleEvmCommand(path: string, input: Readonly<Record<string, string>>): CommandRequest {
  const action = path.slice("circle evm ".length);
  if (!isPlainRecord(input)) invalid();
  if (action === "prepare") {
    if (!exactKeys(input, ["--profile", "--destination-profile", "--destination-chain", "--idempotency-key"])) invalid();
    const chain = input["--destination-chain"]; if (chain !== "1329" && chain !== "59144" && chain !== "143") invalid();
    return { command: "circle.evm.prepare", profile: input["--profile"]!, destinationProfile: input["--destination-profile"]!, destinationChain: Number(chain) as CircleDestinationChain, idempotencyKey: input["--idempotency-key"]! };
  }
  if (!["approve-source", "approve-mint", "observe", "refresh-attestation", "cleanup", "cleanup-nonce", "status"].includes(action) || !exactKeys(input, ["--operation"]) || !/^[a-f0-9]{64}$/u.test(input["--operation"]!)) invalid();
  return { command: `circle.evm.${action}` as "circle.evm.approve-source", operationId: input["--operation"]! };
}
function invalid(): never { throw new ApnError("APN_INVALID_INPUT", "Circle EVM options are invalid."); }
