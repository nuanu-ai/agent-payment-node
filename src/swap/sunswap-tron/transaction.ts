import { utils } from "tronweb";
import { canonicalJson, exactKeys, isPlainRecord, sha256 } from "../../canonical.js";
import { ApnError } from "../../errors.js";
import { tronAddress, tronHash, tronHex } from "../../tron/codec.js";
import { decodeSunSwapCalldata, type SunSwapCalldataIntent } from "./calldata.js";
import { SUNSWAP_V2_ROUTER } from "./catalog.js";

export interface SunSwapTransactionBounds {
  readonly maximumEnergy: string; readonly energyPriceSun: string; readonly maximumFeeLimitSun: string;
}
export interface SunSwapUnsignedIntent extends SunSwapCalldataIntent, SunSwapTransactionBounds {
  readonly calldata: string; readonly callValueAtomic: string; readonly referenceBlockId: string;
  readonly timestampMs: string; readonly expirationMs: string; readonly feeLimitSun: string;
}
export interface SunSwapUnsignedTransaction {
  readonly visible: false; readonly txID: string; readonly raw_data_hex: string;
  readonly raw_data: {
    readonly contract: readonly [{ readonly type: "TriggerSmartContract"; readonly parameter: { readonly type_url: "type.googleapis.com/protocol.TriggerSmartContract"; readonly value: {
      readonly owner_address: string; readonly contract_address: string; readonly data: string; readonly call_value: number;
    } } }];
    readonly ref_block_bytes: string; readonly ref_block_hash: string; readonly timestamp: number; readonly expiration: number; readonly fee_limit: number;
  };
}

export function buildSunSwapUnsignedTransaction(input: SunSwapUnsignedIntent): SunSwapUnsignedTransaction {
  if (!isPlainRecord(input) || !exactKeys(input, ["owner", "recipient", "inputAmountAtomic", "minimumOutputAtomic", "deadlineSeconds",
    "maximumEnergy", "energyPriceSun", "maximumFeeLimitSun", "calldata", "callValueAtomic", "referenceBlockId", "timestampMs",
    "expirationMs", "feeLimitSun"])) invalid();
  validateEnergyBounds(input); tronHash(input.referenceBlockId);
  decodeSunSwapCalldata(input.calldata, input.callValueAtomic, { owner: input.owner, recipient: input.recipient,
    inputAmountAtomic: input.inputAmountAtomic, minimumOutputAtomic: input.minimumOutputAtomic, deadlineSeconds: input.deadlineSeconds });
  const timestamp = safe(input.timestampMs), expiration = safe(input.expirationMs), feeLimit = safe(input.feeLimitSun), callValue = safe(input.callValueAtomic);
  const deadlineMs = positive(input.deadlineSeconds) * 1_000n;
  if (expiration <= timestamp || expiration - timestamp > 600_000 || deadlineMs < BigInt(timestamp) || deadlineMs > BigInt(expiration)) invalid();
  const raw_data = {
    contract: [{ type: "TriggerSmartContract" as const, parameter: { type_url: "type.googleapis.com/protocol.TriggerSmartContract" as const,
      value: { owner_address: tronHex(input.owner), contract_address: tronHex(SUNSWAP_V2_ROUTER), data: input.calldata.slice(2), call_value: callValue } } }] as const,
    ref_block_bytes: input.referenceBlockId.slice(12, 16), ref_block_hash: input.referenceBlockId.slice(16, 32), timestamp, expiration, fee_limit: feeLimit,
  };
  try {
    const pb = utils.transaction.txJsonToPb({ visible: false, raw_data });
    const raw_data_hex = utils.transaction.txPbToRawDataHex(pb).toLowerCase(); const txID = sha256(Buffer.from(raw_data_hex, "hex"));
    if (utils.transaction.txPbToTxID(pb).replace(/^0x/u, "").toLowerCase() !== txID) invalid();
    return { visible: false, txID, raw_data_hex, raw_data };
  } catch { return invalid(); }
}

export function validateSunSwapUnsignedTransaction(value: unknown, intent: SunSwapUnsignedIntent): SunSwapUnsignedTransaction {
  const expected = buildSunSwapUnsignedTransaction(intent);
  if (!sameShape(value, expected) || canonicalJson(value) !== canonicalJson(expected)) {
    throw new ApnError("APN_WALLET_MISMATCH", "Unsigned SunSwap TriggerSmartContract drifted from the frozen intent.");
  }
  return expected;
}

export function validateEnergyBounds(input: SunSwapTransactionBounds & { readonly feeLimitSun: string }): void {
  const energy = positive(input.maximumEnergy), price = positive(input.energyPriceSun), maximum = positive(input.maximumFeeLimitSun), fee = positive(input.feeLimitSun);
  if (fee > maximum || energy * price > fee) throw new ApnError("APN_FEE_BUDGET_EXCEEDED", "SunSwap energy or fee_limit exceeds the frozen budget.");
}
export function sunSwapUnsignedPayloadHash(transaction: SunSwapUnsignedTransaction): string { return sha256(canonicalJson(transaction)); }
function positive(value: string): bigint { if (!/^[1-9][0-9]{0,77}$/u.test(value)) invalid(); return BigInt(value); }
function safe(value: string): number { const number = positive(value); if (number > BigInt(Number.MAX_SAFE_INTEGER)) invalid(); return Number(number); }
function invalid(): never { throw new ApnError("APN_INVALID_INPUT", "SunSwap unsigned transaction or resource bounds are invalid."); }
function sameShape(value: unknown, expected: unknown): boolean {
  if (Array.isArray(expected)) {
    if (!Array.isArray(value) || value.length !== expected.length) return false;
    for (let index = 0; index < expected.length; index++) if (!Object.hasOwn(value, index) || !sameShape(value[index], expected[index])) return false;
    return true;
  }
  if (expected !== null && typeof expected === "object") {
    if (!isPlainRecord(value)) return false;
    const keys = Object.keys(expected); if (!exactKeys(value, keys)) return false;
    return keys.every((key) => sameShape(value[key], (expected as Record<string, unknown>)[key]));
  }
  return typeof value === typeof expected;
}
