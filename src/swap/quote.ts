import { getAddress } from "viem";
import { address as solanaAddress } from "@solana/kit";
import { canonicalJson, domainHash, exactKeys, isPlainRecord } from "../canonical.js";
import { ApnError } from "../errors.js";
import { loadAllowlistInventory, resolveAllowlistAsset, type CandidateKind } from "../allowlist-inventory.js";
import { parseAtomic } from "../money.js";
import { tronAddress } from "../tron/codec.js";

export const SWAP_QUOTE_SCHEMA = "apn.swap-quote.v1" as const;
const DIGEST = /^[a-f0-9]{64}$/u;
const PROFILE = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
const MAX_UINT256 = (1n << 256n) - 1n;

export interface SwapAssetIdentity { readonly chain: string; readonly kind: CandidateKind; readonly identifier: string | null }
export interface SwapSimulationProof { readonly requestHash: string; readonly resultHash: string; readonly success: true }
export interface SwapQuoteSnapshot {
  readonly schemaVersion: typeof SWAP_QUOTE_SCHEMA;
  readonly profile: string;
  readonly profileHash: string;
  readonly account: string;
  readonly recipient: string;
  readonly sourceAsset: SwapAssetIdentity;
  readonly destinationAsset: SwapAssetIdentity;
  readonly inputAmountAtomic: string;
  readonly expectedOutputAtomic: string;
  readonly minimumOutputAtomic: string;
  readonly slippageBps: number;
  readonly effectiveAt: string;
  readonly expiresAt: string;
  readonly providerResponseHash: string;
  readonly routeHash: string;
  readonly unsignedTransactionPayloadHash: string;
  readonly simulation: SwapSimulationProof;
  readonly quoteHash: string;
}

export type SwapQuoteInput = Omit<SwapQuoteSnapshot, "schemaVersion" | "profileHash" | "quoteHash">;

export function createSwapQuote(input: SwapQuoteInput): SwapQuoteSnapshot {
  const body = { schemaVersion: SWAP_QUOTE_SCHEMA, ...input,
    profileHash: domainHash(SWAP_QUOTE_SCHEMA, `profile\0${input.profile}`) } as const;
  return validateSwapQuote({ ...body, quoteHash: domainHash(SWAP_QUOTE_SCHEMA, canonicalJson(body)) }, "input");
}

export function validateSwapQuote(value: unknown, mode: "input" | "stored" = "stored"): SwapQuoteSnapshot {
  const fail = (message: string): never => failure(mode, message);
  if (!isPlainRecord(value) || !exactKeys(value, ["schemaVersion", "profile", "profileHash", "account", "recipient",
    "sourceAsset", "destinationAsset", "inputAmountAtomic", "expectedOutputAtomic", "minimumOutputAtomic", "slippageBps",
    "effectiveAt", "expiresAt", "providerResponseHash", "routeHash", "unsignedTransactionPayloadHash", "simulation", "quoteHash"]) ||
      value.schemaVersion !== SWAP_QUOTE_SCHEMA || typeof value.profile !== "string" || !PROFILE.test(value.profile) ||
      typeof value.profileHash !== "string" || typeof value.account !== "string" || typeof value.recipient !== "string" ||
      typeof value.slippageBps !== "number" || !Number.isSafeInteger(value.slippageBps) || value.slippageBps < 0 || value.slippageBps > 10_000 ||
      typeof value.effectiveAt !== "string" || !instant(value.effectiveAt) || typeof value.expiresAt !== "string" ||
      !instant(value.expiresAt) || value.expiresAt <= value.effectiveAt) fail("Swap quote schema is invalid.");
  const record = value as Record<string, unknown>;
  const sourceAsset = asset(record.sourceAsset, mode), destinationAsset = asset(record.destinationAsset, mode);
  if (sourceAsset.chain !== destinationAsset.chain) fail("Swap assets must use the same exact network identity.");
  const source = resolveInventory(sourceAsset, mode), destination = resolveInventory(destinationAsset, mode);
  if (source.family !== destination.family) fail("Swap asset network families do not match.");
  const account = canonicalParty(source.family, record.account as string, mode), recipient = canonicalParty(source.family, record.recipient as string, mode);
  if (account !== record.account || recipient !== record.recipient) fail("Swap owner or recipient is not canonical.");
  const input = atomic(record.inputAmountAtomic, true, mode), expected = atomic(record.expectedOutputAtomic, true, mode);
  const minimum = atomic(record.minimumOutputAtomic, true, mode);
  if (minimum > expected) fail("Swap minimum output exceeds expected output.");
  for (const key of ["profileHash", "providerResponseHash", "routeHash", "unsignedTransactionPayloadHash", "quoteHash"] as const) {
    if (typeof record[key] !== "string" || !DIGEST.test(record[key] as string)) fail("Swap quote hash binding is invalid.");
  }
  const simulation = record.simulation;
  if (!isPlainRecord(simulation) || !exactKeys(simulation, ["requestHash", "resultHash", "success"]) ||
      simulation.success !== true || typeof simulation.requestHash !== "string" || !DIGEST.test(simulation.requestHash) ||
      typeof simulation.resultHash !== "string" || !DIGEST.test(simulation.resultHash)) fail("A successful bound simulation is required.");
  const quote = value as unknown as SwapQuoteSnapshot;
  const { quoteHash, ...body } = quote;
  if (quote.profileHash !== domainHash(SWAP_QUOTE_SCHEMA, `profile\0${quote.profile}`) ||
      quoteHash !== domainHash(SWAP_QUOTE_SCHEMA, canonicalJson(body))) fail("Swap quote integrity validation failed.");
  void input;
  return quote;
}

function asset(value: unknown, mode: "input" | "stored"): SwapAssetIdentity {
  if (!isPlainRecord(value) || !exactKeys(value, ["chain", "kind", "identifier"]) || typeof value.chain !== "string" ||
      (value.kind !== "native" && value.kind !== "token") ||
      (value.kind === "native" ? value.identifier !== null : typeof value.identifier !== "string")) failure(mode, "Swap asset identity is invalid.");
  return value as unknown as SwapAssetIdentity;
}
function resolveInventory(value: SwapAssetIdentity, mode: "input" | "stored") {
  try { return resolveAllowlistAsset({ chain: value.chain, kind: value.kind,
    ...(value.identifier === null ? {} : { identifier: value.identifier }) }, loadAllowlistInventory()); }
  catch { return failure(mode, "Swap asset is absent from the frozen inventory."); }
}
function canonicalParty(family: string, value: string, mode: "input" | "stored"): string {
  try {
    if (family === "evm") { const result = getAddress(value); if (result !== value || /^0x0{40}$/u.test(result)) throw new Error(); return result; }
    if (family === "solana") return solanaAddress(value);
    return tronAddress(value);
  } catch { return failure(mode, "Swap party identity is invalid."); }
}
function atomic(value: unknown, positive: boolean, mode: "input" | "stored"): bigint {
  try { if (typeof value !== "string" || value.length > 78) throw new Error(); const result = parseAtomic(value, { positive });
    if (result > MAX_UINT256) throw new Error(); return result; }
  catch { return failure(mode, "Swap atomic amount is invalid."); }
}
function instant(value: string): boolean { const time = Date.parse(value); return Number.isFinite(time) && new Date(time).toISOString() === value; }
function failure(mode: "input" | "stored", message: string): never {
  throw new ApnError(mode === "input" ? "APN_INVALID_INPUT" : "APN_STATE_CORRUPT", message);
}
