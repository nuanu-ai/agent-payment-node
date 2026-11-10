/**
 * How a Circle RPC endpoint's refusal reads. On 2026-11-10 PublicNode's keyless Arbitrum root (the Circle source default)
 * refused every eth_getTransactionReceipt, recent or not: HTTP 403 for a single call, and HTTP 200 with a JSON-RPC error
 * row inside a batch ("Archive requests require a personal token"). Both read as an invalid envelope or a nameless HTTP
 * failure, so an agent could not tell that it had to choose another endpoint.
 *
 * A rate limit asks the caller to wait and rerun the same command. Any other refusal names the setting that selects
 * another endpoint, because APN never switches endpoints on its own. Only a body that breaks the JSON-RPC envelope stays
 * an invalid envelope. Every one of them is a failed read and nothing more: no caller records an effect as sent, unsent
 * or failed from it.
 */
import { isPlainRecord } from "../canonical.js";
import { ApnError, type ErrorDetails } from "../errors.js";
import { jsonRpcRateLimit } from "../lifi/rpc-session-helpers.js";
import { circleRoute, isCircleDestinationChain } from "./catalog.js";
import { circleBlocked } from "./operation-model.js";

/** The setting the Circle commands read for a chain's RPC (funding-runtime.ts and funding-external-adoption.ts). */
export function circleRpcSetting(chainId: number): string {
  if (chainId === 42161) return "APN_ARBITRUM_RPC_URL";
  if (isCircleDestinationChain(chainId)) return circleRoute(chainId).rpcEnvironment;
  return circleBlocked("rpc_chain_setting");
}

/** An HTTP status other than 200, named in `httpStatus` as in the other RPC families. */
export function circleHttpRefusal(label: string, status: number, method: string, setting: string, details: ErrorDetails): ApnError {
  if (status === 429) return new ApnError("APN_RPC_RATE_LIMITED", `${label} answered HTTP 429 to ${method}.`,
    { ...details, reason: "rpc_status", httpStatus: 429, retryable: true });
  return new ApnError("APN_RPC_CONFIG", `${label} answered HTTP ${status} to ${method}; ${otherEndpoint(setting)}`,
    { ...details, reason: "rpc_status", httpStatus: status });
}

/**
 * The JSON-RPC error an HTTP 200 body carries for this id, alone or as a batch row: the exact error member with an integer
 * code and a message, and no result. Null when the value is not one; the caller then checks the result envelope.
 */
export function circleJsonRpcRefusal(label: string, value: Record<string, unknown>, id: number, method: string, setting: string,
  details: ErrorDetails): ApnError | null {
  const error = value.error;
  if (value.jsonrpc !== "2.0" || value.id !== id || Object.hasOwn(value, "result") || !isPlainRecord(error)) return null;
  const code: unknown = error.code, text: unknown = error.message;
  if (typeof code !== "number" || !Number.isSafeInteger(code) || typeof text !== "string") return null;
  const known = { ...details, rpcErrorCode: code };
  if (jsonRpcRateLimit(error)) return new ApnError("APN_RPC_RATE_LIMITED", `${label} asked for a cooldown on ${method}.`,
    { ...known, reason: "json_rpc_rate_limit", retryable: true });
  // A revert is the chain's answer to the call; another endpoint would give the same one, so no setting is named.
  if (code === 3 || /^execution reverted\b/iu.test(text)) return new ApnError("APN_RPC_PROTOCOL", `${label} answered ${method} with an execution revert.`,
    { ...known, reason: "rpc_execution_reverted" });
  return new ApnError("APN_RPC_CONFIG", `${label} refused ${method} with JSON-RPC error ${code}; ${otherEndpoint(setting)}`,
    { ...known, reason: "rpc_error" });
}

function otherEndpoint(setting: string): string {
  return `set ${setting} to another public HTTPS RPC endpoint of this chain, then rerun the same command.`;
}
