import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { keccak256, toFunctionSelector } from "viem";
import { sha256 } from "../../src/canonical.js";
import type { GaslessTransport } from "../../src/gasless/https.js";
import type { Address, Hex } from "../../src/model.js";
import { addressWord, MM_INCREASED_COUNT_TOPIC, MM_TRANSFER_TOPIC } from "../../src/metamask-gasless/chain/abi.js";
import { mmQuoteHash } from "../../src/metamask-gasless/economics.js";
import { mmWalletIdentityHash } from "../../src/metamask-gasless/identity.js";
import type { MetaMaskGaslessChainId, MetaMaskGaslessChainState, MetaMaskGaslessIntent } from "../../src/metamask-gasless/model.js";
import { mmRegistry } from "../../src/metamask-gasless/registry.js";

/** A scripted read-only RPC over the pinned runtime code fixture, shared by the MetaMask RPC tests. */
export type Json = Record<string, any>;
export const RUNTIME_PATH = "tests/core/metamask-gasless-chain-fixtures/runtime-code.json";
export const VECTOR_PATH = "tests/core/metamask-gasless-chain-fixtures/base-signed-vector.json";
export const runtimeText = readFileSync(RUNTIME_PATH, "utf8"), runtime = JSON.parse(runtimeText) as Json;
export const vector = JSON.parse(readFileSync(VECTOR_PATH, "utf8")) as Json;
export const RPC_URL = "https://rpc.example/private-path";
export const now = { now: () => new Date("2026-09-09T00:01:00.000Z") };
export const quantity = (value: bigint | number): Hex => `0x${BigInt(value).toString(16)}`;
export const word = (value: bigint): Hex => `0x${value.toString(16).padStart(64, "0")}`;
export const DISABLED_SELECTOR = toFunctionSelector("disabledDelegations(bytes32)");
export const HASH_SELECTOR = toFunctionSelector("getDelegationHash((address,address,bytes32,(address,bytes,bytes)[],uint256,bytes))");
const L1_FEE_SELECTOR = toFunctionSelector("getL1FeeUpperBound(uint256)");
const OP_ORACLE = "0x420000000000000000000000000000000000000f";
export const BASE_FEE = 1_000_000_000n;
export const blockHash = (chainId: number, number: bigint): Hex => `0x${sha256(`mm-rpc-${chainId}-${number}`)}`;

export interface FakeOptions {
  readonly finality?: bigint;
  readonly head?: bigint;
  readonly counter?: (blockNumber: bigint) => bigint;
  /** The manager's `disabledDelegations` flag for the asked delegation at a block (default: never disabled). */
  readonly disabled?: (blockNumber: bigint, delegationHash: Hex) => boolean;
  /** Disable pricing reads: the manager's `getDelegationHash` answer, nonce, gas, priority fee, balance, OP-stack fees. */
  readonly pricing?: { readonly managerHash: Hex; readonly nonce?: bigint; readonly gas?: bigint; readonly priority?: bigint;
    readonly balance?: bigint; readonly l1?: bigint; readonly operator?: bigint; readonly estimateRevert?: boolean };
  readonly corruptProtocol?: boolean;
  readonly transaction?: Json;
  readonly receipt?: Json;
  readonly scanLogs?: readonly Json[];
  /** Refuses one eth_getLogs range: an HTTP status, or a JSON-RPC error inside a 200 response. */
  readonly refuseLogs?: (from: bigint, to: bigint) => { readonly status?: number; readonly error?: Json } | undefined;
  readonly reorgBlock?: bigint;
  readonly ownerCode?: "pinned" | "empty" | "foreign";
  /** Another endpoint of the same chain than the one the operation was prepared through. */
  readonly endpoint?: string;
}

