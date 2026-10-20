import { encodeEventTopics, getAddress, parseAbi } from "viem";
import { canonicalJson, domainHash, exactKeys, isPlainRecord } from "../canonical.js";
import { ApnError } from "../errors.js";
import type { SwapReceiptProof } from "./model.js";
import type { UniswapTransactionEnvelope } from "./uniswap-v3/envelope.js";
import { UNISWAP_ROUTER } from "./uniswap-pin.js";

const TRANSFER = parseAbi(["event Transfer(address indexed from, address indexed to, uint256 value)"]);
const TRANSFER_TOPIC = encodeEventTopics({ abi: TRANSFER, eventName: "Transfer" })[0];
export interface UniswapReceiptEvidence { readonly transactionHash: `0x${string}`; readonly transaction: { readonly hash: `0x${string}`;
  readonly from: string; readonly to: string; readonly input: `0x${string}`; readonly value: string; readonly blockNumber: string;
  readonly blockHash: `0x${string}` }; readonly receipt: { readonly transactionHash: `0x${string}`; readonly status: "0x1";
  readonly blockNumber: string; readonly blockHash: `0x${string}`; readonly logs: readonly { readonly address: string;
  readonly topics: readonly `0x${string}`[]; readonly data: `0x${string}` }[] } & UniswapReceiptFee; readonly beforeNative: string;
  readonly afterNative: string; readonly beforeOutput: string; readonly afterOutput: string; readonly finalizedHead: {
  readonly number: string; readonly hash: `0x${string}` }; readonly observedAt: string }

/** Ethereum charges a type-0/2 transaction gasUsed x effectiveGasPrice; both come from the receipt or neither is kept. */
export type UniswapReceiptFee = { readonly gasUsed?: string; readonly effectiveGasPrice?: string };
export function uniswapReceiptFee(receipt: Readonly<Record<string, unknown>>): UniswapReceiptFee {
  const read = (value: unknown) => typeof value === "string" && /^0x[0-9a-fA-F]{1,64}$/u.test(value) ? BigInt(value).toString() : undefined;
  const gasUsed = read(receipt.gasUsed), effectiveGasPrice = read(receipt.effectiveGasPrice);
  return gasUsed === undefined || effectiveGasPrice === undefined ? {} : { gasUsed, effectiveGasPrice };
}
export function uniswapFeeAtomic(fee: UniswapReceiptFee): bigint | null {
  return fee.gasUsed === undefined || fee.effectiveGasPrice === undefined ? null : quantity(fee.gasUsed) * quantity(fee.effectiveGasPrice);
}

