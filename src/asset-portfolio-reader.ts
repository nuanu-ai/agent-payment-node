import { address as solanaAddress } from "@solana/kit";
import { getAddress } from "viem";
import { exactKeys, isPlainRecord } from "./canonical.js";
import { validateAssetPolicyRegistry, type AssetPolicyChain, type AssetPolicyChainFamily, type AssetPolicyRow } from "./asset-policy-registry.js";
import { ApnError } from "./errors.js";
import { parseAtomic } from "./money.js";
import { tronAddress } from "./tron/codec.js";

const MAX_UINT256 = (1n << 256n) - 1n;
const MAX_RETRIES = 2;

export interface BalanceProvenance {
  readonly block: string | null;
  readonly slot: string | null;
  readonly observedAt: string;
  readonly source: string;
  readonly attempts: number;
}

export type BalanceObservation = Readonly<{
  status: "available";
  amountAtomic: string;
  provenance: BalanceProvenance;
} | {
  status: "unavailable";
  reason: "partial_batch" | "rate_limited" | "transport" | "protocol";
  provenance: BalanceProvenance;
}>;

export interface PortfolioAssetBalance {
  readonly chain: string;
  readonly family: AssetPolicyChainFamily;
  readonly account: string;
  readonly asset: AssetPolicyRow;
  readonly observation: BalanceObservation;
}

export interface PortfolioNetworkBalance {
  readonly chain: string;
  readonly family: AssetPolicyChainFamily;
  readonly account: string;
  readonly datasetDigest: string;
  readonly cache: Readonly<{
    state: "miss" | "fresh" | "expired";
    storedAt: string;
    expiresAt: string;
    unavailableCached: boolean;
  }>;
  readonly balances: readonly PortfolioAssetBalance[];
}

export interface AssetPortfolio {
  readonly datasetDigest: string;
  readonly requestCount: number;
  readonly networks: readonly PortfolioNetworkBalance[];
}

export interface PortfolioAccount {
  readonly chain: string;
  readonly account: string;
}

export interface PortfolioCachePolicy {
  readonly availableTtlMs: number;
  /** Zero explicitly disables caching a batch containing any unavailable observation. */
  readonly unavailableTtlMs: number;
}

export interface BatchBalanceAsset {
  readonly kind: "native" | "token";
  readonly identifier: string | null;
}

export interface BatchBalanceRequest {
  readonly mode: "evm_multicall" | "solana_native_and_token_accounts" | "tron_native_and_trc20";
  readonly chain: string;
  readonly account: string;
  readonly assets: readonly BatchBalanceAsset[];
}

export interface BatchBalanceAvailable {
  readonly status: "available";
  readonly observedAt: string;
  readonly block: string | null;
  readonly slot: string | null;
  readonly balances: readonly Readonly<BatchBalanceAsset & { amountAtomic: string }>[];
}

export interface BatchBalanceUnavailable {
  readonly status: "unavailable";
  readonly reason: "rate_limited" | "transport" | "protocol";
  readonly httpStatus?: number;
  readonly observedAt: string;
  readonly block: string | null;
  readonly slot: string | null;
}

export type BatchBalanceResult = BatchBalanceAvailable | BatchBalanceUnavailable;

export interface FamilyBalanceBatchPort {
  readonly family: AssetPolicyChainFamily;
  /** A configured implementation owns the one family-specific batch request; APN invents no deployment address. */
  readonly source: string;
  read(request: BatchBalanceRequest): Promise<BatchBalanceResult>;
}

interface CachedNetwork {
  readonly storedAtMs: number;
  readonly expiresAtMs: number;
  readonly unavailableCached: boolean;
  readonly balances: readonly PortfolioAssetBalance[];
}

class AssetPortfolioCache {
  private readonly entries = new Map<string, CachedNetwork>();

  lookup(key: string, nowMs: number): { readonly state: "fresh" | "expired"; readonly value: CachedNetwork } | null {
    const value = this.entries.get(key);
    if (value === undefined) return null;
    if (nowMs < value.expiresAtMs) return { state: "fresh", value: structuredClone(value) };
    this.entries.delete(key);
    return { state: "expired", value: structuredClone(value) };
  }

  store(key: string, value: CachedNetwork): void { this.entries.set(key, structuredClone(value)); }
}

export class AssetPortfolioReader {
  private readonly cache = new AssetPortfolioCache();
  constructor(private readonly ports: Readonly<{
    evm: FamilyBalanceBatchPort;
    solana: FamilyBalanceBatchPort;
    tron: FamilyBalanceBatchPort;
  }>, private readonly now: () => number = Date.now,
  private readonly wait: (milliseconds: number) => Promise<void> = async (milliseconds) =>
    await new Promise<void>((resolve) => setTimeout(resolve, milliseconds))) {
    for (const family of ["evm", "solana", "tron"] as const) {
      if (ports[family].family !== family || !source(ports[family].source)) invalid("A portfolio balance port is invalid.");
    }
  }

