/** Bounded, keyless JSON-RPC adapters. Every batchCall here is one physical POST. */
import type { Hex } from "viem";
import { evmRpcAddress, evmRpcBlockResult, evmRpcHex, evmRpcQuantity, evmRpcRecord } from "../evm-rpc-codec.js";
import { ApnError } from "../errors.js";
import { EvmDirectRpcGuard } from "../evm-direct-rpc-guard.js";
import { HttpsBaseRpc, type ReadOnlyRpcBatchCall } from "../rpc.js";
import type { StateStore } from "../state.js";
import { decodeRelayBaseReceiptFee } from "./source-fee-proof.js";
import type { RelayDepositObservation } from "./deposit-effect.js";
import { RELAY_DESTINATION_PROOF_POSTS, type RelayBnbProofPorts, type RelayBnbBlock, type RelayBnbReceipt, type RelayBnbTransaction } from "./destination-proof.js";
import type { RelaySourceFinalityPorts } from "./observe.js";

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
/** The shared provider lock stays held until 750 ms after a POST settles.
 * This covers the delay between the scheduler's persisted reservation and the
 * transport's actual POST start, including DNS and filesystem latency. */
async function holdProviderAfterPost<T>(post: () => Promise<T>): Promise<T> {
  try { return await post(); }
  finally { await new Promise(resolve => setTimeout(resolve, 750)); }
}
function block(value: unknown, tag: string): RelayBnbBlock | null {
  if (value === null) return null;
  const parsed = evmRpcBlockResult(value, tag);
  return { number: BigInt(parsed.number), hash: parsed.hash };
}
function optionalAddress(value: unknown): string | null {
  return value === null ? null : evmRpcAddress(value);
}
function status(value: unknown): "success" | "reverted" {
  const code = evmRpcQuantity(value);
  if (code !== 0n && code !== 1n) throw new ApnError("APN_RPC_PROTOCOL", "Relay receipt status is invalid.");
  return code === 1n ? "success" : "reverted";
}

/** Physical POSTs of one finalized source proof: chain, transaction, receipt and finality head; then the inclusion block. */
export const RELAY_SOURCE_FINALITY_POSTS = 2;
export class RelayEthereumFinalityRpc implements RelaySourceFinalityPorts {
  private readonly rpc: HttpsBaseRpc;
  constructor(private readonly url: string, state: StateStore, rpc?: HttpsBaseRpc,
    private readonly guardFactory: () => EvmDirectRpcGuard = () => new EvmDirectRpcGuard(state, RELAY_SOURCE_FINALITY_POSTS),
    private readonly expectedChainId: 1 | 56 | 8453 = 1) {
    this.rpc = rpc ?? new HttpsBaseRpc(url);
  }
  private async read(guard: EvmDirectRpcGuard, calls: readonly ReadOnlyRpcBatchCall[]): Promise<readonly unknown[]> {
    // One batch is one POST. The shared provider-family scheduler persists starts
    // across CLI processes and refuses cooldowns/lock contention before transport.
    return guard.post(this.url, () => holdProviderAfterPost(() => this.rpc.batchCall(calls)));
  }
  /** P2: the finality head is read with the receipt, before the inclusion block; a canonical inclusion block at or
   * below that head is final, so neither header is re-read. */
  async finalizedDeposit(hash: Hex): Promise<RelayDepositObservation | null> {
    const guard = this.guardFactory(), finalityTag = this.expectedChainId === 1 ? "finalized" : this.expectedChainId === 8453 ? "safe" : "latest";
    const [chain, rawTx, rawReceipt, rawFinalized] = await this.read(guard, [
      { method: "eth_chainId", params: [] },
      { method: "eth_getTransactionByHash", params: [hash] },
      { method: "eth_getTransactionReceipt", params: [hash] },
      { method: "eth_getBlockByNumber", params: [finalityTag, false] },
    ]);
    if (evmRpcQuantity(chain) !== BigInt(this.expectedChainId)) throw new ApnError("APN_CHAIN_MISMATCH", "Relay source RPC chain is wrong.");
    if (rawTx === null || rawReceipt === null || rawFinalized === null) return null;
    const tx = evmRpcRecord(rawTx), receipt = evmRpcRecord(rawReceipt);
    const number = evmRpcQuantity(receipt.blockNumber);
    const inclusion = `0x${number.toString(16)}`, finalized = evmRpcBlockResult(rawFinalized, finalityTag);
    if (BigInt(finalized.number) < number + (this.expectedChainId === 56 ? 15n : 0n)) return null;
    const [rawBlock] = await this.read(guard, [{ method: "eth_getBlockByNumber", params: [inclusion, false] }]);
    if (rawBlock === null) return null;
    const included = evmRpcBlockResult(rawBlock, inclusion);
    if (!same(evmRpcHex(tx.blockHash, 32), included.hash) ||
      !same(evmRpcHex(receipt.blockHash, 32), included.hash) ||
      evmRpcQuantity(tx.blockNumber) !== number || evmRpcQuantity(tx.chainId) !== BigInt(this.expectedChainId)) return null;
    return { transaction: { hash: evmRpcHex(tx.hash, 32), from: evmRpcAddress(tx.from),
      to: optionalAddress(tx.to), input: evmRpcHex(tx.input), value: evmRpcQuantity(tx.value), chainId: this.expectedChainId },
    receipt: { transactionHash: evmRpcHex(receipt.transactionHash, 32), status: status(receipt.status),
      blockNumber: number, blockHash: evmRpcHex(receipt.blockHash, 32),
      ...(this.expectedChainId === 8453 ? { actualFee: decodeRelayBaseReceiptFee(receipt) } : {}) }, canonicalBlockHash: included.hash };
  }
}

