import { request as httpsRequest } from "node:https";
import { isDeepStrictEqual } from "node:util";
import { record } from "./base-rpc-codec.js";
import { exactKeys } from "./canonical.js";
import { MAX_RPC_RESPONSE_BYTES } from "./constants.js";
import { ApnError } from "./errors.js";
import { jsonRpcRequestHeaders } from "./rpc-request-headers.js";
import type { PinnedAddress } from "./network-policy.js";
import { parseJsonWithDuplicateRejection } from "./x402-strict-json.js";

export const MAX_RPC_BATCH_CALLS = 16;
const MAX_RPC_BATCH_ENVELOPES = 24;
export const BATCH_READ_METHODS = new Set([
  "eth_chainId", "eth_getBlockByNumber", "eth_getBalance", "eth_getCode", "eth_call",
  "eth_getTransactionCount", "eth_getTransactionByHash", "eth_getTransactionReceipt", "eth_gasPrice",
  "eth_maxPriorityFeePerGas", "eth_estimateGas",
]);

export function parseRpcResultEnvelope(raw: string, id: string, method?: string): unknown {
  const message = strictRpcRecord(raw);
  if (!exactKeys(message, ["jsonrpc", "id", "result"]) || message.jsonrpc !== "2.0" || message.id !== id) {
    throw new ApnError("APN_RPC_PROTOCOL", "RPC response violates the exact JSON-RPC result envelope.", {
      rpcMethod: method !== undefined && (BATCH_READ_METHODS.has(method) || method === "eth_sendRawTransaction") ? method : "unknown",
      stage: "result_envelope",
    });
  }
  return message.result;
}

export function parseRpcBatchResultEnvelope(raw: string, ids: readonly number[]): readonly unknown[] {
  if (ids.length < 1 || ids.length > MAX_RPC_BATCH_CALLS ||
    ids.some((id) => !Number.isSafeInteger(id) || id < 1) || new Set(ids).size !== ids.length) {
    throw new ApnError("APN_RPC_PROTOCOL", "RPC batch request IDs are invalid.");
  }
  if (Buffer.byteLength(raw) > MAX_RPC_RESPONSE_BYTES) {
    throw new ApnError("APN_RPC_PROTOCOL", "RPC response exceeds the size limit.");
  }
  let parsed: unknown;
  try { parsed = parseJsonWithDuplicateRejection(raw); }
  catch { throw new ApnError("APN_RPC_PROTOCOL", "RPC response is not strict JSON."); }
  if (!Array.isArray(parsed) || parsed.length < ids.length || parsed.length > MAX_RPC_BATCH_ENVELOPES) {
    throw new ApnError("APN_RPC_PROTOCOL", "RPC batch response count is invalid.");
  }
  const expected = new Set(ids);
  const results = new Map<number, Record<string, unknown>>();
  for (const entry of parsed) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      throw new ApnError("APN_RPC_PROTOCOL", "RPC batch response envelope is invalid.");
    }
    const message = entry as Record<string, unknown>;
    if (!exactKeys(message, ["jsonrpc", "id", "result"]) || message.jsonrpc !== "2.0" ||
      typeof message.id !== "number" || !Number.isSafeInteger(message.id) || !expected.has(message.id)) {
      throw new ApnError("APN_RPC_PROTOCOL", "RPC batch response envelope is invalid.");
    }
    const previous = results.get(message.id);
    if (previous !== undefined && !isDeepStrictEqual(previous, message)) {
      throw new ApnError("APN_RPC_PROTOCOL", "RPC batch response envelope is invalid.");
    }
    results.set(message.id, message);
  }
  if (results.size !== ids.length) {
    throw new ApnError("APN_RPC_PROTOCOL", "RPC batch response is missing an ID.");
  }
  return ids.map((id) => results.get(id)!.result);
}

export function parseRpcLogEnvelope(raw: string, id: string):
  | { readonly kind: "complete"; readonly value: unknown }
  | { readonly kind: "pruned" }
  | { readonly kind: "range_unavailable" } {
  const message = strictRpcRecord(raw);
  if (message.jsonrpc !== "2.0" || message.id !== id) {
    throw new ApnError("APN_RPC_PROTOCOL", "RPC response violates JSON-RPC identity requirements.");
  }
  if (exactKeys(message, ["jsonrpc", "id", "result"])) return { kind: "complete", value: message.result };
  if (!exactKeys(message, ["jsonrpc", "id", "error"])) {
    throw new ApnError("APN_RPC_PROTOCOL", "RPC log response violates the exact result or error envelope.");
  }
  const error = record(message.error, "JSON-RPC error");
  const availability = classifyX402LogAvailabilityMessage(typeof error.message === "string" ? error.message : "");
  if (availability !== null) return { kind: availability };
  throw new ApnError("APN_RPC_PROTOCOL", "RPC log query failed without a recognized availability class.");
}