export class FakeRpcTransport implements GaslessTransport {
  readonly calls: Array<{ readonly method: string; readonly params: readonly unknown[] }> = [];
  readonly chainId: MetaMaskGaslessChainId;
  private readonly deployment;
  private readonly codes: Json;
  private readonly served = new Map<string, bigint>();
  constructor(chainId: MetaMaskGaslessChainId, private readonly options: FakeOptions = {}) {
    this.chainId = chainId; this.deployment = mmRegistry(chainId).row;
    const refs = runtime.rows.find((item: Json) => item.chainId === chainId) as Json;
    assert.ok(refs); this.codes = { protocol: Object.fromEntries(Object.entries(refs.protocol)
      .map(([name, ref]) => [name, runtime.codes[String(ref)]])),
    tokenProxyCode: runtime.codes[refs.tokenProxyCode], tokenImplementationCode: runtime.codes[refs.tokenImplementationCode] };
  }
  async request(endpoint: string, method: "POST" | "GET", body: string | null, maxBytes: number,
    code: "APN_RPC_CONFIG" | "APN_HTTP_CONFIG") {
    assert.equal(endpoint, this.options.endpoint ?? RPC_URL); assert.equal(method, "POST"); assert.notEqual(body, null);
    assert.equal(maxBytes, 4 * 1024 * 1024); assert.equal(code, "APN_RPC_CONFIG");
    const request = JSON.parse(body!) as Json;
    this.calls.push({ method: request.method, params: request.params });
    if (request.method === "eth_estimateGas" && this.options.pricing?.estimateRevert) {
      return { status: 200, body: JSON.stringify({ jsonrpc: "2.0", id: request.id, error: { code: 3, message: "execution reverted" } }) };
    }
    if (request.method === "eth_getLogs") {
      const refused = this.options.refuseLogs?.(BigInt(request.params[0].fromBlock), BigInt(request.params[0].toBlock));
      if (refused?.status !== undefined) return { status: refused.status, body: "" };
      if (refused?.error !== undefined) return { status: 200, body: JSON.stringify({ jsonrpc: "2.0", id: request.id, error: refused.error }) };
    }
    const result = this.respond(request.method, request.params);
    return { status: 200, body: JSON.stringify({ jsonrpc: "2.0", id: request.id, result }) };
  }
  private respond(method: string, params: readonly unknown[]): unknown {
    if (method === "eth_chainId") return quantity(this.chainId);
    if (method === "eth_getBlockByNumber") return this.rawBlock(params[0] as string);
    if (method === "eth_getCode") return this.code(params[0] as string, this.blockNumber(params.at(-1)));
    if (method === "eth_getStorageAt") return addressWord(this.deployment.tokenImplementationAddress);
    if (method === "eth_call") {
      const call = params[0] as Json, selector = String(call.data).slice(0, 10);
      if (selector === "0x313ce567") return word(6n);
      if (selector === "0x70a08231") return word(1_000_000n);
      if (call.to.toLowerCase() === this.deployment.protocol.limitedCalls.address) {
        return word(this.options.counter?.(this.blockNumber(params.at(-1))) ?? 0n);
      }
      if (call.to.toLowerCase() === this.deployment.protocol.manager.address && selector === HASH_SELECTOR && this.options.pricing) {
        return this.options.pricing.managerHash;
      }
      if (call.to.toLowerCase() === OP_ORACLE && this.options.pricing) {
        return word(selector === L1_FEE_SELECTOR ? this.options.pricing.l1 ?? 0n : this.options.pricing.operator ?? 0n);
      }
      if (call.to.toLowerCase() === this.deployment.protocol.manager.address && selector === DISABLED_SELECTOR) {
        return word(this.options.disabled?.(this.blockNumber(params.at(-1)), `0x${String(call.data).slice(10)}` as Hex) ? 1n : 0n);
      }
      throw new Error(`unexpected eth_call ${selector}`);
    }
    if (method === "eth_getTransactionByHash") return this.options.transaction ?? null;
    if (this.options.pricing && method === "eth_getTransactionCount") return quantity(this.options.pricing.nonce ?? 7n);
    if (this.options.pricing && method === "eth_estimateGas") return quantity(this.options.pricing.gas ?? 60_000n);
    if (this.options.pricing && method === "eth_maxPriorityFeePerGas") return quantity(this.options.pricing.priority ?? 1_000_000n);
    if (this.options.pricing && method === "eth_getBalance") return quantity(this.options.pricing.balance ?? 10n ** 16n);
    if (method === "eth_getTransactionReceipt") return this.options.receipt ?? null;
    if (method === "eth_getLogs") {
      const filter = params[0] as Json, from = BigInt(filter.fromBlock), to = BigInt(filter.toBlock);
      return (this.options.scanLogs ?? []).filter(log => !this.options.refuseLogs ||
        (BigInt(log.blockNumber) >= from && BigInt(log.blockNumber) <= to));
    }
    throw new Error(`unexpected write or unknown RPC method ${method}`);
  }
  private rawBlock(tag: string): Json {
    const number = tag === "safe" || tag === "finalized" ? (this.options.finality ?? 100n) :
      tag === "latest" ? (this.options.head ?? this.options.finality ?? 101n) : BigInt(tag);
    const hash = this.options.reorgBlock === number ? `0x${"f".repeat(64)}` : blockHash(this.chainId, number);
    this.served.set(hash, number);
    const transactions = this.options.transaction?.blockNumber === quantity(number) ?
      [this.options.transaction.hash] : [];
    return { number: quantity(number), hash, timestamp: quantity(1_788_912_000n + number), transactions, baseFeePerGas: quantity(BASE_FEE) };
  }
  /** EIP-1898 pinned reads resolve to the height of a header this fake served; legacy fixed heights stay known. */
  private blockNumber(value: unknown): bigint {
    if (typeof value === "object" && value !== null && "blockHash" in value) {
      const served = this.served.get((value as Json).blockHash);
      if (served !== undefined) return served;
    }
    return blockNumber(value);
  }
  private code(addressInput: string, _blockNumber: bigint): Hex {
    const address = addressInput.toLowerCase(), row = this.deployment;
    for (const [name, pin] of Object.entries(row.protocol)) if (address === pin.address) {
      const code = this.codes.protocol[name] as Hex;
      return this.options.corruptProtocol && name === "manager" ? `${code.slice(0, -2)}00` as Hex : code;
    }
    if (address === row.token) return this.codes.tokenProxyCode as Hex;
    if (address === row.tokenImplementationAddress) return this.codes.tokenImplementationCode as Hex;
    if (address === vector.owner) {
      if (this.options.ownerCode === "empty") return "0x";
      if (this.options.ownerCode === "foreign") return "0x6000";
      return `0xef0100${row.protocol.delegate.address.slice(2)}` as Hex;
    }
    return "0x";
  }
}

