import { type SolanaRpcPort } from "../../solana/rpc.js";
import { type JupiterV1QuoteResponse, type JupiterV1RawBuildResponse } from "./v1-codec.js";
import { type JupiterV1SemanticAccount, type JupiterV1AddressTable, type JupiterV1ResolvedMaterial, type JupiterV1CompiledAccount, type JupiterV1QuoteRpcLifetime } from "./v1-material.js";
import { type JupiterV1RouteId } from "./v1-route-config.js";
export declare class JupiterV1MaterialResolver {
    private readonly rpc;
    constructor(rpc: SolanaRpcPort);
    /**
     * A new quote passes `freezeRpcLifetime`: the configured RPC supplies the blockhash after the account reads, and the one
     * fee/height/rent read prices that exact message. A saved quote passes its `frozenRpcLifetime` and must rebuild the same bytes.
     */
    resolve(payer: string, quote: JupiterV1QuoteResponse, build: JupiterV1RawBuildResponse, maximumNativeExpenseLamports: string, frozenRpcLifetime?: JupiterV1QuoteRpcLifetime, expectedRouteId?: JupiterV1RouteId, freezeRpcLifetime?: boolean): Promise<JupiterV1ResolvedMaterial>;
    /**
     * Requests of at most eight keys (readSolanaAccountPages), every page pinned to the quote's context slot as its
     * minContextSlot; each row keeps the slot its page answered at, and the guard requires every row at or after the quote.
     */
    private read;
}
export declare function decodeJupiterV1AddressTable(account: JupiterV1SemanticAccount): JupiterV1AddressTable;
export declare function assembleJupiterV1(payer: string, build: JupiterV1RawBuildResponse, tables: readonly JupiterV1AddressTable[], frozenRpcLifetime?: JupiterV1QuoteRpcLifetime): {
    transactionBase64: import("@solana/kit").Base64EncodedWireTransaction;
    transactionHash: string;
    messageBase64: string;
    messageHash: string;
    compiledAccounts: JupiterV1CompiledAccount[];
    lookupBindingDigest: string;
};
