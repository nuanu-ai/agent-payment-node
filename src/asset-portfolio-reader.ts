import { address as solanaAddress } from "@solana/kit";
import { getAddress } from "viem";
import type { AllowlistInventory, CandidateAsset, CandidateNetwork } from "./allowlist-inventory.js";
import { exactKeys, isPlainRecord } from "./canonical.js";
import { ApnError } from "./errors.js";
import { formatAtomic, parseAtomic } from "./money.js";
import type { PortfolioEndpoint, PortfolioFamily } from "./portfolio/registry.js";
import { tronAddress } from "./tron/codec.js";

const MAX_UINT256 = (1n << 256n) - 1n;
export const PORTFOLIO_MAX_ATTEMPTS = 3;
/** Pause before attempt 2 and attempt 3. */
export const PORTFOLIO_RETRY_PAUSES_MS: readonly number[] = Object.freeze([1_000, 2_000]);

export type PortfolioRetryableReason = "rate_limited" | "server_error" | "timeout" | "unreachable";
export type BatchUnavailableReason = PortfolioRetryableReason | "http_status" | "rpc_error" | "protocol" |
  "chain_mismatch" | "multicall_code_mismatch" | "transport_refused";
export type PortfolioUnavailableReason = BatchUnavailableReason | "partial_batch" | "rpc_config_invalid" | "external_provider_profile";
export type PortfolioRowStatus = "ok" | "unavailable" | "no_account" | "rpc_not_configured";
const RETRYABLE: ReadonlySet<string> = new Set<PortfolioRetryableReason>(["rate_limited", "server_error", "timeout", "unreachable"]);
const BATCH_REASONS: ReadonlySet<string> = new Set<BatchUnavailableReason>(["rate_limited", "server_error", "timeout", "unreachable",
  "http_status", "rpc_error", "protocol", "chain_mismatch", "multicall_code_mismatch", "transport_refused"]);

export type PortfolioAccount =
  | { readonly kind: "account"; readonly address: string }
  | { readonly kind: "none" }
  | { readonly kind: "unsupported"; readonly reason: "external_provider_profile" };

export interface BatchBalanceAsset {
  readonly kind: "native" | "token";
  readonly identifier: string | null;
}

export interface BatchBalanceRequest {
  readonly chain: string;
  readonly family: PortfolioFamily;
  readonly account: string;
  /** Validated HTTPS endpoint (serialized URL). */
  readonly endpoint: string;
  readonly assets: readonly BatchBalanceAsset[];
}

export type BatchBalanceMode = "evm_multicall3_aggregate3" | "evm_json_rpc_batch" | "solana_json_rpc_batch" | "tron_http_sequential";
export type BatchBalanceRow = BatchBalanceAsset & ({ readonly amountAtomic: string } | { readonly unavailable: "partial_batch" | "protocol" });

interface BatchCost {
  readonly mode: BatchBalanceMode;
  /** HTTP requests sent during this attempt. One JSON-RPC batch array counts as one call. */
  readonly calls: number;
  /** JSON-RPC methods or TRON API paths carried by those calls. */
  readonly methods: number;
}
export type BatchBalanceAvailable = BatchCost & {
  readonly status: "available";
  readonly block: string | null;
  readonly slot: string | null;
  readonly balances: readonly BatchBalanceRow[];
};
export type BatchBalanceUnavailable = BatchCost & {
  readonly status: "unavailable";
  readonly reason: BatchUnavailableReason;
  readonly httpStatus?: number;
};
export type BatchBalanceResult = BatchBalanceAvailable | BatchBalanceUnavailable;

/** A family port performs one attempt and never throws; the reader owns retries and never turns failure into zero. */
export interface FamilyBalanceBatchPort {
  readonly family: PortfolioFamily;
  read(request: BatchBalanceRequest): Promise<BatchBalanceResult>;
}

export interface PortfolioRow {
  readonly symbol: string;
  readonly kind: "native" | "token";
  readonly contract: string | null;
  readonly decimals: number;
  readonly status: PortfolioRowStatus;
  readonly atomic: string | null;
  readonly display: string | null;
  readonly reason: PortfolioUnavailableReason | null;
  readonly httpStatus: number | null;
}

export interface PortfolioNetworkResult {
  readonly chain: string;
  readonly name: string;
  readonly family: PortfolioFamily;
  readonly account: string | null;
  readonly endpoint: Readonly<{ source: PortfolioEndpoint["source"]; env: string | null; url: string | null }>;
  readonly mode: BatchBalanceMode | null;
  readonly rpcCalls: number;
  readonly attempts: number;
  /** Classified failure of every attempt that was retried, in order. */
  readonly retried: readonly PortfolioRetryableReason[];
  readonly methods: number;
  readonly block: string | null;
  readonly slot: string | null;
  readonly observedAt: string | null;
  readonly rows: readonly PortfolioRow[];
}

