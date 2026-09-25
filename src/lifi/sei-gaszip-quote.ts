/**
 * Read-only inspection of LI.FI GET /v1/quote for native ETH -> native SEI.
 * This module has no provider, wallet, RPC, policy or operation dependency. A
 * local age limit is an APN freshness rule, not a provider quote expiry.
 */
import { canonicalJson, sha256 } from "../canonical.js";
import type { Address } from "../model.js";
import { SEI_GASZIP_QUOTE_DESTINATION } from "./asset-registry.js";
import { BRIDGE_DIAMOND, BRIDGE_MAX_CALLDATA_BYTES, BRIDGE_ZERO_ADDRESS, bridgeAddress,
  bridgeFailure, bridgeHex, bridgeOpaque, bridgeRecord, bridgeUint } from "./validation.js";

export const SEI_GASZIP_LOCAL_MAX_AGE_MS = 60_000;
export const SEI_GASZIP_SOURCE_CHAIN_ID = 1;
export const SEI_GASZIP_BUYER = "0x823A3a5BaB1186141b32fC65F8E25Ca24c679Ce7" as Address;
const SOURCE_AMOUNT = "200000000000000";
const SELECTOR = "0x606326ff";
const MAX_QUOTE_BYTES = 256 * 1024;

export interface SeiGasZipQuoteInspection {
  readonly kind: "sei_gaszip_quote_inspection";
  readonly signable: false;
  readonly execution_blocked: true;
  readonly reason: "source_destination_contract_observer_recovery_and_policy_unreviewed";
  readonly providerExpiry: null;
  readonly fetchedAt: string;
  readonly localExpiresAt: string;
  readonly quoteDigest: string;
  readonly transactionRequestDigest: string;
  readonly quoteId: string;
  readonly transactionId: string;
  readonly tool: "gasZipBridge";
  readonly fromChainId: 1;
  readonly toChainId: 1329;
  readonly fromToken: Address;
  readonly toToken: Address;
  readonly owner: Address;
  readonly recipient: Address;
  readonly sourceAmountAtomic: string;
  readonly bridgeAmountAtomic: string;
  readonly quotedOutputAtomic: string;
  readonly minimumOutputAtomic: string;
  readonly feeAtomic: string;
  readonly transactionTarget: Address;
  readonly transactionValueAtomic: string;
  readonly transactionDataDigest: string;
}

function fail(reason: string): never { return bridgeFailure("APN_PROVIDER_PROTOCOL", `sei_gaszip_${reason}`); }
function object(value: unknown): Record<string, unknown> { return bridgeRecord(value); }
function token(value: unknown, chainId: number, symbol: "ETH" | "SEI"): void {
  const row = object(value);
  if (row.chainId !== chainId || bridgeAddress(row.address) !== BRIDGE_ZERO_ADDRESS ||
    row.symbol !== symbol || row.decimals !== 18) fail("token_identity");
}
function time(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > Date.parse("9999-12-31T23:59:59.999Z")) fail("local_clock");
  return value;
}
function quantity(value: unknown): bigint {
  if (typeof value === "string" && /^0x(?:0|[1-9a-f][0-9a-f]{0,63})$/u.test(value)) return BigInt(value);
  return bridgeUint(value);
}
function sameAction(value: unknown, fromChainId: number, toChainId: number, amount: string,
  sender: Address, recipient: Address, toSymbol: "ETH" | "SEI"): void {
  const action = object(value);
  for (const key of ["destinationCall", "destinationCalls", "destinationCallData", "contractCalls", "permit", "permit2", "authorization"])
    if (action[key] !== undefined) fail("action_extension");
  token(action.fromToken, 1, "ETH"); token(action.toToken, toChainId, toSymbol);
  if (action.fromChainId !== fromChainId || action.toChainId !== toChainId ||
    action.fromAmount !== amount || bridgeAddress(action.fromAddress) !== sender ||
    bridgeAddress(action.toAddress) !== recipient) fail("action_binding");
}

