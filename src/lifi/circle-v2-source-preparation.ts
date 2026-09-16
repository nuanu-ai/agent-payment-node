/** Read-only Circle V2 Base source preparation. This module has no signing, sending, or journal path. */
import { createHash } from "node:crypto";
import { canonicalJson } from "../canonical.js";
import { inspectCircleV2Preflight, type CircleV2PreflightTransport } from "./circle-v2-preflight.js";
import type { CircleV2PreflightedDraft } from "./circle-v2-draft.js";
import { BRIDGE_MAX_GAS, BRIDGE_MIN_REMAINING_MS, BRIDGE_TTL_MS, bridgeAddress, bridgeFailure, bridgeHex, bridgeRecord, bridgeUint } from "./validation.js";

const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
function fail(reason: string): never { return bridgeFailure("APN_PROVIDER_PROTOCOL", `circle_v2_source_preparation_${reason}`); }
function digest(value: unknown): string { return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`; }
function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
function quantity(value: unknown): bigint { return bridgeUint(value); }
export interface CircleV2BaseState {
  readonly chainId: 8453;
  readonly payer: string;
  readonly draftBlockHash: string;
  readonly blockNumber: string;
  readonly blockHash: string;
  readonly latestNonceAtomic: string;
  readonly pendingNonceAtomic: string;
  readonly usdcBalanceAtomic: string;
  readonly usdcAllowanceAtomic: string;
  readonly nativeBalanceWei: string;
  readonly gasLimitAtomic: string;
  readonly maxFeePerGasWei: string;
  readonly maxPriorityFeePerGasWei: string;
}
/** The implementation must only read Base state and pin token reads and gas estimate to the fresh preflight block. */
export type CircleV2BaseStateReader = (query: Readonly<{ payer: string; token: string; spender: string; to: string; data: string; valueAtomic: string; draftBlockNumber: string; freshBlockNumber: string; freshBlockHash: string }>) => Promise<CircleV2BaseState>;
export interface CircleV2SourcePreparationLimits {
  readonly maxGasLimitAtomic: string;
  readonly maxFeePerGasWei: string;
  readonly maxPriorityFeePerGasWei: string;
  readonly maxNativeDebitWei: string;
  readonly ttlMs: number;
}
export interface CircleV2SourcePreparation {
  readonly kind: "circle_v2_base_source_preparation";
  readonly executionAdmitted: false;
  readonly quoteAuthenticityVerified: false;
  readonly baseStateSourceVerified: false;
  readonly blockers: readonly string[];
  readonly draftIntegrityDigest: string;
  readonly quoteHash: string;
  readonly quote: { readonly signedQuote: string; readonly feeToken: string; readonly feeTotalAtomic: string; readonly expiry: unknown };
  readonly recipient: { readonly wallet: string; readonly ata: string; readonly setup: "existing_ata" | "create_ata" };
  readonly principalAtomic: string;
  readonly requiredUsdcDebitAtomic: string;
  readonly sourceRefundAddress: string;
  readonly sourceBlock: { readonly number: string; readonly hash: string };
  readonly transaction: { readonly type: "eip1559"; readonly chainId: 8453; readonly from: string; readonly to: string; readonly data: string; readonly valueAtomic: "0"; readonly nonceAtomic: string; readonly gasLimitAtomic: string; readonly maxFeePerGasWei: string; readonly maxPriorityFeePerGasWei: string };
  readonly maximumNativeDebitWei: string;
  readonly preparedAt: string;
  readonly expiresAt: string;
  readonly preparationDigest: string;
}

export async function prepareCircleV2BaseSourceReadOnly(draft: CircleV2PreflightedDraft, transport: CircleV2PreflightTransport,
  readBase: CircleV2BaseStateReader, limits: CircleV2SourcePreparationLimits,
  now: () => number = Date.now): Promise<CircleV2SourcePreparation> {
  const copy = structuredClone(draft);
  const { integrityDigest, ...unsignedDraft } = copy;
  if (copy.kind !== "circle_v2_preflighted_draft" || copy.state !== "preflighted_unsubmitted" || copy.executionAdmitted !== false ||
    copy.sourceChainId !== 8453 || integrityDigest !== digest(unsignedDraft)) fail("draft_integrity");
  const payer = bridgeAddress(copy.sourcePayer), tx = copy.sourceTransaction, response = bridgeRecord(copy.quoteResponse);
  const principal = quantity(copy.amountAtomic), fee = quantity(copy.quotedFeeAtomic);
  const requiredDebit = principal + fee;
  if (principal === 0n || fee >= principal || fee > quantity(copy.maxSourceFeeAtomic) || requiredDebit > (1n << 256n) - 1n) fail("quote_fee");
  const preflight = await inspectCircleV2Preflight({ payer, quoteEndpoint: copy.quoteEndpoint,
    quoteRequest: copy.quoteRequest, quoteResponse: copy.quoteResponse, transaction: { from: payer, to: tx.to, chainId: 8453,
      data: tx.data, valueAtomic: tx.valueAtomic, refundAddress: tx.refundAddress }, recipientWallet: copy.recipientWallet,
    amountAtomic: copy.amountAtomic, maxSourceFeeAtomic: copy.maxSourceFeeAtomic, recipientSetup: copy.recipientSetup }, transport);
  const oldNumber = quantity(copy.preflight.blockNumber), newNumber = quantity(preflight.blockNumber);
  if (newNumber < oldNumber || newNumber - oldNumber > 20n ||
    (newNumber === oldNumber && bridgeHex(copy.preflight.blockHash, 32, 32) !== bridgeHex(preflight.blockHash, 32, 32))) fail("stale_or_reorged_preflight");
  let state: CircleV2BaseState;
  try { state = await readBase({ payer, token: BASE_USDC, spender: tx.to, to: tx.to, data: tx.data, valueAtomic: tx.valueAtomic,
    draftBlockNumber: copy.preflight.blockNumber, freshBlockNumber: preflight.blockNumber, freshBlockHash: preflight.blockHash }); }
  catch { return fail("base_unavailable"); }
  if (state.chainId !== 8453 || bridgeAddress(state.payer) !== payer ||
    bridgeHex(state.draftBlockHash, 32, 32) !== bridgeHex(copy.preflight.blockHash, 32, 32) ||
    quantity(state.blockNumber) !== newNumber || bridgeHex(state.blockHash, 32, 32) !== bridgeHex(preflight.blockHash, 32, 32)) fail("base_identity");
  const latest = quantity(state.latestNonceAtomic), pending = quantity(state.pendingNonceAtomic);
  if (latest !== pending) fail("pending_nonce");
  if (quantity(state.usdcBalanceAtomic) < requiredDebit) fail("usdc_balance");
  if (quantity(state.usdcAllowanceAtomic) !== requiredDebit) fail("exact_allowance");
  const gas = quantity(state.gasLimitAtomic), maxFee = quantity(state.maxFeePerGasWei), priority = quantity(state.maxPriorityFeePerGasWei);
  if (gas === 0n || gas > BRIDGE_MAX_GAS || gas > quantity(limits.maxGasLimitAtomic) || maxFee === 0n || priority > maxFee ||
    maxFee > quantity(limits.maxFeePerGasWei) || priority > quantity(limits.maxPriorityFeePerGasWei)) fail("gas_or_fee_cap");
  const nativeDebit = gas * maxFee + quantity(tx.valueAtomic);
  if (nativeDebit > (1n << 256n) - 1n) fail("native_debit_overflow");
  if (nativeDebit > quantity(limits.maxNativeDebitWei) || quantity(state.nativeBalanceWei) < nativeDebit) fail("native_balance_or_cap");
  const current = now();
  if (!Number.isSafeInteger(current) || current < 0 || !Number.isSafeInteger(limits.ttlMs) ||
    limits.ttlMs < BRIDGE_MIN_REMAINING_MS || limits.ttlMs > BRIDGE_TTL_MS) fail("ttl");
  const expiry = bridgeRecord(response.expiry);
  let expiresAt = current + limits.ttlMs;
  if (expiry.mode === "TIMESTAMP") expiresAt = Math.min(expiresAt, Number(expiry.expiresAt) * 1000);
  else if (expiry.mode !== "BLOCK_NUMBER" || newNumber >= BigInt(Number(expiry.expiresAtBlock))) fail("quote_expiry");
  if (!Number.isSafeInteger(expiresAt) || expiresAt - current < BRIDGE_MIN_REMAINING_MS) fail("ttl_or_quote_expiry");
  const fields = { kind: "circle_v2_base_source_preparation" as const, executionAdmitted: false as const,
    quoteAuthenticityVerified: false as const, baseStateSourceVerified: false as const,
    blockers: ["The Circle quote, validation response, and Base state are supplied through caller-controlled inputs or transports; this artifact does not authenticate their origin",
      "No signing, source submission, Circle attestation, or Solana mint has occurred",
      "The expiry timestamp is a local preparation limit; a BLOCK_NUMBER quote can expire sooner and must be checked again before any separately authorized submission"] as const,
    draftIntegrityDigest: integrityDigest, quoteHash: digest({ request: copy.quoteRequest, response: copy.quoteResponse }),
    quote: { signedQuote: bridgeHex(response.signedQuote, 16 * 1024), feeToken: bridgeAddress(response.feeToken),
      feeTotalAtomic: fee.toString(), expiry: structuredClone(expiry) },
    recipient: { wallet: copy.recipientWallet, ata: copy.recipientAta, setup: copy.recipientSetup },
    principalAtomic: principal.toString(), requiredUsdcDebitAtomic: requiredDebit.toString(), sourceRefundAddress: bridgeAddress(tx.refundAddress),
    sourceBlock: { number: preflight.blockNumber, hash: preflight.blockHash },
    transaction: { type: "eip1559" as const, chainId: 8453 as const, from: payer, to: bridgeAddress(tx.to), data: bridgeHex(tx.data),
      valueAtomic: "0" as const, nonceAtomic: latest.toString(), gasLimitAtomic: gas.toString(), maxFeePerGasWei: maxFee.toString(),
      maxPriorityFeePerGasWei: priority.toString() }, maximumNativeDebitWei: nativeDebit.toString(),
    preparedAt: new Date(current).toISOString(), expiresAt: new Date(expiresAt).toISOString() };
  return freeze({ ...fields, preparationDigest: digest(fields) });
}
