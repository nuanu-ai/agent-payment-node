/** Read-only Ethereum USDC recipient credit proof for the captured Arbitrum Relay quote. */
import { hashObject } from "../canonical.js";
import { evmRpcAddress, evmRpcBlockResult, evmRpcHex, evmRpcQuantity, evmRpcRecord } from "../evm-rpc-codec.js";
import { EvmDirectRpcGuard } from "../evm-direct-rpc-guard.js";
import { HttpsBaseRpc, type ReadOnlyRpcBatchCall } from "../rpc.js";
import type { StateStore } from "../state.js";
import { RELAY_ETHEREUM_USDC_RECIPIENT,
  validateRelayArbitrumUsdcEthereumUsdcQuote } from "./arbitrum-usdc-ethereum-quote.js";
import { ETHEREUM_USDC } from "./quote.js";

type Quote = Awaited<ReturnType<typeof validateRelayArbitrumUsdcEthereumUsdcQuote>>;
const HASH = /^0x[0-9a-fA-F]{64}$/u;
const UINT = /^(0|[1-9][0-9]*)$/u;
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const same = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();
const topicAddress = (address: string): string => `0x${"0".repeat(24)}${address.slice(2).toLowerCase()}`;

export interface RelayEthereumUsdcTransaction {
  readonly hash: string; readonly chainId: number; readonly blockNumber: bigint | null; readonly blockHash: string | null;
}
export interface RelayEthereumUsdcReceipt {
  readonly transactionHash: string; readonly status: "success" | "reverted";
  readonly blockNumber: bigint; readonly blockHash: string;
  readonly logs: readonly Readonly<{ address: string; topics: readonly string[]; data: string;
    transactionHash: string; blockNumber: bigint; blockHash: string; removed: boolean; logIndex: bigint }>[];
}
export interface RelayEthereumUsdcBlock { readonly number: bigint; readonly hash: string }
export interface RelayEthereumUsdcProofPorts {
  chainId(): Promise<number>;
  transaction(hash: string): Promise<RelayEthereumUsdcTransaction | null>;
  receipt(hash: string): Promise<RelayEthereumUsdcReceipt | null>;
  block(number: bigint): Promise<RelayEthereumUsdcBlock | null>;
  safeBlock(): Promise<RelayEthereumUsdcBlock | null>;
}
export type RelayEthereumUsdcCreditResult = Readonly<{
  relayOrderFulfillmentProven: false; paidAcceptance: false;
}> & (Readonly<{ status: "recipient_credit_proven"; proof: Readonly<{
  quoteDigest: string; orderId: string; destinationTransactionHash: string;
  destinationBlockNumber: string; destinationBlockHash: string;
  safeBlockNumber: string; safeBlockHash: string; token: string; recipient: string;
  minimumOutputAtomic: string; creditedAtomic: string; transferLogIndex: string;
  proofClass: "canonical_safe_erc20_transfer_log";
}> }> | Readonly<{ status: "pending" | "unproven" | "mismatch"; reason: string }>);

function result(status: "pending" | "unproven" | "mismatch", reason: string): RelayEthereumUsdcCreditResult {
  return { status, reason, relayOrderFulfillmentProven: false, paidAcceptance: false };
}