export function intent(start: ReturnType<typeof block>, designation: "empty" | "pinned" = "pinned"): MetaMaskGaslessIntent {
  const deployment = mmRegistry(8453), row = deployment.row;
  const executions = vector.executions as MetaMaskGaslessIntent["quote"]["executions"];
  const quote = { netAtomic: "900000", feeAtomic: "100000", feeRecipient: vector.feeRecipient as Address,
    executions, hash: "" }; quote.hash = mmQuoteHash(quote);
  const state = chainState("0", designation);
  return { profile: "synthetic", request: { chainId: 8453, recipient: vector.recipient,
    grossAtomic: "1000000", maxFeeAtomic: "100000", minReceivedAtomic: "900000" },
    binding: { providerId: "metamask-agent-wallet", address: vector.owner,
      accountBindingHash: "2".repeat(64), capabilityHash: "3".repeat(64), revision: 1,
      projectHash: "4".repeat(64), walletReferenceHash: "5".repeat(64), walletIdHash: mmWalletIdentityHash(vector.owner),
      namespace: "eip155", mode: "server", environment: "prod" }, token: row.token, decimals: 6,
    deploymentEvidenceHash: deployment.deploymentEvidenceHash, initialSnapshot: { chainId: 8453,
      endpointHash: sha256(RPC_URL), endpointOrigin: "https://rpc.example", observedAt: "2026-09-09T00:00:00.000Z",
      safeBlock: start, headBlock: start, safeState: state, headState: state }, quote,
    requestId: "synthetic-request", preparedAt: "2026-09-09T00:00:00.000Z",
    expiresAt: "2026-09-09T00:05:00.000Z", policyHash: "6".repeat(64),
    unsignedDelegation: vector.unsignedDelegation, delegationHash: vector.delegationHash,
    signingDigest: vector.signingDigest, relayTo: row.protocol.manager.address, mode: vector.mode } as MetaMaskGaslessIntent;
}

export function chainState(counterAtomic: string, designation: "empty" | "pinned" = "pinned"): MetaMaskGaslessChainState {
  const row = mmRegistry(8453).row, code = designation === "empty" ? "0x" as Hex :
    `0xef0100${row.protocol.delegate.address.slice(2)}` as Hex;
  return { protocolCodeHashes: Object.fromEntries(Object.entries(row.protocol).map(([name, pin]) =>
    [name, pin.codeHash])) as MetaMaskGaslessChainState["protocolCodeHashes"], tokenProxyCodeHash: row.tokenProxyCodeHash,
    tokenImplementationAddress: row.tokenImplementationAddress, tokenImplementationCodeHash: row.tokenImplementationCodeHash,
    tokenDecimals: 6, ownerCodeHash: keccak256(code), designation, usdcBalanceAtomic: "1000000", counterAtomic };
}

export function block(chainId: number, number: bigint) {
  return { numberAtomic: number.toString(), hash: blockHash(chainId, number),
    timestampAtomic: (1_788_912_000n + number).toString() };
}

export function blockNumber(value: unknown): bigint {
  if (typeof value === "object" && value !== null && "blockHash" in value) {
    for (const number of [100n, 101n, 102n, 2099n, 2500n, 2501n])
      if ((value as Json).blockHash === blockHash(8453, number)) return number;
  }
  return 0n;
}

export function rawSettlementLogs(value: MetaMaskGaslessIntent, at: ReturnType<typeof block>): Json[] {
  const row = mmRegistry(8453).row, common = { transactionHash: vector.type2.hash, blockHash: at.hash,
    blockNumber: "0x65", transactionIndex: "0x0", removed: false };
  return [{ ...common, address: row.protocol.limitedCalls.address, logIndex: "0x0",
    topics: [MM_INCREASED_COUNT_TOPIC, addressWord(row.protocol.manager.address), addressWord(vector.relayer),
      value.delegationHash], data: `${word(1n)}${word(1n).slice(2)}` },
  { ...common, address: row.token, logIndex: "0x1",
    topics: [MM_TRANSFER_TOPIC, addressWord(vector.owner), addressWord(vector.recipient)], data: word(900000n) },
  { ...common, address: row.token, logIndex: "0x2",
    topics: [MM_TRANSFER_TOPIC, addressWord(vector.owner), addressWord(vector.feeRecipient)], data: word(100000n) }];
}

