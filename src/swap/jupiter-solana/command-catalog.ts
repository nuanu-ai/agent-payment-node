import type { CommandDefinition, CommandGroup, CommandOption } from "../../command-catalog.js";
import type { CommandRequest } from "../../commands.js";
import { exactKeys, isPlainRecord } from "../../canonical.js";
import { ApnError } from "../../errors.js";
import { solanaAddress } from "../../solana/rpc.js";

const option = (name: CommandOption["name"], type: CommandOption["type"], constraints: readonly string[]): CommandOption =>
  ({ name, type, constraints, required: true, default: { kind: "none" }, sensitivity: "operator_input" });
const output = { contract: "apn.cli.v1", success_exit: 0, failure_exit: 1,
  success: "Frozen Jupiter inventory, unsigned read-only quote, or durable status.",
  failures: ["Classified refusal; no signing, broadcast, approval, or provider fallback."] } as const;
const states = { terminal: ["finalized", "failed_before_effect"], non_terminal: ["quoted", "prepared", "awaiting_approval",
  "reserved", "submitting", "submitted", "unknown_finality"] } as const;
const profile = option("--profile", "profile", ["existing_profile_name"]);
const account = option("--account", "string", ["canonical_32_byte_base58_solana_address"]);
const operation = option("--operation", "operation_id", ["64_lowercase_hex_characters"]);

export const JUPITER_COMMAND_GROUPS: readonly CommandGroup[] = [
  { path: ["swap", "solana"], summary: "Solana guarded swaps.", kind: "group" },
  { path: ["swap", "solana", "jupiter"], summary: "Pinned Jupiter V2 native SOL to USDC exact input.", kind: "group" },
];

export const JUPITER_COMMANDS: readonly CommandDefinition[] = [
  command("inventory", [], "Read the immutable Jupiter identities without admitting them.", "none"),
  command("quote", [profile, account, option("--to", "string", ["canonical_32_byte_base58_solana_recipient"]),
    option("--amount", "wei", ["positive_native_lamports"]), option("--slippage-bps", "string", ["integer_0_through_owner_cap"]),
    option("--owner-slippage-cap-bps", "string", ["integer_0_through_10000"])],
    "Request one unsigned quote through an explicitly injected read-only builder.", "network_read"),
  command("prepare", [profile, option("--quote", "string", ["64_lowercase_hex_quote_hash"]),
    option("--idempotency-key", "idempotency_key", ["global_payment_key"])],
    "Prepare only after separate owner admission of both assets and the exact mechanism.", "payment_prepare"),
  command("status", [operation], "Read one durable guarded swap operation without resending.", "local_read"),
  command("approve", [operation], "Approval is blocked because the Jupiter V6 instruction ABI is unverified.", "none"),
  command("execute", [operation], "Execution is blocked because the Jupiter V6 instruction ABI is unverified.", "none"),
];

function command(name: string, options: readonly CommandOption[], summary: string,
  effect: CommandDefinition["effect"]["class"]): CommandDefinition {
  const suffix = options.map((row) => ` ${row.name} <${row.type}>`).join("");
  return { path: ["swap", "solana", "jupiter", name], synopsis: `apn swap solana jupiter ${name}${suffix}`, summary, options,
    effect: { class: effect, summary }, approval: { class: "none", when: "Never signs or broadcasts." }, output, states,
    recovery: [], examples: [`apn swap solana jupiter ${name}`] };
}

export function bindJupiterCommand(path: string, options: Readonly<Record<string, string>>): CommandRequest {
  const action = path.slice("swap solana jupiter ".length);
  if (!isPlainRecord(options)) invalid("Jupiter options must be a plain object.");
  if (action === "inventory") { exact(options, []); return { command: "swap.jupiter.inventory" }; }
  if (action === "status" || action === "approve" || action === "execute") {
    exact(options, ["--operation"]); return { command: `swap.jupiter.${action}`, operationId: hash(options["--operation"]) };
  }
  if (action === "prepare") {
    exact(options, ["--profile", "--quote", "--idempotency-key"]);
    return { command: "swap.jupiter.prepare", profile: options["--profile"]!, quoteHash: hash(options["--quote"]),
      idempotencyKey: options["--idempotency-key"]! };
  }
  if (action === "quote") {
    exact(options, ["--profile", "--account", "--to", "--amount", "--slippage-bps", "--owner-slippage-cap-bps"]);
    const slippageBps = basisPoints(options["--slippage-bps"]), ownerSlippageCapBps = basisPoints(options["--owner-slippage-cap-bps"]);
    if (slippageBps > ownerSlippageCapBps) invalid("Jupiter slippage exceeds the owner cap.");
    return { command: "swap.jupiter.quote", profile: options["--profile"]!, account: solanaAddress(options["--account"]!),
      recipient: solanaAddress(options["--to"]!), amountAtomic: positiveAtomic(options["--amount"]), slippageBps, ownerSlippageCapBps };
  }
  return invalid("Unsupported Jupiter action.");
}

function exact(value: Record<string, unknown>, keys: readonly string[]): void {
  if (!exactKeys(value, keys)) invalid("Jupiter options contain an unknown or missing field.");
}
function basisPoints(value: string | undefined): number {
  if (value === undefined || !/^(?:0|[1-9][0-9]{0,4})$/u.test(value)) invalid("Jupiter basis points must be canonical.");
  const parsed = Number(value); if (!Number.isSafeInteger(parsed) || parsed > 10_000) invalid("Jupiter basis points exceed 10000."); return parsed;
}
function positiveAtomic(value: string | undefined): string {
  if (value === undefined || !/^[1-9][0-9]{0,77}$/u.test(value)) invalid("Jupiter amount must be a positive canonical uint256."); return value;
}
function hash(value: string | undefined): string {
  if (value === undefined || !/^[a-f0-9]{64}$/u.test(value)) invalid("Jupiter hash must be 64 lowercase hexadecimal characters."); return value;
}
function invalid(message: string): never { throw new ApnError("APN_INVALID_INPUT", message); }
