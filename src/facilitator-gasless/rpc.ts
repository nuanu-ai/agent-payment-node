import { canonicalJson, exactKeys, sha256 } from "../canonical.js";
import { GaslessHttps, type GaslessTransport } from "../gasless/https.js";
import type { GaslessBlock } from "../gasless/model.js";
import { addressWord, parseReceiptLogs, quantity, rpcBlock, rpcHex, rpcJson, rpcQuantity, rpcRecord, rpcWord, receiptHash,
  recheckBlock, type GaslessRpcCall, type GaslessRpcMethod } from "../gasless/rpc-codec.js";
import type { Address, Hex } from "../model.js";
import { parsePublicHttpsUrl } from "../network-policy.js";
import { facilitatorFail } from "./failure.js";
import { AVALANCHE_FACILITATOR as R } from "./registry.js";

const METHODS = new Set<GaslessRpcMethod>(["eth_chainId", "eth_getBlockByNumber", "eth_call", "eth_getTransactionReceipt", "eth_getLogs"]);
const MAX_RESPONSE = 4 * 1024 * 1024;
const LOG_WINDOW = 2048n;

export interface FacilitatorEvidence {
  readonly transactionHash: Hex;
  readonly block: GaslessBlock;
  readonly finalized: GaslessBlock;
  readonly receiptHash: string;
  readonly deliveredAtomic: string;
}
export interface FacilitatorTransferQuery {
  readonly transactionHash: Hex;
  readonly owner: Address;
  readonly recipient: Address;
  readonly amountAtomic: string;
  readonly nonce: Hex;
}
export interface FacilitatorRpcPort {
  readonly rpcOrigin: string;
  readonly rpcEndpointHash: string;
  assertChain(): Promise<void>;
  finalized(): Promise<GaslessBlock>;
  usdcBalance(owner: Address, block: GaslessBlock): Promise<bigint>;
  authorizationUsed(owner: Address, nonce: Hex, block: GaslessBlock): Promise<boolean>;
  /** A unique log transaction hash, null when absent, or "ambiguous"; the scan stops once blocks reach `validBefore`. */
  findAuthorizationLog(owner: Address, nonce: Hex, from: GaslessBlock, to: GaslessBlock,
    validBefore: bigint): Promise<Hex | null | "ambiguous">;
  /** Evidence only for a finalized successful receipt with the exact authorization and transfer; otherwise null. */
  settledTransfer(query: FacilitatorTransferQuery): Promise<FacilitatorEvidence | null>;
}

export function avalancheFacilitatorRpc(environment: Readonly<Record<string, string | undefined>>,
  transport?: GaslessTransport): FacilitatorRpcPort {
  const rpcUrl = environment[R.rpcEnv];
  if (rpcUrl === undefined || rpcUrl.length === 0) facilitatorFail("facilitator_gasless_rpc_binding");
  return new AvalancheFacilitatorRpc(rpcUrl, transport);
}

export class AvalancheFacilitatorRpc implements FacilitatorRpcPort {
  readonly rpcOrigin: string;
  readonly rpcEndpointHash: string;
  private readonly endpoint: string;
  private sequence = 0n;
  private readonly call: GaslessRpcCall = async (method, params) => await this.request(method, params);

  constructor(rpcUrl: string, private readonly transport: GaslessTransport = new GaslessHttps()) {
    const endpoint = rpcEndpoint(rpcUrl);
    this.endpoint = endpoint.toString(); this.rpcOrigin = endpoint.origin; this.rpcEndpointHash = sha256(this.endpoint);
  }

  async assertChain(): Promise<void> {
    if (rpcQuantity(await this.call("eth_chainId", [])) !== BigInt(R.chainId)) facilitatorFail("facilitator_gasless_rpc_binding");
  }

  async finalized(): Promise<GaslessBlock> { return (await rpcBlock(this.call, R.finalityTag)).block; }

  async usdcBalance(owner: Address, block: GaslessBlock): Promise<bigint> {
    const data = `0x70a08231${addressWord(owner).slice(2)}`;
    return rpcWord(await this.call("eth_call", [{ to: R.token, data }, quantity(BigInt(block.numberAtomic))]));
  }

  async authorizationUsed(owner: Address, nonce: Hex, block: GaslessBlock): Promise<boolean> {
    const data = `${R.authorizationStateSelector}${addressWord(owner).slice(2)}${nonce.slice(2)}`;
    return rpcWord(await this.call("eth_call", [{ to: R.token, data }, quantity(BigInt(block.numberAtomic))])) !== 0n;
  }

