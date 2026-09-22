import { SecureStateStore } from "../../secure-state-store.js";
import { type UniswapTokenRoute } from "./token-route.js";
import type { TokenGasEnvelope } from "./token-operation.js";
export declare const UNISWAP_TOKEN_MATERIAL_SCHEMA: "apn.uniswap-token-material.v1";
export interface UniswapTokenMaterial {
    readonly schemaVersion: typeof UNISWAP_TOKEN_MATERIAL_SCHEMA;
    readonly quoteHash: string;
    readonly profile: string;
    readonly account: string;
    readonly route: UniswapTokenRoute;
    readonly expectedOutputAtomic: string;
    readonly approvalCapAtomic: string;
    readonly allowanceAtPrepare: string;
    readonly approvalGas: TokenGasEnvelope;
    readonly swapGas: TokenGasEnvelope;
    readonly cleanupGas: TokenGasEnvelope;
    readonly maximumNativeDebitWei: string;
    readonly policyDigest: string;
    readonly mechanismDigest: string;
    readonly blockNumber: string;
    readonly blockHash: string;
    readonly createdAt: string;
}
export declare function createUniswapTokenMaterial(input: Omit<UniswapTokenMaterial, "schemaVersion" | "quoteHash">): UniswapTokenMaterial;
export declare function validateUniswapTokenMaterial(value: unknown, mode?: "input" | "stored"): UniswapTokenMaterial;
export declare class SavedUniswapTokenMaterialStore extends SecureStateStore {
    save(value: UniswapTokenMaterial): Promise<UniswapTokenMaterial>;
    load(hash: string): Promise<UniswapTokenMaterial | null>;
    private path;
}