export interface AssetPortfolio {
  readonly datasetVersion: string;
  readonly datasetSha256: string;
  readonly rpcCallsTotal: number;
  readonly networks: readonly PortfolioNetworkResult[];
}

export interface AssetPortfolioInput {
  readonly inventory: AllowlistInventory;
  readonly accounts: Readonly<Record<PortfolioFamily, PortfolioAccount>>;
  readonly endpoint: (chain: string) => PortfolioEndpoint;
}

type Ports = Readonly<Record<PortfolioFamily, FamilyBalanceBatchPort>>;

export class AssetPortfolioReader {
  private readonly ports: Ports;
  /** `wait` resolves "interrupted" to end retries early; the last classified result is then reported. */
  constructor(ports: Ports, private readonly now: () => Date,
    private readonly wait: (milliseconds: number) => Promise<"elapsed" | "interrupted">) {
    for (const family of ["evm", "solana", "tron"] as const) {
      if (ports[family]?.family !== family || typeof ports[family].read !== "function") invalid("A portfolio balance port is invalid.");
    }
    this.ports = ports;
  }

  /** Reads every network of the frozen list concurrently; each network is one batch attempt plus bounded retries. */
  async read(input: AssetPortfolioInput): Promise<AssetPortfolio> {
    const accounts = portfolioAccounts(input.accounts);
    const networks = await Promise.all(input.inventory.networks.map(async (network) => await this.readNetwork(network,
      input.inventory.assets.filter((asset) => asset.chain === network.chain), accounts[network.family], input.endpoint(network.chain))));
    return { datasetVersion: input.inventory.dataset.version, datasetSha256: input.inventory.dataset.sha256,
      rpcCallsTotal: networks.reduce((total, network) => total + network.rpcCalls, 0), networks };
  }

  private async readNetwork(network: CandidateNetwork, assets: readonly CandidateAsset[], account: PortfolioAccount,
    endpoint: PortfolioEndpoint): Promise<PortfolioNetworkResult> {
    if (assets.length === 0 || assets.length !== network.assetCount) invalid("The frozen list network has no exact asset rows.");
    const base = { chain: network.chain, name: network.name, family: network.family,
      account: account.kind === "account" ? account.address : null, endpoint: publicEndpoint(endpoint),
      mode: null, rpcCalls: 0, attempts: 0, methods: 0, retried: [], block: null, slot: null, observedAt: null };
    if (account.kind === "none") return { ...base, rows: assets.map((asset) => row(asset, "no_account")) };
    if (account.kind === "unsupported") return { ...base, rows: assets.map((asset) => row(asset, "unavailable", account.reason)) };
    if (endpoint.source === "not_configured") return { ...base, rows: assets.map((asset) => row(asset, "rpc_not_configured")) };
    if (endpoint.source === "invalid_env") return { ...base, rows: assets.map((asset) => row(asset, "unavailable", "rpc_config_invalid")) };
    const request: BatchBalanceRequest = { chain: network.chain, family: network.family, account: account.address, endpoint: endpoint.url.href,
      assets: assets.map(({ kind, identifier }) => ({ kind, identifier })) };
    let calls = 0, methods = 0;
    const retried: PortfolioRetryableReason[] = [];
    for (let attempt = 1; ; attempt += 1) {
      const result = await this.attempt(this.ports[network.family], request);
      calls += result.calls; methods += result.methods;
      if (result.status === "available" || !RETRYABLE.has(result.reason) || attempt >= PORTFOLIO_MAX_ATTEMPTS ||
          await this.wait(PORTFOLIO_RETRY_PAUSES_MS[attempt - 1]!) !== "elapsed") {
        return { ...base, mode: result.mode, rpcCalls: calls, attempts: attempt, methods, retried,
          block: result.status === "available" ? result.block : null, slot: result.status === "available" ? result.slot : null,
          observedAt: this.now().toISOString(), rows: project(assets, result) };
      }
      retried.push(result.reason as PortfolioRetryableReason);
    }
  }

  private async attempt(port: FamilyBalanceBatchPort, request: BatchBalanceRequest): Promise<BatchBalanceResult> {
    const fallback = { status: "unavailable", reason: "protocol", mode: defaultMode(request.family), calls: 0, methods: 0 } as const;
    try { return batchResult(await port.read(structuredClone(request)), request.family) ?? fallback; }
    catch { return fallback; }
  }
}

/** Exact per-row projection: a row without a validated amount is unavailable, never zero. */
function project(assets: readonly CandidateAsset[], result: BatchBalanceResult): readonly PortfolioRow[] {
  if (result.status === "unavailable") return assets.map((asset) => row(asset, "unavailable", result.reason, result.httpStatus ?? null));
  const expected = new Set(assets.map(assetKey)), seen = new Map<string, BatchBalanceRow>();
  let malformed = result.balances.length > assets.length;
  for (const value of result.balances) {
    const key = assetKey(value);
    if (!expected.has(key) || seen.has(key)) { malformed = true; break; }
    seen.set(key, value);
  }
  return assets.map((asset) => {
    const value = seen.get(assetKey(asset));
    if (malformed) return row(asset, "unavailable", "protocol");
    if (value === undefined) return row(asset, "unavailable", "partial_batch");
    if ("unavailable" in value) return row(asset, "unavailable", value.unavailable);
    return { ...row(asset, "ok"), atomic: value.amountAtomic, display: formatAtomic(value.amountAtomic, asset.decimals) };
  });
}

