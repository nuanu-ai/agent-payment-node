import { encodeEventTopics, getAddress, parseAbi } from "viem";
import { canonicalJson, domainHash, exactKeys, isPlainRecord } from "../canonical.js";
import { ApnError } from "../errors.js";
import type { SwapReceiptProof } from "./model.js";
import type { UniswapTransactionEnvelope } from "./uniswap-codec.js";
import { UNISWAP_ROUTER, UNISWAP_USDC } from "./uniswap-pin.js";

const TRANSFER = parseAbi(["event Transfer(address indexed from, address indexed to, uint256 value)"]);
const TRANSFER_TOPIC = encodeEventTopics({ abi: TRANSFER, eventName: "Transfer" })[0];
export interface UniswapReceiptEvidence { readonly transactionHash: `0x${string}`; readonly transaction: { readonly hash: `0x${string}`;
  readonly from: string; readonly to: string; readonly input: `0x${string}`; readonly value: string; readonly blockNumber: string;
  readonly blockHash: `0x${string}` }; readonly receipt: { readonly transactionHash: `0x${string}`; readonly status: "0x1";
  readonly blockNumber: string; readonly blockHash: `0x${string}`; readonly logs: readonly { readonly address: string;
  readonly topics: readonly `0x${string}`[]; readonly data: `0x${string}` }[] }; readonly beforeNative: string;
  readonly afterNative: string; readonly beforeOutput: string; readonly afterOutput: string; readonly finalizedHead: {
  readonly number: string; readonly hash: `0x${string}` }; readonly observedAt: string }

export function validateUniswapReceipt(evidence: UniswapReceiptEvidence, envelope: UniswapTransactionEnvelope,
  expected: { readonly transactionHash: `0x${string}`; readonly account: string; readonly recipient: string;
    readonly inputAmountAtomic: string; readonly minimumOutputAtomic: string }): SwapReceiptProof {
  if (!isPlainRecord(evidence) || !exactKeys(evidence, ["transactionHash", "transaction", "receipt", "beforeNative", "afterNative",
    "beforeOutput", "afterOutput", "finalizedHead", "observedAt"])) fail();
  const hash = expected.transactionHash.toLowerCase(), tx = evidence.transaction, receipt = evidence.receipt;
  if (evidence.transactionHash.toLowerCase() !== hash || tx.hash.toLowerCase() !== hash || receipt.transactionHash.toLowerCase() !== hash ||
      getAddress(tx.from) !== expected.account || getAddress(tx.to) !== UNISWAP_ROUTER || tx.input.toLowerCase() !== envelope.data.toLowerCase() ||
      BigInt(tx.value) !== BigInt(envelope.value) || tx.blockNumber !== receipt.blockNumber || tx.blockHash.toLowerCase() !== receipt.blockHash.toLowerCase() ||
      receipt.status !== "0x1" || BigInt(evidence.beforeNative) - BigInt(evidence.afterNative) < BigInt(expected.inputAmountAtomic) ||
      BigInt(evidence.afterOutput) - BigInt(evidence.beforeOutput) < BigInt(expected.minimumOutputAtomic) ||
      BigInt(evidence.finalizedHead.number) < BigInt(receipt.blockNumber)) fail();
  const recipientTopic = `0x${getAddress(expected.recipient).slice(2).toLowerCase().padStart(64, "0")}`;
  const credited = receipt.logs.filter((log) => getAddress(log.address) === UNISWAP_USDC && log.topics.length === 3 &&
    log.topics[0]?.toLowerCase() === TRANSFER_TOPIC.toLowerCase() && log.topics[2]?.toLowerCase() === recipientTopic)
    .reduce((sum, log) => sum + BigInt(log.data), 0n);
  if (credited < BigInt(expected.minimumOutputAtomic)) fail();
  const receiptHash = domainHash("apn.uniswap-receipt-proof.v1", canonicalJson({ evidence, envelope, expected }));
  return { receiptHash, transactionHash: expected.transactionHash, observedAt: evidence.observedAt, finalized: true };
}
function fail(): never { throw new ApnError("APN_OPERATION_BLOCKED", "Uniswap receipt does not prove the exact successful finalized swap.", { reason: "uniswap_receipt" }); }
