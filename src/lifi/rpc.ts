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
import type { BridgeBlock, BridgeDestinationTransactionProof, BridgeEnvelope, BridgeProtocolReceipt, BridgeTool, BridgeTransaction, BridgeTransactionProof } from "./model.js";
import type { BridgeRpcFactory, BridgeRpcPort, LifiResponse } from "./ports.js";
import { bridgeArchiveEndpoint, isArchiveRead, isHistoricalStateRead } from "./rpc-archive.js";
import { BASE_FEE_CONTRACT, bridgeActualFees } from "./rpc-fees.js";
import { verifyRpcTransaction } from "./rpc-transaction.js";
import { bridgeAssetRow, bridgeChain } from "./asset-registry.js";
import { BRIDGE_ZERO_ADDRESS, BRIDGE_ZERO_WORD, bridgeFailure, bridgeHex, bridgeJson, bridgeSame, bridgeUint } from "./validation.js";
import { BNB_COMPOSITE, bnbPoolReadData, verifyBnbCompositeTrace, verifyBnbPoolConfiguration } from "./bnb-composite.js";
import { approvedTransportReason, MAX_READ_ATTEMPTS, parseRetryAfter, RpcHttpFailure, RpcReadSession, RPC_RETRY_DELAY_MS,
  type RpcBatchAttempt, type RpcBatchReadItem } from "./rpc-session.js";
import { bridgeFeeQuote, rpcBlockValue, rpcExpectedChainValue, rpcFeeBlockValue, rpcHexValue, rpcQuantityValue,
  rpcRecordValue, rpcTransactionInput, rpcWordValue } from "./rpc-batch-codec.js";
