import { command, option } from "../command-catalog-builders.js";
import type { CommandDefinition, CommandGroup } from "../command-catalog-types.js";
import type { CommandRequest } from "../commands.js";
import { ApnError } from "../errors.js";
import { solanaAddress } from "../solana/rpc.js";

const noDefault = { kind: "none" } as const;
const operation = option("--operation", "operation_id", true, noDefault, ["64_lowercase_hex_characters"], "public");
const states = { terminal: ["settled", "failed_onchain", "expired_unlanded", "failed_before_effect", "abandoned_unknown"],
  non_terminal: ["prepared", "reserving", "signed", "exposed"] };
const rpc = "Chain reads use the explicit APN_SOLANA_RPC_URL; without it the command is refused, naming that setting.";

export const X402_SOLANA_COMMAND_GROUPS: readonly CommandGroup[] = [
  { path: ["x402", "solana"], summary: "x402 exact on Solana mainnet: pay one owner-admitted SPL mint with the seller's facilitator as fee payer.", kind: "group" },
];

export const X402_SOLANA_COMMANDS: readonly CommandDefinition[] = [
  command(["x402", "solana", "pay"], "apn x402 solana pay --profile <profile> --url <https-url> --asset <mint> --max-amount <atomic> --idempotency-key <key>",
    "Pay one Solana x402 exact GET from the profile's local Solana wallet, for a mint the owner admitted for Solana x402.",
    [option("--profile", "profile", true, noDefault, ["matches_[a-z0-9][a-z0-9._-]{0,63}"], "public"),
      option("--url", "https_url", true, noDefault, ["credential_free_https_without_fragment", "canonical_whatwg_serialization", "maximum_2048_utf8_bytes"], "operator_input"),
      option("--asset", "string", true, noDefault, ["canonical_solana_mint_address", "owner_allowlist_x402_row_with_x402-exact-svm_pin"], "public"),
      option("--max-amount", "atomic", true, noDefault, ["positive_atomic_units_of_the_mint", "at_most_the_owner_per_payment_cap_applies"], "operator_input"),
      option("--idempotency-key", "idempotency_key", true, noDefault, ["8_to_200_safe_ascii_characters"], "operator_input")],
    "payment_submit", `Selects the lowest-index exact offer for the mint within the explicit maximum, the owner's policy and allowlist caps and payee pin, freezes it, binds a fresh blockhash, simulates, reserves the owner cap, signs one transaction of exactly two compute budget instructions, one SPL TransferChecked and the spec's Memo (the seller's facilitator pays the fee), and sends one paid GET. A replay never sends again. ${rpc}`,
    "prior_profile_policy", "Unattended (CLI or MCP) under the owner's Solana x402 policy for this mint (`wallet policy set --chain solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp --asset <mint>`): its per-payment cap and wallet balance cap, plus the allowlist x402 row.",
    states, [{ command_path: ["x402", "solana", "observe"], when: "Prove settlement, failure on chain or that the payment can no longer land." }],
    ["apn x402 solana pay --profile default --url https://seller.example/item --asset EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v --max-amount 10000 --idempotency-key item-0001"]),
  command(["x402", "solana", "observe"], "apn x402 solana observe --operation <operation-id>",
    "Observe one Solana x402 payment at finalized: settlement by its exact bytes, failure on chain, or never landed once its blockhash lifetime passed.",
    [operation], "local_write", `One bounded observation; settles the usage hold to the proven outcome. Never signs or sends. ${rpc}`,
    "prior_operation_authorization", "Only the saved operation is observed.", states, [], ["apn x402 solana observe --operation <operation-id>"]),
  command(["x402", "solana", "status"], "apn x402 solana status --operation <operation-id>",
    "Read one Solana x402 payment from its local journal.", [operation], "local_read", "Reads local state only; never reserves, signs or sends.",
    "none", "Never.", states, [], ["apn x402 solana status --operation <operation-id>"]),
];

export function bindX402SolanaCommand(path: string, options: Readonly<Record<string, string>>): CommandRequest {
  const operationId = (): string => required(options["--operation"]);
  if (path === "x402 solana observe") return { command: "x402.solana.observe", operationId: operationId() };
  if (path === "x402 solana status") return { command: "x402.solana.status", operationId: operationId() };
  if (path !== "x402 solana pay") throw new ApnError("APN_UNSUPPORTED_COMMAND", "Unsupported Solana x402 command.");
  const mint = required(options["--asset"]);
  try { solanaAddress(mint); } catch { throw new ApnError("APN_INVALID_INPUT", "--asset must be a canonical Solana mint address."); }
  const amount = required(options["--max-amount"]);
  if (!/^[1-9][0-9]{0,19}$/u.test(amount) || BigInt(amount) > (1n << 64n) - 1n) throw new ApnError("APN_INVALID_INPUT", "--max-amount must fit an SPL amount.");
  return { command: "x402.solana.pay", profile: required(options["--profile"]), url: required(options["--url"]), mint, maxAmountAtomic: amount,
    idempotencyKey: required(options["--idempotency-key"]) };
}
function required(value: string | undefined): string {
  if (value === undefined) throw new ApnError("APN_INVALID_INPUT", "A required Solana x402 option is missing.");
  return value;
}
