import { canonicalJson, exactKeys, isPlainRecord, sha256 } from "../../canonical.js";
import { atomic, canonicalAddress, canonicalBase64, invalid, JUPITER_V6_PROGRAM, SOLANA_USDC_MINT, WRAPPED_SOL_MINT } from "./catalog.js";

export interface JupiterRouteLeg { readonly percent: number; readonly swapInfo: { readonly ammKey: string; readonly label: string; readonly inputMint: string; readonly outputMint: string; readonly inAmount: string; readonly outAmount: string; readonly feeAmount: string; readonly feeMint: string } }
export interface JupiterQuoteResponse { readonly inputMint: string; readonly inAmount: string; readonly outputMint: string; readonly outAmount: string; readonly otherAmountThreshold: string; readonly swapMode: "ExactIn"; readonly slippageBps: number; readonly priceImpactPct: string; readonly routePlan: readonly JupiterRouteLeg[]; readonly contextSlot: number; readonly timeTaken: number; readonly responseHash: string }
export interface JupiterOrderResponse { readonly requestId: string; readonly transaction: string; readonly lastValidBlockHeight: string; readonly rfqExpiresAt: string | null; readonly quote: JupiterQuoteResponse; readonly responseHash: string }
export interface JupiterBuildResponse { readonly requestId: string; readonly swapTransaction: string; readonly lastValidBlockHeight: string; readonly rfqExpiresAt: string | null;
  readonly prioritizationFeeLamports: string; readonly tipLamports: string; readonly rentFeeLamports: string;
  readonly platformFeeAtomic: string; readonly referralFeeAtomic: string; readonly responseHash: string }

/** The separate, unassembled GET /swap/v2/build wire shape. It grants no signing authority. */
export interface JupiterRawInstruction { readonly programId: string; readonly accounts: readonly { readonly pubkey: string; readonly isWritable: boolean; readonly isSigner: boolean }[]; readonly data: string }
export interface JupiterRawRouteStep { readonly percent: number; readonly bps: number; readonly usdValue?: number; readonly swapInfo: {
  readonly ammKey: string; readonly label: string; readonly inputMint: string; readonly outputMint: string; readonly inAmount: string; readonly outAmount: string } }
export interface JupiterRawBuildResponse {
  readonly inputMint: string; readonly outputMint: string; readonly inAmount: string; readonly outAmount: string; readonly otherAmountThreshold: string;
  readonly swapMode: string; readonly slippageBps: number; readonly priceImpactPct?: string; readonly routePlan: readonly JupiterRawRouteStep[];
  readonly computeBudgetInstructions: readonly JupiterRawInstruction[]; readonly setupInstructions: readonly JupiterRawInstruction[];
  readonly swapInstruction: JupiterRawInstruction; readonly cleanupInstruction: JupiterRawInstruction | null;
  readonly otherInstructions: readonly JupiterRawInstruction[]; readonly tipInstruction: JupiterRawInstruction | null;
  readonly addressesByLookupTableAddress: Readonly<Record<string, readonly string[]>> | null;
  readonly blockhashWithMetadata: { readonly blockhash: readonly number[]; readonly lastValidBlockHeight: number;
    readonly fetchedAt?: { readonly secs_since_epoch: number; readonly nanos_since_epoch: number } };
  readonly responseHash: string;
}

