import { canonicalJson, domainHash, exactKeys, isPlainRecord } from "../../canonical.js";
import { ApnError } from "../../errors.js";
import { TRON_TRANSFER_TOPIC, tronHex } from "../../tron/codec.js";
import type { TronRpcPort } from "../../tron/rpc.js";
import { SUNSWAP_USDT } from "./catalog.js";

export interface SunSwapReceiptExpectation {
  readonly transactionHash: string; readonly recipient: string; readonly minimumOutputAtomic: string;
  readonly unsignedRawDataHex: string; readonly maximumFeeSun: string;
}
export interface SunSwapReceiptValidation {
  readonly transactionHash: string; readonly blockNumber: string; readonly solidifiedHeadNumber: string;
  readonly outputAmountAtomic: string; readonly feeSun: string; readonly finalized: true; readonly receiptHash: string;
}

export async function observeSunSwapReceipt(rpc: TronRpcPort, expected: SunSwapReceiptExpectation): Promise<SunSwapReceiptValidation> {
  const [transaction, info, head] = await Promise.all([
    rpc.call("walletsolidity/gettransactionbyid", { value: expected.transactionHash }),
    rpc.call("walletsolidity/gettransactioninfobyid", { value: expected.transactionHash }),
    rpc.call("walletsolidity/getnowblock", {}),
  ]);
  const headRecord = record(record(record(head).block_header).raw_data); const solid = integer(headRecord.number);
  return validateSunSwapReceipt(transaction, info, solid.toString(), expected);
}

export function validateSunSwapReceipt(transactionValue: unknown, infoValue: unknown, solidifiedHeadNumber: string,
  expected: SunSwapReceiptExpectation): SunSwapReceiptValidation {
  if (!isPlainRecord(expected) || !exactKeys(expected, ["transactionHash", "recipient", "minimumOutputAtomic", "unsignedRawDataHex", "maximumFeeSun"]) ||
      !/^[a-f0-9]{64}$/u.test(expected.transactionHash) || !/^[1-9][0-9]{0,77}$/u.test(expected.minimumOutputAtomic) ||
      !/^[1-9][0-9]{0,77}$/u.test(expected.maximumFeeSun) || !/^[a-f0-9]+$/u.test(expected.unsignedRawDataHex) || expected.unsignedRawDataHex.length % 2 !== 0) fail();
  const transaction = record(transactionValue), info = record(infoValue), ret = array(transaction.ret, 1);
  if (transaction.txID !== expected.transactionHash || transaction.raw_data_hex !== expected.unsignedRawDataHex || ret.length !== 1 ||
      !isPlainRecord(ret[0]) || ret[0].contractRet !== "SUCCESS" || info.id !== expected.transactionHash) fail();
  const receipt = record(info.receipt); if (receipt.result !== "SUCCESS") fail();
  const block = integer(info.blockNumber), solid = integer(solidifiedHeadNumber), fee = integer(info.fee);
  if (block <= 0n || solid < block || fee > BigInt(expected.maximumFeeSun)) fail();
  const recipientTopic = tronHex(expected.recipient).slice(2).padStart(64, "0"); const token = tronHex(SUNSWAP_USDT).slice(2);
  const transfers = array(info.log, 64).filter((item) => {
    if (!isPlainRecord(item) || item.address !== token || !Array.isArray(item.topics)) return false;
    return item.topics.length === 3 && item.topics[0] === TRON_TRANSFER_TOPIC && item.topics[2] === recipientTopic;
  });
  if (transfers.length !== 1) fail(); const transfer = record(transfers[0]);
  if (typeof transfer.data !== "string" || !/^[a-fA-F0-9]{64}$/u.test(transfer.data)) fail();
  const output = BigInt(`0x${transfer.data}`); if (output < BigInt(expected.minimumOutputAtomic)) fail();
  const body = { transactionHash: expected.transactionHash, blockNumber: block.toString(), solidifiedHeadNumber: solid.toString(),
    outputAmountAtomic: output.toString(), feeSun: fee.toString(), finalized: true as const };
  return { ...body, receiptHash: domainHash("apn.sunswap-tron-receipt.v1", canonicalJson({ transaction, info, ...body })) };
}
function record(value: unknown): Record<string, unknown> { if (!isPlainRecord(value)) fail(); return value; }
function array(value: unknown, maximum: number): readonly unknown[] {
  if (!Array.isArray(value) || value.length > maximum) fail();
  for (let index = 0; index < value.length; index++) if (!Object.hasOwn(value, index)) fail();
  return value;
}
function integer(value: unknown): bigint {
  if (typeof value === "number" && !Number.isSafeInteger(value)) fail();
  if ((typeof value !== "string" && typeof value !== "number" && typeof value !== "bigint") || !/^[0-9]+$/u.test(String(value))) fail();
  return BigInt(value);
}
function fail(): never { throw new ApnError("APN_RPC_PROTOCOL", "Solidified SunSwap receipt does not prove the exact successful USDT output."); }
