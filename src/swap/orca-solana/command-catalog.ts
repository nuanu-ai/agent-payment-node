import type { CommandDefinition, CommandGroup, CommandOption } from "../../command-catalog.js";
import type { CommandRequest } from "../../commands.js";
import { exactKeys, isPlainRecord } from "../../canonical.js";
import { ApnError } from "../../errors.js";
import { solanaAddress } from "../../solana/rpc.js";
import { slippageAboveCap } from "../slippage-refusal.js";

const option = (name: CommandOption["name"], type: CommandOption["type"], constraints: readonly string[]): CommandOption =>
  ({ name, type, constraints, required: true, default: { kind: "none" }, sensitivity: "operator_input" });
const output = { contract: "apn.cli.v1", success_exit: 0, failure_exit: 1,
  success: "Pinned Orca inventory, unsigned quote, prepared operation, one-shot execution or durable status.",
  failures: ["Classified refusal; no provider fallback or automatic resend."] } as const;
const states = { terminal: ["finalized", "failed_before_effect", "failed_confirmed_revert"], non_terminal: ["quoted", "prepared", "awaiting_approval",
  "reserved", "submitting", "submitted", "unknown_finality"] } as const;
const profile = option("--profile", "profile", ["existing_profile_name"]);
const operation = option("--operation", "operation_id", ["64_lowercase_hex_characters"]);

export const ORCA_COMMAND_GROUPS: readonly CommandGroup[] = [
  { path: ["swap", "solana", "orca"], summary: "Keyless Orca Whirlpool native SOL to USDC exact input against the pinned SOL/USDC pool.", kind: "group" },
];

export const ORCA_COMMANDS: readonly CommandDefinition[] = [
  command("stable-inventory", [], "Read the pinned USDC/USDT Whirlpool identity without admission or signing.", "none"),
  command("stable-quote", [option("--amount", "atomic_usdc", ["positive_usdc_atomic"]),
    option("--slippage-bps", "string", ["integer_0_through_9999"]),
    option("--maximum-price-impact-bps", "string", ["integer_0_through_10000"])],
    "Read a guarded exact-input USDC to USDT quote from one Whirlpool snapshot. No transaction is built.", "network_read"),
  command("stable-prepare", [profile, option("--policy-revision", "string", ["positive_active_revision"]),
    option("--owner", "string", ["canonical_32_byte_base58_solana_address"]),
    option("--amount", "atomic_usdc", ["positive_usdc_atomic"]), option("--slippage-bps", "string", ["integer_0_through_9999"]),
    option("--maximum-price-impact-bps", "string", ["integer_0_through_10000"]),
    option("--compute-unit-limit", "string", ["integer_1_through_1400000"]),
    option("--compute-unit-price", "string", ["micro_lamports_per_compute_unit"]),
    option("--create-usdt-ata", "string", ["true_or_false"]), option("--maximum-ata-rent", "string", ["atomic_lamports_or_zero"]),
    option("--maximum-total-fee", "string", ["positive_lamports"]), option("--idempotency-key", "idempotency_key", ["global_payment_key"])],
    "Simulate the exact unsigned stable transaction and persist owner-bound prepared material. Never signs or broadcasts.", "payment_prepare"),
  command("stable-status", [operation], "Read a stable operation and reconcile an expired unsigned principal lease. Never signs or broadcasts.", "local_write"),
  command("stable-approve", [operation], "Confirm the exact stable swap in the foreground and reserve USDC principal only. Never signs or broadcasts.", "payment_prepare",
    { class: "foreground_tty", when: "Each stable principal reservation requires exact foreground consent." }),
  command("stable-execute", [operation], "Confirm a reserved stable swap separately, refresh preflight, sign once and make at most one send attempt.", "payment_submit",
    { class: "foreground_tty", when: "Every stable execution requires separate exact foreground consent; MCP returns the CLI handoff only." }),
  command("stable-release", [operation], "Retire an unsigned stable preparation and release its exact principal reservation. Never signs or broadcasts.", "local_write"),
  command("stable-observe", [operation], "Read a claimed stable signature; durably record possible send, finalized proof and principal lease outcome. Never signs or sends.", "local_write"),
  command("inventory", [], "Read the pinned Whirlpool program, pool and keyless mechanism pin without admitting them.", "none"),
  command("quote", [profile, option("--account", "string", ["canonical_32_byte_base58_solana_address_of_the_profile"]),
    option("--amount", "wei", ["positive_native_lamports"]), option("--slippage-bps", "string", ["integer_0_through_owner_cap"]),
    option("--owner-slippage-cap-bps", "string", ["integer_0_through_10000"]),
    option("--compute-unit-limit", "string", ["integer_1_through_1400000"]),
    option("--compute-unit-price", "string", ["micro_lamports_per_compute_unit"])],
    "Quote from the pinned pool's on-chain state, build the instructions locally, and simulate the exact unsigned transaction. Uses APN_SOLANA_RPC_URL.",
    "network_read"),
  command("prepare", [profile, option("--quote", "string", ["64_lowercase_hex_quote_hash"]), option("--idempotency-key", "idempotency_key", ["global_payment_key"])],
    "Prepare only after separate owner admission of SOL and USDC with the exact keyless mechanism.", "payment_prepare"),
  command("status", [operation], "Read one durable guarded swap operation and observe its exact signature without resending.", "local_read"),
  command("approve", [operation], "Show the exact swap screen, take the typed approval code, re-simulate with a fresh blockhash, sign locally and send once.",
    "payment_submit", { class: "foreground_tty", when: "Every guarded swap; MCP returns the exact CLI handoff only." }),
  command("execute", [operation], "Continue an approved reservation with its single send, or observe an already marked swap without resending.",
    "payment_submit", { class: "foreground_tty", when: "Only an unexpired stored foreground approval; MCP returns the exact CLI handoff only." }),
];

