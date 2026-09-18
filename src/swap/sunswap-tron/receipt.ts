import { canonicalJson, domainHash, exactKeys, isPlainRecord } from "../../canonical.js";
import { ApnError } from "../../errors.js";
import { TRON_TRANSFER_TOPIC, tronAddress, tronHex } from "../../tron/codec.js";
import type { TronRpcPort } from "../../tron/rpc.js";
import { SUNSWAP_USDT, SUNSWAP_V2_ROUTER, SUNSWAP_V2_WTRX_USDT_PAIR, SUNSWAP_WTRX } from "./catalog.js";
import { normalizeTronEvidence } from "./tron-call.js";

const SWAP_TOPIC = "d78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822";
const DEPOSIT_TOPIC = "e1fffcc4923d04b559f4d29a8bfc6cda04eb5b0d3c460751c2402c5c5cc9109c";

export interface SunSwapReceiptExpectation {
  readonly transactionHash: string; readonly recipient: string; readonly inputAmountAtomic: string;
  readonly minimumOutputAtomic: string; readonly unsignedRawDataHex: string; readonly maximumFeeSun: string;
}
export interface SunSwapReceiptValidation {
  readonly transactionHash: string; readonly blockNumber: string; readonly solidifiedHeadNumber: string;
  readonly inputAmountAtomic: string; readonly outputAmountAtomic: string; readonly feeSun: string; readonly trxDebitSun: string;
  readonly finalized: true; readonly receiptHash: string;
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

/**
 * Proves one solidified successful V2 swap: exact txid and bytes, owner debit = call_value (input) + fee, one WTRX
 * deposit of the input by the router, one pair Swap to the owner, and one USDT Transfer from the pair to the owner >= minOut.
 */
export function validateSunSwapReceipt(transactionValue: unknown, infoValue: unknown, solidifiedHeadNumber: string,
  expected: SunSwapReceiptExpectation): SunSwapReceiptValidation {
  if (!isPlainRecord(expected) || !exactKeys(expected, ["transactionHash", "recipient", "inputAmountAtomic", "minimumOutputAtomic",
    "unsignedRawDataHex", "maximumFeeSun"]) || !/^[a-f0-9]{64}$/u.test(expected.transactionHash) ||
      !/^[1-9][0-9]{0,15}$/u.test(expected.inputAmountAtomic) || !/^[1-9][0-9]{0,77}$/u.test(expected.minimumOutputAtomic) ||
      !/^[1-9][0-9]{0,77}$/u.test(expected.maximumFeeSun) || !/^[a-f0-9]+$/u.test(expected.unsignedRawDataHex) ||
      expected.unsignedRawDataHex.length % 2 !== 0 || typeof expected.recipient !== "string" || canonical(expected.recipient) !== expected.recipient) fail();
  const transaction = record(transactionValue), info = record(infoValue), ret = array(transaction.ret, 1);
  if (transaction.txID !== expected.transactionHash || transaction.raw_data_hex !== expected.unsignedRawDataHex || ret.length !== 1 ||
      !isPlainRecord(ret[0]) || ret[0].contractRet !== "SUCCESS" || info.id !== expected.transactionHash) fail();
  const contracts = array(record(transaction.raw_data).contract, 1);
  if (contracts.length !== 1) fail();
  const call = record(record(record(contracts[0]).parameter).value);
  if (call.owner_address !== tronHex(expected.recipient) || call.contract_address !== tronHex(SUNSWAP_V2_ROUTER) ||
      integer(call.call_value).toString() !== expected.inputAmountAtomic) fail();
  const receipt = record(info.receipt); if (receipt.result !== "SUCCESS") fail();
  const block = integer(info.blockNumber), solid = integer(solidifiedHeadNumber), fee = info.fee === undefined ? 0n : integer(info.fee);
  if (block <= 0n || solid < block || fee > BigInt(expected.maximumFeeSun)) fail();
  const input = BigInt(expected.inputAmountAtomic), owner = word(expected.recipient), router = word(SUNSWAP_V2_ROUTER);
  const logs = array(info.log, 64);
  const transfer = single(logs, SUNSWAP_USDT, TRON_TRANSFER_TOPIC, 3, 64);
  if (transfer.topics[1] !== word(SUNSWAP_V2_WTRX_USDT_PAIR) || transfer.topics[2] !== owner) fail();
  const output = transfer.words[0]!; if (output < BigInt(expected.minimumOutputAtomic)) fail();
  const swap = single(logs, SUNSWAP_V2_WTRX_USDT_PAIR, SWAP_TOPIC, 3, 256);
  if (swap.topics[1] !== router || swap.topics[2] !== owner || swap.words[0] !== input || swap.words[1] !== 0n ||
      swap.words[2] !== 0n || swap.words[3] !== output) fail();
  const deposit = single(logs, SUNSWAP_WTRX, DEPOSIT_TOPIC, 2, 64);
  if (deposit.topics[1] !== router || deposit.words[0] !== input) fail();
  const body = { transactionHash: expected.transactionHash, blockNumber: block.toString(), solidifiedHeadNumber: solid.toString(),
    inputAmountAtomic: input.toString(), outputAmountAtomic: output.toString(), feeSun: fee.toString(),
    trxDebitSun: (input + fee).toString(), finalized: true as const };
  return { ...body, receiptHash: domainHash("apn.sunswap-tron-v2-receipt.v1",
    canonicalJson(normalizeTronEvidence({ transaction, info, ...body }))) };
}

interface MatchedLog { readonly topics: readonly string[]; readonly words: readonly bigint[] }
function single(logs: readonly unknown[], contract: string, topic: string, topicCount: number, dataLength: number): MatchedLog {
  const address = tronHex(contract).slice(2);
  const matches = logs.filter((item) => isPlainRecord(item) && item.address === address && Array.isArray(item.topics) &&
    item.topics[0] === topic);
  if (matches.length !== 1) fail();
  const log = record(matches[0]), topics = array(log.topics, 4);
  if (topics.length !== topicCount || topics.some((item) => typeof item !== "string" || !/^[a-f0-9]{64}$/u.test(item)) ||
      typeof log.data !== "string" || log.data.length !== dataLength || !/^[a-f0-9]+$/u.test(log.data)) fail();
  const words: bigint[] = [];
  for (let offset = 0; offset < dataLength; offset += 64) words.push(BigInt(`0x${(log.data as string).slice(offset, offset + 64)}`));
  return { topics: topics as readonly string[], words };
}
function word(address: string): string { return tronHex(address).slice(2).padStart(64, "0"); }
function canonical(value: string): string { try { return tronAddress(value); } catch { return fail(); } }
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
function fail(): never { throw new ApnError("APN_RPC_PROTOCOL", "Solidified SunSwap receipt does not prove the exact successful V2 swap to the owner."); }