  async read(registryValue: unknown, accountsValue: unknown, cachePolicyValue: unknown): Promise<AssetPortfolio> {
    const registry = validateAssetPolicyRegistry(registryValue);
    const accounts = portfolioAccounts(accountsValue, registry.chains);
    const cachePolicy = cachePolicyContract(cachePolicyValue);
    const networks: PortfolioNetworkBalance[] = [];
    let requestCount = 0;
    for (const chain of [...registry.chains].sort((left, right) => left.chain.localeCompare(right.chain))) {
      const account = accounts.get(chain.chain)!;
      const key = `${registry.policyDigest}\0${chain.chain}\0${account}`;
      const nowMs = this.now();
      const cached = this.cache.lookup(key, nowMs);
      if (cached?.state === "fresh") {
        networks.push(networkResult(chain, account, registry.policyDigest, "fresh", cached.value));
        continue;
      }
      const assets = orderedAssets(chain.assets);
      const read = await this.readNetwork(chain, account, assets);
      requestCount += read.attempts;
      const balances = projectBalances(chain, account, assets, read.result, this.ports[chain.family].source, read.attempts,
        new Date(this.now()).toISOString());
      const hasUnavailable = balances.some((row) => row.observation.status === "unavailable");
      const ttlMs = hasUnavailable ? cachePolicy.unavailableTtlMs : cachePolicy.availableTtlMs;
      const storedAtMs = this.now(), expiresAtMs = storedAtMs + ttlMs;
      const value: CachedNetwork = { storedAtMs, expiresAtMs, unavailableCached: hasUnavailable && ttlMs > 0, balances };
      if (ttlMs > 0) this.cache.store(key, value);
      networks.push(networkResult(chain, account, registry.policyDigest, cached?.state ?? "miss", value));
    }
    return { datasetDigest: registry.policyDigest, requestCount, networks };
  }

  private async readNetwork(chain: AssetPolicyChain, account: string, assets: readonly AssetPolicyRow[]): Promise<{
    readonly attempts: number; readonly result: BatchBalanceResult;
  }> {
    const port = this.ports[chain.family];
    const request: BatchBalanceRequest = { mode: mode(chain.family), chain: chain.chain, account,
      assets: assets.map(({ kind, identifier }) => ({ kind, identifier })) };
    for (let attempt = 1; ; attempt += 1) {
      let result: BatchBalanceResult;
      try { result = await port.read(request); }
      catch {
        result = { status: "unavailable", reason: "transport", observedAt: new Date(this.now()).toISOString(), block: null, slot: null };
      }
      if (result.status !== "unavailable" || result.httpStatus !== 429 || attempt > MAX_RETRIES) {
        return { attempts: attempt, result };
      }
      await this.wait(attempt === 1 ? 1_000 : 2_000);
    }
  }
}

function portfolioAccounts(value: unknown, chains: readonly AssetPolicyChain[]): ReadonlyMap<string, string> {
  if (!Array.isArray(value) || value.length !== chains.length) invalid("Portfolio accounts must exactly cover the registry networks.");
  const families = new Map(chains.map((chain) => [chain.chain, chain.family]));
  const result = new Map<string, string>();
  for (const row of value) {
    if (!isPlainRecord(row) || !exactKeys(row, ["chain", "account"]) || typeof row.chain !== "string" ||
        typeof row.account !== "string" || result.has(row.chain)) invalid("A portfolio account row is invalid or duplicated.");
    const family = families.get(row.chain); if (family === undefined) invalid("A portfolio account names an unlisted network.");
    result.set(row.chain, canonicalAccount(family, row.account));
  }
  if (result.size !== families.size) invalid("Portfolio accounts must exactly cover the registry networks.");
  return result;
}

function cachePolicyContract(value: unknown): PortfolioCachePolicy {
  if (!isPlainRecord(value) || !exactKeys(value, ["availableTtlMs", "unavailableTtlMs"]) ||
      !ttl(value.availableTtlMs) || !ttl(value.unavailableTtlMs)) invalid("The portfolio cache policy is invalid.");
  return value as unknown as PortfolioCachePolicy;
}

function ttl(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 300_000;
}

function canonicalAccount(family: AssetPolicyChainFamily, value: string): string {
  try {
    if (family === "evm") {
      const account = getAddress(value);
      if (account !== value || account === "0x0000000000000000000000000000000000000000") throw new Error("account");
      return account;
    }
    if (family === "solana") return solanaAddress(value);
    const account = tronAddress(value); if (account !== value) throw new Error("account"); return account;
  } catch { return invalid("A portfolio account is not canonical for its network family."); }
}