function command(name: string, options: readonly CommandOption[], summary: string, effect: CommandDefinition["effect"]["class"],
  approval: CommandDefinition["approval"] = { class: "none", when: "Never signs or broadcasts." }): CommandDefinition {
  const suffix = options.map((row) => ` ${row.name} <${row.type}>`).join("");
  return { path: ["swap", "solana", "orca", name], synopsis: `apn swap solana orca ${name}${suffix}`, summary, options,
    effect: { class: effect, summary }, approval, output, states, recovery: [], examples: [`apn swap solana orca ${name}`] };
}

export function bindOrcaCommand(path: string, options: Readonly<Record<string, string>>): CommandRequest {
  const action = path.slice("swap solana orca ".length);
  if (!isPlainRecord(options)) invalid("Orca options must be a plain object.");
  if (action === "inventory") { exact(options, []); return { command: "swap.orca.inventory" }; }
  if (action === "stable-inventory") { exact(options, []); return { command: "swap.orca.stable-inventory" }; }
  if (action === "stable-quote") {
    exact(options, ["--amount", "--slippage-bps", "--maximum-price-impact-bps"]);
    const amount = options["--amount"];
    if (amount === undefined || !/^[1-9][0-9]{0,19}$/u.test(amount)) invalid("Stable Orca amount must be positive canonical USDC atomic units.");
    return { command: "swap.orca.stable-quote", amountAtomic: amount, slippageBps: integer(options["--slippage-bps"], 9_999),
      maximumPriceImpactBps: integer(options["--maximum-price-impact-bps"], 10_000) };
  }
  if (action === "stable-prepare") {
    exact(options, ["--profile", "--policy-revision", "--owner", "--amount", "--slippage-bps", "--maximum-price-impact-bps",
      "--compute-unit-limit", "--compute-unit-price", "--create-usdt-ata", "--maximum-ata-rent", "--maximum-total-fee", "--idempotency-key"]);
    const amount = options["--amount"], price = options["--compute-unit-price"], rent = options["--maximum-ata-rent"], fee = options["--maximum-total-fee"];
    if (amount === undefined || !/^[1-9][0-9]{0,19}$/u.test(amount) ||
        price === undefined || !/^(?:0|[1-9][0-9]{0,19})$/u.test(price) ||
        rent === undefined || !/^(?:0|[1-9][0-9]{0,19})$/u.test(rent) ||
        fee === undefined || !/^[1-9][0-9]{0,19}$/u.test(fee) ||
        !["true", "false"].includes(options["--create-usdt-ata"] ?? "")) invalid("Stable prepare amount, fee, rent or ATA option is invalid.");
    const createUsdtAta = options["--create-usdt-ata"] === "true";
    if (createUsdtAta ? rent === "0" : rent !== "0") invalid("Stable ATA rent cap must match the requested creation mode.");
    const slippageBps = integer(options["--slippage-bps"], 9_999), maximumPriceImpactBps = integer(options["--maximum-price-impact-bps"], 10_000);
    if (slippageBps > maximumPriceImpactBps) invalid("Stable slippage exceeds the price impact cap.");
    return { command: "swap.orca.stable-prepare", profile: options["--profile"]!, policyRevision: positiveInteger(options["--policy-revision"]),
      owner: canonicalAccount(options["--owner"]), amountAtomic: amount, slippageBps, maximumPriceImpactBps,
      computeUnitLimit: positiveInteger(options["--compute-unit-limit"], 1_400_000), computeUnitPriceMicroLamports: price,
      createUsdtAta, ...(createUsdtAta ? { maximumAtaRentLamports: rent } : {}), maximumTotalFeeLamports: fee,
      idempotencyKey: options["--idempotency-key"]! };
  }
  if (action === "stable-status" || action === "stable-approve" || action === "stable-execute" || action === "stable-release" || action === "stable-observe") { exact(options, ["--operation"]); return { command: `swap.orca.${action}`, operationId: hash(options["--operation"]) }; }
  if (action === "status" || action === "approve" || action === "execute") {
    exact(options, ["--operation"]); return { command: `swap.orca.${action}`, operationId: hash(options["--operation"]) };
  }
  if (action === "prepare") {
    exact(options, ["--profile", "--quote", "--idempotency-key"]);
    return { command: "swap.orca.prepare", profile: options["--profile"]!, quoteHash: hash(options["--quote"]), idempotencyKey: options["--idempotency-key"]! };
  }
  if (action !== "quote") invalid("Unsupported Orca action.");
  exact(options, ["--profile", "--account", "--amount", "--slippage-bps", "--owner-slippage-cap-bps", "--compute-unit-limit", "--compute-unit-price"]);
  const slippageBps = integer(options["--slippage-bps"], 10_000), ownerSlippageCapBps = integer(options["--owner-slippage-cap-bps"], 10_000);
  if (slippageBps > ownerSlippageCapBps) slippageAboveCap("Orca", slippageBps, ownerSlippageCapBps);
  const amount = options["--amount"], price = options["--compute-unit-price"];
  if (amount === undefined || !/^[1-9][0-9]{0,19}$/u.test(amount)) invalid("Orca amount must be positive canonical lamports.");
  if (price === undefined || !/^(?:0|[1-9][0-9]{0,15})$/u.test(price)) invalid("Orca compute unit price must be canonical micro-lamports.");
  return { command: "swap.orca.quote", profile: options["--profile"]!, account: canonicalAccount(options["--account"]), amountAtomic: amount,
    slippageBps, ownerSlippageCapBps, computeUnitLimit: integer(options["--compute-unit-limit"], 1_400_000), computeUnitPriceMicroLamports: price };
}

function exact(value: Record<string, unknown>, keys: readonly string[]): void {
  if (!exactKeys(value, keys)) invalid("Orca options contain an unknown or missing field.");
}
function integer(value: string | undefined, maximum: number): number {
  if (value === undefined || !/^(?:0|[1-9][0-9]{0,6})$/u.test(value) || Number(value) > maximum) invalid("Orca integer option is not canonical or exceeds its bound.");
  return Number(value);
}
function positiveInteger(value: string | undefined, maximum = Number.MAX_SAFE_INTEGER): number {
  if (value === undefined || !/^[1-9][0-9]{0,15}$/u.test(value) || Number(value) > maximum || !Number.isSafeInteger(Number(value)))
    invalid("Orca positive integer option is invalid.");
  return Number(value);
}
function canonicalAccount(value: string | undefined): string {
  if (value === undefined) invalid("Orca account is required.");
  return solanaAddress(value);
}
function hash(value: string | undefined): string {
  if (value === undefined || !/^[a-f0-9]{64}$/u.test(value)) invalid("Orca hash must be 64 lowercase hexadecimal characters.");
  return value;
}
function invalid(message: string): never { throw new ApnError("APN_INVALID_INPUT", message); }