function strictRpcRecord(raw: string): Record<string, unknown> {
  try { return record(parseJsonWithDuplicateRejection(raw), "JSON-RPC response"); }
  catch (error) {
    if (error instanceof ApnError && error.code === "APN_RPC_PROTOCOL") throw error;
    throw new ApnError("APN_RPC_PROTOCOL", "RPC response is not strict JSON.");
  }
}

export function classifyX402LogAvailabilityMessage(
  message: string,
): "pruned" | "range_unavailable" | null {
  const text = message.toLowerCase();
  if (/\b(?:rate[ -]limit(?:ed|ing)?|request limit|too many requests)\b/u.test(text)) return null;
  if (/\b(?:pruned|missing trie|historical state|history unavailable)\b/u.test(text)) return "pruned";
  const rangeSubject = /\b(?:block(?:s)?|range|logs?|results?|query|window)\b/u.test(text);
  const boundedFailure = /\b(?:too (?:wide|large)|too many results?|exceed(?:s|ed|ing)?|maximum|max|limit(?:ed)?|more than|returned more|at most|up to)\b/u.test(text);
  return rangeSubject && boundedFailure ? "range_unavailable" : null;
}

export async function postJson(
  endpoint: URL,
  body: string,
  addresses: readonly PinnedAddress[],
  timeoutMs: number,
  rpcMethod: string,
  allowJsonRpcClientError = false,
  abortSignal?: AbortSignal,
): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const selected = addresses[0];
    if (selected === undefined) { reject(new ApnError("APN_RPC_CONFIG", "RPC host has no validated address.")); return; }
    let requestTimedOut = false;
    const request = httpsRequest(endpoint, {
      method: "POST",
      signal: abortSignal,
      family: selected.family,
      headers: jsonRpcRequestHeaders(body),
      lookup: (_hostname, _options, callback) => callback(null, selected.address, selected.family),
    }, (response) => {
      const details = { rpcMethod, ...(response.statusCode === undefined ? {} : { httpStatus: response.statusCode }) };
      if ((response.statusCode ?? 0) >= 300 && (response.statusCode ?? 0) < 400) {
        response.resume(); reject(new ApnError("APN_RPC_PROTOCOL", "RPC redirects are forbidden.", details)); return;
      }
      if (!acceptRpcHttpBody(response.statusCode, allowJsonRpcClientError)) {
        response.resume(); reject(new ApnError("APN_RPC_PROTOCOL", "RPC returned an unsuccessful HTTP status.", details)); return;
      }
      const declared = Number(response.headers["content-length"] ?? "0");
      if (Number.isFinite(declared) && declared > MAX_RPC_RESPONSE_BYTES) { response.destroy(); reject(new ApnError("APN_RPC_PROTOCOL", "RPC response exceeds the size limit.")); return; }
      const chunks: Buffer[] = [];
      let total = 0;
      response.on("data", (chunk: Buffer) => {
        total += chunk.length;
        if (total > MAX_RPC_RESPONSE_BYTES) { response.destroy(); reject(new ApnError("APN_RPC_PROTOCOL", "RPC response exceeds the size limit.")); return; }
        chunks.push(chunk);
      });
      response.on("end", () => { if (!abortSignal?.aborted && !requestTimedOut) resolve(Buffer.concat(chunks, total).toString("utf8")); });
      response.on("error", () => { if (!abortSignal?.aborted && !requestTimedOut) reject(new ApnError("APN_RPC_AMBIGUOUS", "RPC response failed safely.")); });
    });
    request.setTimeout(timeoutMs, () => { requestTimedOut = true; request.destroy(); });
    request.on("error", (error) => {
      // Abort rejects only after close, when the underlying HTTPS request has stopped.
      if (abortSignal?.aborted || requestTimedOut) return;
      reject(error instanceof ApnError ? error : new ApnError("APN_RPC_AMBIGUOUS", "RPC transport failed safely."));
    });
    request.on("close", () => {
      if (abortSignal?.aborted) reject(new ApnError("APN_RPC_BUDGET_EXCEEDED",
        "Relay execution reached its wall deadline; resume the saved operation explicitly.", { reason: "relay_wall_deadline" }));
      else if (requestTimedOut) reject(new ApnError("APN_RPC_AMBIGUOUS", "RPC request timed out.", { reason: "request_deadline" }));
    });
    request.end(body);
  });
}

export function acceptRpcHttpBody(status: number | undefined, allowJsonRpcClientError: boolean): boolean {
  return status === 200 || (allowJsonRpcClientError && status === 400);
}

export function rpcAbortableWait(signal: AbortSignal): (milliseconds: number) => Promise<void> {
  return async (milliseconds: number): Promise<void> => await new Promise((resolve, reject) => {
      if (signal.aborted) { reject(new ApnError("APN_RPC_AMBIGUOUS", "Bounded RPC observation reached its deadline.")); return; }
      const timer = setTimeout(() => { signal.removeEventListener("abort", onAbort); resolve(); }, milliseconds);
      const onAbort = () => { clearTimeout(timer); reject(new ApnError("APN_RPC_AMBIGUOUS", "Bounded RPC observation reached its deadline.")); };
      signal.addEventListener("abort", onAbort, { once: true });
    });
}