/** A candidate from Relay status is only a discovery hint, including when it is a real credit. */
export async function proveRelayEthereumUsdcCredit(quote: Quote, candidateHash: string,
  ports: RelayEthereumUsdcProofPorts): Promise<RelayEthereumUsdcCreditResult> {
  try {
    const { quoteDigest, ...projection } = quote;
    if (hashObject(projection) !== quoteDigest || quote.schemaVersion !== "apn.relay-arbitrum-usdc-ethereum-usdc-quote.v1" ||
      quote.routeReference !== "arbitrum-usdc-ethereum-usdc-observation-v1" ||
      quote.recipient !== RELAY_ETHEREUM_USDC_RECIPIENT.toLowerCase() ||
      quote.orderData.output.chainId !== "ethereum" || quote.orderData.output.calls.length !== 0 ||
      quote.orderData.output.payments.length !== 1 ||
      !same(quote.orderData.output.payments[0]!.currency, ETHEREUM_USDC) ||
      !same(quote.orderData.output.payments[0]!.recipient, quote.recipient) ||
      !UINT.test(quote.minimumOutputAtomic) || BigInt(quote.minimumOutputAtomic) <= 0n ||
      quote.orderData.output.payments[0]!.minimumAmount !== quote.minimumOutputAtomic ||
      !HASH.test(quote.orderId)) return result("mismatch", "saved_quote_binding");
  } catch { return result("mismatch", "saved_quote_binding"); }
  if (!HASH.test(candidateHash)) return result("mismatch", "destination_candidate_hash_invalid");
  const hash = candidateHash.toLowerCase();
  let chain: number;
  try { chain = await ports.chainId(); } catch { return result("unproven", "ethereum_rpc_unavailable"); }
  if (chain !== 1) return result("mismatch", "destination_chain_id");
  let tx: RelayEthereumUsdcTransaction | null, receipt: RelayEthereumUsdcReceipt | null;
  try { tx = await ports.transaction(hash); receipt = await ports.receipt(hash); }
  catch { return result("unproven", "ethereum_rpc_unavailable"); }
  if (tx === null || receipt === null) return result("pending", "destination_transaction_or_receipt_missing");
  if (!same(tx.hash, hash) || !same(receipt.transactionHash, hash) || tx.chainId !== 1 ||
    tx.blockNumber !== receipt.blockNumber || tx.blockHash === null || !same(tx.blockHash, receipt.blockHash) ||
    !HASH.test(receipt.blockHash) || receipt.blockNumber < 0n || !Array.isArray(receipt.logs) ||
    receipt.logs.length > 256) return result("mismatch", "destination_transaction_receipt_identity");
  if (receipt.status !== "success") return result("mismatch", "destination_receipt_failed");
  let inclusion: RelayEthereumUsdcBlock | null, safe: RelayEthereumUsdcBlock | null;
  let inclusionAgain: RelayEthereumUsdcBlock | null, safeAgain: RelayEthereumUsdcBlock | null;
  try {
    inclusion = await ports.block(receipt.blockNumber); safe = await ports.safeBlock();
    if (inclusion === null || safe === null) return result("pending", "destination_finality_unavailable");
    inclusionAgain = await ports.block(receipt.blockNumber); safeAgain = await ports.block(safe.number);
  } catch { return result("unproven", "ethereum_finality_rpc_unavailable"); }
  if (inclusionAgain === null || safeAgain === null) return result("pending", "destination_finality_unavailable");
  if (!HASH.test(inclusion.hash) || !HASH.test(safe.hash) ||
    inclusion.number !== receipt.blockNumber || !same(inclusion.hash, receipt.blockHash) ||
    inclusionAgain.number !== inclusion.number || !same(inclusionAgain.hash, inclusion.hash) ||
    safeAgain.number !== safe.number || !same(safeAgain.hash, safe.hash) || safe.number < 0n)
    return result("mismatch", "destination_noncanonical_block");
  if (safe.number < receipt.blockNumber) return result("pending", "destination_not_safe");
  if (receipt.logs.some(log => !HASH.test(log.transactionHash) || !HASH.test(log.blockHash) ||
    !same(log.transactionHash, hash) || !same(log.blockHash, receipt.blockHash) ||
    log.blockNumber !== receipt.blockNumber || log.removed !== false || log.logIndex < 0n ||
    !/^0x[0-9a-fA-F]{40}$/u.test(log.address) || !Array.isArray(log.topics) || log.topics.length > 4 ||
    log.topics.some((topic: string) => !HASH.test(topic)) || !/^0x(?:[0-9a-fA-F]{2})*$/u.test(log.data)) ||
    new Set(receipt.logs.map(log => log.logIndex.toString())).size !== receipt.logs.length)
    return result("mismatch", "destination_receipt_log_identity");
  const transfers = receipt.logs.filter(log => same(log.address, ETHEREUM_USDC) &&
    log.topics[0] !== undefined && same(log.topics[0], TRANSFER_TOPIC));
  if (transfers.some(log => log.topics.length !== 3 || !/^0x[0-9a-fA-F]{64}$/u.test(log.data) ||
    !/^0x0{24}[0-9a-fA-F]{40}$/u.test(log.topics[1]!) ||
    !/^0x0{24}[0-9a-fA-F]{40}$/u.test(log.topics[2]!)))
    return result("mismatch", "destination_transfer_log_malformed");
  const matching = transfers.filter(log => same(log.topics[2]!, topicAddress(quote.recipient)));
  if (matching.length !== 1) return result("unproven", "destination_transfer_missing_or_ambiguous");
  const credit = BigInt(matching[0]!.data);
  if (credit < BigInt(quote.minimumOutputAtomic)) return result("mismatch", "destination_value_below_minimum");
  return { status: "recipient_credit_proven", relayOrderFulfillmentProven: false, paidAcceptance: false, proof: {
    quoteDigest: quote.quoteDigest, orderId: quote.orderId, destinationTransactionHash: hash,
    destinationBlockNumber: receipt.blockNumber.toString(), destinationBlockHash: receipt.blockHash.toLowerCase(),
    safeBlockNumber: safe.number.toString(), safeBlockHash: safe.hash.toLowerCase(),
    token: ETHEREUM_USDC.toLowerCase(), recipient: quote.recipient,
    minimumOutputAtomic: quote.minimumOutputAtomic, creditedAtomic: credit.toString(),
    transferLogIndex: matching[0]!.logIndex.toString(), proofClass: "canonical_safe_erc20_transfer_log" } };
}

