import { randomUUID } from "node:crypto";
import { parseJsonWithBigInts } from "@solana/rpc-spec-types";
import { address, getAddressDecoder, getAddressEncoder, getBase58Decoder, getBase58Encoder } from "@solana/kit";
import { exactKeys, isPlainRecord, sha256 } from "../canonical.js";
import { atomic, SOLANA_GENESIS } from "../chain-policy.js";
import { ApnError } from "../errors.js";
import { parsePublicHttpsUrl } from "../network-policy.js";
import { solanaHttpsFetch } from "./https.js";

export type SolanaMethod = "getGenesisHash" | "getMultipleAccounts" | "getAccountInfo" | "getLatestBlockhash" | "getBlockHeight" | "getFeeForMessage" | "getMinimumBalanceForRentExemption" | "simulateTransaction" | "sendTransaction" | "getSignatureStatuses" | "getTransaction" | "getBlock";
export type SolanaReadMethod = Exclude<SolanaMethod, "simulateTransaction" | "sendTransaction">;
export interface SolanaBatchRead { readonly method: SolanaReadMethod; readonly params: readonly unknown[]; }
export interface SolanaRpcBudgetOptions {
  /** One budget may be shared by all RPC instances used for one operation. */
  readonly maxPhysicalRequests: number;
  /** At least 500 ms between physical POST starts (two per second). */
  readonly minimumIntervalMs?: number;
  readonly now?: () => number;
  /** Supply only from a caller that does not hold a state lock; otherwise cooldown fails fast. */
  readonly wait?: (milliseconds: number) => Promise<void>;
}
export class SolanaRpcBudget {
  readonly maxPhysicalRequests: number;
  readonly minimumIntervalMs: number;
  private readonly now: () => number;
  private readonly wait: ((milliseconds: number) => Promise<void>) | undefined;
  private nextStart = 0;
  private turn: Promise<void> = Promise.resolve();
  private logical = 0;
  private physical = 0;
  constructor(options: SolanaRpcBudgetOptions) {
    if (!Number.isSafeInteger(options.maxPhysicalRequests) || options.maxPhysicalRequests < 1 ||
      !Number.isSafeInteger(options.minimumIntervalMs ?? 500) || (options.minimumIntervalMs ?? 500) < 500) configFailure();
    this.maxPhysicalRequests = options.maxPhysicalRequests;
    this.minimumIntervalMs = options.minimumIntervalMs ?? 500;
    this.now = options.now ?? Date.now;
    this.wait = options.wait;
  }
  get logicalCalls(): number { return this.logical; }
  get physicalRequests(): number { return this.physical; }
  get remainingPhysicalRequests(): number { return this.maxPhysicalRequests - this.physical; }
  /** Reserve and pace before transport. The queue owns no operation or storage lock. */
  async acquire(logicalCalls: number): Promise<void> {
    this.logical += logicalCalls;
    const previous = this.turn;
    let release!: () => void;
    this.turn = new Promise<void>(resolve => { release = resolve; });
    await previous;
    try {
      if (this.physical >= this.maxPhysicalRequests) throw new ApnError("APN_RPC_BUDGET_EXCEEDED", "The Solana operation exhausted its physical RPC request budget.",
        { logicalCalls: this.logical, physicalRequests: this.physical, maxPhysicalRequests: this.maxPhysicalRequests });
      const delay = Math.max(0, this.nextStart - this.now());
      if (delay > 0) {
        if (this.wait === undefined) throw new ApnError("APN_RPC_RATE_LIMITED", "The Solana RPC pacing window is not yet open.",
          { retryAfterMs: delay, logicalCalls: this.logical, physicalRequests: this.physical });
        await this.wait(delay);
        const remaining = this.nextStart - this.now();
        if (remaining > 0) throw new ApnError("APN_RPC_RATE_LIMITED", "The Solana RPC pacing window is not yet open.",
          { retryAfterMs: remaining, logicalCalls: this.logical, physicalRequests: this.physical });
      }
      this.physical += 1;
      this.nextStart = this.now() + this.minimumIntervalMs;
    } finally { release(); }
  }
}
const READ_METHODS: ReadonlySet<string> = new Set<SolanaReadMethod>([
  "getGenesisHash", "getMultipleAccounts", "getAccountInfo", "getLatestBlockhash", "getBlockHeight", "getFeeForMessage",
  "getMinimumBalanceForRentExemption", "getSignatureStatuses", "getTransaction", "getBlock",
]);
export interface SolanaRpcPort {
  readonly originHash: string;
  call(method: SolanaMethod, params: readonly unknown[]): Promise<unknown>;
  batch?(reads: readonly SolanaBatchRead[]): Promise<readonly unknown[]>;
}
/** Preserve input order for test/alternate ports that do not expose JSON-RPC batch. */
export async function solanaReadBatch(rpc: SolanaRpcPort, reads: readonly SolanaBatchRead[]): Promise<readonly unknown[]> {
  if (rpc.batch !== undefined) return await rpc.batch(reads);
  const results: unknown[] = [];
  for (const read of reads) results.push(await rpc.call(read.method, read.params));
  return results;
}
export function assertSolanaNetworkValue(value: unknown): string {
  if (value !== SOLANA_GENESIS) throw new ApnError("APN_CHAIN_MISMATCH", "The RPC does not attest the expected Solana mainnet genesis.");
  return SOLANA_GENESIS;
}
export class SolanaRpc implements SolanaRpcPort {
  readonly originHash: string;
  readonly budget: SolanaRpcBudget | undefined;
  constructor(private readonly endpoint?: string, private readonly fetcher: typeof fetch = solanaHttpsFetch,
    budget?: SolanaRpcBudget) {
    this.originHash = endpoint === undefined ? sha256("solana_rpc_unconfigured") : sha256(endpoint);
    // Stage integration passes one bounded budget through an operation, outside state locks.
    this.budget = budget;
  }
  async call(method: SolanaMethod, params: readonly unknown[]): Promise<unknown> {
    const id = randomUUID();
    const value = await this.request({ jsonrpc: "2.0", id, method, params }, 1, method === "sendTransaction");
    const record = rpcRecord(value);
    if (!exactKeys(record, ["jsonrpc", "id", "result"]) || record.jsonrpc !== "2.0" || record.id !== id) protocolFailure();
    return record.result;
  }
  /** Independent read methods share one POST; results retain input order despite unordered replies. */
  async batch(reads: readonly SolanaBatchRead[]): Promise<readonly unknown[]> {
    if (reads.length < 1 || reads.length > 8 || reads.some(read => !READ_METHODS.has(read.method))) protocolFailure();
    const requests = reads.map(read => ({ jsonrpc: "2.0" as const, id: randomUUID(), method: read.method, params: read.params }));
    const value = await this.request(requests, requests.length, false);
    if (!Array.isArray(value) || value.length !== requests.length) protocolFailure();
    const byId = new Map<string, number>(requests.map((request, index) => [request.id, index]));
    const results: unknown[] = new Array(requests.length);
    const seen = new Set<string>();
    for (const response of value) {
      const record = rpcRecord(response);
      if (!exactKeys(record, ["jsonrpc", "id", "result"]) || record.jsonrpc !== "2.0" || typeof record.id !== "string" ||
        !byId.has(record.id) || seen.has(record.id)) protocolFailure();
      seen.add(record.id);
      results[byId.get(record.id)!] = record.result;
    }
    if (seen.size !== requests.length) protocolFailure();
    return results;
  }
  private async request(body: unknown, logicalCalls: number, effect: boolean): Promise<unknown> {
    if (this.endpoint === undefined) configFailure();
    let url: URL;
    try { url = parsePublicHttpsUrl(this.endpoint, "APN_RPC_CONFIG", "Solana RPC endpoint", 2048); } catch { return configFailure(); }
    if (url.protocol !== "https:" || url.username !== "" || url.password !== "" || url.hash !== "" || url.search !== "" || url.port !== "" && url.port !== "443") configFailure();
    let payload: string;
    try { payload = JSON.stringify(body); } catch { return protocolFailure(); }
    await this.budget?.acquire(logicalCalls);
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), 10_000); deadline.unref();
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const response = await this.fetcher(url, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" },
        body: payload, redirect: "error", credentials: "omit", signal: controller.signal });
      if (response.status === 429) throw new ApnError("APN_RPC_RATE_LIMITED", "The Solana RPC provider requested a cooldown.",
        retryAfterDetails(response.headers.get("retry-after")));
      if (!response.ok || response.body === null || !(response.headers.get("content-type") ?? "").includes("application/json")) protocolFailure();
      reader = response.body.getReader(); const chunks: Uint8Array[] = []; let length = 0;
      while (true) {
        const result = await reader.read();
        if (result.done) break;
        length += result.value.byteLength;
        if (length > 2_097_152) protocolFailure();
        chunks.push(result.value);
      }
      return parseJsonWithBigInts(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))) as unknown;
    } catch (error) {
      if (error instanceof ApnError) throw error;
      throw new ApnError(effect ? "APN_RPC_AMBIGUOUS" : "APN_RPC_PROTOCOL", "The bounded Solana RPC request did not return valid evidence.");
    } finally { clearTimeout(deadline); await reader?.cancel().catch(() => {}); }
  }
}
function retryAfterDetails(value: string | null): { readonly retryAfterMs: number } | undefined {
  if (value === null) return undefined;
  const milliseconds = /^\d+$/u.test(value.trim()) ? Number(value.trim()) * 1_000 : Date.parse(value) - Date.now();
  return Number.isFinite(milliseconds) && milliseconds >= 0 ? { retryAfterMs: Math.min(milliseconds, 86_400_000) } : undefined;
}
export async function assertSolanaNetwork(rpc: SolanaRpcPort): Promise<string> {
  return assertSolanaNetworkValue(await rpc.call("getGenesisHash", []));
}
export function solanaAddress(input: string): string {
  try {
    const encoded = getAddressEncoder().encode(address(input));
    if (encoded.length !== 32 || getAddressDecoder().decode(encoded) !== input) throw new Error("address mismatch");
    return input;
  } catch { throw new ApnError("APN_INVALID_INPUT", "Use a canonical 32-byte Solana base58 address."); }
}
export function solanaSignature(input: unknown): string {
  if (typeof input !== "string" || input.length < 64 || input.length > 88) protocolFailure();
  try {
    const bytes = getBase58Encoder().encode(input);
    if (bytes.length !== 64 || getBase58Decoder().decode(bytes) !== input) protocolFailure();
  } catch { protocolFailure(); }
  return input;
}
export function rpcRecord(value: unknown): Record<string, unknown> {
  if (!isPlainRecord(value)) protocolFailure();
  return value;
}
export function rpcArray(value: unknown, maximum = 64): readonly unknown[] {
  if (!Array.isArray(value) || value.length > maximum) protocolFailure();
  return value;
}
export function rpcAtomic(value: unknown): bigint {
  if (typeof value === "bigint") return atomic(value.toString());
  if (typeof value === "number" && Number.isSafeInteger(value)) return atomic(value.toString());
  protocolFailure();
}
export function protocolFailure(): never { throw new ApnError("APN_RPC_PROTOCOL", "Solana RPC evidence has an invalid shape or semantic binding."); }
function configFailure(): never { throw new ApnError("APN_RPC_CONFIG", "The Solana RPC requires explicit HTTPS without URL credentials, query parameters or fragments.", { nextActions: ["Set APN_SOLANA_RPC_URL to the intended Solana mainnet HTTPS endpoint."] }); }
