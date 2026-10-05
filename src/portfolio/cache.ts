import type { AssetPortfolioInput, PortfolioAccount, PortfolioNetworkResult } from "../asset-portfolio-reader.js";
import type { CandidateAsset, CandidateNetwork } from "../allowlist-inventory.js";
import { hashObject, sha256 } from "../canonical.js";
import type { StateStore } from "../state.js";
import { portfolioCacheRecord, type PortfolioCapture } from "./cache-record.js";
import type { PortfolioEndpoint } from "./registry.js";

export interface PortfolioCacheContext {
  readonly state: Pick<StateStore, "loadPortfolioCache" | "writePortfolioCache">;
  readonly profileHash: string;
  readonly profileIdentity: string;
  readonly refresh?: boolean;
}
export interface PortfolioCacheMetadata {
  readonly hit: boolean;
  readonly ageMs: number;
  readonly capturedAt: string;
  readonly expiresAt: string;
  readonly sourceRpc: Pick<PortfolioNetworkResult, "mode" | "rpcCalls" | "attempts" | "methods" | "retried">;
}
interface CacheKey { readonly slot: string; readonly identity: string; readonly family: CandidateNetwork["family"]; readonly assets: readonly CandidateAsset[] }
export function portfolioCacheKey(context: PortfolioCacheContext, inventory: AssetPortfolioInput["inventory"], network: CandidateNetwork,
  assets: readonly CandidateAsset[], account: PortfolioAccount, endpoint: PortfolioEndpoint): CacheKey {
  return { family: network.family, assets, slot: hashObject({ profileHash: context.profileHash, family: network.family, chain: network.chain }),
    identity: hashObject({ profileHash: context.profileHash, profileIdentity: context.profileIdentity, dataset: inventory.dataset,
      network, assets, account, endpoint: { source: endpoint.source, env: endpoint.env,
        urlHash: endpoint.source === "env" || endpoint.source === "default_public" ? sha256(endpoint.url.href) : null } }) };
}
export async function cachedPortfolio(context: PortfolioCacheContext, key: CacheKey, now: Date): Promise<(PortfolioCapture & { cache: PortfolioCacheMetadata }) | null> {
  if (context.refresh === true) return null;
  const record = await context.state.loadPortfolioCache(key.slot);
  if (record === null || record.identity !== key.identity || Date.parse(record.capturedAt) > now.getTime() || Date.parse(record.expiresAt) <= now.getTime()) return null;
  if (record.capture.rows.length !== key.assets.length || record.capture.rows.some((row, i) => {
    const asset = key.assets[i]!;
    return row.kind !== asset.kind || row.contract !== asset.identifier || row.symbol !== asset.symbol || row.decimals !== asset.decimals;
  }) || (key.family === "evm" ? !record.capture.mode?.startsWith("evm_") :
    record.capture.mode !== (key.family === "solana" ? "solana_json_rpc_batch" : "tron_http_sequential"))) return null;
  return { ...record.capture, rpcCalls: 0, attempts: 0, methods: 0, retried: [], cache: metadata(record.capture, record.capturedAt, record.expiresAt, true, now) };
}
export async function capturePortfolio(context: PortfolioCacheContext, key: CacheKey, result: PortfolioNetworkResult): Promise<PortfolioNetworkResult> {
  if (result.rows.some((row) => row.status !== "ok")) return result;
  const { mode, rpcCalls, attempts, methods, retried, block, slot, observedAt, rows } = result;
  const record = portfolioCacheRecord(key.slot, key.identity, { mode, rpcCalls, attempts, methods, retried, block, slot, observedAt, rows });
  await context.state.writePortfolioCache(record);
  return { ...result, cache: metadata(record.capture, record.capturedAt, record.expiresAt, false, new Date(record.capturedAt)) };
}
function metadata(capture: PortfolioCapture, capturedAt: string, expiresAt: string, hit: boolean, now: Date): PortfolioCacheMetadata {
  return { hit, ageMs: now.getTime() - Date.parse(capturedAt), capturedAt, expiresAt,
    sourceRpc: { mode: capture.mode, rpcCalls: capture.rpcCalls, attempts: capture.attempts, methods: capture.methods, retried: capture.retried } };
}
