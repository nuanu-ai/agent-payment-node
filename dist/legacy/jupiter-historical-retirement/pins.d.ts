/**
 * Frozen read-only identities of the Jupiter historical retirement records (`jupiter-historical-retirements/`).
 * Only 0.5.39–0.5.44 could write such a record, only for these three operations. All three closed as
 * `expired_unlanded` on 0.5.43 (owner check 2026-10-17), so nothing writes or executes against them any more.
 * The values are literals, not live route constants, so a later Jupiter route change cannot break the reader.
 */
export declare const HISTORICAL_JUPITER_IDS: readonly ["67cec83fd91f78acb9decf9ef89dcf1f95c9551dcdf996d0a840db4c48cd8457", "ea25d97d0da057bfab9a6b6ade2b5799d8b81333ab99c33c793a75c0a8bde5ee", "ed04535cb343db8bd5b7871b8725492c395206ccfe339661d15817c2ead7a738"];
export declare const HISTORICAL_JUPITER_PAYER = "GtZc9wfM98Peee7dJrL1dYE54sWU8zA8gYeo9VUfR9ki";
export declare const HISTORICAL_JUPITER_ACCOUNT_BINDING = "6300729b2c444cb67eaf0d75a49f8dd2eb39ea095a7dfdf20c8bf3279da066a1";
export declare const HISTORICAL_JUPITER_OWNER_PROFILE = "3b39c575c04b7b84570f0b98c721accfb75743d1aa3fe0275c54e8931d366193";
export declare const HISTORICAL_SOLANA_GENESIS: "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
export declare const HISTORICAL_SOLANA_USDC_MINT: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
/** The original `whirlpool-v1-83-sol-usdc` route the three operations were prepared under. */
export declare const HISTORICAL_JUPITER_MECHANISM_PIN: Readonly<{
    schemaVersion: "apn.swap-mechanism-pin.v1";
    protocolFamily: "jupiter_solana";
    networkFamily: "solana";
    chain: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
    protocolVersion: "jup6-route-v1-whirlpool.1";
    constructorKind: "builder_api";
    constructorIdentity: "https://api.jup.ag/swap/v1/swap-instructions";
    constructorVersion: "1.0.0";
    routerProgramIdentity: "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";
    auxiliaryContractProgramIdentities: readonly string[];
    quoteSchemaVersion: "jupiter-v1-exact-in-whirlpool.1";
    transactionSchemaVersion: "v0-jup6-route-whirlpool-wrap-close.1";
    validationPolicyIdentity: "apn.jupiter-v1.runtime-pinned-sol-usdc";
    validationPolicyVersion: "1.0.0";
}>;
export declare const HISTORICAL_JUPITER_MECHANISM_DIGEST = "ad61f7c981282e494684f41649552531437fa31f6db0d18dee1aa4d7c6b96b92";
export declare const HISTORICAL_JUPITER_REGISTRY_DIGEST = "b54b3d63bd62557dbbf25d290a7ccade678562976de6b06eafa79e7d2be17623";
export declare const HISTORICAL_JUPITER_REGISTRY_VERSION = "jupiter-v1-whirlpool.2026-10-07";
