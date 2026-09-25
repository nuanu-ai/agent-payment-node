import { ApnError } from "../errors.js";
import type { EvmRpcCall } from "../evm-ports.js";
import { evmRpcHex, evmRpcQuantity, evmRpcRecord } from "../evm-rpc-codec.js";
import type { Hex } from "../model.js";
import type { BridgeChainId } from "./chains.js";
import type { BridgeBlock } from "./model.js";
import { isArchiveRead } from "./rpc-archive.js";
import { approvedTransportReason, MAX_READ_ATTEMPTS, RpcHttpFailure, RPC_RETRY_DELAY_MS } from "./rpc-session.js";
import { bridgeFailure } from "./validation.js";

export const READ_METHODS = new Set(["eth_chainId", "eth_getBlockByNumber", "eth_getBalance", "eth_getCode", "eth_getStorageAt", "eth_getTransactionCount", "eth_call", "eth_estimateGas", "eth_maxPriorityFeePerGas", "eth_getTransactionByHash", "eth_getTransactionReceipt", "debug_traceTransaction", "eth_sendRawTransaction"]);
export async function retryDirect(method: string, _params: readonly unknown[], oneAttempt: () => Promise<unknown>, wait: (milliseconds: number) => Promise<void> = async (milliseconds) => {
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
export async function submitDirect(method: string, params: readonly unknown[], oneAttempt: EvmRpcCall): Promise<unknown> {
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
export async function withEndpointRole<T>(read: Promise<T>, endpointRole: "primary" | "receipt" | "archive"): Promise<T> {
  try { return await read; }
  catch (error) {
    if (!(error instanceof ApnError)) throw error;
    throw new ApnError(error.code, error.message, { ...error.details, endpointRole });
  }
}
export function isReceiptFallbackError(error: unknown): boolean {
  if (!(error instanceof ApnError)) return false;
  if (error.code === "APN_PROVIDER_CAPABILITY_UNAVAILABLE") {
    return error.details?.reason === "historical_receipt_unavailable" && error.details.rpcMethod === "eth_getTransactionReceipt";
  }
  if (["APN_RPC_AMBIGUOUS", "APN_PROVIDER_UNAVAILABLE"].includes(error.code)) return true;
  if (error.code !== "APN_RPC_PROTOCOL") return false;
  const status = Number(error.details?.httpStatus);
  return status === 408 || status >= 500 && status <= 599;
}
const PUBLICNODE_ARCHIVE_MESSAGE = "archive requests require a personal token";
export function historicalReceiptUnavailable(value: unknown, chainId: BridgeChainId, target: URL, method: string): boolean {
  let error: Record<string, unknown>;
  try { error = evmRpcRecord(value); } catch { return false; }
  if (!Number.isSafeInteger(error.code) || typeof error.message !== "string" || error.message.length > 1024) return false;
  const message = normalizeProviderMessage(error.message);
  if (message === PUBLICNODE_ARCHIVE_MESSAGE) return isPublicNodeReceiptRequest(chainId, target, method);
  if (credentialOrAuthorizationMessage(message)) return false;
  return message.includes("missing trie node") || message.includes("pruned") ||
    message.includes("historical") && ["unavailable", "not available", "unsupported", "not supported"].some((part) => message.includes(part));
}
export function knownPublicNodeReceiptCapability(chainId: BridgeChainId, target: URL, method: string, body: string): boolean {
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
export function missingHistoricalArchive(): never {
  throw new ApnError("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "Historical bridge proof requires a distinct archive RPC endpoint.",
    { reason: "distinct_archive_RPC_required" });
}
export function rpcBodyMethod(body: string): string {
  try {
    const parsed = JSON.parse(body) as unknown;
    if (Array.isArray(parsed)) return "batch";
    if (typeof parsed === "object" && parsed !== null && typeof (parsed as { readonly method?: unknown }).method === "string") {
      return (parsed as { readonly method: string }).method;
    }
  } catch { /* The canonical body is constructed internally and validated by the response path. */ }
  return "batch";
}
export function decodeAtomicBatchResponse(response: unknown, requests: readonly { readonly id: string }[]): readonly unknown[] {
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
export function isArchiveBatchItem(method: string, params: readonly unknown[]): boolean {
  if (method === "eth_chainId") return params.length === 0;
  if (method === "eth_getBlockByNumber") return params.length === 2 && typeof params[0] === "string" && /^0x(?:0|[1-9a-f][0-9a-f]*)$/u.test(params[0]);
  if (method === "debug_traceTransaction") return params.length === 2 && typeof params[0] === "string" && /^0x[0-9a-fA-F]{64}$/u.test(params[0]);
  return isArchiveRead(method, params);
}
export function isReceiptBatchShape(items: readonly { readonly method: string; readonly params: readonly unknown[] }[]): boolean {
  if (items.length !== 2) return false;
  const [chain, receipt] = items;
  return chain?.method === "eth_chainId" && chain.params.length === 0 && receipt?.method === "eth_getTransactionReceipt" &&
    receipt.params.length === 1 && typeof receipt.params[0] === "string" && /^0x[0-9a-f]{64}$/u.test(receipt.params[0]);
}
export function rpcArchiveChainValue(chainId: BridgeChainId): (value: unknown) => bigint {
  return (value) => {
    const observed = evmRpcQuantity(value);
    if (observed !== BigInt(chainId)) bridgeFailure("APN_RPC_CONFIG", "bridge_archive_RPC_chain");
    return observed;
  };
}
export function rpcFallbackChainValue(chainId: BridgeChainId, role: "receipt" | "archive"): (value: unknown) => bigint {
  return (value) => {
    const observed = evmRpcQuantity(value);
    if (observed !== BigInt(chainId)) bridgeFailure("APN_RPC_CONFIG", role === "receipt" ? "bridge_receipt_RPC_chain" : "bridge_archive_RPC_chain");
    return observed;
  };
}
export function rpcReceiptFallbackValue(expected: unknown): (value: unknown) => unknown {
  return (value) => {
    if (value === null) return null;
    const receipt = evmRpcRecord(value), hash = evmRpcHex(expected, 32);
    if (evmRpcHex(receipt.transactionHash, 32) !== hash) bridgeFailure("APN_RPC_PROTOCOL", "receipt_transaction_hash");
    const status = evmRpcQuantity(receipt.status);
    if (status !== 0n && status !== 1n) bridgeFailure("APN_RPC_PROTOCOL", "receipt_status");
    evmRpcQuantity(receipt.blockNumber); evmRpcHex(receipt.blockHash, 32);
    return value;
  };
}
export function assertMatchingHeader(raw: Record<string, unknown>, expected: BridgeBlock): void {
  if (evmRpcQuantity(raw.number).toString() !== expected.numberAtomic || evmRpcHex(raw.hash, 32) !== expected.hash) {
    bridgeFailure("APN_RPC_PROTOCOL", "bridge_archive_block_mismatch");
  }
}
export function quantity(n: bigint): Hex { return `0x${n.toString(16)}`; }
export function eip7702Delegation(code: Hex): boolean { return /^0xef0100[0-9a-f]{40}$/iu.test(code); }