const QUOTE_KEYS = ["inputMint", "inAmount", "outputMint", "outAmount", "otherAmountThreshold", "swapMode", "slippageBps", "priceImpactPct", "routePlan", "contextSlot", "timeTaken"] as const;
export function decodeQuoteResponse(value: unknown): JupiterQuoteResponse {
  const record = exact(value, QUOTE_KEYS, "Jupiter quote response");
  if (record.swapMode !== "ExactIn" || record.inputMint !== WRAPPED_SOL_MINT || record.outputMint !== SOLANA_USDC_MINT) invalid("Jupiter quote does not match the pinned exact-input SOL to USDC pair.");
  atomic(record.inAmount); const out = atomic(record.outAmount); const minimum = atomic(record.otherAmountThreshold);
  if (minimum > out) invalid("Jupiter quote minimum exceeds its output.");
  const slippageBps = safeInteger(record.slippageBps, 0, 10_000); const contextSlot = safeInteger(record.contextSlot, 1, Number.MAX_SAFE_INTEGER);
  if (typeof record.timeTaken !== "number" || !Number.isFinite(record.timeTaken) || record.timeTaken < 0 || record.timeTaken > 60) invalid("Jupiter quote timing is invalid.");
  if (typeof record.priceImpactPct !== "string" || !/^(0|[1-9][0-9]*)(\.[0-9]{1,18})?$/u.test(record.priceImpactPct)) invalid("Jupiter quote price impact is invalid.");
  if (!Array.isArray(record.routePlan) || record.routePlan.length === 0 || record.routePlan.length > 16) invalid("Jupiter quote route is invalid.");
  const routePlan = record.routePlan.map(routeLeg); const totalPercent = routePlan.reduce((sum, leg) => sum + leg.percent, 0);
  if (totalPercent !== 100) invalid("Jupiter quote route percentages do not total 100.");
  const body: Omit<JupiterQuoteResponse, "responseHash"> = { inputMint: record.inputMint as string, inAmount: record.inAmount as string,
    outputMint: record.outputMint as string, outAmount: record.outAmount as string, otherAmountThreshold: record.otherAmountThreshold as string,
    swapMode: "ExactIn", slippageBps, priceImpactPct: record.priceImpactPct as string, routePlan, contextSlot, timeTaken: record.timeTaken as number };
  return Object.freeze({ ...body, responseHash: sha256(canonicalJson(body)) });
}

export function decodeOrderResponse(value: unknown): JupiterOrderResponse {
  const record = exact(value, ["requestId", "transaction", "lastValidBlockHeight", "rfqExpiresAt", "quote"], "Jupiter order response");
  const requestId = boundedId(record.requestId); canonicalBase64(record.transaction); const lastValidBlockHeight = blockHeight(record.lastValidBlockHeight);
  const quote = decodeQuoteResponse(record.quote); const body = { requestId, transaction: record.transaction as string, lastValidBlockHeight, rfqExpiresAt: expiry(record.rfqExpiresAt), quote };
  return Object.freeze({ ...body, responseHash: sha256(canonicalJson(body)) });
}
export function decodeBuildResponse(value: unknown): JupiterBuildResponse {
  const record = exact(value, ["requestId", "swapTransaction", "lastValidBlockHeight", "rfqExpiresAt", "prioritizationFeeLamports", "tipLamports",
    "rentFeeLamports", "platformFeeAtomic", "referralFeeAtomic"], "Jupiter build response");
  const body = { requestId: boundedId(record.requestId), swapTransaction: record.swapTransaction as string, lastValidBlockHeight: blockHeight(record.lastValidBlockHeight),
    rfqExpiresAt: expiry(record.rfqExpiresAt), prioritizationFeeLamports: amount(record.prioritizationFeeLamports), tipLamports: amount(record.tipLamports),
    rentFeeLamports: amount(record.rentFeeLamports), platformFeeAtomic: amount(record.platformFeeAtomic), referralFeeAtomic: amount(record.referralFeeAtomic) };
  canonicalBase64(body.swapTransaction); return Object.freeze({ ...body, responseHash: sha256(canonicalJson(body)) });
}

const RAW_BUILD_KEYS = ["inputMint", "outputMint", "inAmount", "outAmount", "otherAmountThreshold", "swapMode", "slippageBps", "routePlan",
  "computeBudgetInstructions", "setupInstructions", "swapInstruction", "cleanupInstruction", "otherInstructions", "tipInstruction",
  "addressesByLookupTableAddress", "blockhashWithMetadata"] as const;