import { exactNativeTransfer, parseReceiptLogs } from "./rpc-proof-codec.js";
export { RpcReadSession } from "./rpc-session.js";
export type { RpcBatchReadItem, RpcReadSessionOptions, RpcReadTelemetry } from "./rpc-session.js";
const ERC20_READ = [{ type: "function", name: "allowance", stateMutability: "view", inputs: [{ type: "address" }, { type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] }] as const;
const GAS_ORACLE = "0x420000000000000000000000000000000000000F" as Address;
const L1_BLOCK = "0x4200000000000000000000000000000000000015" as Address;
const GAS_ORACLE_ABI = [{ type: "function", name: "getL1FeeUpperBound", stateMutability: "view", inputs: [{ name: "size", type: "uint256" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "getOperatorFee", stateMutability: "view", inputs: [{ name: "gas", type: "uint256" }], outputs: [{ type: "uint256" }] }] as const;
const READ_METHODS = new Set(["eth_chainId", "eth_getBlockByNumber", "eth_getBalance", "eth_getCode", "eth_getStorageAt", "eth_getTransactionCount", "eth_call", "eth_estimateGas", "eth_maxPriorityFeePerGas", "eth_getTransactionByHash", "eth_getTransactionReceipt", "debug_traceTransaction", "eth_sendRawTransaction"]);
const LINEA_TRACE_PROBE_TRANSACTION = "0x4352433956109d31ab50db9547f16bcb90f3545f793ed40f75716ccd9a360efd" as Hex;
const MONAD_TRACE_PROBE_TRANSACTION = "0x9ff1560ef67d7253df2663b897452abe6644f6d6cb746743253822c264d13440" as Hex;
export const BRIDGE_RPC_ENV = { 1: "APN_ETHEREUM_RPC_URL", 56: "APN_BNB_RPC_URL", 8453: "APN_BASE_RPC_URL", 143: "APN_MONAD_RPC_URL", 42161: "APN_ARBITRUM_RPC_URL", 59144: "APN_LINEA_RPC_URL" } as const;
export function bridgeRpcCall(chainId: BridgeChainId, environment: Readonly<Record<string, string | undefined>>, options: {
  readonly transport?: Pick<BridgeHttps, "request">;
  readonly wait?: (milliseconds: number) => Promise<void>;
} = {}): { readonly origin: string; readonly call: EvmRpcCall; readonly attempt: EvmRpcCall; readonly sessionCall: (session: RpcReadSession) => EvmRpcCall;
  readonly sessionBatchCall: (session: RpcReadSession) => (items: readonly Omit<RpcBatchReadItem, "batchAttempt">[], route?: "primary" | "archive" | "archive_deployment") => Promise<readonly unknown[]> } {
  bridgeChain(chainId, "APN_RPC_CONFIG");
  const transport = options.transport ?? new BridgeHttps();
  const wait = options.wait ?? (async (milliseconds: number) => await new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const value = environment[BRIDGE_RPC_ENV[chainId]];
  if (value === undefined || value.length === 0) bridgeFailure("APN_RPC_CONFIG", `missing_${BRIDGE_RPC_ENV[chainId]}`);
  const endpoint = parsePublicHttpsUrl(value, "APN_RPC_CONFIG", "Bridge RPC endpoint", 2048);
  if (endpoint.search !== "") bridgeFailure("APN_RPC_CONFIG", "bridge_RPC_query_forbidden");
  const archive = bridgeArchiveEndpoint(chainId, environment);
  const distinctArchive = archive !== null && archive.origin !== endpoint.origin ? archive : null;
  let sequence = 0n, archiveChain: Promise<void> | undefined;
  const call: EvmRpcCall = async (method, params) => {
    if (!READ_METHODS.has(method)) bridgeFailure("APN_RPC_PROTOCOL", "bridge_RPC_method");
    if (method === "eth_sendRawTransaction") return await submitDirect(method, params, (m, p) => oneAttempt(endpoint, m, p));
    if (method === "eth_getTransactionReceipt" && isArchiveRead(method, params)) {
      let primary: unknown;
      try { primary = await retryDirect(method, params, () => oneAttempt(endpoint, method, params), wait); }
      catch (error) {
        if (distinctArchive === null || !isReceiptFallbackError(error)) throw error;
        return await archiveReceipt(method, params, distinctArchive);
      }
      if (primary !== null || distinctArchive === null) return primary;
      return await archiveReceipt(method, params, distinctArchive);
    }
    if (isHistoricalStateRead(method, params)) {
      if (distinctArchive === null) return missingHistoricalArchive();
      return await archiveRead(method, params, distinctArchive);
    }
    return await retryDirect(method, params, () => oneAttempt(endpoint, method, params), wait);
  };
  const assertArchiveChain = async (target: URL): Promise<void> => {
    if (archiveChain === undefined) archiveChain = (async () => {
      if (evmRpcQuantity(await retryDirect("eth_chainId", [], () => oneAttempt(target, "eth_chainId", []), wait)) !== BigInt(chainId)) {
        bridgeFailure("APN_RPC_CONFIG", "bridge_archive_RPC_chain");
      }
    })();
    await archiveChain;
  };
  const archiveRead = async (method: string, params: readonly unknown[], target: URL): Promise<unknown> => {
    await assertArchiveChain(target);
    return await retryDirect(method, params, () => oneAttempt(target, method, params), wait);
  };
  const archiveReceipt = async (method: string, params: readonly unknown[], target: URL): Promise<unknown> => {
    if (archiveChain !== undefined) {
      await archiveChain;
      return await retryDirect(method, params, () => oneAttempt(target, method, params), wait);
    }
    const requests = [
      { jsonrpc: "2.0", id: (++sequence).toString(), method: "eth_chainId", params: [] },
      { jsonrpc: "2.0", id: (++sequence).toString(), method, params },
    ] as const;
    const operation = (async () => {
      const response = await retryDirect(method, params, async () => await batchAttempt(target, canonicalJson(requests)), wait);
      const values = decodeAtomicBatchResponse(response, requests);
      rpcArchiveChainValue(chainId)(values[0]);
      return values[1];
    })();
    archiveChain = operation.then(() => undefined);
    void archiveChain.catch(() => undefined);
    try { return await operation; } catch (error) { archiveChain = undefined; throw error; }
  };
  const oneAttempt = async (target: URL, method: string, params: readonly unknown[], now = Date.now()): Promise<unknown> => {
    if (!READ_METHODS.has(method)) bridgeFailure("APN_RPC_PROTOCOL", "bridge_RPC_method");
    const id = (++sequence).toString(), body = canonicalJson({ jsonrpc: "2.0", id, method, params });
    let response: LifiResponse;
    try { response = await transport.request(target.toString(), "POST", body, 1024 * 1024, "APN_RPC_CONFIG"); }
    catch (error) {
      if (error instanceof ApnError && error.code === "APN_RPC_AMBIGUOUS") throw error;
      throw error;
    }
    if (response.status !== 200) {
      if (response.status === 403 && knownPublicNodeReceiptCapability(chainId, target, method, response.body)) {
        throw new ApnError("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "Bridge RPC historical receipt read is unavailable.",
          { rpcMethod: method, reason: "historical_receipt_unavailable" });
      }
      throw new RpcHttpFailure(method, response.status, parseRetryAfter(response.headers, now));
    }
    const r = evmRpcRecord(bridgeJson(response.body, 1024 * 1024));
    if (r.jsonrpc !== "2.0" || r.id !== id) bridgeFailure("APN_RPC_PROTOCOL", "bridge_RPC_response", { rpcMethod: method });
    if (Object.hasOwn(r, "error")) {
      if (method === "eth_getTransactionReceipt" && historicalReceiptUnavailable(r.error, chainId, target, method)) {
        throw new ApnError("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "Bridge RPC historical receipt read is unavailable.",
          { rpcMethod: method, reason: "historical_receipt_unavailable" });
      }
      bridgeFailure("APN_RPC_PROTOCOL", "bridge_RPC_response", { rpcMethod: method });
    }
    if (!Object.hasOwn(r, "result")) bridgeFailure("APN_RPC_PROTOCOL", "bridge_RPC_response", { rpcMethod: method });
    return r.result;
  };
  const batchAttempt = async (target: URL, body: string, now = Date.now()): Promise<unknown> => {
    const rpcMethod = rpcBodyMethod(body);
    let response: LifiResponse;
    try { response = await transport.request(target.toString(), "POST", body, 1024 * 1024, "APN_RPC_CONFIG"); }
    catch (error) { throw error; }
    if (response.status !== 200) throw new RpcHttpFailure(rpcMethod, response.status, parseRetryAfter(response.headers, now));
    return bridgeJson(response.body, 1024 * 1024);
  };
  const sessionBatchCall = (session: RpcReadSession) => async (items: readonly Omit<RpcBatchReadItem, "batchAttempt">[], route: "primary" | "archive" | "archive_deployment" = "primary") => {
    if (route !== "primary" && items.some((item) => !isArchiveBatchItem(item.method, item.params))) {
      bridgeFailure("APN_RPC_CONFIG", "bridge_archive_RPC_method");
    }
    const target = route !== "primary" ? distinctArchive ?? missingHistoricalArchive() : endpoint;
    const attempt: RpcBatchAttempt = async (body) => await batchAttempt(target, body, session.currentTime());
    const bound = items.map((item) => ({ ...item, batchAttempt: attempt }));
    return route === "archive_deployment"
      ? await session.readArchiveDeploymentBatch(target.toString(), chainId, bound)
      : await session.readBatch(target.toString(), chainId, bound);
  };
  const sessionArchiveReceipt = async (session: RpcReadSession, method: string, params: readonly unknown[]): Promise<unknown> => {
    const values = await sessionBatchCall(session)([
      { method: "eth_chainId", params: [], cachePolicy: "immutable", decoder: rpcExpectedChainValue(chainId) },
      { method, params, cachePolicy: "auto", decoder: (value) => value },
    ], "archive");
    return values[1];
  };
  const sessionCall = (session: RpcReadSession): EvmRpcCall => async (method, params) => {
    if (!READ_METHODS.has(method)) bridgeFailure("APN_RPC_PROTOCOL", "bridge_RPC_method");
    const primaryAttempt = (m: string, p: readonly unknown[]) => oneAttempt(endpoint, m, p, session.currentTime());
    if (method === "eth_sendRawTransaction") return await submitDirect(method, params, primaryAttempt);
    if (method === "eth_getTransactionReceipt" && isArchiveRead(method, params)) {
      let primary: unknown;
      try { primary = await session.read(endpoint.toString(), chainId, method, params, primaryAttempt); }
      catch (error) {
        if (distinctArchive === null || !isReceiptFallbackError(error)) throw error;
        return await sessionArchiveReceipt(session, method, params);
      }
      if (primary !== null || distinctArchive === null) return primary;
      return await sessionArchiveReceipt(session, method, params);
    }
    if (isHistoricalStateRead(method, params)) {
      if (distinctArchive === null) return missingHistoricalArchive();
      const archiveAttempt = (m: string, p: readonly unknown[]) => oneAttempt(distinctArchive, m, p, session.currentTime());
      const chain = await session.read(distinctArchive.toString(), chainId, "eth_chainId", [], archiveAttempt);
      if (evmRpcQuantity(chain) !== BigInt(chainId)) bridgeFailure("APN_RPC_CONFIG", "bridge_archive_RPC_chain");
      return await session.read(distinctArchive.toString(), chainId, method, params, archiveAttempt);
    }
    return await session.read(endpoint.toString(), chainId, method, params, primaryAttempt);
  };
  return { origin: endpoint.origin, call, attempt: (method, params) => oneAttempt(endpoint, method, params), sessionCall, sessionBatchCall };
}
export function bridgeRpcFactory(environment: Readonly<Record<string, string | undefined>>, options: {
  readonly transport?: Pick<BridgeHttps, "request">;
  readonly wait?: (milliseconds: number) => Promise<void>;
} = {}): BridgeRpcFactory {
  const cache = new Map<BridgeChainId, { origin: string; call: EvmRpcCall; attempt: EvmRpcCall; sessionCall: (session: RpcReadSession) => EvmRpcCall; sessionBatchCall: (session: RpcReadSession) => (items: readonly Omit<RpcBatchReadItem, "batchAttempt">[], route?: "primary" | "archive" | "archive_deployment") => Promise<readonly unknown[]>; base?: BridgeRpcPort }>(), transport = options.transport ?? new BridgeHttps();
  return (chainId, session) => {
    bridgeChain(chainId, "APN_RPC_CONFIG");
    const existing = cache.get(chainId);
    if (existing !== undefined) {
      if (session === undefined) return existing.base!;
      return new BridgeRpc(chainId, existing.origin, existing.call, session, existing.attempt, existing.sessionCall, existing.sessionBatchCall);
    }
    const { origin, call, attempt, sessionCall, sessionBatchCall } = bridgeRpcCall(chainId, environment, { ...options, transport });
    const base = new BridgeRpc(chainId, origin, call);
    cache.set(chainId, { origin, call, attempt, sessionCall, sessionBatchCall, base });
    return session === undefined ? base : new BridgeRpc(chainId, origin, call, session, attempt, sessionCall, sessionBatchCall);
  };
}
export class BridgeRpc implements BridgeRpcPort {
  private readonly evm: EvmRpc;
  private readonly call: EvmRpcCall;
  private readonly batchCall: ((items: readonly Omit<RpcBatchReadItem, "batchAttempt">[], route?: "primary" | "archive" | "archive_deployment") => Promise<readonly unknown[]>) | undefined;
  private commandLatestBlock?: BridgeBlock;
  private commandPrices?: Readonly<{ maxFeePerGasAtomic: string; maxPriorityFeePerGasAtomic: string }>;
  private commandFeeInputs?: Readonly<{ l1DataFeeUpperWei: bigint; operatorScalar: bigint; operatorConstant: bigint }>;
  private readonly preparedEstimates = new Map<string, string>();
  constructor(readonly chainId: BridgeChainId, readonly origin: string, call: EvmRpcCall, session?: RpcReadSession, oneAttempt?: EvmRpcCall,
    sessionCall?: (session: RpcReadSession) => EvmRpcCall,
    sessionBatchCall?: (session: RpcReadSession) => (items: readonly Omit<RpcBatchReadItem, "batchAttempt">[], route?: "primary" | "archive" | "archive_deployment") => Promise<readonly unknown[]>) {
    bridgeChain(chainId); this.call = session === undefined ? call : sessionCall?.(session) ?? session.wrap(origin, chainId, call, oneAttempt ?? call);
    this.batchCall = session === undefined ? undefined : sessionBatchCall?.(session);
    this.evm = new EvmRpc(this.call, origin, 16 * 1024);
  }
  async assertChain(): Promise<void> { await this.evm.assertChain(this.chainId); }
  async block(tag: "latest" | "safe" | string): Promise<BridgeBlock> {
    if (this.batchCall !== undefined) {
      const rpcTag = tag === "latest" || tag === "safe" ? tag : quantity(bridgeUint(tag));
      const [chain, raw] = await this.batchCall([
        { method: "eth_chainId", params: [], cachePolicy: "immutable", decoder: rpcExpectedChainValue(this.chainId) },
        { method: "eth_getBlockByNumber", params: [rpcTag, false], cachePolicy: tag === "latest" ? "snapshot" : "immutable", decoder: rpcBlockValue },
      ]);
      if (chain !== BigInt(this.chainId)) throw new ApnError("APN_CHAIN_MISMATCH", "RPC chain does not match the explicitly selected EVM network.");
      const b = raw as Record<string, unknown>, number = evmRpcQuantity(b.number).toString(), hash = evmRpcHex(b.hash, 32);
      if (tag !== "latest" && tag !== "safe" && number !== bridgeUint(tag).toString()) bridgeFailure("APN_RPC_PROTOCOL", "bridge_block_number");
      const block = { numberAtomic: number, hash, timestampAtomic: evmRpcQuantity(b.timestamp).toString() };
      if (tag === "latest") this.commandLatestBlock = block;
      return block;
    }
    await this.assertChain();
    const rpcTag = tag === "latest" || tag === "safe" ? tag : quantity(bridgeUint(tag));
    const b = await evmRpcBlock(this.call, rpcTag);
    await this.assertChain();
    return { numberAtomic: b.number, hash: b.hash, timestampAtomic: evmRpcQuantity(b.raw.timestamp).toString() };
  }
  async deployment(tool: BridgeTool, peerChainId: BridgeChainId, token: Address, block?: BridgeBlock) {
    if (this.batchCall === undefined) await this.assertChain();
    const at = block ?? await this.block("safe"), contract = bridgeDeployment(this.chainId, peerChainId, tool, token), tag = quantity(BigInt(at.numberAtomic));
    const code: Array<{ address: Address; codeHash: Hex }> = [], configuration: Array<{ kind: string; address: Address; data: Hex; expected: Hex }> = [];
    const feeContract = this.chainId === 8453 ? BASE_FEE_CONTRACT : { code: [], reads: [] };
    const codeRows = [...contract.code, ...feeContract.code], readRows = [...contract.reads, ...feeContract.reads];
    const extraItems: Array<Omit<RpcBatchReadItem, "batchAttempt">> = [];
    if (this.chainId === 56 && peerChainId === 1 && tool === "across" && token === BRIDGE_ZERO_ADDRESS) {
      extraItems.push({ method: "eth_call", params: [{ to: BNB_COMPOSITE.vault, data: bnbPoolReadData.registration }, tag], cachePolicy: "immutable", decoder: rpcHexValue(256) },
        { method: "eth_call", params: [{ to: BNB_COMPOSITE.vault, data: bnbPoolReadData.tokens }, tag], cachePolicy: "immutable", decoder: rpcHexValue(2048) });
    }
    let traceProbe: { transaction: Hex; from: string; to: string; value: bigint } | undefined;
    if ((this.chainId === 143 || this.chainId === 59144) && peerChainId === 1 && tool === "across" && token === BRIDGE_ZERO_ADDRESS) {
      traceProbe = this.chainId === 143 ? { transaction: MONAD_TRACE_PROBE_TRANSACTION, from: "0x6f49a8f621353f12378d0046e7d7e4b9b249dc9e", to: "0x0000000000000000000000000000000000001000", value: 18000000000000000000n }
        : { transaction: LINEA_TRACE_PROBE_TRANSACTION, from: "0x9629fe86f04e735923e8542ddd9f265f576e7421", to: "0xbcc016e2a79d509d2b776827ed986568d9b56d59", value: 243939205000000000n };
      extraItems.push({ method: "debug_traceTransaction", params: [traceProbe.transaction, { tracer: "callTracer", tracerConfig: { onlyTopCall: true, withLog: false } }], cachePolicy: "immutable", decoder: rpcRecordValue });
    }
    const items: Array<Omit<RpcBatchReadItem, "batchAttempt">> = [
      { method: "eth_chainId", params: [], cachePolicy: "immutable", decoder: rpcExpectedChainValue(this.chainId) },
      ...codeRows.map((row) => ({ method: "eth_getCode", params: [row.address, tag], cachePolicy: "immutable" as const, decoder: rpcHexValue(128 * 1024) })),
      ...readRows.map((row) => ({ method: row.kind === "storage" ? "eth_getStorageAt" : "eth_call",
        params: row.kind === "storage" ? [row.address, row.data, tag] : [{ to: row.address, data: row.data }, tag], cachePolicy: "immutable" as const,
        decoder: rpcHexValue(64 * 1024) })),
      ...extraItems,
      { method: "eth_getBlockByNumber", params: [tag, false], cachePolicy: "immutable", decoder: rpcBlockValue },
    ];
    const values = this.batchCall === undefined ? await Promise.all(items.map(async (item) => item.decoder(await this.call(item.method, item.params))))
      : await this.batchCall(items, block === undefined ? "archive" : "archive_deployment");
    let offset = 0;
    if (values[offset++] !== BigInt(this.chainId)) throw new ApnError("APN_CHAIN_MISMATCH", "RPC chain does not match the explicitly selected EVM network.");
    for (const row of codeRows) {
      const bytes = values[offset++] as Hex;
      if (bytes === "0x" || keccak256(bytes) !== row.codeHash) bridgeFailure("APN_PROVIDER_PROTOCOL", "bridge_deployment_code_changed");
      code.push({ address: row.address, codeHash: keccak256(bytes) });
    }
    for (const row of readRows) {
      const observed = values[offset++] as Hex;
      if (observed !== row.expected) bridgeFailure("APN_PROVIDER_PROTOCOL", "bridge_deployment_configuration_changed");
      configuration.push({ ...row, expected: observed });
    }
    if (this.chainId === 56 && peerChainId === 1 && tool === "across" && token === BRIDGE_ZERO_ADDRESS) {
      const registrationRaw = values[offset++], tokensRaw = values[offset++];
      const pool = verifyBnbPoolConfiguration(bridgeHex(registrationRaw, 256, undefined, "APN_RPC_PROTOCOL"),
        bridgeHex(tokensRaw, 2048, undefined, "APN_RPC_PROTOCOL"));
      configuration.push({ kind: "pool", address: BNB_COMPOSITE.vault, data: bnbPoolReadData.tokens,
        expected: `0x${Buffer.from(canonicalJson(pool)).toString("hex")}` as Hex });
    }
    if (traceProbe !== undefined) {
      const trace = values[offset++] as Record<string, unknown>;
      if (trace.type !== "CALL" || evmRpcAddress(trace.from).toLowerCase() !== traceProbe.from ||
          evmRpcAddress(trace.to).toLowerCase() !== traceProbe.to || evmRpcQuantity(trace.value) !== traceProbe.value) {
        bridgeFailure("APN_PROVIDER_PROTOCOL", "native_destination_trace_capability_changed");
      }
    }
    const recheck = values[offset] as Record<string, unknown>;
    if (evmRpcQuantity(recheck.number).toString() !== at.numberAtomic || evmRpcHex(recheck.hash, 32) !== at.hash) bridgeFailure("APN_RPC_PROTOCOL", "bridge_block_reorg");
    if (this.batchCall === undefined) await this.assertChain();
    return { chainId: this.chainId, peerChainId, tool, block: at, rpcOrigin: this.origin,
      contractHash: hashObject({ protocol: contract, feeContract }), codeHash: hashObject(code), configurationHash: hashObject(configuration) };
  }
  /** A native principal's balance is the native balance itself and its allowance is the constant zero: nothing is approved. */
  async account(owner: Address, spender: Address, token: Address, planned: readonly BridgeTransaction[] = []) {
    if (this.batchCall !== undefined) {
      const asset = bridgeAssetRow(this.chainId, token, "APN_RPC_CONFIG");
      const data = encodeFunctionData({ abi: ERC20_READ, functionName: "balanceOf", args: [owner] });
      const allowanceData = encodeFunctionData({ abi: ERC20_READ, functionName: "allowance", args: [owner, spender] });
      const l1Data = encodeFunctionData({ abi: GAS_ORACLE_ABI, functionName: "getL1FeeUpperBound", args: [16384n] });
      const phaseOne: Array<Omit<RpcBatchReadItem, "batchAttempt">> = [
        { method: "eth_chainId", params: [], cachePolicy: "immutable", decoder: rpcExpectedChainValue(this.chainId) },
        { method: "eth_getBlockByNumber", params: ["latest", false], cachePolicy: "snapshot", decoder: rpcFeeBlockValue },
        ...(this.chainId === 42161 ? [] : [{ method: "eth_maxPriorityFeePerGas", params: [], cachePolicy: "snapshot" as const, decoder: rpcQuantityValue }]),
      ];
      const head = await this.batchCall(phaseOne);
      let headOffset = 0;
      if (head[headOffset++] !== BigInt(this.chainId)) throw new ApnError("APN_CHAIN_MISMATCH", "RPC chain does not match the explicitly selected EVM network.");
      const raw = head[headOffset++] as Record<string, unknown>, at = { numberAtomic: evmRpcQuantity(raw.number).toString(), hash: evmRpcHex(raw.hash, 32),
        timestampAtomic: evmRpcQuantity(raw.timestamp).toString() };
      const priority = this.chainId === 42161 ? 0n : head[headOffset++] as bigint, maximum = 2n * evmRpcQuantity(raw.baseFeePerGas) + priority;
      bridgeUint(maximum.toString(), true, "APN_RPC_PROTOCOL"); this.commandLatestBlock = at;
      this.commandPrices = { maxFeePerGasAtomic: maximum.toString(), maxPriorityFeePerGasAtomic: priority.toString() };
      const tag = quantity(BigInt(at.numberAtomic));
      const phaseTwo: Array<Omit<RpcBatchReadItem, "batchAttempt">> = [
        { method: "eth_chainId", params: [], cachePolicy: "immutable", decoder: rpcExpectedChainValue(this.chainId) },
        { method: "eth_getBalance", params: [owner, tag], cachePolicy: "immutable", decoder: rpcQuantityValue },
        ...(asset.kind === "native" ? [] : [
          { method: "eth_call", params: [{ to: token, data }, tag], cachePolicy: "immutable" as const, decoder: rpcWordValue },
          { method: "eth_call", params: [{ to: token, data: allowanceData }, tag], cachePolicy: "immutable" as const, decoder: rpcWordValue },
        ]),
        ...(this.chainId === 8453 ? [
          { method: "eth_call", params: [{ to: GAS_ORACLE, data: l1Data }, tag], cachePolicy: "immutable" as const, decoder: rpcWordValue },
          { method: "eth_call", params: [{ to: L1_BLOCK, data: "0x4d5d9a2a" }, tag], cachePolicy: "immutable" as const, decoder: rpcWordValue },
          { method: "eth_call", params: [{ to: L1_BLOCK, data: "0x16d3bc7f" }, tag], cachePolicy: "immutable" as const, decoder: rpcWordValue },
        ] : []),
        { method: "eth_getTransactionCount", params: [owner, tag], cachePolicy: "immutable", decoder: rpcQuantityValue },
        { method: "eth_getTransactionCount", params: [owner, "pending"], cachePolicy: "none", decoder: rpcQuantityValue },
        ...planned.map((transaction) => ({ method: "eth_estimateGas", params: [rpcTransactionInput(transaction), tag], cachePolicy: "none" as const, decoder: rpcQuantityValue })),
        { method: "eth_getBlockByNumber", params: [tag, false], cachePolicy: "immutable", decoder: rpcBlockValue },
      ];
      const values = await this.batchCall(phaseTwo);
      let offset = 0;
      if (values[offset++] !== BigInt(this.chainId)) throw new ApnError("APN_CHAIN_MISMATCH", "RPC chain does not match the explicitly selected EVM network.");
      const native = values[offset++] as bigint, balance = asset.kind === "native" ? native : values[offset++] as bigint;
      const allowance = asset.kind === "native" ? 0n : values[offset++] as bigint;
      this.commandFeeInputs = this.chainId === 8453 ? { l1DataFeeUpperWei: values[offset++] as bigint,
        operatorScalar: values[offset++] as bigint, operatorConstant: values[offset++] as bigint } :
        { l1DataFeeUpperWei: 0n, operatorScalar: 0n, operatorConstant: 0n };
      const latest = values[offset++] as bigint, pending = values[offset++] as bigint;
      for (const transaction of planned) this.preparedEstimates.set(hashObject(transaction), (values[offset++] as bigint).toString());
      const recheck = values[offset] as Record<string, unknown>;
      if (evmRpcQuantity(recheck.number).toString() !== at.numberAtomic || evmRpcHex(recheck.hash, 32) !== at.hash) bridgeFailure("APN_RPC_PROTOCOL", "bridge_block_reorg");
      return { chainId: this.chainId, rpcOrigin: this.origin, block: at, owner, token, spender, balanceAtomic: balance.toString(),
        nativeBalanceWei: native.toString(), allowanceAtomic: allowance.toString(), latestNonceAtomic: latest.toString(), pendingNonceAtomic: pending.toString() };
    }
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
    if (this.commandPrices !== undefined) return this.commandPrices;
    if (this.batchCall !== undefined) {
      const items: Array<Omit<RpcBatchReadItem, "batchAttempt">> = [
        { method: "eth_chainId", params: [], cachePolicy: "immutable", decoder: rpcExpectedChainValue(this.chainId) },
        { method: "eth_getBlockByNumber", params: ["latest", false], cachePolicy: "snapshot", decoder: rpcFeeBlockValue },
        ...(this.chainId === 42161 ? [] : [{ method: "eth_maxPriorityFeePerGas", params: [], cachePolicy: "snapshot" as const, decoder: rpcQuantityValue }]),
      ];
      const values = await this.batchCall(items);
      if (values[0] !== BigInt(this.chainId)) throw new ApnError("APN_CHAIN_MISMATCH", "RPC chain does not match the explicitly selected EVM network.");
      const block = values[1] as Record<string, unknown>, priority = this.chainId === 42161 ? 0n : values[2] as bigint;
      this.commandLatestBlock = { numberAtomic: evmRpcQuantity(block.number).toString(), hash: evmRpcHex(block.hash, 32), timestampAtomic: evmRpcQuantity(block.timestamp).toString() };
      const maximum = 2n * evmRpcQuantity(block.baseFeePerGas) + priority;
      bridgeUint(maximum.toString(), true, "APN_RPC_PROTOCOL");
      return this.commandPrices = { maxFeePerGasAtomic: maximum.toString(), maxPriorityFeePerGasAtomic: priority.toString() };
    }
    await this.assertChain();
    const b = await evmRpcBlock(this.call, "latest"), priority = this.chainId === 42161 ? 0n : evmRpcQuantity(await this.call("eth_maxPriorityFeePerGas", []));
    const maximum = 2n * evmRpcQuantity(b.raw.baseFeePerGas) + priority;
    bridgeUint(maximum.toString(), true, "APN_RPC_PROTOCOL"); await this.assertChain();
    return { maxFeePerGasAtomic: maximum.toString(), maxPriorityFeePerGasAtomic: priority.toString() };
  }
  async estimate(transaction: BridgeTransaction) {
    if (transaction.chainId !== this.chainId) bridgeFailure("APN_CHAIN_MISMATCH", "bridge_estimate_chain");
    const prepared = this.preparedEstimates.get(hashObject(transaction));
    if (prepared !== undefined && this.commandPrices !== undefined) return { gasLimitAtomic: prepared, ...this.commandPrices };
    if (this.batchCall !== undefined) {
      const items: Array<Omit<RpcBatchReadItem, "batchAttempt">> = [
        { method: "eth_chainId", params: [], cachePolicy: "immutable", decoder: rpcExpectedChainValue(this.chainId) },
        { method: "eth_estimateGas", params: [{ from: transaction.from, to: transaction.to, data: transaction.data,
          value: quantity(bridgeUint(transaction.valueAtomic)) }], cachePolicy: "none", decoder: rpcQuantityValue },
        { method: "eth_getBlockByNumber", params: ["latest", false], cachePolicy: "snapshot", decoder: rpcFeeBlockValue },
        ...(this.chainId === 42161 ? [] : [{ method: "eth_maxPriorityFeePerGas", params: [], cachePolicy: "snapshot" as const, decoder: rpcQuantityValue }]),
      ];
      const values = await this.batchCall(items);
      if (values[0] !== BigInt(this.chainId)) throw new ApnError("APN_CHAIN_MISMATCH", "RPC chain does not match the explicitly selected EVM network.");
      const gas = values[1] as bigint, block = values[2] as Record<string, unknown>, priority = this.chainId === 42161 ? 0n : values[3] as bigint;
      this.commandLatestBlock = { numberAtomic: evmRpcQuantity(block.number).toString(), hash: evmRpcHex(block.hash, 32), timestampAtomic: evmRpcQuantity(block.timestamp).toString() };
      const maximum = 2n * evmRpcQuantity(block.baseFeePerGas) + priority;
      if (maximum === 0n) bridgeFailure("APN_RPC_PROTOCOL", "bridge_zero_gas_price");
      return { gasLimitAtomic: gas.toString(), maxFeePerGasAtomic: maximum.toString(), maxPriorityFeePerGasAtomic: priority.toString() };
    }
    return await this.evm.estimate(transaction);
  }
  async feeQuote(envelope: Pick<BridgeEnvelope, "economics">) { return (await this.feeQuotes([envelope]))[0]!; }
  async feeQuotes(envelopes: readonly Pick<BridgeEnvelope, "economics">[]) {
    if (this.batchCall === undefined) return await Promise.all(envelopes.map(async (envelope) => await this.evm.feeQuote(this.chainId, envelope.economics)));
    if (this.commandLatestBlock !== undefined && this.commandFeeInputs !== undefined) return envelopes.map((envelope) => {
      const execution = bridgeUint(envelope.economics.maximumGasCostAtomic, true), input = this.commandFeeInputs!;
      const operator = BigInt(envelope.economics.gasLimitAtomic) * input.operatorScalar * 100n + input.operatorConstant;
      return bridgeFeeQuote(this.chainId, this.origin, this.commandLatestBlock!, execution, input.l1DataFeeUpperWei, operator);
    });
    const block = this.commandLatestBlock ?? await this.block("latest"), tag = quantity(BigInt(block.numberAtomic));
    const items: Array<Omit<RpcBatchReadItem, "batchAttempt">> = [
      { method: "eth_chainId", params: [], cachePolicy: "immutable", decoder: rpcExpectedChainValue(this.chainId) },
      ...(this.chainId === 8453 ? envelopes.flatMap((envelope) => {
        const l1 = encodeFunctionData({ abi: GAS_ORACLE_ABI, functionName: "getL1FeeUpperBound", args: [16384n] });
        const operator = encodeFunctionData({ abi: GAS_ORACLE_ABI, functionName: "getOperatorFee", args: [bridgeUint(envelope.economics.gasLimitAtomic, true)] });
        return [
          { method: "eth_call", params: [{ to: GAS_ORACLE, data: l1 }, tag], cachePolicy: "none" as const, decoder: rpcWordValue },
          { method: "eth_call", params: [{ to: GAS_ORACLE, data: operator }, tag], cachePolicy: "none" as const, decoder: rpcWordValue },
        ];
      }) : []),
      { method: "eth_getBlockByNumber", params: [tag, false], cachePolicy: "immutable", decoder: rpcBlockValue },
    ];
    const values = await this.batchCall(items);
    if (values[0] !== BigInt(this.chainId)) throw new ApnError("APN_CHAIN_MISMATCH", "RPC chain does not match the explicitly selected EVM network.");
    let offset = 1;
    const quotes = envelopes.map((envelope) => {
      const execution = bridgeUint(envelope.economics.maximumGasCostAtomic, true);
      const l1 = this.chainId === 8453 ? values[offset++] as bigint : 0n;
      const operator = this.chainId === 8453 ? values[offset++] as bigint : 0n;
      const total = execution + l1 + operator;
      return { chainId: this.chainId, ...(this.chainId === 42161 ? { feeModel: "arbitrum-inclusive" as const } : this.chainId === 143 ? { feeModel: "monad-gas-limit" as const } : {}),
        l1DataFeeUpperWei: l1.toString(), operatorFeeUpperWei: operator.toString(), maximumExecutionFeeWei: execution.toString(),
        totalQuoteWei: total.toString(), totalFeeEnforcedOnchain: false as const, blockNumberAtomic: block.numberAtomic, blockHash: block.hash,
        rpcOrigin: this.origin, observedAt: new Date().toISOString() };
    });
    const recheck = values[offset] as Record<string, unknown>;
    if (evmRpcQuantity(recheck.number).toString() !== block.numberAtomic || evmRpcHex(recheck.hash, 32) !== block.hash) bridgeFailure("APN_RPC_PROTOCOL", "bridge_block_reorg");
    return quotes;
  }
  async send(raw: Hex): Promise<Hex> {
    bridgeHex(raw, 16 * 1024, undefined, "APN_PROVIDER_EFFECT_UNAVAILABLE");
    const hash = evmRpcHex(await this.call("eth_sendRawTransaction", [raw]), 32);
    if (hash !== keccak256(raw)) bridgeFailure("APN_RPC_AMBIGUOUS", "submitted_transaction_hash_mismatch");
    return hash;
  }
  async observe(hash: Hex, expected?: BridgeEnvelope, nativeDelivery?: Parameters<BridgeRpcPort["observe"]>[2]): Promise<{ transaction: BridgeTransactionProof; receipt: BridgeProtocolReceipt } | null> {
    return await this.observeCanonical(hash, expected, nativeDelivery, true) as { transaction: BridgeTransactionProof; receipt: BridgeProtocolReceipt } | null;
  }
  async observeDestination(hash: Hex, nativeDelivery?: Parameters<NonNullable<BridgeRpcPort["observeDestination"]>>[1]): Promise<{
    transaction: BridgeDestinationTransactionProof; receipt: BridgeProtocolReceipt } | null> {
    return await this.observeCanonical(hash, undefined, nativeDelivery, false) as {
      transaction: BridgeDestinationTransactionProof; receipt: BridgeProtocolReceipt } | null;
  }
  private async observeCanonical(hash: Hex, expected: BridgeEnvelope | undefined,
    nativeDelivery: Parameters<BridgeRpcPort["observe"]>[2], includeFees: boolean): Promise<{
      transaction: BridgeTransactionProof | BridgeDestinationTransactionProof; receipt: BridgeProtocolReceipt } | null> {
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
    const safeRaw = await evmRpcBlock(this.call, "safe");
    const safe = { numberAtomic: safeRaw.number, hash: safeRaw.hash, timestampAtomic: evmRpcQuantity(safeRaw.raw.timestamp).toString() };
    const safeBlock = BigInt(safe.numberAtomic) >= number ? safe : null;
    const status = evmRpcQuantity(r.status);
    if (status !== 0n && status !== 1n) bridgeFailure("APN_RPC_PROTOCOL", "receipt_status");
    const identity = await verifyRpcTransaction(tx, this.chainId, hash, expected);
    if (evmRpcAddress(r.from) !== identity.from || evmRpcAddress(r.to) !== identity.to) bridgeFailure("APN_RPC_PROTOCOL", "receipt_sender_target");
    const logs = parseReceiptLogs(r.logs, hash, block, index);
    const fees = includeFees ? await bridgeActualFees(this.chainId, r, block, this.call) : null;
    if (fees !== null && (BigInt(fees.gasUsedAtomic) > BigInt(identity.gasLimitAtomic) ||
      BigInt(fees.effectiveGasPriceAtomic) > BigInt(identity.maxFeePerGasAtomic))) bridgeFailure("APN_RPC_PROTOCOL", "receipt_execution_fee_bounds");
    let nativeBalance: BridgeProtocolReceipt["nativeBalance"] = null;
    let nativeTransfer: BridgeProtocolReceipt["nativeTransfer"] = null;
    let compositeTrace: BridgeProtocolReceipt["compositeTrace"] = null;
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
      if (nativeDelivery.composite === undefined) nativeTransfer = exactNativeTransfer(trace, hash, nativeDelivery);
      else compositeTrace = verifyBnbCompositeTrace(trace, hash, nativeDelivery.composite.message, nativeDelivery.composite.call,
        { sender: identity.from, calldata: bridgeHex(tx.input, 24_576, undefined, "APN_RPC_PROTOCOL") });
      await this.recheck(before);
    }
    if (this.batchCall === undefined) {
      await this.recheck(block); if (safeBlock !== null) await this.recheck(safeBlock);
    } else {
      const values = await this.batchCall([
        { method: "eth_chainId", params: [], cachePolicy: "immutable", decoder: rpcArchiveChainValue(this.chainId) },
        { method: "eth_getBlockByNumber", params: [quantity(number), false], cachePolicy: "immutable", decoder: rpcBlockValue },
        { method: "eth_getBlockByNumber", params: [quantity(BigInt(safe.numberAtomic)), false], cachePolicy: "immutable", decoder: rpcBlockValue },
      ], "archive");
      assertMatchingHeader(values[1] as Record<string, unknown>, block);
      assertMatchingHeader(values[2] as Record<string, unknown>, safe);
    }
    await this.assertChain();
    return { transaction: { chainId: this.chainId, transactionHash: hash, block, safeBlock, rpcOrigin: this.origin, ...identity,
      ...(fees ?? {}), status: status === 1n ? "success" : "reverted", logsHash: hashObject(logs) },
      receipt: { chainId: this.chainId, transactionHash: hash, blockNumberAtomic: number.toString(), blockHash, logs, nativeBalance, nativeTransfer, compositeTrace } };
  }
  private async recheck(block: BridgeBlock): Promise<void> {
    if (!bridgeSame(await this.block(block.numberAtomic), block)) bridgeFailure("APN_RPC_PROTOCOL", "bridge_block_reorg");
  }
}
async function retryDirect(method: string, _params: readonly unknown[], oneAttempt: () => Promise<unknown>, wait: (milliseconds: number) => Promise<void> = async (milliseconds) => {
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}): Promise<unknown> {
  for (let attempt = 0; ; attempt += 1) {
    try { return await oneAttempt(); }
    catch (error) {
      const http = error instanceof RpcHttpFailure ? error : undefined, transport = approvedTransportReason(error);
      const retryable = http !== undefined ? http.status === 408 || http.status >= 500 && http.status <= 599 : transport !== undefined;
      if (!retryable || attempt + 1 >= MAX_READ_ATTEMPTS) {
        if (http !== undefined) {
          if (http.status === 429) throw new ApnError("APN_RPC_RATE_LIMITED", "Bridge RPC provider requested a cooldown.", {
            rpcMethod: method, ...(http.retryAfterMs === undefined ? {} : { retryAfterMs: http.retryAfterMs.toString() }), attempts: (attempt + 1).toString(),
          });
          throw rpcHttpFailure("bridge_RPC_HTTP_status", method, http.status, attempt + 1);
        }
        if (transport !== undefined) throw new ApnError("APN_RPC_AMBIGUOUS", "Bridge RPC transport is unavailable.", {
          rpcMethod: method, attempts: (attempt + 1).toString(), transportReason: transport,
        });
        if (error instanceof ApnError && error.code === "APN_RPC_AMBIGUOUS") {
          throw new ApnError("APN_RPC_AMBIGUOUS", "Bridge RPC transport is unavailable.", { rpcMethod: method });
        }
        throw error;
      }
      const delay = Math.max(RPC_RETRY_DELAY_MS, http?.retryAfterMs ?? 0);
      await wait(delay);
    }
  }
}
async function submitDirect(method: string, params: readonly unknown[], oneAttempt: EvmRpcCall): Promise<unknown> {
  try { return await oneAttempt(method, params); }
  catch (error) {
    if (error instanceof RpcHttpFailure) {
      if (error.status === 429) throw new ApnError("APN_RPC_RATE_LIMITED", "Bridge RPC provider requested a cooldown.", {
        rpcMethod: method, ...(error.retryAfterMs === undefined ? {} : { retryAfterMs: error.retryAfterMs.toString() }), attempts: "1",
      });
      throw rpcHttpFailure("bridge_RPC_HTTP_status", method, error.status, 1);
    }
    const transport = approvedTransportReason(error);
    if (transport !== undefined) throw new ApnError("APN_RPC_AMBIGUOUS", "Bridge RPC transport is unavailable.", {
      rpcMethod: method, attempts: "1", transportReason: transport,
    });
    if (error instanceof ApnError && error.code === "APN_RPC_AMBIGUOUS") {
      throw new ApnError("APN_RPC_AMBIGUOUS", "Bridge RPC transport is unavailable.", { rpcMethod: method });
    }
    throw error;
  }
}
function rpcHttpFailure(reason: string, method: string, status: number, attempts: number): ApnError {
  return new ApnError("APN_RPC_PROTOCOL", `Bridge validation failed: ${reason}.`, {
    rpcMethod: method, httpStatus: status.toString(), attempts: attempts.toString(),
  });
}
function isReceiptFallbackError(error: unknown): boolean {
  if (!(error instanceof ApnError)) return false;
  if (error.code === "APN_PROVIDER_CAPABILITY_UNAVAILABLE") {
    return error.details?.reason === "historical_receipt_unavailable" && error.details.rpcMethod === "eth_getTransactionReceipt";
  }
  if (["APN_RPC_AMBIGUOUS", "APN_RPC_RATE_LIMITED", "APN_PROVIDER_UNAVAILABLE"].includes(error.code)) return true;
  if (error.code !== "APN_RPC_PROTOCOL") return false;
  const status = Number(error.details?.httpStatus);
  return status === 408 || status >= 500 && status <= 599;
}
const PUBLICNODE_ARCHIVE_MESSAGE = "archive requests require a personal token";
function historicalReceiptUnavailable(value: unknown, chainId: BridgeChainId, target: URL, method: string): boolean {
  let error: Record<string, unknown>;
  try { error = evmRpcRecord(value); } catch { return false; }
  if (!Number.isSafeInteger(error.code) || typeof error.message !== "string" || error.message.length > 1024) return false;
  const message = normalizeProviderMessage(error.message);
  if (message === PUBLICNODE_ARCHIVE_MESSAGE) return isPublicNodeReceiptRequest(chainId, target, method);
  if (credentialOrAuthorizationMessage(message)) return false;
  return message.includes("missing trie node") || message.includes("pruned") ||
    message.includes("historical") && ["unavailable", "not available", "unsupported", "not supported"].some((part) => message.includes(part));
}
function knownPublicNodeReceiptCapability(chainId: BridgeChainId, target: URL, method: string, body: string): boolean {
  if (!isPublicNodeReceiptRequest(chainId, target, method)) return false;
  const trimmed = body.trim();
  if (normalizeProviderMessage(trimmed) === PUBLICNODE_ARCHIVE_MESSAGE) return true;
  if (trimmed.length === 0 || trimmed.length > 4096) return false;
  try {
    const value = evmRpcRecord(JSON.parse(trimmed)), error = evmRpcRecord(value.error);
    return typeof error.message === "string" && normalizeProviderMessage(error.message) === PUBLICNODE_ARCHIVE_MESSAGE;
  } catch { return false; }
}
function isPublicNodeReceiptRequest(chainId: BridgeChainId, target: URL, method: string): boolean {
  if (method !== "eth_getTransactionReceipt" || target.pathname !== "/" || target.search !== "") return false;
  return chainId === 8453 && target.origin === "https://base-rpc.publicnode.com" ||
    chainId === 1 && target.origin === "https://ethereum-rpc.publicnode.com";
}
function normalizeProviderMessage(message: string): string { return message.trim().toLowerCase(); }
function credentialOrAuthorizationMessage(message: string): boolean {
  return ["token", "credential", "api key", "apikey", "unauthorized", "forbidden", "authorization", "authentication", "access denied"]
    .some((part) => message.includes(part));
}
function missingHistoricalArchive(): never {
  throw new ApnError("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "Historical bridge proof requires a distinct archive RPC endpoint.",
    { reason: "distinct_archive_RPC_required" });
}
function rpcBodyMethod(body: string): string {
  try {
    const parsed = JSON.parse(body) as unknown;
    if (Array.isArray(parsed)) return "batch";
    if (typeof parsed === "object" && parsed !== null && typeof (parsed as { readonly method?: unknown }).method === "string") {
      return (parsed as { readonly method: string }).method;
    }
  } catch { /* The canonical body is constructed internally and validated by the response path. */ }
  return "batch";
}
function decodeAtomicBatchResponse(response: unknown, requests: readonly { readonly id: string }[]): readonly unknown[] {
  if (!Array.isArray(response) || response.length !== requests.length) {
    throw new ApnError("APN_RPC_PROTOCOL", "Bridge RPC batch result count is invalid.", { rpcMethod: "eth_getTransactionReceipt" });
  }
  const byId = new Map<string, unknown>();
  for (const candidate of response) {
    const row = evmRpcRecord(candidate);
    if (row.jsonrpc !== "2.0" || typeof row.id !== "string" || byId.has(row.id) || Object.hasOwn(row, "error") || !Object.hasOwn(row, "result")) {
      bridgeFailure("APN_RPC_PROTOCOL", "bridge_RPC_response", { rpcMethod: "eth_getTransactionReceipt" });
    }
    byId.set(row.id, row.result);
  }
  return requests.map((request) => byId.has(request.id) ? byId.get(request.id) : bridgeFailure("APN_RPC_PROTOCOL", "bridge_RPC_response",
    { rpcMethod: "eth_getTransactionReceipt" }));
}
function isArchiveBatchItem(method: string, params: readonly unknown[]): boolean {
  if (method === "eth_chainId") return params.length === 0;
  if (method === "eth_getBlockByNumber") return params.length === 2 && typeof params[0] === "string" && /^0x(?:0|[1-9a-f][0-9a-f]*)$/u.test(params[0]);
  if (method === "debug_traceTransaction") return params.length === 2 && typeof params[0] === "string" && /^0x[0-9a-fA-F]{64}$/u.test(params[0]);
  return isArchiveRead(method, params);
}
function rpcArchiveChainValue(chainId: BridgeChainId): (value: unknown) => bigint {
  return (value) => {
    const observed = evmRpcQuantity(value);
    if (observed !== BigInt(chainId)) bridgeFailure("APN_RPC_CONFIG", "bridge_archive_RPC_chain");
    return observed;
  };
}
function assertMatchingHeader(raw: Record<string, unknown>, expected: BridgeBlock): void {
  if (evmRpcQuantity(raw.number).toString() !== expected.numberAtomic || evmRpcHex(raw.hash, 32) !== expected.hash) {
    bridgeFailure("APN_RPC_PROTOCOL", "bridge_archive_block_mismatch");
  }
}
function quantity(n: bigint): Hex { return `0x${n.toString(16)}`; }
