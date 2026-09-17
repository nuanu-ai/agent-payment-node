import type { CommandDefinition, CommandGroup, CommandOption } from "../../command-catalog.js";
import type { CommandRequest } from "../../commands.js";
import { exactKeys, isPlainRecord } from "../../canonical.js";
import { ApnError } from "../../errors.js";
import { tronAddress } from "../../tron/codec.js";

const option = (name: CommandOption["name"], type: CommandOption["type"], constraints: readonly string[]): CommandOption =>
  ({ name, type, constraints, required: true, default: { kind: "none" }, sensitivity: "operator_input" });
const output = { contract: "apn.cli.v1", success_exit: 0, failure_exit: 1,
  success: "Frozen SunSwap inventory, unsigned read-only quote, or durable status.",
  failures: ["Classified refusal; no signing, broadcast, approval, or provider fallback."] } as const;
const states = { terminal: ["finalized", "failed_before_effect"], non_terminal: ["quoted", "prepared", "awaiting_approval",
  "reserved", "submitting", "submitted", "unknown_finality"] } as const;
const profile = option("--profile", "profile", ["existing_profile_name"]);
const account = option("--account", "string", ["canonical_tron_base58check_address"]);
const operation = option("--operation", "operation_id", ["64_lowercase_hex_characters"]);

export const SUNSWAP_COMMAND_GROUPS: readonly CommandGroup[] = [
  { path: ["swap", "tron"], summary: "TRON guarded swaps.", kind: "group" },
  { path: ["swap", "tron", "sunswap"], summary: "Pinned SunSwap native TRX to USDT exact input.", kind: "group" },
];

export const SUNSWAP_COMMANDS: readonly CommandDefinition[] = [
  command("inventory", [], "Read the immutable SunSwap pin catalog without admitting it.", "none"),
  command("quote", [profile, account, option("--to", "string", ["canonical_tron_base58check_recipient"]),
    option("--amount", "wei", ["positive_native_sun"]), option("--slippage-bps", "string", ["integer_0_through_owner_cap"]),
    option("--owner-slippage-cap-bps", "string", ["integer_0_through_10000"])],
    "Request one unsigned quote through an explicitly injected read-only builder.", "network_read"),
  command("prepare", [profile, option("--quote", "string", ["64_lowercase_hex_quote_hash"]),
    option("--idempotency-key", "idempotency_key", ["global_payment_key"])],
    "Prepare only after separate owner admission of both assets and the exact mechanism.", "payment_prepare"),
  command("status", [operation], "Read one durable guarded swap operation without resending.", "local_read"),
  command("approve", [operation], "Native TRX has no token approval operation.", "none"),
  command("execute", [operation], "Execution remains dormant without a signer, sender, and observer.", "none"),
];

function command(name: string, options: readonly CommandOption[], summary: string,
  effect: CommandDefinition["effect"]["class"]): CommandDefinition {
  const suffix = options.map((row) => ` ${row.name} <${row.type}>`).join("");
  return { path: ["swap", "tron", "sunswap", name], synopsis: `apn swap tron sunswap ${name}${suffix}`, summary, options,
    effect: { class: effect, summary }, approval: { class: "none", when: "Never signs or broadcasts." }, output, states,
    recovery: [], examples: [`apn swap tron sunswap ${name}`] };
}

export function bindSunSwapCommand(path: string, options: Readonly<Record<string, string>>): CommandRequest {
  const action = path.slice("swap tron sunswap ".length);
  if (!isPlainRecord(options)) invalid("SunSwap options must be a plain object.");
  if (action === "inventory") { exact(options, []); return { command: "swap.sunswap.inventory" }; }
  if (action === "status" || action === "approve" || action === "execute") {
    exact(options, ["--operation"]); return { command: `swap.sunswap.${action}`, operationId: hash(options["--operation"]) };
  }
  if (action === "prepare") {
    exact(options, ["--profile", "--quote", "--idempotency-key"]);
    return { command: "swap.sunswap.prepare", profile: options["--profile"]!, quoteHash: hash(options["--quote"]),
      idempotencyKey: options["--idempotency-key"]! };
  }
  if (action === "quote") {
    exact(options, ["--profile", "--account", "--to", "--amount", "--slippage-bps", "--owner-slippage-cap-bps"]);
    const slippageBps = basisPoints(options["--slippage-bps"]), ownerSlippageCapBps = basisPoints(options["--owner-slippage-cap-bps"]);
    if (slippageBps > ownerSlippageCapBps) invalid("SunSwap slippage exceeds the owner cap.");
    return { command: "swap.sunswap.quote", profile: options["--profile"]!, account: tronAddress(options["--account"]!),
      recipient: tronAddress(options["--to"]!), amountAtomic: positiveAtomic(options["--amount"]), slippageBps, ownerSlippageCapBps };
  }
  return invalid("Unsupported SunSwap action.");
}

function exact(value: Record<string, unknown>, keys: readonly string[]): void {
  if (!exactKeys(value, keys)) invalid("SunSwap options contain an unknown or missing field.");
}
function basisPoints(value: string | undefined): number {
  if (value === undefined || !/^(?:0|[1-9][0-9]{0,4})$/u.test(value)) invalid("SunSwap basis points must be canonical.");
  const parsed = Number(value); if (!Number.isSafeInteger(parsed) || parsed > 10_000) invalid("SunSwap basis points exceed 10000."); return parsed;
}
function positiveAtomic(value: string | undefined): string {
  if (value === undefined || !/^[1-9][0-9]{0,77}$/u.test(value)) invalid("SunSwap amount must be a positive canonical uint256."); return value;
}
function hash(value: string | undefined): string {
  if (value === undefined || !/^[a-f0-9]{64}$/u.test(value)) invalid("SunSwap hash must be 64 lowercase hexadecimal characters."); return value;
}
function invalid(message: string): never { throw new ApnError("APN_INVALID_INPUT", message); }
