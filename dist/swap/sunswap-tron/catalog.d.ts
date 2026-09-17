export declare const SUNSWAP_TRON_CHAIN_ID: 728126428;
export declare const SUNSWAP_TRON_CHAIN: "tron:00000000000000001ebf88508a03865c71d452e25f4d51194196a1d22b6653dc";
export declare const SUNSWAP_NATIVE_TRX: "T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb";
export declare const SUNSWAP_USDT: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
export declare const SUNSWAP_V4_UNIVERSAL_ROUTER: "TQqgNg13s2DjvXhW1ky4v6TsR8wZGvb7Y4";
export declare const SUNSWAP_V4_POOL_MANAGER: "TVjuTE3V5bMVdpfNhid8kD2v35T2k1u1Br";
export declare const SUNSWAP_PERMIT2: "TTJxU3P8rHycAyFY4kVtGNfmnMH4ezcuM9";
export declare const SUNSWAP_QUOTE_URL: "https://open.sun.io/apiv2/quote/swap/routingInV2";
export declare const SUNSWAP_PIN_CATALOG: Readonly<{
    schemaVersion: "apn.sunswap-tron-pins.v1";
    chainId: 728126428;
    chain: "tron:00000000000000001ebf88508a03865c71d452e25f4d51194196a1d22b6653dc";
    router: "TQqgNg13s2DjvXhW1ky4v6TsR8wZGvb7Y4";
    poolManager: "TVjuTE3V5bMVdpfNhid8kD2v35T2k1u1Br";
    permit2: "TTJxU3P8rHycAyFY4kVtGNfmnMH4ezcuM9";
    nativeTrx: "T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb";
    usdt: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
    quoteUrl: "https://open.sun.io/apiv2/quote/swap/routingInV2";
    sources: readonly (Readonly<{
        url: "https://docs.sun.io/protocols/universal-router/reference/functions-and-command/";
        sha256: "9e84195ee7ab8fb8141233df87400b4dbdad3a4ad772537eb26b2c4d0655538b";
    }> | Readonly<{
        url: "https://docs.sun.io/protocols/smart-router/reference/calculation-service/";
        sha256: "c48525943912904562ce619626c41ed39395f99b1ca850376a3b109e9f1e6632";
    }>)[];
    researchVersions: Readonly<{
        universalRouterSdk: "1.1.1";
        permit2: "1.0.0";
        sunKit: "1.2.0";
        tronWeb: "6.2.1";
    }>;
    installedTronWebVersion: "6.5.0";
    encodingPolicy: "official-universal-router-v2-exact-input-only.v1";
}>;
export declare const SUNSWAP_PIN_CATALOG_SHA256 = "c92ea3f303452e28ffaf30feb7b68e55185bfe3d29cdf188e17ab2f6caf4eb1a";
export type SunSwapPinCatalog = typeof SUNSWAP_PIN_CATALOG;
export declare function loadSunSwapPinCatalog(value?: unknown): SunSwapPinCatalog;