export function decodeRawBuildResponse(value: unknown): JupiterRawBuildResponse {
  const record = exactOptional(value, RAW_BUILD_KEYS, ["priceImpactPct"], "Jupiter raw build response");
  const inputMint = rawAddress(record.inputMint); const outputMint = rawAddress(record.outputMint);
  const inAmount = rawAmount(record.inAmount); const outAmount = rawAmount(record.outAmount);
  const otherAmountThreshold = rawAmount(record.otherAmountThreshold, true);
  if (BigInt(otherAmountThreshold) > BigInt(outAmount)) invalid("Jupiter raw build threshold exceeds output.");
  if (typeof record.swapMode !== "string" || record.swapMode.length === 0 || record.swapMode.length > 32) invalid("Jupiter raw build swap mode is invalid.");
  const routePlan = rawArray(record.routePlan, rawRouteStep, "Jupiter raw build route");
  if (routePlan.length === 0) invalid("Jupiter raw build route is empty.");
  const body = {
    inputMint, outputMint, inAmount, outAmount, otherAmountThreshold, swapMode: record.swapMode,
    slippageBps: safeInteger(record.slippageBps, 0, 10_000),
    ...(Object.hasOwn(record, "priceImpactPct") ? { priceImpactPct: rawDecimal(record.priceImpactPct, "Jupiter raw build price impact") } : {}),
    routePlan,
    computeBudgetInstructions: rawArray(record.computeBudgetInstructions, rawInstruction, "Jupiter compute budget instructions"),
    setupInstructions: rawArray(record.setupInstructions, rawInstruction, "Jupiter setup instructions"),
    swapInstruction: rawInstruction(record.swapInstruction),
    cleanupInstruction: record.cleanupInstruction === null ? null : rawInstruction(record.cleanupInstruction),
    otherInstructions: rawArray(record.otherInstructions, rawInstruction, "Jupiter other instructions"),
    tipInstruction: record.tipInstruction === null ? null : rawInstruction(record.tipInstruction),
    addressesByLookupTableAddress: rawLookupTables(record.addressesByLookupTableAddress),
    blockhashWithMetadata: rawBlockhash(record.blockhashWithMetadata),
  };
  return Object.freeze({ ...body, responseHash: sha256(canonicalJson(body)) });
}

function rawRouteStep(value: unknown): JupiterRawRouteStep {
  const record = exactOptional(value, ["percent", "bps", "swapInfo"], ["usdValue"], "Jupiter raw route step");
  const info = exact(record.swapInfo, ["ammKey", "label", "inputMint", "outputMint", "inAmount", "outAmount"], "Jupiter raw swap info");
  if (typeof info.label !== "string" || info.label.length === 0 || info.label.length > 96) invalid("Jupiter raw route label is invalid.");
  const swapInfo = Object.freeze({ ammKey: rawAddress(info.ammKey), label: info.label, inputMint: rawAddress(info.inputMint),
    outputMint: rawAddress(info.outputMint), inAmount: rawAmount(info.inAmount), outAmount: rawAmount(info.outAmount) });
  return Object.freeze({ percent: safeNumber(record.percent, 0, 100), bps: safeNumber(record.bps, 0, 10_000),
    ...(Object.hasOwn(record, "usdValue") ? { usdValue: safeNumber(record.usdValue, 0, Number.MAX_SAFE_INTEGER) } : {}), swapInfo });
}
function rawInstruction(value: unknown): JupiterRawInstruction {
  const record = exact(value, ["programId", "accounts", "data"], "Jupiter raw instruction");
  if (typeof record.data !== "string" || Buffer.from(record.data, "base64").toString("base64") !== record.data) invalid("Jupiter raw instruction data is not canonical base64.");
  const accounts = rawArray(record.accounts, (item) => {
    const account = exact(item, ["pubkey", "isWritable", "isSigner"], "Jupiter raw instruction account");
    if (typeof account.isWritable !== "boolean" || typeof account.isSigner !== "boolean") invalid("Jupiter raw instruction account roles are invalid.");
    return Object.freeze({ pubkey: rawAddress(account.pubkey), isWritable: account.isWritable, isSigner: account.isSigner });
  }, "Jupiter raw instruction accounts");
  return Object.freeze({ programId: rawAddress(record.programId), accounts, data: record.data });
}
function rawLookupTables(value: unknown): Readonly<Record<string, readonly string[]>> | null {
  if (value === null) return null;
  if (!isPlainRecord(value)) invalid("Jupiter raw address lookup tables are invalid.");
  const tables: Record<string, readonly string[]> = Object.create(null);
  for (const [key, addresses] of Object.entries(value)) tables[rawAddress(key)] = rawArray(addresses, rawAddress, "Jupiter raw lookup table addresses");
  return Object.freeze(tables);
}
function rawBlockhash(value: unknown): JupiterRawBuildResponse["blockhashWithMetadata"] {
  const record = exactOptional(value, ["blockhash", "lastValidBlockHeight"], ["fetchedAt"], "Jupiter raw blockhash metadata");
  if (!Array.isArray(record.blockhash) || record.blockhash.length !== 32) invalid("Jupiter raw blockhash must contain 32 bytes.");
  const blockhash = Object.freeze(record.blockhash.map((byte) => safeInteger(byte, 0, 255)));
  let fetchedAt: JupiterRawBuildResponse["blockhashWithMetadata"]["fetchedAt"];
  if (Object.hasOwn(record, "fetchedAt")) {
    const timestamp = exact(record.fetchedAt, ["secs_since_epoch", "nanos_since_epoch"], "Jupiter raw blockhash fetchedAt");
    fetchedAt = Object.freeze({ secs_since_epoch: safeInteger(timestamp.secs_since_epoch, 0, Number.MAX_SAFE_INTEGER),
      nanos_since_epoch: safeInteger(timestamp.nanos_since_epoch, 0, 999_999_999) });
  }
  return Object.freeze({ blockhash, lastValidBlockHeight: safeInteger(record.lastValidBlockHeight, 0, Number.MAX_SAFE_INTEGER),
    ...(fetchedAt === undefined ? {} : { fetchedAt }) });
}
function rawArray<T>(value: unknown, decode: (item: unknown) => T, label: string): readonly T[] {
  if (!Array.isArray(value)) invalid(`${label} must be an array.`);
  return Object.freeze(value.map(decode));
}
function rawAddress(value: unknown): string {
  if (typeof value !== "string") invalid("Jupiter raw Solana address is invalid.");
  return canonicalAddress(value);
}
function rawAmount(value: unknown, allowZero = false): string { atomic(value, allowZero); return value as string; }
function rawDecimal(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u.test(value)) invalid(`${label} is invalid.`);
  return value;
}
function safeNumber(value: unknown, minimum: number, maximum: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) invalid("Jupiter raw number is invalid.");
  return value;
}
function exactOptional(value: unknown, required: readonly string[], optional: readonly string[], label: string): Record<string, unknown> {
  if (!isPlainRecord(value) || required.some((key) => !Object.hasOwn(value, key)) ||
      Object.keys(value).some((key) => !required.includes(key) && !optional.includes(key))) invalid(`${label} schema is invalid.`);
  return value;
}

