import { loadAllowlistInventory } from "../allowlist-inventory.js";
import { AssetPortfolioReader, type AssetPortfolio, type PortfolioAccount, type PortfolioRowStatus } from "../asset-portfolio-reader.js";
import { ApnError } from "../errors.js";
import type { RuntimeContext } from "../runtime.js";
import { canonicalProfile } from "../wallet-policy.js";
import { EvmPortfolioPort } from "./evm-reader.js";
import type { PortfolioHttpPort } from "./https.js";
import { portfolioEndpoint, portfolioNetworkRpc, type PortfolioFamily } from "./registry.js";
import { SolanaPortfolioPort } from "./solana-reader.js";
import { TronPortfolioPort } from "./tron-reader.js";

export interface PortfolioDependencies {
  /** Owner overrides (`APN_*_RPC_URL`); an unset or empty variable selects the pinned keyless default. */
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly http: PortfolioHttpPort;
  /** Retry pause. Networks retry concurrently, so this must not register a per-wait process signal listener. */
  readonly wait: (milliseconds: number) => Promise<"elapsed" | "interrupted">;
}

export async function portfolioPause(milliseconds: number): Promise<"elapsed"> {
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
  return "elapsed";
}

/** Read-only: resolves public profile accounts under the profile lock, then reads every list network without holding it. */
export async function readProfilePortfolio(context: RuntimeContext, profileInput: string): Promise<unknown> {
  const profile = canonicalProfile(profileInput);
  const dependencies = context.portfolio;
  if (dependencies === undefined) throw new ApnError("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "The portfolio reader is unavailable.");
  const inventory = loadAllowlistInventory();
  if (inventory.networks.some((network) => portfolioNetworkRpc(network.chain)?.family !== network.family)) {
    throw new ApnError("APN_INTERNAL", "The portfolio RPC registry does not match the frozen list networks.");
  }
  await context.ready();
  const profileHash = context.state.profileHash(profile);
  const accounts = await context.state.withLocks([`profile:${profileHash}`], async () => await profileAccounts(context, profile, profileHash));
  const reader = new AssetPortfolioReader({ evm: new EvmPortfolioPort(dependencies.http), solana: new SolanaPortfolioPort(dependencies.http),
    tron: new TronPortfolioPort(dependencies.http) }, () => context.clock.now(), dependencies.wait);
  const portfolio = await reader.read({ inventory, accounts,
    endpoint: (chain) => portfolioEndpoint(chain, dependencies.environment) });
  return publicPortfolio(profile, portfolio);
}

async function profileAccounts(context: RuntimeContext, profile: string, profileHash: string): Promise<Record<PortfolioFamily, PortfolioAccount>> {
  const chainAccounts = context.chainAccounts;
  if (chainAccounts === undefined) throw new ApnError("APN_PROVIDER_UNAVAILABLE", "Chain custody storage is unavailable.");
  const provider = await context.state.loadProviderProfile(profileHash);
  const wallet = await context.state.loadWallet(profileHash);
  // External EVM wallets expose provider-specific account semantics; they are reported, never guessed.
  const evm: PortfolioAccount = provider !== null && provider.provider_id !== "local"
    ? { kind: "unsupported", reason: "external_provider_profile" }
    : wallet === null ? { kind: "none" } : { kind: "account", address: wallet.address };
  const [solana, tron] = await Promise.all([chainAccounts.account(profile, "solana"), chainAccounts.account(profile, "tron")]);
  return { evm, solana: solana === null ? { kind: "none" } : { kind: "account", address: solana.address },
    tron: tron === null ? { kind: "none" } : { kind: "account", address: tron.address } };
}

function publicPortfolio(profile: string, portfolio: AssetPortfolio): unknown {
  const rows = portfolio.networks.flatMap((network) => network.rows);
  const count = (status: PortfolioRowStatus): number => rows.filter((row) => row.status === status).length;
  return {
    profile, read_only: true,
    dataset: { version: portfolio.datasetVersion, sha256: portfolio.datasetSha256 },
    rpc_calls_total: portfolio.rpcCallsTotal,
    summary: { networks: portfolio.networks.length, rows: rows.length, ok: count("ok"), unavailable: count("unavailable"),
      no_account: count("no_account"), rpc_not_configured: count("rpc_not_configured") },
    networks: portfolio.networks.map((network) => ({
      chain: network.chain, name: network.name, family: network.family, account: network.account,
      endpoint: network.endpoint,
      rpc: { mode: network.mode, calls: network.rpcCalls, attempts: network.attempts, methods: network.methods, retried: network.retried },
      provenance: { block: network.block, slot: network.slot, observed_at: network.observedAt },
      rows: network.rows.map((row) => ({ symbol: row.symbol, kind: row.kind, contract: row.contract, decimals: row.decimals,
        status: row.status, atomic: row.atomic, display: row.display,
        ...(row.reason === null ? {} : { reason: row.reason }), ...(row.httpStatus === null ? {} : { http_status: row.httpStatus }) })),
    })),
    proof_class: "chain_verified_public_read",
    next_actions: [],
  };
}
