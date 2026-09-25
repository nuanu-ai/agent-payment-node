/** Bounded, keyless JSON-RPC adapters. Every batchCall here is one physical POST. */
import { keccak256, type Hex } from "viem";
import { evmRpcAddress, evmRpcBlockResult, evmRpcHex, evmRpcQuantity, evmRpcRecord } from "../evm-rpc-codec.js";
import { ApnError } from "../errors.js";
import { EvmDirectRpcGuard } from "../evm-direct-rpc-guard.js";
import { HttpsBaseRpc, type ReadOnlyRpcBatchCall } from "../rpc.js";
import type { StateStore } from "../state.js";
import type { RelayDepositObservation } from "./deposit-effect.js";
import type { RelayBnbProofPorts, RelayBnbBlock, RelayBnbReceipt, RelayBnbTransaction } from "./destination-proof.js";
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

export class RelayEthereumFinalityRpc implements RelaySourceFinalityPorts {
  private readonly rpc: HttpsBaseRpc;
  constructor(private readonly url: string, state: StateStore, rpc?: HttpsBaseRpc,
    private readonly guardFactory: () => EvmDirectRpcGuard = () => new EvmDirectRpcGuard(state, 3),
    private readonly expectedChainId: 1 | 56 = 1) {
    this.rpc = rpc ?? new HttpsBaseRpc(url);
  }
  private async read(guard: EvmDirectRpcGuard, calls: readonly ReadOnlyRpcBatchCall[]): Promise<readonly unknown[]> {
    // One batch is one POST. The shared provider-family scheduler persists starts
    // across CLI processes and refuses cooldowns/lock contention before transport.
    return guard.post(this.url, () => holdProviderAfterPost(() => this.rpc.batchCall(calls)));
  }
  async finalizedDeposit(hash: Hex): Promise<RelayDepositObservation | null> {
    const guard = this.guardFactory();
    const [chain, rawTx, rawReceipt] = await this.read(guard, [
      { method: "eth_chainId", params: [] },
      { method: "eth_getTransactionByHash", params: [hash] },
      { method: "eth_getTransactionReceipt", params: [hash] },
    ]);
    if (evmRpcQuantity(chain) !== BigInt(this.expectedChainId)) throw new ApnError("APN_CHAIN_MISMATCH", "Relay source RPC chain is wrong.");
    if (rawTx === null || rawReceipt === null) return null;
    const tx = evmRpcRecord(rawTx), receipt = evmRpcRecord(rawReceipt);
    const number = evmRpcQuantity(receipt.blockNumber);
    const inclusion = `0x${number.toString(16)}`;
    const [rawBlock, rawFinalized] = await this.read(guard, [
      { method: "eth_getBlockByNumber", params: [inclusion, false] },
      { method: "eth_getBlockByNumber", params: [this.expectedChainId === 1 ? "finalized" : "latest", false] },
    ]);
    if (rawBlock === null || rawFinalized === null) return null;
    const included = evmRpcBlockResult(rawBlock, inclusion), finalized = evmRpcBlockResult(rawFinalized,
      this.expectedChainId === 1 ? "finalized" : "latest");
    if (BigInt(finalized.number) < number + (this.expectedChainId === 56 ? 15n : 0n)) return null;
    const [rawIncludedAgain, rawFinalizedAgain] = await this.read(guard, [
      { method: "eth_getBlockByNumber", params: [included.tag, false] },
      { method: "eth_getBlockByNumber", params: [finalized.tag, false] },
    ]);
    if (rawIncludedAgain === null || rawFinalizedAgain === null ||
      !same(evmRpcBlockResult(rawIncludedAgain, included.tag).hash, included.hash) ||
      !same(evmRpcBlockResult(rawFinalizedAgain, finalized.tag).hash, finalized.hash)) return null;
    if (!same(evmRpcHex(tx.blockHash, 32), included.hash) ||
      !same(evmRpcHex(receipt.blockHash, 32), included.hash) ||
      evmRpcQuantity(tx.blockNumber) !== number || evmRpcQuantity(tx.chainId) !== BigInt(this.expectedChainId)) return null;
    return { transaction: { hash: evmRpcHex(tx.hash, 32), from: evmRpcAddress(tx.from),
      to: optionalAddress(tx.to), input: evmRpcHex(tx.input), value: evmRpcQuantity(tx.value), chainId: this.expectedChainId },
    receipt: { transactionHash: evmRpcHex(receipt.transactionHash, 32), status: status(receipt.status),
      blockNumber: number, blockHash: evmRpcHex(receipt.blockHash, 32) }, canonicalBlockHash: included.hash };
  }
}

