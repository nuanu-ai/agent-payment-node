import { exactKeys, hashObject, isPlainRecord } from "../canonical.js";
import { formatAtomic, parseAtomic } from "../money.js";
import type { PortfolioNetworkResult } from "../asset-portfolio-reader.js";

export const PORTFOLIO_CACHE_TTL_MS = 15_000;
export type PortfolioCapture = Pick<PortfolioNetworkResult, "mode" | "rpcCalls" | "attempts" | "methods" | "retried" | "block" | "slot" | "observedAt" | "rows">;
export interface PortfolioCacheRecord {
  readonly schemaVersion: "apn.portfolio-cache.v1";
  readonly slot: string;
  readonly identity: string;
  readonly capturedAt: string;
  readonly expiresAt: string;
  readonly capture: PortfolioCapture;
  readonly digest: string;
}
const digest = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/u.test(v);
const integer = (v: unknown, max: number): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && v <= max;
function instant(v: unknown): v is string {
  if (typeof v !== "string") return false;
  const ms = Date.parse(v); return Number.isSafeInteger(ms) && ms >= 0 && new Date(ms).toISOString() === v;
}
function atomic(v: unknown): v is string {
  try { return typeof v === "string" && parseAtomic(v) <= (1n << 256n) - 1n; } catch { return false; }
}
/** Untrusted cache data is disposable; secure filesystem errors are handled by the store, not this codec. */
export function parsePortfolioCache(value: unknown): PortfolioCacheRecord | null {
  if (!isPlainRecord(value) || !exactKeys(value, ["schemaVersion", "slot", "identity", "capturedAt", "expiresAt", "capture", "digest"]) ||
      value.schemaVersion !== "apn.portfolio-cache.v1" || !digest(value.slot) || !digest(value.identity) || !digest(value.digest) ||
      !instant(value.capturedAt) || !instant(value.expiresAt) || Date.parse(value.expiresAt) - Date.parse(value.capturedAt) !== PORTFOLIO_CACHE_TTL_MS) return null;
  const c = value.capture;
  if (!isPlainRecord(c) || !exactKeys(c, ["mode", "rpcCalls", "attempts", "methods", "retried", "block", "slot", "observedAt", "rows"]) ||
      !["evm_multicall3_aggregate3", "evm_json_rpc_batch", "solana_json_rpc_batch", "tron_http_sequential"].includes(String(c.mode)) ||
      !integer(c.rpcCalls, 192) || !integer(c.methods, 192) || !integer(c.attempts, 3) || c.attempts === 0 ||
      !Array.isArray(c.retried) || c.retried.length !== c.attempts - 1 ||
      c.retried.some((v) => !["rate_limited", "server_error", "timeout", "unreachable"].includes(v)) ||
      c.observedAt !== value.capturedAt || !Array.isArray(c.rows) || c.rows.length === 0 || c.rows.length > 64 ||
      (c.mode === "solana_json_rpc_batch" ? c.block !== null || !atomic(c.slot) : c.slot !== null || !atomic(c.block))) return null;
  for (const r of c.rows) {
    if (!isPlainRecord(r) || !exactKeys(r, ["symbol", "kind", "contract", "decimals", "status", "atomic", "display", "reason", "httpStatus"]) ||
        typeof r.symbol !== "string" || r.symbol.length === 0 || r.symbol.length > 64 || !integer(r.decimals, 255) || r.status !== "ok" ||
        r.reason !== null || r.httpStatus !== null || !atomic(r.atomic) || r.display !== formatAtomic(r.atomic, r.decimals) ||
        !(r.kind === "native" ? r.contract === null : r.kind === "token" && typeof r.contract === "string" && r.contract.length <= 256)) return null;
  }
  const { digest: stored, ...body } = value;
  if (hashObject(body) !== stored) return null;
  return value as unknown as PortfolioCacheRecord;
}
export function portfolioCacheRecord(slot: string, identity: string, capture: PortfolioCapture): PortfolioCacheRecord {
  const capturedAt = capture.observedAt!;
  const body = { schemaVersion: "apn.portfolio-cache.v1" as const, slot, identity, capturedAt,
    expiresAt: new Date(Date.parse(capturedAt) + PORTFOLIO_CACHE_TTL_MS).toISOString(), capture };
  return { ...body, digest: hashObject(body) };
}
