import { canonicalJson, exactKeys, isPlainRecord, sha256 } from "../../canonical.js";
import { atomic, canonicalAddress, canonicalBase64, invalid, JUPITER_V6_PROGRAM, SOLANA_USDC_MINT, WRAPPED_SOL_MINT } from "./catalog.js";

export interface JupiterRouteLeg { readonly percent: number; readonly swapInfo: { readonly ammKey: string; readonly label: string; readonly inputMint: string; readonly outputMint: string; readonly inAmount: string; readonly outAmount: string; readonly feeAmount: string; readonly feeMint: string } }
export interface JupiterQuoteResponse { readonly inputMint: string; readonly inAmount: string; readonly outputMint: string; readonly outAmount: string; readonly otherAmountThreshold: string; readonly swapMode: "ExactIn"; readonly slippageBps: number; readonly priceImpactPct: string; readonly routePlan: readonly JupiterRouteLeg[]; readonly contextSlot: number; readonly timeTaken: number; readonly responseHash: string }
export interface JupiterOrderResponse { readonly requestId: string; readonly transaction: string; readonly lastValidBlockHeight: string; readonly rfqExpiresAt: string | null; readonly quote: JupiterQuoteResponse; readonly responseHash: string }
export interface JupiterBuildResponse { readonly requestId: string; readonly swapTransaction: string; readonly lastValidBlockHeight: string; readonly rfqExpiresAt: string | null;
  readonly prioritizationFeeLamports: string; readonly tipLamports: string; readonly rentFeeLamports: string;
  readonly platformFeeAtomic: string; readonly referralFeeAtomic: string; readonly responseHash: string }

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