/** Keyless, shared-guard JSON-RPC session. At most seven physical POSTs per candidate. */
export class RelayEthereumUsdcReadOnlyRpc implements RelayEthereumUsdcProofPorts {
  private readonly rpc: HttpsBaseRpc;
  private readonly guard: EvmDirectRpcGuard;
  constructor(private readonly url: string, state: StateStore, rpc?: HttpsBaseRpc,
    guard = new EvmDirectRpcGuard(state, 7)) {
    this.rpc = rpc ?? new HttpsBaseRpc(url); this.guard = guard;
  }
  get physicalPosts(): number { return this.guard.physicalRequests; }
  private async read(method: ReadOnlyRpcBatchCall["method"], params: readonly unknown[]): Promise<unknown> {
    return (await this.guard.post(this.url, async () => {
      try { return await this.rpc.batchCall([{ method, params }]); }
      finally { await new Promise(resolve => setTimeout(resolve, 750)); }
    }))[0];
  }
  async chainId(): Promise<number> { return Number(evmRpcQuantity(await this.read("eth_chainId", []))); }
  async transaction(hash: string): Promise<RelayEthereumUsdcTransaction | null> {
    const raw = await this.read("eth_getTransactionByHash", [hash]); if (raw === null) return null;
    const tx = evmRpcRecord(raw);
    return { hash: evmRpcHex(tx.hash, 32), chainId: Number(evmRpcQuantity(tx.chainId)),
      blockNumber: tx.blockNumber === null ? null : evmRpcQuantity(tx.blockNumber),
      blockHash: tx.blockHash === null ? null : evmRpcHex(tx.blockHash, 32) };
  }
  async receipt(hash: string): Promise<RelayEthereumUsdcReceipt | null> {
    const raw = await this.read("eth_getTransactionReceipt", [hash]); if (raw === null) return null;
    const row = evmRpcRecord(raw), status = evmRpcQuantity(row.status);
    if (status !== 0n && status !== 1n || !Array.isArray(row.logs) || row.logs.length > 256)
      throw new Error("Relay Ethereum USDC receipt is invalid.");
    const transactionHash = evmRpcHex(row.transactionHash, 32), blockHash = evmRpcHex(row.blockHash, 32);
    const blockNumber = evmRpcQuantity(row.blockNumber);
    return { transactionHash, blockHash, blockNumber, status: status === 1n ? "success" : "reverted",
      logs: row.logs.map(value => {
        const log = evmRpcRecord(value);
        if (!Array.isArray(log.topics) || log.removed !== false) throw new Error("Relay Ethereum USDC log is invalid.");
        return { address: evmRpcAddress(log.address), topics: log.topics.map(topic => evmRpcHex(topic, 32)),
          data: evmRpcHex(log.data), transactionHash: evmRpcHex(log.transactionHash, 32),
          blockNumber: evmRpcQuantity(log.blockNumber), blockHash: evmRpcHex(log.blockHash, 32),
          removed: false, logIndex: evmRpcQuantity(log.logIndex) };
      }) };
  }
  async block(number: bigint): Promise<RelayEthereumUsdcBlock | null> {
    const tag = `0x${number.toString(16)}`; const raw = await this.read("eth_getBlockByNumber", [tag, false]);
    if (raw === null) return null; const block = evmRpcBlockResult(raw, tag);
    return { number: BigInt(block.number), hash: block.hash };
  }
  async safeBlock(): Promise<RelayEthereumUsdcBlock | null> {
    const raw = await this.read("eth_getBlockByNumber", ["safe", false]); if (raw === null) return null;
    const block = evmRpcBlockResult(raw, "safe"); return { number: BigInt(block.number), hash: block.hash };
  }
}