function routeLeg(value: unknown): JupiterRouteLeg {
  const record = exact(value, ["percent", "swapInfo"], "Jupiter quote route leg"); const info = exact(record.swapInfo,
    ["ammKey", "label", "inputMint", "outputMint", "inAmount", "outAmount", "feeAmount", "feeMint"], "Jupiter route swap info");
  canonicalAddress(info.ammKey as string); canonicalAddress(info.inputMint as string); canonicalAddress(info.outputMint as string); canonicalAddress(info.feeMint as string);
  atomic(info.inAmount); atomic(info.outAmount); atomic(info.feeAmount, true);
  if (typeof info.label !== "string" || info.label.length === 0 || info.label.length > 96 || info.ammKey === JUPITER_V6_PROGRAM) invalid("Jupiter route label or AMM identity is invalid.");
  return Object.freeze({ percent: safeInteger(record.percent, 1, 100), swapInfo: info as unknown as JupiterRouteLeg["swapInfo"] });
}
function exact(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (!isPlainRecord(value) || !exactKeys(value, keys)) invalid(`${label} schema is invalid.`); return value;
}
function safeInteger(value: unknown, minimum: number, maximum: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > maximum) invalid("Jupiter integer is invalid."); return value;
}
function blockHeight(value: unknown): string { atomic(value); return value as string; }
function amount(value: unknown): string { atomic(value, true); return value as string; }
function expiry(value: unknown): string | null { if (value === null) return null; if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) invalid("Jupiter RFQ expiry is invalid."); return value; }
function boundedId(value: unknown): string { if (typeof value !== "string" || !/^[A-Za-z0-9_-]{8,128}$/u.test(value)) invalid("Jupiter requestId is invalid."); return value; }
