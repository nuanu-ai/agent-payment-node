/** Candidate-only consistency check over caller-supplied records. It authenticates no chain reads. */
import { hashObject } from "../canonical.js";
import { RELAY_ARBITRUM_USDC, validateRelayArbitrumUsdcEthereumUsdcQuote,
  type RelayArbitrumQuoteIntent } from "./arbitrum-usdc-ethereum-quote.js";
import type { RelayArbitrumSourceProof } from "./arbitrum-source-finality.js";
import type { RelayEthereumUsdcCreditResult } from "./ethereum-usdc-credit-proof.js";
import { ETHEREUM_DEPOSITORY, ETHEREUM_USDC } from "./quote.js";

type Quote = Awaited<ReturnType<typeof validateRelayArbitrumUsdcEthereumUsdcQuote>>;
const HASH = /^0x[0-9a-fA-F]{64}$/u;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/u;
const DATA = /^0x(?:[0-9a-fA-F]{2})*$/u;
const UINT = /^(0|[1-9][0-9]*)$/u;
const DEPOSIT_TOPIC = "0x49fed1d0b752ce30eee63c7a81133f3363b532fec5d4d7dd1ccfd005de4555e1";
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const wordAddress = (word: string): string | null => /^0{24}[0-9a-fA-F]{40}$/u.test(word) ? `0x${word.slice(24).toLowerCase()}` : null;
const topicAddress = (address: string): string => `0x${"0".repeat(24)}${address.slice(2).toLowerCase()}`;

export interface RelayOrderReferenceLog {
  readonly address: string; readonly topics: readonly string[]; readonly data: string;
  readonly transactionHash: string; readonly blockNumber: bigint; readonly blockHash: string;
  readonly removed: boolean; readonly logIndex: bigint;
}
export interface RelayOrderReferenceReceipt {
  readonly transactionHash: string; readonly status: "success" | "reverted";
  readonly blockNumber: bigint; readonly blockHash: string; readonly logs: readonly RelayOrderReferenceLog[];
}
export interface RelayOrderReferenceDestinationTransaction {
  readonly hash: string; readonly chainId: number; readonly blockNumber: bigint;
  readonly blockHash: string; readonly input: string;
}
export interface RelayOrderReferenceDestinationBlock {
  readonly number: bigint; readonly hash: string; readonly timestampSeconds: bigint;
}
export interface RelayOrderReferenceEvidence {
  readonly rawQuote: unknown;
  readonly quoteIntent: RelayArbitrumQuoteIntent;
  readonly quote: Quote;
  readonly sourceProof: RelayArbitrumSourceProof;
  readonly sourceReceipt: RelayOrderReferenceReceipt;
  readonly destinationCredit: RelayEthereumUsdcCreditResult;
  readonly destinationReceipt: RelayOrderReferenceReceipt;
  readonly destinationTransaction: RelayOrderReferenceDestinationTransaction;
  readonly destinationBlock: RelayOrderReferenceDestinationBlock;
}
export type RelayOrderReferenceResult = Readonly<{
  status: "candidate_consistent" | "candidate_mismatch";
  relayOrderFulfillmentProven: false;
  cryptographicCausalityProven: false;
  paidAcceptance: false;
  reason: string | null;
  candidate: null | Readonly<{
    orderId: string; quoteDigest: string; sourceTransactionHash: string;
    sourceBlockHash: string; sourceDepositLogIndex: string;
    destinationTransactionHash: string; destinationBlockHash: string;
    destinationTransferLogIndex: string; creditedAtomic: string;
    destinationTimestampSeconds: string;
    candidateClass: "caller_supplied_order_reference_and_recipient_credit";
  }>;
}>;

