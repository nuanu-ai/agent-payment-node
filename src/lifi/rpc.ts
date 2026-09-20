import { encodeFunctionData, keccak256 } from "viem";
import { canonicalJson, hashObject } from "../canonical.js";
import { ApnError } from "../errors.js";
import { EvmRpc } from "../evm-rpc.js";
import { evmRpcAddress, evmRpcBlock, evmRpcHex, evmRpcQuantity, evmRpcRecord, evmRpcWord } from "../evm-rpc-codec.js";
import type { BridgeChainId } from "./chains.js";
import type { EvmRpcCall } from "../evm-ports.js";
import type { Address, Hex } from "../model.js";
import { parsePublicHttpsUrl } from "../network-policy.js";
import { bridgeDeployment } from "./deployments.js";
import { BridgeHttps } from "./https.js";
import type { BridgeBlock, BridgeEnvelope, BridgeLog, BridgeProtocolReceipt, BridgeTool, BridgeTransaction, BridgeTransactionProof } from "./model.js";
import type { BridgeRpcFactory, BridgeRpcPort } from "./ports.js";
import { bridgeArchiveEndpoint, isHistoricalStateRead } from "./rpc-archive.js";
import { BASE_FEE_CONTRACT, bridgeActualFees } from "./rpc-fees.js";
import { verifyRpcTransaction } from "./rpc-transaction.js";
import { bridgeAssetRow, bridgeChain } from "./asset-registry.js";
import { BRIDGE_ZERO_ADDRESS, BRIDGE_ZERO_WORD, bridgeFailure, bridgeHex, bridgeJson, bridgeSame, bridgeUint } from "./validation.js";

