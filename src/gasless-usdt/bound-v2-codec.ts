import { getAddress } from "viem";
import { canonicalJson, exactKeys, hashObject, isPlainRecord } from "../canonical.js";
import { ApnError } from "../errors.js";
import type { Hex, Address } from "../model.js";
import type { UsdtPolicyPreparedV2 } from "./policy-prepare-v2.js";
import { draftUsdtV2, signedUsdtV2 } from "./economics-v2.js";
import { USDT_GASLESS } from "./model.js";
import { usdtApprovalTransferBatch, USDT_PREPARE_STUB_WORD } from "./policy-prepare.js";
import { usdtUserOperation } from "./userop.js";
import { assertUsdtV2Evidence, usdtQuoteChangedFields } from "./auth-v2-validation.js";
import { assertUsdtSponsorWindow } from "./sponsor-auth.js";
import { validateUsdtTokenQuote, validateUsdtGasPrice } from "./quote.js";
export const USDT_BOUND_V2_SCHEMA = "apn.gasless-usdt-bound-operation.v2" as const;
export type PersistedV2<T> = T extends bigint ? string : T extends readonly (infer Item)[] ? readonly PersistedV2<Item>[] :
  T extends object ? { readonly [Key in keyof T]: PersistedV2<T[Key]> } : T;
