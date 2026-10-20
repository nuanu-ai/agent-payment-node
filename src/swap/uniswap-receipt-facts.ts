import { ApnError } from "../errors.js";
import { evmRpcAddress, evmRpcHex, evmRpcQuantity, evmRpcRecord } from "../evm-rpc-codec.js";
import type { SwapOperationRecord, SwapReceiptEconomics } from "./model.js";
import { uniswapCredited, uniswapFeeAtomic, uniswapReceiptFee } from "./uniswap-receipt.js";
import { UNISWAP_ROUTER } from "./uniswap-pin.js";
import { UNISWAP_WETH9 } from "./uniswap-v3/pins.js";

const DEPOSIT_TOPIC = "0xe1fffcc4923d04b559f4d29a8bfc6cda04eb5b0d3c460751c2402c5c5cc9109c";

/**
 * The economics of a Uniswap swap its record proved finalized, from that transaction's own receipt (read once, P1: no
 * state at an old block): the router's single WETH9 Deposit of the native input, the output token's Transfer credit to
 * the recipient, and gasUsed x effectiveGasPrice. The receipt must be the record's transaction, from its account to the
 * router, with the outcome the record holds, at or below the finalized head.
 */
export function uniswapEconomicsFromReceipt(record: SwapOperationRecord, receiptValue: unknown, finalizedHead: { readonly number: string }): SwapReceiptEconomics {
  const receipt = evmRpcRecord(receiptValue), hash = record.receiptProof?.transactionHash.toLowerCase();
  const blockHash = evmRpcHex(receipt.blockHash, 32), block = evmRpcQuantity(receipt.blockNumber), status = evmRpcQuantity(receipt.status);
  if (hash === undefined || evmRpcHex(receipt.transactionHash, 32) !== hash || evmRpcAddress(receipt.from) !== record.quote.account ||
    evmRpcAddress(receipt.to) !== UNISWAP_ROUTER || BigInt(finalizedHead.number) < block || (status === 1n) !== (record.state === "finalized") ||
    (status !== 1n && status !== 0n) || !Array.isArray(receipt.logs) || receipt.logs.length > 4096) binding();
  const logs = (receipt.logs as unknown[]).map(value => {
    const log = evmRpcRecord(value);
    if (!Array.isArray(log.topics) || log.topics.length > 4 || evmRpcHex(log.transactionHash, 32) !== hash || evmRpcHex(log.blockHash, 32) !== blockHash ||
      evmRpcQuantity(log.blockNumber) !== block || log.removed !== false) binding();
    return { address: evmRpcAddress(log.address), topics: (log.topics as unknown[]).map(topic => evmRpcHex(topic, 32)), data: evmRpcHex(log.data) };
  });
  const fee = uniswapFeeAtomic(uniswapReceiptFee(receipt));
  if (status === 0n) {
    if (logs.length !== 0) binding();
    return { inputAtomic: "0", outputAtomic: null, networkFeeAtomic: fee?.toString() ?? null, nativeDebitAtomic: fee?.toString() ?? null };
  }
  const router = `0x${UNISWAP_ROUTER.slice(2).toLowerCase().padStart(64, "0")}`;
  const deposits = logs.filter(log => log.address === UNISWAP_WETH9 && log.topics[0] === DEPOSIT_TOPIC);
  if (deposits.length !== 1 || deposits[0]!.topics.length !== 2 || deposits[0]!.topics[1] !== router || !/^0x[0-9a-f]{64}$/u.test(deposits[0]!.data)) binding();
  const input = BigInt(deposits[0]!.data), token = record.quote.destinationAsset.identifier;
  if (input !== BigInt(record.quote.inputAmountAtomic) || token === null) binding();
  const output = uniswapCredited(logs, token, record.quote.recipient);
  if (output < BigInt(record.quote.minimumOutputAtomic)) binding();
  return { inputAtomic: input.toString(), outputAtomic: output.toString(), networkFeeAtomic: fee?.toString() ?? null,
    nativeDebitAtomic: fee === null ? null : (input + fee).toString() };
}

function binding(): never {
  throw new ApnError("APN_RPC_PROTOCOL", "The receipt read for the swap economics is not the one this record proved.", { reason: "receipt_facts_binding" });
}
