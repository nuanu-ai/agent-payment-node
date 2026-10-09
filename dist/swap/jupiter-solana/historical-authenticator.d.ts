import type { WrappingSecretPort } from "../../macos-keychain.js";
import { SOLANA_MAINNET_GENESIS } from "./catalog.js";
export declare const HISTORICAL_JUPITER_IDS: readonly ["67cec83fd91f78acb9decf9ef89dcf1f95c9551dcdf996d0a840db4c48cd8457", "ea25d97d0da057bfab9a6b6ade2b5799d8b81333ab99c33c793a75c0a8bde5ee", "ed04535cb343db8bd5b7871b8725492c395206ccfe339661d15817c2ead7a738"];
declare const brand: unique symbol;
export interface HistoricalJupiterMaterialAuthority {
    readonly [brand]: true;
}
export interface HistoricalJupiterProjection {
    readonly schemaVersion: "apn.jupiter-historical-authentication.v1";
    readonly operationId: string;
    readonly operationIntegrityHash: string;
    readonly rootBinding: string;
    readonly ownerProfileHash: string;
    readonly accountBindingHash: string;
    readonly payer: string;
    readonly policyDigest: string;
    readonly activationDigest: string;
    readonly originalBindingHash: string;
    readonly originalMaterialDigest: string;
    readonly freshMaterialDigest: string;
    readonly markerHash: string;
    readonly principalLamports: string;
    readonly maximumNativeExpenseLamports: string;
    readonly freshMaximumNativeExpenseLamports: string;
    readonly networkFeeLamports: string;
    readonly tokenAccountRentLamports: string;
    readonly genesis: typeof SOLANA_MAINNET_GENESIS;
    readonly blockhash: string;
    readonly lastValidBlockHeight: string;
    readonly signature: string;
    readonly rawPayloadHash: string;
    readonly messageHash: string;
    readonly freshBlockhash: string;
    readonly freshLastValidBlockHeight: string;
    readonly heightBinding: "authenticated_material_not_signed_message";
    readonly originalQuoteRpcLifetime: import("./v1-material.js").JupiterV1QuoteRpcLifetime | null;
    readonly lifetimeProvenance: "configured_mainnet_rpc_before_quote_freeze" | "original_provider_build";
    readonly ordinaryRecentBlockhash: true;
    readonly authenticatedAt: string;
}
/** No financial authority: only exact historical material authenticity, never expiry or past absence. */
export declare class JupiterHistoricalAuthenticator {
    #private;
    constructor(root: string, wrapping: WrappingSecretPort);
    authenticate(operationId: string): Promise<{
        readonly projection: HistoricalJupiterProjection;
        readonly authority: HistoricalJupiterMaterialAuthority;
    }>;
    /** Instance/root-bound one-use authentication evidence; never permission to change a ledger or send. */
    consume(authority: HistoricalJupiterMaterialAuthority, operationId: string): Promise<HistoricalJupiterProjection>;
}
export {};
