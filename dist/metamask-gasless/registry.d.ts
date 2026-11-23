import type { Address } from "../model.js";
import { type MetaMaskGaslessChainId, type MetaMaskGaslessDeployment, type MetaMaskGaslessDeploymentRow } from "./model.js";
export { MM_CHAINS } from "./model.js";
export declare const MM_RPC_ENV: Readonly<Record<MetaMaskGaslessChainId, string>>;
export declare const MM_SENTINEL_SLUG: Readonly<Record<MetaMaskGaslessChainId, string>>;
export type MetaMaskGaslessSymbol = "USDC" | "USDT";
/** The rows in chain order, then in their evidence input's order. */
export declare const MM_DEPLOYMENTS: readonly MetaMaskGaslessDeployment[];
/** The facts every row of one chain shares; a chain with several tokens differs only in its token fields. */
export type MetaMaskGaslessChainFacts = Pick<MetaMaskGaslessDeploymentRow, "chainId" | "network" | "finalityTag" | "protocol">;
/**
 * Static source-correlated input, never current account or mainnet payment acceptance. A chain with one token row needs
 * no token; a chain with several (56) needs the transfer token, and an unknown token is refused.
 */
export declare function mmRegistry(chainId: number, token?: string): MetaMaskGaslessDeployment;
/** The tokens a chain's rows name, in registry order. */
export declare function mmChainTokens(chainId: number): readonly Address[];
/** Network, finality tag and protocol pins: the same in every row of the chain, so no token is needed for them. */
export declare function mmChainFacts(chainId: number): MetaMaskGaslessChainFacts;
/**
 * The row a prepared request uses. Its token is present exactly on a chain with several tokens, so each transfer has
 * one canonical request shape and one request hash.
 */
export declare function mmRequestDeployment(request: {
    readonly chainId: number;
    readonly token?: string;
}): MetaMaskGaslessDeployment;
/**
 * The request token field for an owner's optional asset: required on a chain with several tokens; on a chain with one,
 * the asset may only name that token and the request keeps no token field.
 */
export declare function mmRequestToken(chainId: number, asset: string | undefined): {
    readonly token?: Address;
};
/**
 * The row a saved record is observed against. A chain with one row keeps the earlier rule: that row, with the record's
 * own token and pins laid over it (recorded.ts). On a chain with several, the record's own token's row.
 */
export declare function mmRecordRegistry(chainId: number, token: string): MetaMaskGaslessDeployment;
/** A lane token's symbol; a token no row has named is refused, never guessed. */
export declare function mmTokenSymbol(token: string): MetaMaskGaslessSymbol;
