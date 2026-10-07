import { type SolanaRpcPort } from "../../solana/rpc.js";
import { type JupiterV1QuoteResponse, type JupiterV1RawBuildResponse } from "./v1-codec.js";
import { type JupiterV1SemanticAccount, type JupiterV1AddressTable, type JupiterV1ResolvedMaterial, type JupiterV1CompiledAccount } from "./v1-material.js";
export declare class JupiterV1MaterialResolver {
    private readonly rpc;
    constructor(rpc: SolanaRpcPort);
    resolve(payer: string, quote: JupiterV1QuoteResponse, build: JupiterV1RawBuildResponse, maximumNativeExpenseLamports?: string): Promise<JupiterV1ResolvedMaterial>;
    private read;
    private readProgramData;
}
export declare function decodeJupiterV1AddressTable(account: JupiterV1SemanticAccount): JupiterV1AddressTable;
export declare function assembleJupiterV1(payer: string, build: JupiterV1RawBuildResponse, tables: readonly JupiterV1AddressTable[]): {
    transactionBase64: import("@solana/kit").Base64EncodedWireTransaction;
    transactionHash: string;
    messageBase64: string;
    messageHash: string;
    compiledAccounts: JupiterV1CompiledAccount[];
    lookupBindingDigest: string;
};
