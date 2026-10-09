import type { WrappingSecretPort } from "../../macos-keychain.js";
import { SOLANA_MAINNET_GENESIS } from "./catalog.js";
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
    readonly authenticationExpiresAt: string;
}
/** Plain cryptographic projection only: no private authority, expiry verdict, ledger or sending permission. */
export declare class JupiterHistoricalProjectionReader {
    #private;
    constructor(root: string, wrapping: WrappingSecretPort);
    read(operationId: string): Promise<{
        readonly projection: HistoricalJupiterProjection;
    }>;
}
