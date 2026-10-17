import { type MetaMaskGaslessChainId, type MetaMaskGaslessDeployment } from "./model.js";
export { MM_CHAINS } from "./model.js";
export declare const MM_RPC_ENV: Readonly<Record<MetaMaskGaslessChainId, string>>;
export declare const MM_SENTINEL_SLUG: Readonly<Record<MetaMaskGaslessChainId, string>>;
/** Static source-correlated input, never current account or mainnet payment acceptance. */
export declare function mmRegistry(chainId: number): MetaMaskGaslessDeployment;