function projectBalances(chain: AssetPolicyChain, account: string, assets: readonly AssetPolicyRow[], result: BatchBalanceResult,
  sourceValue: string, attempts: number, fallbackObservedAt: string): readonly PortfolioAssetBalance[] {
  let provenance: BalanceProvenance;
  try {
    const observedAt = instant(result.observedAt), anchor = anchors(chain.family, result.block, result.slot, result.status === "available");
    provenance = { ...anchor, observedAt, source: sourceValue, attempts };
  } catch {
    provenance = { block: null, slot: null, observedAt: fallbackObservedAt, source: sourceValue, attempts };
    return assets.map((asset) => ({ chain: chain.chain, family: chain.family, account, asset,
      observation: { status: "unavailable", reason: "protocol", provenance } }));
  }
  if (result.status === "unavailable") {
    const reason = result.httpStatus === 429 ? "rate_limited" : result.reason;
    return assets.map((asset) => ({ chain: chain.chain, family: chain.family, account, asset,
      observation: { status: "unavailable", reason, provenance } }));
  }
  const expected = new Map(assets.map((asset) => [assetKey(asset), asset]));
  const balances = new Map<string, string>();
  let protocolFailure = false;
  if (!Array.isArray(result.balances) || result.balances.length > assets.length) protocolFailure = true;
  else for (const row of result.balances) {
    if (!isPlainRecord(row) || !exactKeys(row, ["kind", "identifier", "amountAtomic"]) ||
        (row.kind !== "native" && row.kind !== "token") ||
        (row.kind === "native" ? row.identifier !== null : typeof row.identifier !== "string") ||
        typeof row.amountAtomic !== "string") { protocolFailure = true; break; }
    const key = assetKey(row as unknown as BatchBalanceAsset);
    if (!expected.has(key) || balances.has(key)) { protocolFailure = true; break; }
    try { const amount = parseAtomic(row.amountAtomic); if (amount > MAX_UINT256) throw new Error("uint256"); balances.set(key, amount.toString()); }
    catch { protocolFailure = true; break; }
  }
  return assets.map((asset) => {
    const amount = balances.get(assetKey(asset));
    const observation: BalanceObservation = protocolFailure ? { status: "unavailable", reason: "protocol", provenance }
      : amount === undefined ? { status: "unavailable", reason: "partial_batch", provenance }
      : { status: "available", amountAtomic: amount, provenance };
    return { chain: chain.chain, family: chain.family, account, asset, observation };
  });
}

function networkResult(chain: AssetPolicyChain, account: string, digest: string, state: "miss" | "fresh" | "expired",
  cached: CachedNetwork): PortfolioNetworkBalance {
  return { chain: chain.chain, family: chain.family, account, datasetDigest: digest,
    cache: { state, storedAt: new Date(cached.storedAtMs).toISOString(), expiresAt: new Date(cached.expiresAtMs).toISOString(),
      unavailableCached: cached.unavailableCached }, balances: structuredClone(cached.balances) };
}

function orderedAssets(assets: readonly AssetPolicyRow[]): readonly AssetPolicyRow[] {
  return [...assets].sort((left, right) => assetKey(left).localeCompare(assetKey(right)));
}

function assetKey(asset: BatchBalanceAsset): string { return asset.kind === "native" ? "0:native" : `1:${asset.identifier}`; }
function mode(family: AssetPolicyChainFamily): BatchBalanceRequest["mode"] {
  return family === "evm" ? "evm_multicall" : family === "solana" ? "solana_native_and_token_accounts" : "tron_native_and_trc20";
}
function anchors(family: AssetPolicyChainFamily, block: unknown, slot: unknown, requiredAnchor: boolean): Pick<BalanceProvenance, "block" | "slot"> {
  const required = family === "solana" ? slot : block, absent = family === "solana" ? block : slot;
  if (absent !== null || (requiredAnchor && required === null) ||
      (required !== null && !atomicString(required))) invalid("A portfolio batch provenance anchor is invalid.");
  return { block: family === "solana" ? null : required as string | null, slot: family === "solana" ? required as string | null : null };
}
function atomicString(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try { return parseAtomic(value) <= MAX_UINT256; } catch { return false; }
}
function instant(value: unknown): string {
  if (typeof value !== "string") invalid("A portfolio batch observation time is invalid.");
  const time = Date.parse(value); if (!Number.isFinite(time) || new Date(time).toISOString() !== value) invalid("A portfolio batch observation time is invalid.");
  return value;
}
function source(value: unknown): value is string { return typeof value === "string" && /^[a-z0-9][a-z0-9._:/-]{0,127}$/u.test(value); }
function invalid(message: string): never { throw new ApnError("APN_INVALID_INPUT", message); }
