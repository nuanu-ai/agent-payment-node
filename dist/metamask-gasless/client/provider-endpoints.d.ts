import type { MetaMaskGaslessChainId } from "../model.js";
/** The exact provider reads the helper's network policy admits and a refusal names; no other URL is used for them. */
export declare const MM_SERVER_WALLET_NETWORKS_ENDPOINT = "https://agentic-mimir-service.api.cx.metamask.io/v1/supportedNetworks";
export declare const MM_SENTINEL_NETWORKS_ENDPOINT = "https://agentic-proxy.workers.cx.metamask.io/proxy/prd/tx-sentinel-ethereum-mainnet/networks";
export declare const mmSentinelQuoteEndpoint: (chainId: MetaMaskGaslessChainId) => string;
