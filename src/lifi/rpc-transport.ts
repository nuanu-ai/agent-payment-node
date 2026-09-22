import { canonicalJson } from "../canonical.js";
import { ApnError } from "../errors.js";
import type { EvmRpcCall } from "../evm-ports.js";
import { evmRpcQuantity, evmRpcRecord } from "../evm-rpc-codec.js";
import { parsePublicHttpsUrl } from "../network-policy.js";
import type { BridgeChainId } from "./chains.js";
import { BridgeHttps } from "./https.js";
import type { BridgeRpcFactory, BridgeRpcPort, LifiResponse } from "./ports.js";
import { bridgeArchiveEndpoint, bridgeReceiptEndpoint, isArchiveRead, isHistoricalStateRead, type BridgeReceiptEndpoint } from "./rpc-archive.js";
import { rpcBlockValue } from "./rpc-batch-codec.js";
import { BridgeRpc } from "./rpc-adapter.js";
import { parseRetryAfter, RpcHttpFailure, type RpcBatchAttempt, type RpcBatchReadItem, RpcReadSession } from "./rpc-session.js";
import { decodeAtomicBatchResponse, historicalReceiptUnavailable, isArchiveBatchItem, isReceiptBatchShape, isReceiptFallbackError, knownPublicNodeReceiptCapability, missingHistoricalArchive, READ_METHODS, retryDirect, rpcBodyMethod, rpcFallbackChainValue, rpcReceiptFallbackValue, submitDirect, withEndpointRole } from "./rpc-support.js";
import { bridgeChain } from "./asset-registry.js";
import { bridgeFailure, bridgeJson } from "./validation.js";