interface QueuedRead { readonly call: ReadOnlyRpcBatchCall; readonly resolve: (value: unknown) => void; readonly reject: (error: unknown) => void }
/** Reads requested in the same turn of the event loop leave as one JSON-RPC batch POST (P3); the chain id is read once. */
export class RelayBnbReadOnlyRpc implements RelayBnbProofPorts {
  private readonly rpc: HttpsBaseRpc;
  private readonly guard: EvmDirectRpcGuard;
  private queued: QueuedRead[] = [];
  private chain: Promise<number> | null = null;
  constructor(private readonly url: string, state: StateStore, rpc?: HttpsBaseRpc,
    guard = new EvmDirectRpcGuard(state, RELAY_DESTINATION_PROOF_POSTS), private readonly expectedChainId: 56 | 137 | 143 | 8453 | 4326 = 56) {
    this.rpc = rpc ?? new HttpsBaseRpc(url);
    this.guard = guard;
  }
  get physicalPosts(): number { return this.guard.physicalRequests; }
  private read(method: ReadOnlyRpcBatchCall["method"], params: readonly unknown[]): Promise<unknown> {
    return new Promise((resolve, reject) => {
      this.queued.push({ call: { method, params }, resolve, reject });
      if (this.queued.length === 1) setImmediate(() => { void this.flush(); });
    });
  }
  private async flush(): Promise<void> {
    const entries = this.queued.splice(0);
    try {
      const rows = await this.guard.post(this.url, () => holdProviderAfterPost(() => this.rpc.batchCall(entries.map(entry => entry.call))));
      if (rows.length !== entries.length) throw new ApnError("APN_RPC_PROTOCOL", "Relay destination batch result is invalid.");
      entries.forEach((entry, index) => entry.resolve(rows[index]));
    } catch (error) { for (const entry of entries) entry.reject(error); }
  }
  async chainId(): Promise<number> {
    this.chain ??= this.read("eth_chainId", []).then(value => Number(evmRpcQuantity(value)));
    try { return await this.chain; } catch (error) { this.chain = null; throw error; }
  }
  async transaction(hash: string): Promise<RelayBnbTransaction | null> {
    const value = await this.read("eth_getTransactionByHash", [hash]);
    if (value === null) return null;
    const tx = evmRpcRecord(value);
    return { hash: evmRpcHex(tx.hash, 32), chainId: Number(evmRpcQuantity(tx.chainId)),
      to: optionalAddress(tx.to), valueWei: evmRpcQuantity(tx.value),
      blockNumber: tx.blockNumber === null ? null : evmRpcQuantity(tx.blockNumber),
      blockHash: tx.blockHash === null ? null : evmRpcHex(tx.blockHash, 32) };
  }
  async receipt(hash: string): Promise<RelayBnbReceipt | null> {
    const value = await this.read("eth_getTransactionReceipt", [hash]);
    if (value === null) return null;
    const receipt = evmRpcRecord(value);
    const transactionHash = evmRpcHex(receipt.transactionHash, 32), blockHash = evmRpcHex(receipt.blockHash, 32);
    const blockNumber = evmRpcQuantity(receipt.blockNumber);
    if (!Array.isArray(receipt.logs) || receipt.logs.length > 256) throw new ApnError("APN_RPC_PROTOCOL", "Relay receipt logs are invalid.");
    const logs = receipt.logs.map(value => {
      const log = evmRpcRecord(value);
      if (!Array.isArray(log.topics) || log.topics.length > 4 || log.removed !== false ||
        !same(evmRpcHex(log.transactionHash, 32), transactionHash) ||
        !same(evmRpcHex(log.blockHash, 32), blockHash) || evmRpcQuantity(log.blockNumber) !== blockNumber)
        throw new ApnError("APN_RPC_PROTOCOL", "Relay receipt log identity is invalid.");
      return { address: evmRpcAddress(log.address), topics: log.topics.map(topic => evmRpcHex(topic, 32)),
        data: evmRpcHex(log.data) };
    });
    return { transactionHash, status: status(receipt.status), blockNumber, blockHash, logs };
  }
  async block(number: bigint): Promise<RelayBnbBlock | null> {
    const tag = `0x${number.toString(16)}`;
    return block(await this.read("eth_getBlockByNumber", [tag, false]), tag);
  }
  async finalityCheckpoint(): Promise<RelayBnbBlock | null> {
    if (this.expectedChainId === 56 || this.expectedChainId === 8453 || this.expectedChainId === 4326)
      return block(await this.read("eth_getBlockByNumber", ["safe", false]), "safe");
    // A 15-block canonical checkpoint is used on native Relay destination lanes.
    const latest = block(await this.read("eth_getBlockByNumber", ["latest", false]), "latest");
    if (latest === null || latest.number < 15n) return null;
    return this.block(latest.number - 15n);
  }
  async polygonFinalizedCheckpoint(): Promise<RelayBnbBlock | null> {
    if (this.expectedChainId !== 137) throw new ApnError("APN_CHAIN_MISMATCH", "Polygon finality requires Polygon RPC.");
    return block(await this.read("eth_getBlockByNumber", ["finalized", false]), "finalized");
  }
}
