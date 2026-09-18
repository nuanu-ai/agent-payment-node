import { canonicalJson, domainHash, isPlainRecord } from "../../canonical.js";
import { ApnError } from "../../errors.js";
import { tronHex } from "../../tron/codec.js";
import { validateSwapOperation, type SwapOperationRecord, type SwapReceiptProof } from "../model.js";
import { SUNSWAP_V2_ROUTER } from "./catalog.js";
import type { SunSwapObservationRpcPort } from "./observer.js";
import { validateSunSwapPreparedMaterial, type SunSwapPreparedMaterial } from "./prepared.js";
import { validateSunSwapReceipt, type SunSwapReceiptExpectation } from "./receipt.js";
import { normalizeTronEvidence } from "./tron-call.js";

/** Failed contract results TRON records in a block: state, including the call value, is rolled back and only fees burn. */
const FAILED_RESULTS = new Set(["REVERT", "BAD_JUMP_DESTINATION", "OUT_OF_MEMORY", "PRECOMPILED_CONTRACT", "STACK_TOO_SMALL",
  "STACK_TOO_LARGE", "ILLEGAL_OPERATION", "STACK_OVERFLOW", "OUT_OF_ENERGY", "OUT_OF_TIME", "JVM_STACK_OVER_FLOW",
  "TRANSFER_FAILED", "INVALID_CODE"]);

export type SunSwapObservedOutcome = { readonly outcome: "succeeded" | "reverted"; readonly proof: SwapReceiptProof };

/**
 * Observe-only outcome reader for the exact prepared transaction. Null means not yet solidified. Success needs the
 * full receipt proof; a failed contract result needs the same transaction bytes, fee bounds and no emitted logs, from
 * both full-node and solidified history.
 */
export class SunSwapOutcomeObserver {
  constructor(private readonly rpc: SunSwapObservationRpcPort, private readonly now: () => Date) {}

  async observeOutcome(operationValue: SwapOperationRecord, materialValue: SunSwapPreparedMaterial): Promise<SunSwapObservedOutcome | null> {
    const operation = validateSwapOperation(operationValue), material = validateSunSwapPreparedMaterial(materialValue, "stored");
    if (operation.submissionMarker === null || material.quote.quoteHash !== operation.quote.quoteHash) {
      blocked("SunSwap observation is forbidden before the durable submission marker.");
    }
    const txid = material.execution.transaction.txID;
    let fullTx: unknown, fullInfo: unknown, solidTx: unknown, solidInfo: unknown, head: unknown;
    try {
      [fullTx, fullInfo, solidTx, solidInfo, head] = await Promise.all([
        this.rpc.call("wallet/gettransactionbyid", { value: txid }), this.rpc.call("wallet/gettransactioninfobyid", { value: txid }),
        this.rpc.call("walletsolidity/gettransactionbyid", { value: txid }), this.rpc.call("walletsolidity/gettransactioninfobyid", { value: txid }),
        this.rpc.call("walletsolidity/getnowblock", {}),
      ]);
    } catch { return conflict(); }
    if (empty(solidTx) || empty(solidInfo)) return null;
    const expected: SunSwapReceiptExpectation = { transactionHash: txid, recipient: operation.quote.recipient,
      inputAmountAtomic: operation.quote.inputAmountAtomic, minimumOutputAtomic: operation.quote.minimumOutputAtomic,
      unsignedRawDataHex: material.execution.transaction.raw_data_hex, maximumFeeSun: material.execution.intent.feeLimitSun,
      maximumBandwidthFeeSun: required(material.gasOrEnergy.maximumBandwidthFeeSun) };
    const solid = solidHead(head), succeeded = contractResult(solidTx) === "SUCCESS";
    const validate = succeeded ? validateSunSwapReceipt : validateSunSwapFailure;
    const full = validate(fullTx, fullInfo, solid, expected), finalized = validate(solidTx, solidInfo, solid, expected);
    if (full.receiptHash !== finalized.receiptHash) conflict();
    const observedAt = this.now();
    if (!(observedAt instanceof Date) || !Number.isFinite(observedAt.getTime())) conflict();
    return { outcome: succeeded ? "succeeded" : "reverted", proof: { receiptHash: finalized.receiptHash,
      transactionHash: txid, observedAt: observedAt.toISOString(), finalized: true } };
  }
}