export const BRIDGE_RPC_ENV = { 1: "APN_ETHEREUM_RPC_URL", 56: "APN_BNB_RPC_URL", 8453: "APN_BASE_RPC_URL", 143: "APN_MONAD_RPC_URL", 42161: "APN_ARBITRUM_RPC_URL", 59144: "APN_LINEA_RPC_URL" } as const;
export interface BridgeRpcRequestTrace {
  readonly origin: string;
  readonly endpointRole: "primary" | "receipt" | "archive";
  readonly methods: readonly string[];
  readonly batchSize: number;
}
export function bridgeRpcCall(chainId: BridgeChainId, environment: Readonly<Record<string, string | undefined>>, options: {
  readonly transport?: Pick<BridgeHttps, "request">;
  readonly wait?: (milliseconds: number) => Promise<void>;
  /** Optional read-only observation hook; called from the selected production route before each physical HTTP attempt. */
  readonly onRequest?: (trace: BridgeRpcRequestTrace) => void;
} = {}): { readonly origin: string; readonly call: EvmRpcCall; readonly attempt: EvmRpcCall; readonly sessionCall: (session: RpcReadSession) => EvmRpcCall;
  readonly sessionBatchCall: (session: RpcReadSession) => (items: readonly Omit<RpcBatchReadItem, "batchAttempt">[], route?: "primary" | "archive" | "archive_deployment" | "receipt") => Promise<readonly unknown[]> } {
  bridgeChain(chainId, "APN_RPC_CONFIG");
  const transport = options.transport ?? new BridgeHttps();
  const wait = options.wait ?? (async (milliseconds: number) => await new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const value = environment[BRIDGE_RPC_ENV[chainId]];
  if (value === undefined || value.length === 0) bridgeFailure("APN_RPC_CONFIG", `missing_${BRIDGE_RPC_ENV[chainId]}`);
  const endpoint = parsePublicHttpsUrl(value, "APN_RPC_CONFIG", "Bridge RPC endpoint", 2048);
  if (endpoint.search !== "") bridgeFailure("APN_RPC_CONFIG", "bridge_RPC_query_forbidden");
  const archive = bridgeArchiveEndpoint(chainId, environment), receipt = bridgeReceiptEndpoint(chainId, environment);
  const distinctArchive = archive !== null && archive.origin !== endpoint.origin ? archive : null;
  const distinctReceipt = receipt !== null && receipt.url.origin !== endpoint.origin ? receipt : null;
  const receiptFallback: (BridgeReceiptEndpoint & { readonly role: "receipt" | "archive" }) | null = distinctReceipt === null
    ? distinctArchive === null ? null : { url: distinctArchive, maxItemsPerRequest: 3, role: "archive" }
    : { ...distinctReceipt, role: "receipt" };
  let sequence = 0n, archiveChain: Promise<void> | undefined;
  const call: EvmRpcCall = async (method, params) => {
    if (!READ_METHODS.has(method)) bridgeFailure("APN_RPC_PROTOCOL", "bridge_RPC_method");
    if (method === "eth_sendRawTransaction") return await submitDirect(method, params, (m, p) => oneAttempt(endpoint, m, p));
    if (method === "eth_getTransactionReceipt" && isArchiveRead(method, params)) {
      if (distinctReceipt !== null) return await withEndpointRole(fallbackReceipt(method, params, { ...distinctReceipt, role: "receipt" }), "receipt");
      let primary: unknown;
      try { primary = await withEndpointRole(retryDirect(method, params, () => oneAttempt(endpoint, method, params), wait), "primary"); }
      catch (error) {
        if (receiptFallback === null || !isReceiptFallbackError(error)) throw error;
        return await withEndpointRole(fallbackReceipt(method, params, receiptFallback), receiptFallback.role);
      }
      if (primary !== null || receiptFallback === null) return primary;
      return await withEndpointRole(fallbackReceipt(method, params, receiptFallback), receiptFallback.role);
    }
    if (isHistoricalStateRead(method, params)) {
      if (distinctArchive === null) return missingHistoricalArchive();
      return await withEndpointRole(archiveRead(method, params, distinctArchive), "archive");
    }
    return await withEndpointRole(retryDirect(method, params, () => oneAttempt(endpoint, method, params), wait), "primary");
  };
  const assertArchiveChain = async (target: URL): Promise<void> => {
    if (archiveChain === undefined) archiveChain = (async () => {
      if (evmRpcQuantity(await retryDirect("eth_chainId", [], () => oneAttempt(target, "eth_chainId", [], undefined, "archive"), wait)) !== BigInt(chainId)) {
        bridgeFailure("APN_RPC_CONFIG", "bridge_archive_RPC_chain");
      }
    })();
    await archiveChain;
  };
  const archiveRead = async (method: string, params: readonly unknown[], target: URL): Promise<unknown> => {
    await assertArchiveChain(target);
    return await retryDirect(method, params, () => oneAttempt(target, method, params, undefined, "archive"), wait);
  };
  const fallbackReceipt = async (method: string, params: readonly unknown[], target: BridgeReceiptEndpoint & {
    readonly role: "receipt" | "archive" }): Promise<unknown> => {
    const requests = [
      { jsonrpc: "2.0", id: (++sequence).toString(), method: "eth_chainId", params: [] },
      { jsonrpc: "2.0", id: (++sequence).toString(), method, params },
    ] as const;
    return await retryDirect(method, params, async () => {
      let values: readonly unknown[];
      if (target.maxItemsPerRequest === 1) {
        const chain = await oneAttempt(target.url, requests[0].method, requests[0].params, undefined, target.role);
        await wait(750);
        const result = await oneAttempt(target.url, requests[1].method, requests[1].params, undefined, target.role);
        values = [chain, result];
      } else {
        values = decodeAtomicBatchResponse(await batchAttempt(target.url, canonicalJson(requests), undefined, target.role), requests);
      }
      rpcFallbackChainValue(chainId, target.role)(values[0]);
      return rpcReceiptFallbackValue(params[0])(values[1]);
    }, wait);
  };
  const oneAttempt = async (target: URL, method: string, params: readonly unknown[], now = Date.now(),
    endpointRole: "primary" | "receipt" | "archive" = "primary", telemetrySession?: RpcReadSession): Promise<unknown> => {
    if (!READ_METHODS.has(method)) bridgeFailure("APN_RPC_PROTOCOL", "bridge_RPC_method");
    const id = (++sequence).toString(), body = canonicalJson({ jsonrpc: "2.0", id, method, params });
    let response: LifiResponse;
    try {
      options.onRequest?.({ origin: target.origin, endpointRole, methods: [method], batchSize: 1 });
      telemetrySession?.recordPhysicalAttempt(endpointRole, [method]);
      response = await transport.request(target.toString(), "POST", body, 1024 * 1024, "APN_RPC_CONFIG");
    }
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
  const batchAttempt = async (target: URL, body: string, now = Date.now(),
    endpointRole: "primary" | "receipt" | "archive" = "primary", telemetrySession?: RpcReadSession): Promise<unknown> => {
    const rpcMethod = rpcBodyMethod(body);
    let response: LifiResponse;
    try {
      const parsed = JSON.parse(body) as { method: string } | Array<{ method: string }>;
      const rows = Array.isArray(parsed) ? parsed : [parsed];
      options.onRequest?.({ origin: target.origin, endpointRole, methods: rows.map((row) => row.method), batchSize: rows.length });
      telemetrySession?.recordPhysicalAttempt(endpointRole, rows.map((row) => row.method));
      response = await transport.request(target.toString(), "POST", body, 1024 * 1024, "APN_RPC_CONFIG");
    }
    catch (error) { throw error; }
    if (response.status !== 200) throw new RpcHttpFailure(rpcMethod, response.status, parseRetryAfter(response.headers, now));
    return bridgeJson(response.body, 1024 * 1024);
  };
  const sessionBatchCall = (session: RpcReadSession) => async (items: readonly Omit<RpcBatchReadItem, "batchAttempt">[], route: "primary" | "archive" | "archive_deployment" | "receipt" = "primary") => {
    if (route === "receipt" && !isReceiptBatchShape(items)) {
      bridgeFailure("APN_RPC_CONFIG", "bridge_receipt_RPC_method");
    }
    if (route !== "primary" && route !== "receipt" && items.some((item) => !isArchiveBatchItem(item.method, item.params))) {
      bridgeFailure("APN_RPC_CONFIG", "bridge_archive_RPC_method");
    }
    const fallback = route === "receipt" ? receiptFallback : null;
    if (route === "receipt" && fallback === null) missingHistoricalArchive();
    const target = route === "receipt" ? fallback!.url : route !== "primary" ? distinctArchive ?? missingHistoricalArchive() : endpoint;
    const role = route === "primary" ? "primary" : route === "receipt" ? fallback!.role : "archive";
    const attempt: RpcBatchAttempt = async (body) => await batchAttempt(target, body, session.currentTime(), role, session);
    const bound = items.map((item) => ({ ...item, batchAttempt: attempt }));
    return await withEndpointRole(route === "receipt"
      ? session.readReceiptBatch(target.toString(), chainId, bound, fallback!.maxItemsPerRequest)
      : route === "archive_deployment"
      ? session.readArchiveDeploymentBatch(target.toString(), chainId, bound)
      : session.readBatch(target.toString(), chainId, bound), role);
  };
  const sessionArchiveReceipt = async (session: RpcReadSession, method: string, params: readonly unknown[]): Promise<unknown> => {
    const values = await sessionBatchCall(session)([
      { method: "eth_chainId", params: [], cachePolicy: "immutable", decoder: rpcFallbackChainValue(chainId, receiptFallback?.role ?? "archive") },
      { method, params, cachePolicy: "auto", decoder: rpcReceiptFallbackValue(params[0]) },
    ], "receipt");
    return values[1];
  };
  const sessionCall = (session: RpcReadSession): EvmRpcCall => async (method, params) => {
    if (!READ_METHODS.has(method)) bridgeFailure("APN_RPC_PROTOCOL", "bridge_RPC_method");
    const primaryAttempt = (m: string, p: readonly unknown[]) => oneAttempt(endpoint, m, p, session.currentTime(), "primary", session);
    if (method === "eth_sendRawTransaction") return await submitDirect(method, params, primaryAttempt);
    if (method === "eth_getTransactionReceipt" && isArchiveRead(method, params)) {
      if (distinctReceipt !== null) return await withEndpointRole(sessionArchiveReceipt(session, method, params), "receipt");
      let primary: unknown;
      try { primary = await withEndpointRole(session.read(endpoint.toString(), chainId, method, params, primaryAttempt), "primary"); }
      catch (error) {
        if (receiptFallback === null || !isReceiptFallbackError(error)) throw error;
        return await withEndpointRole(sessionArchiveReceipt(session, method, params), receiptFallback.role);
      }
      if (primary !== null || receiptFallback === null) return primary;
      return await withEndpointRole(sessionArchiveReceipt(session, method, params), receiptFallback.role);
    }
    if (isHistoricalStateRead(method, params)) {
      if (distinctArchive === null) return missingHistoricalArchive();
      const archiveAttempt = (m: string, p: readonly unknown[]) => oneAttempt(distinctArchive, m, p, session.currentTime(), "archive", session);
      return await withEndpointRole((async () => {
        const chain = await session.read(distinctArchive.toString(), chainId, "eth_chainId", [], archiveAttempt);
        if (evmRpcQuantity(chain) !== BigInt(chainId)) bridgeFailure("APN_RPC_CONFIG", "bridge_archive_RPC_chain");
        return await session.read(distinctArchive.toString(), chainId, method, params, archiveAttempt);
      })(), "archive");
    }
    return await withEndpointRole(session.read(endpoint.toString(), chainId, method, params, primaryAttempt), "primary");
  };
  return { origin: endpoint.origin, call, attempt: (method, params) => oneAttempt(endpoint, method, params), sessionCall, sessionBatchCall };
}
export function bridgeRpcFactory(environment: Readonly<Record<string, string | undefined>>, options: {
  readonly transport?: Pick<BridgeHttps, "request">;
  readonly wait?: (milliseconds: number) => Promise<void>;
  readonly onRequest?: (trace: BridgeRpcRequestTrace) => void;
} = {}): BridgeRpcFactory {
  const cache = new Map<BridgeChainId, { origin: string; call: EvmRpcCall; attempt: EvmRpcCall; sessionCall: (session: RpcReadSession) => EvmRpcCall; sessionBatchCall: (session: RpcReadSession) => (items: readonly Omit<RpcBatchReadItem, "batchAttempt">[], route?: "primary" | "archive" | "archive_deployment" | "receipt") => Promise<readonly unknown[]>; base?: BridgeRpcPort }>(), transport = options.transport ?? new BridgeHttps();
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