const ERC20_READ = [{ type: "function", name: "allowance", stateMutability: "view", inputs: [{ type: "address" }, { type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] }] as const;
const READ_METHODS = new Set(["eth_chainId", "eth_getBlockByNumber", "eth_getBalance", "eth_getCode", "eth_getStorageAt", "eth_getTransactionCount", "eth_call", "eth_estimateGas", "eth_maxPriorityFeePerGas", "eth_getTransactionByHash", "eth_getTransactionReceipt", "eth_getLogs", "debug_traceTransaction", "eth_sendRawTransaction"]);
const LINEA_TRACE_PROBE_TRANSACTION = "0x4352433956109d31ab50db9547f16bcb90f3545f793ed40f75716ccd9a360efd" as Hex;
export const BRIDGE_RPC_ENV = { 1: "APN_ETHEREUM_RPC_URL", 56: "APN_BNB_RPC_URL", 8453: "APN_BASE_RPC_URL",
  42161: "APN_ARBITRUM_RPC_URL", 59144: "APN_LINEA_RPC_URL" } as const;
/** The single explicit Ethereum-family RPC reader: endpoint only from its named environment variable, public HTTPS, no query. */
export function bridgeRpcCall(chainId: BridgeChainId, environment: Readonly<Record<string, string | undefined>>, options: {
  readonly transport?: Pick<BridgeHttps, "request">;
  readonly wait?: (milliseconds: number) => Promise<void>;
} = {}): { readonly origin: string; readonly call: EvmRpcCall } {
  bridgeChain(chainId, "APN_RPC_CONFIG");
  const transport = options.transport ?? new BridgeHttps();
  const wait = options.wait ?? (async (milliseconds: number) => await new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const value = environment[BRIDGE_RPC_ENV[chainId]];
  if (value === undefined || value.length === 0) bridgeFailure("APN_RPC_CONFIG", `missing_${BRIDGE_RPC_ENV[chainId]}`);
  const endpoint = parsePublicHttpsUrl(value, "APN_RPC_CONFIG", "Bridge RPC endpoint", 2048);
  if (endpoint.search !== "") bridgeFailure("APN_RPC_CONFIG", "bridge_RPC_query_forbidden");
  const archive = bridgeArchiveEndpoint(chainId, environment);
  let sequence = 0n, archiveChain: Promise<void> | undefined;
  const call: EvmRpcCall = async (method, params) => {
    if (!READ_METHODS.has(method)) bridgeFailure("APN_RPC_PROTOCOL", "bridge_RPC_method");
    if (archive === null || !isHistoricalStateRead(method, params)) return await exchange(endpoint, method, params);
    // Only an explicitly named archive reader answers block-pinned state reads, after it proves the same chain once.
    if (archiveChain === undefined) archiveChain = (async () => {
      if (evmRpcQuantity(await exchange(archive, "eth_chainId", [])) !== BigInt(chainId)) bridgeFailure("APN_RPC_CONFIG", "bridge_archive_RPC_chain");
    })();
    await archiveChain;
    return await exchange(archive, method, params);
  };
  const exchange = async (target: URL, method: string, params: readonly unknown[]): Promise<unknown> => {
    for (let attempt = 0; ; attempt += 1) {
      const id = (++sequence).toString(), body = canonicalJson({ jsonrpc: "2.0", id, method, params });
      let response;
      try { response = await transport.request(target.toString(), "POST", body, 1024 * 1024, "APN_RPC_CONFIG"); }
      catch (error) {
        if (error instanceof ApnError && error.code === "APN_RPC_AMBIGUOUS") {
          throw new ApnError("APN_RPC_AMBIGUOUS", "Bridge RPC transport is unavailable.", { rpcMethod: method });
        }
        throw error;
      }
      if (response.status === 429 && chainId === 8453 && method !== "eth_sendRawTransaction" && attempt < 2) {
        await wait(attempt === 0 ? 1_000 : 2_000);
        continue;
      }
      if (response.status === 429) bridgeFailure("APN_RPC_PROTOCOL", "bridge_RPC_HTTP_429");
      if (response.status !== 200) bridgeFailure("APN_RPC_PROTOCOL", "bridge_RPC_HTTP_status");
      const r = evmRpcRecord(bridgeJson(response.body, 1024 * 1024));
      if (r.jsonrpc !== "2.0" || r.id !== id || !Object.hasOwn(r, "result") || Object.hasOwn(r, "error")) bridgeFailure("APN_RPC_PROTOCOL", "bridge_RPC_response");
      return r.result;
    }
  };
  return { origin: endpoint.origin, call };
}
export function bridgeRpcFactory(environment: Readonly<Record<string, string | undefined>>, options: {
  readonly transport?: Pick<BridgeHttps, "request">;
  readonly wait?: (milliseconds: number) => Promise<void>;
} = {}): BridgeRpcFactory {
  const cache = new Map<BridgeChainId, BridgeRpcPort>(), transport = options.transport ?? new BridgeHttps();
  return (chainId) => {
    bridgeChain(chainId, "APN_RPC_CONFIG");
    const existing = cache.get(chainId); if (existing !== undefined) return existing;
    const { origin, call } = bridgeRpcCall(chainId, environment, { ...options, transport });
    const rpc = new BridgeRpc(chainId, origin, call); cache.set(chainId, rpc); return rpc;
  };
}
export class BridgeRpc implements BridgeRpcPort {
  private readonly evm: EvmRpc;
  constructor(readonly chainId: BridgeChainId, readonly origin: string, private readonly call: EvmRpcCall) {
    bridgeChain(chainId); this.evm = new EvmRpc(call, origin, 16 * 1024);
  }
  async assertChain(): Promise<void> { await this.evm.assertChain(this.chainId); }
  async block(tag: "latest" | "safe" | string): Promise<BridgeBlock> {
    await this.assertChain();
    const rpcTag = tag === "latest" || tag === "safe" ? tag : quantity(bridgeUint(tag));
    const b = await evmRpcBlock(this.call, rpcTag);
    await this.assertChain();
    return { numberAtomic: b.number, hash: b.hash, timestampAtomic: evmRpcQuantity(b.raw.timestamp).toString() };
  }
  async deployment(tool: BridgeTool, peerChainId: BridgeChainId, token: Address, block?: BridgeBlock) {
    await this.assertChain();
    const at = block ?? await this.block("safe"), contract = bridgeDeployment(this.chainId, peerChainId, tool, token), tag = quantity(BigInt(at.numberAtomic));
    const code: Array<{ address: Address; codeHash: Hex }> = [], configuration: Array<{ kind: string; address: Address; data: Hex; expected: Hex }> = [];
    const feeContract = this.chainId === 8453 ? BASE_FEE_CONTRACT : { code: [], reads: [] };
    for (const row of [...contract.code, ...feeContract.code]) {
      const bytes = bridgeHex(await this.call("eth_getCode", [row.address, tag]), 128 * 1024, undefined, "APN_RPC_PROTOCOL");
      if (bytes === "0x" || keccak256(bytes) !== row.codeHash) bridgeFailure("APN_PROVIDER_PROTOCOL", "bridge_deployment_code_changed");
      code.push({ address: row.address, codeHash: keccak256(bytes) });
    }
    for (const row of [...contract.reads, ...feeContract.reads]) {
      const result = row.kind === "storage" ? await this.call("eth_getStorageAt", [row.address, row.data, tag])
        : await this.call("eth_call", [{ to: row.address, data: row.data }, tag]);
      const observed = bridgeHex(result, 64 * 1024, undefined, "APN_RPC_PROTOCOL");
      if (observed !== row.expected) bridgeFailure("APN_PROVIDER_PROTOCOL", "bridge_deployment_configuration_changed");
      configuration.push({ ...row, expected: observed });
    }
    if (this.chainId === 59144 && peerChainId === 1 && tool === "across" && token === BRIDGE_ZERO_ADDRESS) {
      const trace = evmRpcRecord(await this.call("debug_traceTransaction", [LINEA_TRACE_PROBE_TRANSACTION,
        { tracer: "callTracer", tracerConfig: { onlyTopCall: true, withLog: false } }]));
      if (trace.type !== "CALL" || evmRpcAddress(trace.from).toLowerCase() !== "0x9629fe86f04e735923e8542ddd9f265f576e7421" ||
          evmRpcAddress(trace.to).toLowerCase() !== "0xbcc016e2a79d509d2b776827ed986568d9b56d59" || evmRpcQuantity(trace.value) !== 243939205000000000n) {
        bridgeFailure("APN_PROVIDER_PROTOCOL", "linea_trace_capability_changed");
      }
    }
    await this.recheck(at); await this.assertChain();
    return { chainId: this.chainId, peerChainId, tool, block: at, rpcOrigin: this.origin,
      contractHash: hashObject({ protocol: contract, feeContract }), codeHash: hashObject(code), configurationHash: hashObject(configuration) };
  }
  /** A native principal's balance is the native balance itself and its allowance is the constant zero: nothing is approved. */
  async account(owner: Address, spender: Address, token: Address) {
    await this.assertChain(); const at = await this.block("latest"), tag = quantity(BigInt(at.numberAtomic));
    const asset = bridgeAssetRow(this.chainId, token, "APN_RPC_CONFIG");
    const data = encodeFunctionData({ abi: ERC20_READ, functionName: "balanceOf", args: [owner] });
    const allowanceData = encodeFunctionData({ abi: ERC20_READ, functionName: "allowance", args: [owner, spender] });
    const nativeBalance = this.call("eth_getBalance", [owner, tag]).then(evmRpcQuantity);
    const [balance, native, allowance, latest, pending] = await Promise.all([
      asset.kind === "native" ? nativeBalance : this.call("eth_call", [{ to: token, data }, tag]).then(evmRpcWord), nativeBalance,
      asset.kind === "native" ? Promise.resolve(0n) : this.call("eth_call", [{ to: token, data: allowanceData }, tag]).then(evmRpcWord),
      this.call("eth_getTransactionCount", [owner, "latest"]).then(evmRpcQuantity), this.call("eth_getTransactionCount", [owner, "pending"]).then(evmRpcQuantity),
    ]);
    await this.recheck(at); await this.assertChain();
    return { chainId: this.chainId, rpcOrigin: this.origin, block: at, owner, token, spender, balanceAtomic: balance.toString(),
      nativeBalanceWei: native.toString(), allowanceAtomic: allowance.toString(), latestNonceAtomic: latest.toString(), pendingNonceAtomic: pending.toString() };
  }
  async prices() {
    await this.assertChain();
    const b = await evmRpcBlock(this.call, "latest"), priority = this.chainId === 42161 ? 0n : evmRpcQuantity(await this.call("eth_maxPriorityFeePerGas", []));
    const maximum = 2n * evmRpcQuantity(b.raw.baseFeePerGas) + priority;
    bridgeUint(maximum.toString(), true, "APN_RPC_PROTOCOL"); await this.assertChain();
    return { maxFeePerGasAtomic: maximum.toString(), maxPriorityFeePerGasAtomic: priority.toString() };
  }
  async estimate(transaction: BridgeTransaction) {
    if (transaction.chainId !== this.chainId) bridgeFailure("APN_CHAIN_MISMATCH", "bridge_estimate_chain");
    return await this.evm.estimate(transaction);
  }
  async feeQuote(envelope: Pick<BridgeEnvelope, "economics">) { return await this.evm.feeQuote(this.chainId, envelope.economics); }
  async send(raw: Hex): Promise<Hex> {
    bridgeHex(raw, 16 * 1024, undefined, "APN_PROVIDER_EFFECT_UNAVAILABLE");
    const hash = evmRpcHex(await this.call("eth_sendRawTransaction", [raw]), 32);
    if (hash !== keccak256(raw)) bridgeFailure("APN_RPC_AMBIGUOUS", "submitted_transaction_hash_mismatch");
    return hash;
  }
  async observe(hash: Hex, expected?: BridgeEnvelope, nativeDelivery?: Readonly<{ recipient: Address; from: Address; amountAtomic: string }>): Promise<{ transaction: BridgeTransactionProof; receipt: BridgeProtocolReceipt } | null> {
    await this.assertChain(); bridgeHex(hash, 32, 32, "APN_RPC_PROTOCOL");
    const [rawTx, rawReceipt] = await Promise.all([this.call("eth_getTransactionByHash", [hash]), this.call("eth_getTransactionReceipt", [hash])]);
    if (rawTx === null || rawReceipt === null) return null;
    const tx = evmRpcRecord(rawTx), r = evmRpcRecord(rawReceipt), number = evmRpcQuantity(r.blockNumber), blockHash = evmRpcHex(r.blockHash, 32);
    if (evmRpcHex(r.transactionHash, 32) !== hash || evmRpcHex(tx.blockHash, 32) !== blockHash ||
      evmRpcQuantity(tx.blockNumber) !== number || evmRpcQuantity(tx.type) !== evmRpcQuantity(r.type) || evmRpcQuantity(tx.transactionIndex) !== evmRpcQuantity(r.transactionIndex)) bridgeFailure("APN_RPC_PROTOCOL", "receipt_transaction_membership");
    const included = await evmRpcBlock(this.call, quantity(number));
    const index = evmRpcQuantity(r.transactionIndex);
    if (included.hash !== blockHash || !Array.isArray(included.raw.transactions) || included.raw.transactions.length > 20_000 ||
      index >= BigInt(included.raw.transactions.length) || included.raw.transactions[Number(index)] !== hash) bridgeFailure("APN_RPC_PROTOCOL", "canonical_transaction_membership");
    const block = { numberAtomic: number.toString(), hash: blockHash, timestampAtomic: evmRpcQuantity(included.raw.timestamp).toString() };
    const safe = await this.block("safe"), safeBlock = BigInt(safe.numberAtomic) >= number ? safe : null;
    const status = evmRpcQuantity(r.status);
    if (status !== 0n && status !== 1n) bridgeFailure("APN_RPC_PROTOCOL", "receipt_status");
    const identity = await verifyRpcTransaction(tx, this.chainId, hash, expected);
    if (evmRpcAddress(r.from) !== identity.from || evmRpcAddress(r.to) !== identity.to) bridgeFailure("APN_RPC_PROTOCOL", "receipt_sender_target");
    const logs = parseReceiptLogs(r.logs, hash, block, index), fees = await bridgeActualFees(this.chainId, r, block, this.call);
    if (BigInt(fees.gasUsedAtomic) > BigInt(identity.gasLimitAtomic) || BigInt(fees.effectiveGasPriceAtomic) > BigInt(identity.maxFeePerGasAtomic)) bridgeFailure("APN_RPC_PROTOCOL", "receipt_execution_fee_bounds");
    let nativeBalance: BridgeProtocolReceipt["nativeBalance"] = null;
    let nativeTransfer: BridgeProtocolReceipt["nativeTransfer"] = null;
    if (nativeDelivery !== undefined) {
      if (number === 0n) bridgeFailure("APN_RPC_PROTOCOL", "native_balance_genesis");
      const beforeRaw = await evmRpcBlock(this.call, quantity(number - 1n));
      const before = { numberAtomic: (number - 1n).toString(), hash: beforeRaw.hash, timestampAtomic: evmRpcQuantity(beforeRaw.raw.timestamp).toString() };
      const [beforeBalance, afterBalance, trace] = await Promise.all([
        this.call("eth_getBalance", [nativeDelivery.recipient, { blockHash: before.hash, requireCanonical: true }]).then(evmRpcQuantity),
        this.call("eth_getBalance", [nativeDelivery.recipient, { blockHash: block.hash, requireCanonical: true }]).then(evmRpcQuantity),
        this.call("debug_traceTransaction", [hash, { tracer: "callTracer", tracerConfig: { onlyTopCall: false, withLog: false } }]),
      ]);
      if (afterBalance < beforeBalance) bridgeFailure("APN_RPC_PROTOCOL", "native_balance_delta_negative");
      nativeBalance = { recipient: nativeDelivery.recipient, beforeBlock: before, afterBlock: block,
        beforeBalanceAtomic: beforeBalance.toString(), afterBalanceAtomic: afterBalance.toString(), deltaAtomic: (afterBalance - beforeBalance).toString() };
      nativeTransfer = exactNativeTransfer(trace, hash, nativeDelivery);
      await this.recheck(before);
    }
    await this.recheck(block); if (safeBlock !== null) await this.recheck(safeBlock); await this.assertChain();
    return { transaction: { chainId: this.chainId, transactionHash: hash, block, safeBlock, rpcOrigin: this.origin, ...identity,
      ...fees, status: status === 1n ? "success" : "reverted", logsHash: hashObject(logs) },
      receipt: { chainId: this.chainId, transactionHash: hash, blockNumberAtomic: number.toString(), blockHash, logs, nativeBalance, nativeTransfer } };
  }
  async logs(input: Parameters<BridgeRpcPort["logs"]>[0]) {
    await this.assertChain(); const from = bridgeUint(input.fromBlockAtomic), to = bridgeUint(input.toBlockAtomic);
    if (from > to || to - from >= 1024n || input.topics.length < 2 || input.topics.length > 4) bridgeFailure("APN_RPC_PROTOCOL", "destination_log_range");
    const value = await this.call("eth_getLogs", [{ address: input.address, fromBlock: quantity(from), toBlock: quantity(to), topics: input.topics }]);
    if (!Array.isArray(value) || value.length > 128) bridgeFailure("APN_RPC_PROTOCOL", "destination_log_count");
    const result = value.map((value) => {
      const r = evmRpcRecord(value), number = evmRpcQuantity(r.blockNumber), blockHash = evmRpcHex(r.blockHash, 32), transactionHash = evmRpcHex(r.transactionHash, 32);
      if (evmRpcAddress(r.address) !== input.address || r.removed !== false || number < from || number > to ||
        !Array.isArray(r.topics) || r.topics.length > 4 || r.topics.length < input.topics.length ||
        input.topics.some((v, i) => v !== null && evmRpcHex((r.topics as unknown[])[i], 32) !== v)) bridgeFailure("APN_RPC_PROTOCOL", "destination_log_identity");
      bridgeHex(r.data, 64 * 1024, undefined, "APN_RPC_PROTOCOL");
      if (transactionHash === BRIDGE_ZERO_WORD || blockHash === BRIDGE_ZERO_WORD) bridgeFailure("APN_RPC_PROTOCOL", "destination_log_hash");
      return { transactionHash, blockNumberAtomic: number.toString(), blockHash };
    });
    await this.assertChain(); return result;
  }
  private async recheck(block: BridgeBlock): Promise<void> {
    if (!bridgeSame(await this.block(block.numberAtomic), block)) bridgeFailure("APN_RPC_PROTOCOL", "bridge_block_reorg");
  }
}
function exactNativeTransfer(value: unknown, transactionHash: Hex, expected: Readonly<{ recipient: Address; from: Address; amountAtomic: string }>) {
  const rows: Array<{ type: "CALL"; from: Address; to: Address; valueAtomic: string; path: string }> = [];
  const visit = (raw: unknown, path: string, depth: number): void => {
    if (depth > 32 || rows.length > 1024) bridgeFailure("APN_RPC_PROTOCOL", "native_trace_bound");
    const call = evmRpcRecord(raw), from = evmRpcAddress(call.from), to = evmRpcAddress(call.to), valueAtomic = evmRpcQuantity(call.value ?? "0x0").toString();
    if (call.type === "CALL" && call.error === undefined && from === expected.from && to === expected.recipient && valueAtomic === expected.amountAtomic) {
      rows.push({ type: "CALL", from, to, valueAtomic, path });
    }
    if (call.calls !== undefined) {
      if (!Array.isArray(call.calls) || call.calls.length > 256) bridgeFailure("APN_RPC_PROTOCOL", "native_trace_calls");
      call.calls.forEach((child, index) => visit(child, `${path}.${index}`, depth + 1));
    }
  };
  visit(value, "0", 0);
  if (rows.length !== 1) bridgeFailure("APN_RPC_PROTOCOL", "native_destination_transfer");
  return { transactionHash, from: expected.from, to: expected.recipient, valueAtomic: expected.amountAtomic,
    traceHash: hashObject({ transactionHash, delivery: rows[0] }) };
}
function quantity(n: bigint): Hex { return `0x${n.toString(16)}`; }
function parseReceiptLogs(value: unknown, hash: Hex, block: BridgeBlock, transactionIndex: bigint): readonly BridgeLog[] {
  if (!Array.isArray(value) || value.length > 256) bridgeFailure("APN_RPC_PROTOCOL", "receipt_log_count");
  const indices = new Set<string>();
  return value.map((value) => {
    const l = evmRpcRecord(value), index = evmRpcQuantity(l.logIndex).toString();
    if (indices.has(index) || evmRpcHex(l.transactionHash, 32) !== hash || evmRpcHex(l.blockHash, 32) !== block.hash ||
      evmRpcQuantity(l.blockNumber).toString() !== block.numberAtomic || evmRpcQuantity(l.transactionIndex) !== transactionIndex || l.removed !== false || !Array.isArray(l.topics) || l.topics.length > 4) bridgeFailure("APN_RPC_PROTOCOL", "receipt_log_membership");
    indices.add(index);
    return { address: evmRpcAddress(l.address), topics: l.topics.map((v) => evmRpcHex(v, 32)), data: bridgeHex(l.data, 64 * 1024, undefined, "APN_RPC_PROTOCOL") };
  });
}