/** A solidified failed call: exact bytes, one failed result on both records, fees within the frozen bounds, no logs. */
export function validateSunSwapFailure(transactionValue: unknown, infoValue: unknown, solidifiedHeadNumber: string,
  expected: SunSwapReceiptExpectation): { readonly receiptHash: string } {
  const transaction = record(transactionValue), info = record(infoValue), ret = transaction.ret;
  if (transaction.txID !== expected.transactionHash || transaction.raw_data_hex !== expected.unsignedRawDataHex || !Array.isArray(ret) ||
      ret.length !== 1 || !isPlainRecord(ret[0]) || typeof ret[0].contractRet !== "string" || !FAILED_RESULTS.has(ret[0].contractRet) ||
      info.id !== expected.transactionHash || info.result !== "FAILED") conflict();
  const result = (ret[0] as Record<string, unknown>).contractRet as string, receipt = record(info.receipt);
  const contracts = record(transaction.raw_data).contract;
  if (receipt.result !== result || !Array.isArray(contracts) || contracts.length !== 1) conflict();
  const call = record(record(record(contracts[0]).parameter).value);
  if (call.owner_address !== tronHex(expected.recipient) || call.contract_address !== tronHex(SUNSWAP_V2_ROUTER) ||
      integer(call.call_value).toString() !== expected.inputAmountAtomic) conflict();
  if (info.log !== undefined && (!Array.isArray(info.log) || info.log.length !== 0)) conflict();
  const block = integer(info.blockNumber), solid = integer(solidifiedHeadNumber), fee = optional(info.fee);
  const energyFee = optional(receipt.energy_fee), bandwidthFee = optional(receipt.net_fee);
  if (block <= 0n || solid < block || fee !== energyFee + bandwidthFee || energyFee > BigInt(expected.maximumFeeSun) ||
      bandwidthFee > BigInt(expected.maximumBandwidthFeeSun)) conflict();
  const body = { transactionHash: expected.transactionHash, blockNumber: block.toString(), solidifiedHeadNumber: solid.toString(),
    contractResult: result, inputAmountAtomic: "0", feeSun: fee.toString(), trxDebitSun: fee.toString(), finalized: true as const };
  return { receiptHash: domainHash("apn.sunswap-tron-v2-failed-call.v1", canonicalJson(normalizeTronEvidence({ transaction, info, ...body }))) };
}

function contractResult(value: unknown): unknown {
  const ret = record(value).ret;
  return Array.isArray(ret) && ret.length === 1 && isPlainRecord(ret[0]) ? ret[0].contractRet : conflict();
}
function empty(value: unknown): boolean { return isPlainRecord(value) && Object.keys(value).length === 0; }
function solidHead(value: unknown): string {
  const number = record(record(record(value).block_header).raw_data).number;
  return integer(number).toString();
}
function required(value: string | undefined): string { if (value === undefined) conflict(); return value; }
function record(value: unknown): Record<string, unknown> { if (!isPlainRecord(value)) conflict(); return value; }
function optional(value: unknown): bigint { return value === undefined ? 0n : integer(value); }
function integer(value: unknown): bigint {
  if (typeof value === "number" && !Number.isSafeInteger(value)) conflict();
  if ((typeof value !== "string" && typeof value !== "number" && typeof value !== "bigint") || !/^[0-9]+$/u.test(String(value))) conflict();
  return BigInt(value);
}
function conflict(): never { throw new ApnError("APN_RPC_PROTOCOL", "SunSwap full-node and solidified history is missing, conflicting, or not finalized."); }
function blocked(message: string): never { throw new ApnError("APN_OPERATION_BLOCKED", message, { reason: "sunswap_observation_before_marker" }); }
