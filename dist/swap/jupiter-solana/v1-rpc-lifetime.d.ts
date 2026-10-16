import { type SolanaRpcPort } from "../../solana/rpc.js";
import { type JupiterV1QuoteRpcLifetime, type JupiterV1SemanticAccount } from "./v1-material.js";
/** Remaining blocks a freshly frozen quote lifetime must leave at its own fee/height read. */
export declare const JUPITER_V1_RPC_LIFETIME_WINDOW: Readonly<{
    minimumRemainingBlocks: 100;
    maximumRemainingBlocks: 151;
}>;
/**
 * Quote construction only, before any saved quote, consent, lease or signature: the configured RPC supplies the frozen
 * blockhash from a bank at least as recent as every account the quote read. The official build's own blockhash is never
 * signed, so no second official build is requested for a fresher one.
 */
export declare function readJupiterV1QuoteRpcLifetime(rpc: Pick<SolanaRpcPort, "call" | "originHash">, accounts: readonly Pick<JupiterV1SemanticAccount, "slot">[]): Promise<JupiterV1QuoteRpcLifetime>;
/** The fee/height read that prices the frozen message must leave a bounded, plausible lifetime. */
export declare function assertJupiterV1RpcLifetimeWindow(lifetime: JupiterV1QuoteRpcLifetime, height: string): void;