function refuse(reason: string): RelayOrderReferenceResult {
  return { status: "candidate_mismatch", relayOrderFulfillmentProven: false,
    cryptographicCausalityProven: false, paidAcceptance: false, reason, candidate: null };
}
function validLogs(receipt: RelayOrderReferenceReceipt): boolean {
  if (!HASH.test(receipt.transactionHash) || !HASH.test(receipt.blockHash) ||
    receipt.blockNumber < 0n || receipt.status !== "success" ||
    !Array.isArray(receipt.logs) || receipt.logs.length > 256) return false;
  const indexes = new Set<string>();
  for (const log of receipt.logs) {
    if (!ADDRESS.test(log.address) || !Array.isArray(log.topics) || log.topics.length > 4 ||
      log.topics.some((topic: string) => !HASH.test(topic)) || !DATA.test(log.data) ||
      !same(log.transactionHash, receipt.transactionHash) || !same(log.blockHash, receipt.blockHash) ||
      log.blockNumber !== receipt.blockNumber || log.removed !== false || log.logIndex < 0n ||
      indexes.has(log.logIndex.toString())) return false;
    indexes.add(log.logIndex.toString());
  }
  return true;
}

/** Useful for detecting inconsistent candidates; caller-supplied records can be forged together. */
export async function inspectRelayOrderReferenceCandidate(e: RelayOrderReferenceEvidence): Promise<RelayOrderReferenceResult> {
  const q = e.quote;
  try {
    const validated = await validateRelayArbitrumUsdcEthereumUsdcQuote(e.rawQuote, e.quoteIntent);
    const { quoteDigest, ...body } = q;
    if (hashObject(body) !== quoteDigest || validated.quoteDigest !== q.quoteDigest ||
      q.schemaVersion !== "apn.relay-arbitrum-usdc-ethereum-usdc-quote.v1" ||
      q.routeReference !== "arbitrum-usdc-ethereum-usdc-observation-v1" ||
      !HASH.test(q.orderId) || !UINT.test(q.principalAtomic) || BigInt(q.principalAtomic) <= 0n ||
      !UINT.test(q.minimumOutputAtomic) || BigInt(q.minimumOutputAtomic) <= 0n ||
      !Number.isSafeInteger(q.deadline) || q.deadline < 0 ||
      !same(q.paymentDetails.depository, ETHEREUM_DEPOSITORY) ||
      !same(q.paymentDetails.currency, RELAY_ARBITRUM_USDC) ||
      q.paymentDetails.amount !== q.principalAtomic || !same(q.deposit.from, q.payer) ||
      !same(q.deposit.to, ETHEREUM_DEPOSITORY) ||
      q.orderData.inputs.length !== 1 ||
      q.orderData.inputs[0]!.payment.chainId !== "arbitrum" ||
      !same(q.orderData.inputs[0]!.payment.currency, RELAY_ARBITRUM_USDC) ||
      q.orderData.inputs[0]!.payment.amount !== q.principalAtomic ||
      !same(q.orderData.output.payments[0]!.recipient, q.recipient) ||
      !same(q.orderData.output.payments[0]!.currency, ETHEREUM_USDC) ||
      q.orderData.output.payments[0]!.minimumAmount !== q.minimumOutputAtomic ||
      q.orderData.output.deadline !== q.deadline || q.orderData.output.calls.length !== 0 ||
      q.orderData.output.payments.length !== 1) return refuse("saved_quote_binding");
  } catch { return refuse("saved_quote_or_signature_invalid"); }

  const source = e.sourceProof, sourceReceipt = e.sourceReceipt;
  if (source.sourceChainId !== 42161 || source.proofClass !== "canonical_safe_source_receipts" ||
    source.destinationDeliveryProven !== false || source.causalLinkCryptographicallyProven !== false ||
    source.paidAcceptance !== false || !validLogs(sourceReceipt) ||
    !same(source.deposit.transactionHash, sourceReceipt.transactionHash) ||
    source.deposit.blockNumber !== sourceReceipt.blockNumber.toString() ||
    !same(source.deposit.blockHash, sourceReceipt.blockHash) ||
    !UINT.test(source.safeHead.number) || BigInt(source.safeHead.number) < sourceReceipt.blockNumber ||
    !HASH.test(source.safeHead.hash)) return refuse("source_safe_receipt_drift");
  const deposits = sourceReceipt.logs.filter(log => same(log.address, ETHEREUM_DEPOSITORY) &&
    log.topics[0] !== undefined && same(log.topics[0], DEPOSIT_TOPIC));
  if (deposits.length !== 1 || deposits[0]!.topics.length !== 1 ||
    !/^0x[0-9a-fA-F]{256}$/u.test(deposits[0]!.data)) return refuse("source_deposit_event_missing_or_ambiguous");
  const words = deposits[0]!.data.slice(2).match(/.{64}/gu)!;
  if (wordAddress(words[0]!) !== q.payer || wordAddress(words[1]!) !== RELAY_ARBITRUM_USDC.toLowerCase() ||
    BigInt(`0x${words[2]}`) !== BigInt(q.principalAtomic) ||
    !same(`0x${words[3]}`, q.orderId)) return refuse("source_deposit_event_mismatch");

  const credit = e.destinationCredit;
  if (credit.status !== "recipient_credit_proven" || credit.relayOrderFulfillmentProven !== false ||
    credit.paidAcceptance !== false) return refuse("destination_credit_unproven");
  const p = credit.proof, receipt = e.destinationReceipt, tx = e.destinationTransaction, block = e.destinationBlock;
  if (p.quoteDigest !== q.quoteDigest || !same(p.orderId, q.orderId) ||
    !same(p.token, ETHEREUM_USDC) || !same(p.recipient, q.recipient) ||
    p.minimumOutputAtomic !== q.minimumOutputAtomic || p.proofClass !== "canonical_safe_erc20_transfer_log" ||
    !validLogs(receipt) || !same(receipt.transactionHash, p.destinationTransactionHash) ||
    receipt.blockNumber.toString() !== p.destinationBlockNumber ||
    !same(receipt.blockHash, p.destinationBlockHash) ||
    !same(tx.hash, receipt.transactionHash) || tx.chainId !== 1 ||
    tx.blockNumber !== receipt.blockNumber || !same(tx.blockHash, receipt.blockHash) ||
    !DATA.test(tx.input) || !tx.input.toLowerCase().endsWith(q.orderId.slice(2).toLowerCase()) ||
    block.number !== receipt.blockNumber || !same(block.hash, receipt.blockHash) ||
    block.timestampSeconds < 0n || block.timestampSeconds > BigInt(q.deadline) ||
    !UINT.test(p.safeBlockNumber) || BigInt(p.safeBlockNumber) < receipt.blockNumber ||
    !HASH.test(p.safeBlockHash)) return refuse("destination_order_reference_or_block_drift");
  const transfers = receipt.logs.filter(log => same(log.address, ETHEREUM_USDC) &&
    log.topics[0] !== undefined && same(log.topics[0], TRANSFER_TOPIC));
  if (transfers.some(log => log.topics.length !== 3 || !/^0x0{24}[0-9a-fA-F]{40}$/u.test(log.topics[1]!) ||
    !/^0x0{24}[0-9a-fA-F]{40}$/u.test(log.topics[2]!) || !/^0x[0-9a-fA-F]{64}$/u.test(log.data)))
    return refuse("destination_transfer_malformed");
  const matching = transfers.filter(log => same(log.topics[2]!, topicAddress(q.recipient)));
  if (matching.length !== 1 || matching[0]!.logIndex.toString() !== p.transferLogIndex ||
    !UINT.test(p.creditedAtomic) || BigInt(matching[0]!.data) !== BigInt(p.creditedAtomic) ||
    BigInt(p.creditedAtomic) < BigInt(q.minimumOutputAtomic)) return refuse("destination_credit_drift");
  return { status: "candidate_consistent", relayOrderFulfillmentProven: false,
    cryptographicCausalityProven: false, paidAcceptance: false, reason: null, candidate: {
      orderId: q.orderId, quoteDigest: q.quoteDigest,
      sourceTransactionHash: sourceReceipt.transactionHash, sourceBlockHash: sourceReceipt.blockHash,
      sourceDepositLogIndex: deposits[0]!.logIndex.toString(),
      destinationTransactionHash: tx.hash, destinationBlockHash: block.hash,
      destinationTransferLogIndex: matching[0]!.logIndex.toString(),
      creditedAtomic: p.creditedAtomic, destinationTimestampSeconds: block.timestampSeconds.toString(),
      candidateClass: "caller_supplied_order_reference_and_recipient_credit" } };
}