function row(asset: CandidateAsset, status: PortfolioRowStatus, reason: PortfolioUnavailableReason | null = null,
  httpStatus: number | null = null): PortfolioRow {
  return { symbol: asset.symbol, kind: asset.kind, contract: asset.identifier, decimals: asset.decimals, status,
    atomic: null, display: null, reason, httpStatus };
}

function batchResult(value: unknown, family: PortfolioFamily): BatchBalanceResult | null {
  if (!isPlainRecord(value) || !cost(value.calls) || !cost(value.methods) || value.mode !== modeFamily(value.mode, family)) return null;
  if (value.status === "unavailable") {
    const keys = ["status", "reason", "mode", "calls", "methods", ...(Object.hasOwn(value, "httpStatus") ? ["httpStatus"] : [])];
    if (!exactKeys(value, keys) || typeof value.reason !== "string" || !BATCH_REASONS.has(value.reason) ||
        (Object.hasOwn(value, "httpStatus") && !httpStatus(value.httpStatus))) return null;
    return value as unknown as BatchBalanceUnavailable;
  }
  if (value.status !== "available" || !exactKeys(value, ["status", "mode", "calls", "methods", "block", "slot", "balances"]) ||
      !Array.isArray(value.balances) || !anchor(value.block, family !== "solana") || !anchor(value.slot, family === "solana")) return null;
  for (const entry of value.balances) {
    if (!isPlainRecord(entry) || (entry.kind !== "native" && entry.kind !== "token") ||
        (entry.kind === "native" ? entry.identifier !== null : typeof entry.identifier !== "string")) return null;
    if (Object.hasOwn(entry, "amountAtomic") ? !exactKeys(entry, ["kind", "identifier", "amountAtomic"]) || !uint256(entry.amountAtomic)
      : !exactKeys(entry, ["kind", "identifier", "unavailable"]) || (entry.unavailable !== "partial_batch" && entry.unavailable !== "protocol")) return null;
  }
  return value as unknown as BatchBalanceAvailable;
}

function portfolioAccounts(value: Readonly<Record<PortfolioFamily, PortfolioAccount>>): Readonly<Record<PortfolioFamily, PortfolioAccount>> {
  if (!isPlainRecord(value) || !exactKeys(value, ["evm", "solana", "tron"])) invalid("Portfolio accounts must name exactly evm, solana and tron.");
  for (const family of ["evm", "solana", "tron"] as const) {
    const account = value[family];
    if (account.kind === "account") canonicalAccount(family, account.address);
    else if (account.kind !== "none" && !(account.kind === "unsupported" && account.reason === "external_provider_profile")) {
      invalid("A portfolio account state is invalid.");
    }
  }
  return value;
}

function canonicalAccount(family: PortfolioFamily, value: string): void {
  try {
    const canonical = family === "evm" ? getAddress(value) : family === "solana" ? solanaAddress(value) : tronAddress(value);
    if (canonical !== value || canonical === "0x0000000000000000000000000000000000000000") throw new Error("account");
  } catch { invalid("A portfolio account is not canonical for its network family."); }
}

function publicEndpoint(endpoint: PortfolioEndpoint): PortfolioNetworkResult["endpoint"] {
  // Owner-supplied URLs may carry credentials in the path; only the pinned public default is echoed.
  return { source: endpoint.source, env: endpoint.env, url: endpoint.source === "default_public" ? endpoint.display : null };
}

function defaultMode(family: PortfolioFamily): BatchBalanceMode {
  return family === "evm" ? "evm_multicall3_aggregate3" : family === "solana" ? "solana_json_rpc_batch" : "tron_http_sequential";
}
function modeFamily(mode: unknown, family: PortfolioFamily): BatchBalanceMode | null {
  if (family === "evm") return mode === "evm_multicall3_aggregate3" || mode === "evm_json_rpc_batch" ? mode : null;
  return mode === defaultMode(family) ? defaultMode(family) : null;
}
function assetKey(asset: BatchBalanceAsset): string { return asset.kind === "native" ? "native" : `token:${asset.identifier}`; }
function cost(value: unknown): boolean { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 64; }
function httpStatus(value: unknown): boolean { return typeof value === "number" && Number.isSafeInteger(value) && value >= 100 && value <= 599; }
function anchor(value: unknown, required: boolean): boolean { return required ? uint256(value) : value === null; }
function uint256(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try { return parseAtomic(value) <= MAX_UINT256; } catch { return false; }
}
function invalid(message: string): never { throw new ApnError("APN_INVALID_INPUT", message); }