export interface UsdtBoundOperationV2 {
  readonly schemaVersion: typeof USDT_BOUND_V2_SCHEMA; readonly operationId: string; readonly profileHash: string; readonly idempotencyKey: string;
  readonly binding: PersistedV2<UsdtPolicyPreparedV2>; readonly createdAt: string;
  readonly signerBoundary: "unavailable"; readonly dispatch: "disabled"; readonly usageReservation: "disabled"; readonly integrityHash: string;
}
const serial = (v: unknown): unknown => JSON.parse(JSON.stringify(v, (_k, entry: unknown) => typeof entry === "bigint" ? entry.toString() : entry));
const hash = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/u.test(v);
function fail(): never { throw new ApnError("APN_STATE_CORRUPT", "Gasless USDT v2 binding refused.", { reason: "binding_v2", rail: "gasless_usdt" }); }
const decimal = (v: unknown): bigint => { if (typeof v !== "string" || !/^(0|[1-9][0-9]*)$/u.test(v)) fail(); return BigInt(v); };
function quote(value: unknown) {
  if (!isPlainRecord(value)) fail();
  return validateUsdtTokenQuote({ quotes: [{ ...value, postOpGas: `0x${decimal(value.postOpGas).toString(16)}`,
    exchangeRate: `0x${decimal(value.exchangeRate).toString(16)}`, exchangeRateNativeToUsd: `0x${decimal(value.exchangeRateNativeToUsd).toString(16)}`,
    balanceSlot: "0x2", allowanceSlot: "0x5" }] });
}
function price(value: unknown) {
  if (!isPlainRecord(value)) fail();
  const tier = { maxFeePerGas: `0x${decimal(value.maxFeePerGas).toString(16)}`, maxPriorityFeePerGas: `0x${decimal(value.maxPriorityFeePerGas).toString(16)}` };
  return validateUsdtGasPrice({ slow: tier, standard: tier, fast: tier }).fast;
}
export function validateUsdtBoundOperationV2(value: unknown): UsdtBoundOperationV2 {
  try {
    if (!isPlainRecord(value) || !exactKeys(value, ["schemaVersion", "operationId", "profileHash", "idempotencyKey", "binding", "createdAt", "signerBoundary", "dispatch", "usageReservation", "integrityHash"]) ||
      value.schemaVersion !== USDT_BOUND_V2_SCHEMA || !hash(value.operationId) || !hash(value.profileHash) || !hash(value.integrityHash) ||
      typeof value.idempotencyKey !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value.idempotencyKey) ||
      value.signerBoundary !== "unavailable" || value.dispatch !== "disabled" || value.usageReservation !== "disabled" ||
      typeof value.createdAt !== "string" || !Number.isFinite(Date.parse(value.createdAt)) || new Date(value.createdAt).toISOString() !== value.createdAt) fail();
    const b = value.binding;
    if (!isPlainRecord(b) || !exactKeys(b, ["schemaVersion", "profile", "policyDigest", "policyRevision", "activationDigest", "chain", "token", "mechanism", "sponsorUrl", "safeBlockNumber", "safeBlockHash", "account", "plan", "callData", "paymaster", "paymasterData", "unsignedOperation", "quoteFacts", "sponsorAuth", "bindingHash"]) ||
      b.schemaVersion !== "apn.gasless-usdt-policy-prepare.v2" || typeof b.profile !== "string" || !b.profile || !hash(b.policyDigest) ||
      !hash(b.activationDigest) || !Number.isSafeInteger(b.policyRevision) || (b.policyRevision as number) < 1 || b.chain !== USDT_GASLESS.chain ||
      b.token !== USDT_GASLESS.token || b.sponsorUrl !== USDT_GASLESS.bundlerUrl || canonicalJson(b.mechanism) !== canonicalJson(USDT_GASLESS.mechanism) ||
      decimal(b.safeBlockNumber) < 1n || typeof b.safeBlockHash !== "string" || !/^0x[0-9a-f]{64}$/u.test(b.safeBlockHash)) fail();
    if (!isPlainRecord(b.account) || !exactKeys(b.account, ["usdtBalanceAtomic", "entryPointNonce", "eoaNonce", "delegation"]) ||
      !["empty", "expected"].includes(b.account.delegation as string) || !isPlainRecord(b.plan) || !isPlainRecord(b.plan.request) ||
      !isPlainRecord(b.quoteFacts) || !exactKeys(b.quoteFacts, ["initialQuote", "initialPrice", "freshQuote", "freshPrice", "changedFields"])) fail();
    const r = b.plan.request;
    const request = { sender: r.sender as Address, recipient: r.recipient as Address, grossAtomic: decimal(r.grossAtomic),
      maxFeeAtomic: decimal(r.maxFeeAtomic), minReceivedAtomic: decimal(r.minReceivedAtomic) };
    if (getAddress(request.sender) !== request.sender || getAddress(request.recipient) !== request.recipient ||
      [request.sender, USDT_GASLESS.token, USDT_GASLESS.paymaster, USDT_GASLESS.entryPoint, USDT_GASLESS.delegate, USDT_GASLESS.treasury].includes(request.recipient)) fail();
    const initialQuote = quote(b.quoteFacts.initialQuote), initialPrice = price(b.quoteFacts.initialPrice),
      freshQuote = quote(b.quoteFacts.freshQuote), freshPrice = price(b.quoteFacts.freshPrice);
    const facts = { initialQuote, initialPrice, freshQuote, freshPrice, changedFields: usdtQuoteChangedFields(initialQuote, initialPrice, freshQuote, freshPrice) };
    if (canonicalJson(serial(facts)) !== canonicalJson(b.quoteFacts)) fail();
    const draft = draftUsdtV2(request, initialQuote, initialPrice);
    const { plan, paymaster } = signedUsdtV2({ paymaster: USDT_GASLESS.paymaster, paymasterData: b.paymasterData }, draft,
      BigInt(Math.floor(Date.parse(value.createdAt) / 1000)));
    if (canonicalJson(serial(plan)) !== canonicalJson(b.plan) || canonicalJson(serial(paymaster)) !== canonicalJson(b.paymaster) ||
      decimal(b.account.usdtBalanceAtomic) < request.grossAtomic || b.callData !== usdtApprovalTransferBatch(plan)) fail();
    const authorization = b.account.delegation === "empty" ? { chainId: "0x1" as Hex, address: USDT_GASLESS.delegate,
      nonce: `0x${decimal(b.account.eoaNonce).toString(16)}` as Hex, yParity: "0x0" as Hex, r: USDT_PREPARE_STUB_WORD, s: USDT_PREPARE_STUB_WORD } : null;
    if (decimal(b.account.eoaNonce) > BigInt(Number.MAX_SAFE_INTEGER)) fail();
    const op = usdtUserOperation(plan, { entryPointNonce: decimal(b.account.entryPointNonce), callData: b.callData as Hex,
      paymasterData: b.paymasterData as Hex, signature: "0x", authorization });
    if (canonicalJson(op) !== canonicalJson(b.unsignedOperation) || !isPlainRecord(b.sponsorAuth)) fail();
    const auth = b.sponsorAuth;
    assertUsdtV2Evidence(op, auth, { chainId: 1n, blockNumber: decimal(b.safeBlockNumber), blockHash: b.safeBlockHash as Hex, pins: auth.pins as never });
    assertUsdtSponsorWindow(op, { now: () => new Date(auth.capturedAt) });
    if (Date.parse(auth.capturedAt) > Date.parse(value.createdAt)) fail();
    const { bindingHash: _b, ...bindingBody } = b, { integrityHash: _i, ...recordBody } = value;
    if (b.bindingHash !== hashObject(bindingBody) || value.integrityHash !== hashObject(recordBody) ||
      value.operationId !== hashObject({ schemaVersion: USDT_BOUND_V2_SCHEMA, profileHash: value.profileHash, idempotencyKey: value.idempotencyKey, bindingHash: b.bindingHash })) fail();
    const freeze = (v: unknown): void => { if (v !== null && typeof v === "object") { Object.values(v).forEach(freeze); Object.freeze(v); } };
    freeze(value); return value as unknown as UsdtBoundOperationV2;
  } catch { return fail(); }
}