  async findAuthorizationLog(owner: Address, nonce: Hex, from: GaslessBlock, to: GaslessBlock,
    validBefore: bigint): Promise<Hex | null | "ambiguous"> {
    const hashes = new Set<Hex>(), last = BigInt(to.numberAtomic);
    for (let start = BigInt(from.numberAtomic); start <= last; start += LOG_WINDOW) {
      const end = start + LOG_WINDOW - 1n < last ? start + LOG_WINDOW - 1n : last;
      const logs = await this.call("eth_getLogs", [{ address: R.token, fromBlock: quantity(start), toBlock: quantity(end),
        topics: [R.authorizationUsedTopic, addressWord(owner), nonce] }]);
      if (!Array.isArray(logs)) facilitatorFail("facilitator_gasless_evidence");
      for (const item of logs) {
        const log = rpcRecord(item);
        if (log.removed !== false) facilitatorFail("facilitator_gasless_evidence");
        hashes.add(rpcHex(log.transactionHash, 32, 32));
      }
      // EIP-3009 refuses an authorization at or after validBefore, so no later block can use it.
      if (end < last && BigInt((await rpcBlock(this.call, quantity(end))).block.timestampAtomic) >= validBefore) break;
    }
    return hashes.size === 0 ? null : hashes.size === 1 ? [...hashes][0]! : "ambiguous";
  }

  async settledTransfer(query: FacilitatorTransferQuery): Promise<FacilitatorEvidence | null> {
    const found = await this.call("eth_getTransactionReceipt", [query.transactionHash]);
    if (found === null) return null;
    const receipt = rpcRecord(found), status = rpcQuantity(receipt.status);
    if (rpcHex(receipt.transactionHash, 32, 32) !== query.transactionHash) facilitatorFail("facilitator_gasless_evidence");
    if (status !== 1n) return null;
    const included = await rpcBlock(this.call, quantity(rpcQuantity(receipt.blockNumber)));
    if (included.block.hash !== rpcHex(receipt.blockHash, 32, 32)) facilitatorFail("facilitator_gasless_evidence");
    const finalized = await this.finalized();
    if (BigInt(included.block.numberAtomic) > BigInt(finalized.numberAtomic)) return null;
    const logs = parseReceiptLogs(receipt.logs, query.transactionHash, included.block, rpcQuantity(receipt.transactionIndex));
    const fromToken = logs.filter(log => log.address.toLowerCase() === R.token);
    const used = fromToken.filter(log => log.topics[0] === R.authorizationUsedTopic && log.topics[1] === addressWord(query.owner) &&
      log.topics[2] === query.nonce);
    const transfers = fromToken.filter(log => log.topics[0] === R.transferTopic && log.topics[1] === addressWord(query.owner));
    if (used.length !== 1 || transfers.length !== 1 || transfers[0]!.topics[2] !== addressWord(query.recipient) ||
      rpcWord(transfers[0]!.data) !== BigInt(query.amountAtomic)) facilitatorFail("facilitator_gasless_evidence");
    // The used-nonce mapping is permanent, so the finalized block proves it without historical state.
    if (!await this.authorizationUsed(query.owner, query.nonce, finalized)) facilitatorFail("facilitator_gasless_evidence");
    await recheckBlock(this.call, included.block);
    return { transactionHash: query.transactionHash, block: included.block, finalized,
      receiptHash: receiptHash(R.chainId, query.transactionHash, included.block, status, logs), deliveredAtomic: query.amountAtomic };
  }

  private async request(method: GaslessRpcMethod, params: readonly unknown[]): Promise<unknown> {
    if (!METHODS.has(method)) facilitatorFail("facilitator_gasless_evidence");
    const id = (++this.sequence).toString(), body = canonicalJson({ jsonrpc: "2.0", id, method, params });
    let response: { readonly status: number; readonly body: string };
    try { response = await this.transport.request(this.endpoint, "POST", body, MAX_RESPONSE, "APN_RPC_CONFIG"); }
    catch { return facilitatorFail("facilitator_gasless_rpc_unavailable"); }
    if (response.status !== 200) facilitatorFail("facilitator_gasless_rpc_unavailable");
    const record = rpcRecord(rpcJson(response.body, MAX_RESPONSE));
    const result = Object.hasOwn(record, "result"), error = Object.hasOwn(record, "error");
    if (record.jsonrpc !== "2.0" || record.id !== id || result === error || !exactKeys(record, result ? ["jsonrpc", "id", "result"] : ["jsonrpc", "id", "error"])) {
      facilitatorFail("facilitator_gasless_evidence");
    }
    if (error) facilitatorFail("facilitator_gasless_rpc_unavailable");
    return record.result;
  }
}

function rpcEndpoint(value: string): URL {
  try { return parsePublicHttpsUrl(value, "APN_RPC_CONFIG", "Avalanche RPC endpoint", 2048); }
  catch { return facilitatorFail("facilitator_gasless_rpc_binding"); }
}