/** Accept one already fetched provider response. `fetchedAtMs` must come from the caller's trusted fetch clock. */
export function inspectSeiGasZipQuote(value: unknown, fetchedAtMs: number): SeiGasZipQuoteInspection {
  const fetchedAt = time(fetchedAtMs), bytes = canonicalJson(value);
  if (Buffer.byteLength(bytes, "utf8") > MAX_QUOTE_BYTES) fail("quote_size");
  const q = object(value), action = object(q.action), estimate = object(q.estimate), tx = object(q.transactionRequest);
  const owner = SEI_GASZIP_BUYER, destination = SEI_GASZIP_QUOTE_DESTINATION;
  if (q.type !== "lifi" || q.tool !== destination.tool || q.integrator !== "lifi-api" ||
    object(q.toolDetails).key !== destination.tool) fail("provider_tool");
  sameAction(action, 1, destination.chainId, SOURCE_AMOUNT, owner, owner, "SEI");
  if (action.slippage !== 0.005) fail("slippage");
  const quoted = bridgeUint(estimate.toAmount, true), minimum = bridgeUint(estimate.toAmountMin, true),
    feeRows = estimate.feeCosts;
  if (estimate.tool !== destination.tool || estimate.fromAmount !== SOURCE_AMOUNT ||
    bridgeAddress(estimate.approvalAddress) !== BRIDGE_DIAMOND || minimum > quoted ||
    !Array.isArray(feeRows) || feeRows.length !== 1) fail("estimate_binding");
  const fee = object(feeRows[0]); token(fee.token, 1, "ETH");
  const feeAmount = bridgeUint(fee.amount, true), source = BigInt(SOURCE_AMOUNT), bridgeAmount = source - feeAmount;
  if (fee.name !== "LIFI Fixed Fee" || fee.included !== true || feeAmount !== 500000000000n || bridgeAmount <= 0n ||
    estimate.skipApproval !== true) fail("fee_binding");
  const split = object(fee.feeSplit);
  if (split.lifiFee !== feeAmount.toString() || split.integratorFee !== "0" ||
    !Array.isArray(split.recipients) || split.recipients.length !== 1) fail("fee_split");
  const recipient = object(split.recipients[0]);
  if (recipient.name !== "lifi" || recipient.type !== "FIXED" || recipient.fee !== feeAmount.toString()) fail("fee_split");
  const steps = q.includedSteps;
  if (!Array.isArray(steps) || steps.length !== 2) fail("included_steps");
  const collection = object(steps[0]), cross = object(steps[1]);
  if (collection.type !== "protocol" || collection.tool !== "feeCollection" ||
    cross.type !== "cross" || cross.tool !== destination.tool ||
    object(collection.toolDetails).key !== "feeCollection" || object(cross.toolDetails).key !== destination.tool) fail("effect_graph");
  for (const step of [collection, cross]) for (const key of ["typedData", "permit", "permit2", "authorization", "destinationCall", "destinationCalls", "contractCalls", "userOperation"])
    if (step[key] !== undefined) fail("step_extension");
  for (const step of [collection, cross])
    if ((step.executionType !== undefined && step.executionType !== "transaction") ||
      (step.gasless !== undefined && step.gasless !== false)) fail("execution_mode");
  sameAction(collection.action, 1, 1, SOURCE_AMOUNT, BRIDGE_DIAMOND, BRIDGE_DIAMOND, "ETH");
  sameAction(cross.action, 1, destination.chainId, bridgeAmount.toString(), BRIDGE_DIAMOND, owner, "SEI");
  const collected = object(collection.estimate), bridged = object(cross.estimate);
  if (collected.tool !== "feeCollection" || collected.fromAmount !== SOURCE_AMOUNT ||
    collected.toAmount !== bridgeAmount.toString() || collected.toAmountMin !== bridgeAmount.toString() ||
    !Array.isArray(collected.feeCosts) || collected.feeCosts.length !== 1 ||
    canonicalJson(collected.feeCosts[0]) !== canonicalJson(fee) ||
    bridged.tool !== destination.tool || bridged.fromAmount !== bridgeAmount.toString() ||
    bridged.toAmount !== quoted.toString() || bridged.toAmountMin !== minimum.toString() ||
    bridgeAddress(bridged.approvalAddress) !== BRIDGE_DIAMOND ||
    !Array.isArray(bridged.feeCosts) || bridged.feeCosts.length !== 0) fail("step_economics");
  const txKeys = ["to", "from", "data", "value", "chainId", "gasLimit", "gasPrice", "maxFeePerGas", "maxPriorityFeePerGas", "type", "accessList", "nonce"];
  if (Object.keys(tx).some((key) => !txKeys.includes(key)) ||
    (tx.gasPrice !== undefined && (tx.maxFeePerGas !== undefined || tx.maxPriorityFeePerGas !== undefined)) ||
    ((tx.maxFeePerGas === undefined) !== (tx.maxPriorityFeePerGas === undefined)) ||
    (tx.accessList !== undefined && (!Array.isArray(tx.accessList) || tx.accessList.length !== 0)) ||
    (tx.type !== undefined && tx.type !== 2 && tx.type !== "0x2")) fail("transaction_fields");
  if (tx.chainId !== 1 || bridgeAddress(tx.from) !== owner || bridgeAddress(tx.to) !== BRIDGE_DIAMOND ||
    quantity(tx.value) !== source || quantity(tx.gasLimit) <= 0n || quantity(tx.gasLimit) > 5_000_000n) fail("transaction_binding");
  for (const key of ["gasPrice", "maxFeePerGas", "maxPriorityFeePerGas", "nonce"])
    if (tx[key] !== undefined) quantity(tx[key]);
  const data = bridgeHex(tx.data, BRIDGE_MAX_CALLDATA_BYTES);
  if (data.length <= 10 || data.slice(0, 10) !== SELECTOR) fail("transaction_selector");
  const transactionId = bridgeHex(q.transactionId, 32, 32);
  if (transactionId === `0x${"0".repeat(64)}` || !data.includes(transactionId.slice(2))) fail("transaction_id_binding");
  return {
    kind: "sei_gaszip_quote_inspection", signable: false, execution_blocked: true,
    reason: "source_destination_contract_observer_recovery_and_policy_unreviewed", providerExpiry: null,
    fetchedAt: new Date(fetchedAt).toISOString(), localExpiresAt: new Date(fetchedAt + SEI_GASZIP_LOCAL_MAX_AGE_MS).toISOString(),
    quoteDigest: sha256(bytes), transactionRequestDigest: sha256(canonicalJson(tx)),
    quoteId: bridgeOpaque(q.id), transactionId, tool: "gasZipBridge", fromChainId: 1, toChainId: 1329,
    fromToken: BRIDGE_ZERO_ADDRESS, toToken: destination.nativeToken, owner, recipient: owner,
    sourceAmountAtomic: SOURCE_AMOUNT, bridgeAmountAtomic: bridgeAmount.toString(),
    quotedOutputAtomic: quoted.toString(), minimumOutputAtomic: minimum.toString(), feeAtomic: feeAmount.toString(),
    transactionTarget: BRIDGE_DIAMOND, transactionValueAtomic: source.toString(), transactionDataDigest: sha256(data),
  };
}

/** Reparse and compare the entire quote at the original capture time. Always returns a blocked inspection. */
export function revalidateSeiGasZipQuote(saved: SeiGasZipQuoteInspection, value: unknown, nowMs: number): SeiGasZipQuoteInspection {
  const now = time(nowMs), fetchedAt = Date.parse(saved.fetchedAt);
  if (!Number.isSafeInteger(fetchedAt) || now < fetchedAt || now - fetchedAt >= SEI_GASZIP_LOCAL_MAX_AGE_MS) fail("local_quote_stale");
  const current = inspectSeiGasZipQuote(value, fetchedAt);
  if (canonicalJson(saved) !== canonicalJson(current)) fail("quote_mutated");
  return current;
}
