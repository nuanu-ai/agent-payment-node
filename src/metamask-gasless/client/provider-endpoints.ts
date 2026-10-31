import type { MetaMaskGaslessChainId } from "../model.js";
import { MM_SENTINEL_SLUG } from "../registry.js";

/** The exact provider reads the helper's network policy admits and a refusal names; no other URL is used for them. */
export const MM_SERVER_WALLET_NETWORKS_ENDPOINT = "https://agentic-mimir-service.api.cx.metamask.io/v1/supportedNetworks";
export const MM_SENTINEL_NETWORKS_ENDPOINT = "https://agentic-proxy.workers.cx.metamask.io/proxy/prd/tx-sentinel-ethereum-mainnet/networks";
export const mmSentinelQuoteEndpoint = (chainId: MetaMaskGaslessChainId): string =>
  `https://agentic-proxy.workers.cx.metamask.io/proxy/prd/tx-sentinel-${MM_SENTINEL_SLUG[chainId]}`;
/** The session project's server-wallet list, written with its id as a placeholder: a refusal never shows the id itself. */
export const MM_PROJECT_WALLETS_ENDPOINT = "https://agentic-mimir-service.api.cx.metamask.io/v1/projects/{projectId}/wallets";
export const mmProjectWalletsUrl = (projectId: string): string =>
  MM_PROJECT_WALLETS_ENDPOINT.replace("{projectId}", encodeURIComponent(projectId));