export function validateUniswapReceipt(evidence: UniswapReceiptEvidence, envelope: UniswapTransactionEnvelope,
  expected: { readonly transactionHash: `0x${string}`; readonly account: string; readonly recipient: string;
    readonly inputAmountAtomic: string; readonly minimumOutputAtomic: string; readonly outputToken: string }): SwapReceiptProof {
  if (!isPlainRecord(evidence) || !exactKeys(evidence, ["transactionHash", "transaction", "receipt", "beforeNative", "afterNative",
    "beforeOutput", "afterOutput", "finalizedHead", "observedAt"])) fail();
  if (!isPlainRecord(evidence.transaction) || !exactKeys(evidence.transaction, ["hash", "from", "to", "input", "value", "blockNumber", "blockHash"]) ||
      !isPlainRecord(evidence.receipt) || !exactKeys(evidence.receipt, ["transactionHash", "status", "blockNumber", "blockHash", "logs",
        ...(evidence.receipt.gasUsed === undefined ? [] : ["gasUsed", "effectiveGasPrice"])]) ||
      !Array.isArray(evidence.receipt.logs) || evidence.receipt.logs.length > 4096 ||
      evidence.receipt.logs.some((log) => !isPlainRecord(log) || !exactKeys(log, ["address", "topics", "data"]) ||
        !Array.isArray(log.topics) || log.topics.length > 4 || log.topics.some((topic) => !hexWord(topic)) || !hexData(log.data)) ||
      !isPlainRecord(evidence.finalizedHead) || !exactKeys(evidence.finalizedHead, ["number", "hash"]) ||
      !hex32(evidence.transactionHash) || !hex32(evidence.transaction.hash) || !hex32(evidence.receipt.transactionHash) ||
      !hex32(evidence.transaction.blockHash) || !hex32(evidence.receipt.blockHash) || !hex32(evidence.finalizedHead.hash) ||
      !hexBytes(evidence.transaction.input) || evidence.receipt.status !== "0x1" ||
      !canonicalInstant(evidence.observedAt)) fail();
  const hash = expected.transactionHash.toLowerCase(), tx = evidence.transaction, receipt = evidence.receipt;
  const beforeNative = quantity(evidence.beforeNative), afterNative = quantity(evidence.afterNative),
    beforeOutput = quantity(evidence.beforeOutput), afterOutput = quantity(evidence.afterOutput),
    inputAmount = quantity(expected.inputAmountAtomic), minimumOutput = quantity(expected.minimumOutputAtomic),
    transactionValue = quantity(tx.value), transactionBlock = quantity(tx.blockNumber), receiptBlock = quantity(receipt.blockNumber),
    finalizedBlock = quantity(evidence.finalizedHead.number);
  if (evidence.transactionHash.toLowerCase() !== hash || tx.hash.toLowerCase() !== hash || receipt.transactionHash.toLowerCase() !== hash ||
      address(tx.from) !== expected.account || address(tx.to) !== UNISWAP_ROUTER || tx.input.toLowerCase() !== envelope.data.toLowerCase() ||
      transactionValue !== quantity(envelope.value) || transactionBlock !== receiptBlock ||
      tx.blockHash.toLowerCase() !== receipt.blockHash.toLowerCase() || beforeNative < afterNative || beforeNative - afterNative < inputAmount ||
      afterOutput < beforeOutput || afterOutput - beforeOutput < minimumOutput || finalizedBlock < receiptBlock) fail();
  const credited = uniswapCredited(receipt.logs, expected.outputToken, expected.recipient);
  if (credited < minimumOutput) fail();
  const receiptHash = domainHash("apn.uniswap-receipt-proof.v1", canonicalJson({ evidence, envelope, expected }));
  // The exact input is the mined value (the router wraps and swaps exactly it); the output is this receipt's credit.
  const fee = uniswapFeeAtomic(receipt);
  return { receiptHash, transactionHash: expected.transactionHash, observedAt: evidence.observedAt, finalized: true,
    economics: { inputAtomic: transactionValue.toString(), outputAtomic: credited.toString(), networkFeeAtomic: fee?.toString() ?? null,
      nativeDebitAtomic: fee === null ? null : (transactionValue + fee).toString() } };
}
/** A pool Swap event carries several data words; only a one-word ERC-20 Transfer of the output token to the recipient counts. */
export function uniswapCredited(logs: readonly { readonly address: string; readonly topics: readonly string[]; readonly data: string }[],
  outputTokenValue: string, recipient: string): bigint {
  const recipientTopic = `0x${address(recipient).slice(2).toLowerCase().padStart(64, "0")}`, outputToken = address(outputTokenValue);
  return logs.filter((log) => address(log.address) === outputToken && log.topics.length === 3 && hexWord(log.data) &&
    log.topics[0]?.toLowerCase() === TRANSFER_TOPIC.toLowerCase() && log.topics[2]?.toLowerCase() === recipientTopic)
    .reduce((sum, log) => sum + BigInt(log.data), 0n);
}
function quantity(value: unknown): bigint {
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]{0,77})$/u.test(value)) fail();
  const parsed = BigInt(value); if (parsed >= 1n << 256n) fail(); return parsed;
}
function address(value: unknown): string { try { if (typeof value !== "string") fail(); return getAddress(value); } catch { return fail(); } }
function hex32(value: unknown): value is `0x${string}` { return typeof value === "string" && /^0x[a-fA-F0-9]{64}$/u.test(value) && !/^0x0{64}$/u.test(value); }
function hexBytes(value: unknown): value is `0x${string}` { return typeof value === "string" && /^0x(?:[a-fA-F0-9]{2})+$/u.test(value); }
function hexWord(value: unknown): value is `0x${string}` { return typeof value === "string" && /^0x[a-fA-F0-9]{64}$/u.test(value); }
function hexData(value: unknown): value is `0x${string}` { return typeof value === "string" && /^0x(?:[a-fA-F0-9]{2})*$/u.test(value); }
function canonicalInstant(value: unknown): boolean { return typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value; }
function fail(): never { throw new ApnError("APN_OPERATION_BLOCKED", "Uniswap receipt does not prove the exact successful finalized swap.", { reason: "uniswap_receipt" }); }