export class RelayBnbReadOnlyRpc implements RelayBnbProofPorts {
  private readonly rpc: HttpsBaseRpc;
  private readonly guard: EvmDirectRpcGuard;
  constructor(private readonly url: string, state: StateStore, rpc?: HttpsBaseRpc,
    guard = new EvmDirectRpcGuard(state, 8), private readonly expectedChainId: 56 | 137 | 143 | 8453 = 56) {
    this.rpc = rpc ?? new HttpsBaseRpc(url);
    this.guard = guard;
  }
  get physicalPosts(): number { return this.guard.physicalRequests; }
  private async read(method: ReadOnlyRpcBatchCall["method"], params: readonly unknown[]): Promise<unknown> {
    const [value] = await this.readBatch([{ method, params }]);
    return value;
  }
  private async readBatch(calls: readonly ReadOnlyRpcBatchCall[]): Promise<readonly unknown[]> {
    return this.guard.post(this.url, () => holdProviderAfterPost(() => this.rpc.batchCall(calls)));
  }
  async chainId(): Promise<number> { return Number(evmRpcQuantity(await this.read("eth_chainId", []))); }
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
    if ((this.expectedChainId === 8453 && !Array.isArray(receipt.logs)) ||
      (Array.isArray(receipt.logs) && receipt.logs.length > 256))
      throw new ApnError("APN_RPC_PROTOCOL", "Relay receipt logs are invalid.");
    const logs = (Array.isArray(receipt.logs) ? receipt.logs : []).map(value => {
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
    if (this.expectedChainId === 56 || this.expectedChainId === 8453)
      return block(await this.read("eth_getBlockByNumber", ["safe", false]), "safe");
    // A 15-block canonical checkpoint is used on native Relay destination lanes.
    const latest = block(await this.read("eth_getBlockByNumber", ["latest", false]), "latest");
    if (latest === null || latest.number < 15n) return null;
    return this.block(latest.number - 15n);
  }
  async nativeTrace(): Promise<null> { return null; }
  async routerCodeHash(address: string, blockNumber: bigint): Promise<string> {
    const code = evmRpcHex(await this.read("eth_getCode", [address, `0x${blockNumber.toString(16)}`]));
    return keccak256(code);
  }
  async adjacentBalances(address: string, blockNumber: bigint, expectedBlockHash: string): Promise<readonly [bigint, bigint]> {
    if (blockNumber === 0n) throw new ApnError("APN_RPC_PROTOCOL", "Relay adjacent balance requires a preceding block.");
    const previousTag = `0x${(blockNumber - 1n).toString(16)}`, inclusionTag = `0x${blockNumber.toString(16)}`;
    const [before, after, rawPrevious, rawIncluded] = await this.readBatch([
      { method: "eth_getBalance", params: [address, previousTag] },
      { method: "eth_getBalance", params: [address, inclusionTag] },
      { method: "eth_getBlockByNumber", params: [previousTag, false] },
      { method: "eth_getBlockByNumber", params: [inclusionTag, false] },
    ]);
    const previous = evmRpcBlockResult(rawPrevious, previousTag), included = evmRpcBlockResult(rawIncluded, inclusionTag);
    if (!same(included.hash, expectedBlockHash) || !same(evmRpcHex(included.raw.parentHash, 32), previous.hash))
      throw new ApnError("APN_RPC_PROTOCOL", "Relay adjacent balance blocks are not one canonical pair.");
    return [evmRpcQuantity(before), evmRpcQuantity(after)];
  }
}
