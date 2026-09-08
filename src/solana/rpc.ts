import { randomUUID } from "node:crypto";
import { parseJsonWithBigInts } from "@solana/rpc-spec-types";
import { address, getAddressDecoder, getAddressEncoder, getBase58Decoder, getBase58Encoder } from "@solana/kit";
import { exactKeys, isPlainRecord, sha256 } from "../canonical.js";
import { atomic, SOLANA_GENESIS } from "../chain-policy.js";
import { ApnError } from "../errors.js";
import { parsePublicHttpsUrl } from "../network-policy.js";
import { solanaHttpsFetch } from "./https.js";

export type SolanaMethod = "getGenesisHash" | "getMultipleAccounts" | "getAccountInfo" | "getLatestBlockhash" | "getBlockHeight" | "getFeeForMessage" | "getMinimumBalanceForRentExemption" | "sendTransaction" | "getSignatureStatuses" | "getTransaction" | "getBlock";
export interface SolanaRpcPort {
  readonly originHash: string;
  call(method: SolanaMethod, params: readonly unknown[]): Promise<unknown>;
}
export class SolanaRpc implements SolanaRpcPort {
  readonly originHash: string;
  constructor(private readonly endpoint?: string, private readonly fetcher: typeof fetch = solanaHttpsFetch) {
    this.originHash = endpoint === undefined ? sha256("solana_rpc_unconfigured") : sha256(endpoint);
  }
  async call(method: SolanaMethod, params: readonly unknown[]): Promise<unknown> {
    if (this.endpoint === undefined) configFailure();
    let url: URL;
    try { url = parsePublicHttpsUrl(this.endpoint, "APN_RPC_CONFIG", "Solana RPC endpoint", 2048); } catch { return configFailure(); }
    if (url.protocol !== "https:" || url.username !== "" || url.password !== "" || url.hash !== "" || url.search !== "" || url.port !== "" && url.port !== "443") configFailure();
    const id = randomUUID(); const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), 10_000); deadline.unref();
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const response = await this.fetcher(url, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id, method, params }), redirect: "error", credentials: "omit", signal: controller.signal });
      if (!response.ok || response.body === null || !(response.headers.get("content-type") ?? "").includes("application/json")) protocolFailure();
      reader = response.body.getReader(); const chunks: Uint8Array[] = []; let length = 0;
      while (true) {
        const result = await reader.read();
        if (result.done) break;
        length += result.value.byteLength;
        if (length > 2_097_152) protocolFailure();
        chunks.push(result.value);
      }
      const value = parseJsonWithBigInts(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))) as unknown;
      const record = rpcRecord(value);
      if (!exactKeys(record, ["jsonrpc", "id", "result"]) || record.jsonrpc !== "2.0" || record.id !== id) protocolFailure();
      return record.result;
    } catch (error) {
      if (error instanceof ApnError) throw error;
      throw new ApnError(method === "sendTransaction" ? "APN_RPC_AMBIGUOUS" : "APN_RPC_PROTOCOL", "The bounded Solana RPC request did not return valid evidence.");
    } finally { clearTimeout(deadline); await reader?.cancel().catch(() => {}); }
  }
}
export async function assertSolanaNetwork(rpc: SolanaRpcPort): Promise<string> {
  if (await rpc.call("getGenesisHash", []) !== SOLANA_GENESIS) throw new ApnError("APN_CHAIN_MISMATCH", "The RPC does not attest the expected Solana mainnet genesis.");
  return SOLANA_GENESIS;
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
