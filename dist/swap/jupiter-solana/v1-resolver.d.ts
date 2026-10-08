import { type SolanaRpcPort } from "../../solana/rpc.js";
import { type JupiterV1QuoteResponse, type JupiterV1RawBuildResponse } from "./v1-codec.js";
import { type JupiterV1SemanticAccount, type JupiterV1AddressTable, type JupiterV1ResolvedMaterial, type JupiterV1CompiledAccount, type JupiterV1QuoteRpcLifetime } from "./v1-material.js";
export declare class JupiterV1MaterialResolver {
    private readonly rpc;
    constructor(rpc: SolanaRpcPort);
    refreshQuoteBuild(material: JupiterV1ResolvedMaterial, build: JupiterV1RawBuildResponse, useRpcLifetime?: boolean): Promise<JupiterV1ResolvedMaterial>;
    resolve(payer: string, quote: JupiterV1QuoteResponse, build: JupiterV1RawBuildResponse, maximumNativeExpenseLamports?: string, frozenRpcLifetime?: JupiterV1QuoteRpcLifetime): Promise<JupiterV1ResolvedMaterial>;
    private read;
    private readProgramData;
    private readProgramDataChunk;
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
