export declare const SUNSWAP_TRON_CHAIN_ID: 728126428;
export declare const SUNSWAP_TRON_CHAIN: "tron:00000000000000001ebf88508a03865c71d452e25f4d51194196a1d22b6653dc";
export declare const SUNSWAP_WTRX: "TNUC9Qb1rRpS5CbWLmNMxXBjyFoydXjWFR";
export declare const SUNSWAP_USDT: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
export declare const SUNSWAP_V2_ROUTER: "TKzxdSv2FZKQrEqkKVgp5DcwEXBEKMg2Ax";
export declare const SUNSWAP_V2_FACTORY: "TKWJdrQkqHisa1X8HUdHEfREvTzw4pMAaY";
export declare const SUNSWAP_V2_WTRX_USDT_PAIR: "TFGDbUyP8xez44C76fin3bn3Ss6jugoUwJ";
/** Frozen head drift, in 3-second TRON blocks, between the recorded quote block and every later read. */
export declare const SUNSWAP_MAX_HEAD_DRIFT_BLOCKS: 10;
/** keccak256(wallet/getcontractinfo.runtimecode), equal to wallet/getcontract.code_hash at pin time. */
export declare const SUNSWAP_V2_CODE_HASHES: Readonly<{
    router: "cb5fd0396849833189158afd71529ee326e7d65e8f852d1b510b520bc16a3fb5";
    factory: "4d942d934b574c09244bf6876f248e0cbac1fa3d18128e8efcb82aa6b234b1fe";
    pair: "41625dc36ebfc3d0d2d89132975e84ad64738f2b4ee892f4561cbf33796d14d8";
    wrappedNative: "12573415957a15017dd28752d528e7de25262abd102afd3f5d0529909c3dc03e";
    usdt: "99bb60e56b4cd2642c6847e372b18b6e0f9514229e3086d3a042d60a4c7b78a9";
}>;
export declare const SUNSWAP_PIN_CATALOG: Readonly<{
    schemaVersion: "apn.sunswap-tron-v2-pins.v1";
    chainId: 728126428;
    chain: "tron:00000000000000001ebf88508a03865c71d452e25f4d51194196a1d22b6653dc";
    router: Readonly<{
        address: "TKzxdSv2FZKQrEqkKVgp5DcwEXBEKMg2Ax";
        contractName: "UniswapV2Router02";
        codeHash: "cb5fd0396849833189158afd71529ee326e7d65e8f852d1b510b520bc16a3fb5";
        factory: "TKWJdrQkqHisa1X8HUdHEfREvTzw4pMAaY";
        wrappedNative: "TNUC9Qb1rRpS5CbWLmNMxXBjyFoydXjWFR";
    }>;
    factory: Readonly<{
        address: "TKWJdrQkqHisa1X8HUdHEfREvTzw4pMAaY";
        contractName: "UniswapV2Factory";
        codeHash: "4d942d934b574c09244bf6876f248e0cbac1fa3d18128e8efcb82aa6b234b1fe";
    }>;
    pair: Readonly<{
        address: "TFGDbUyP8xez44C76fin3bn3Ss6jugoUwJ";
        token0: "TNUC9Qb1rRpS5CbWLmNMxXBjyFoydXjWFR";
        token1: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
        codeHash: "41625dc36ebfc3d0d2d89132975e84ad64738f2b4ee892f4561cbf33796d14d8";
        lpFeeNumerator: 997;
        lpFeeDenominator: 1000;
    }>;
    wrappedNative: Readonly<{
        address: "TNUC9Qb1rRpS5CbWLmNMxXBjyFoydXjWFR";
        contractName: "WTRX";
        symbol: "WTRX";
        decimals: 6;
        codeHash: "12573415957a15017dd28752d528e7de25262abd102afd3f5d0529909c3dc03e";
    }>;
    usdt: Readonly<{
        address: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
        contractName: "TetherToken";
        symbol: "USDT";
        decimals: 6;
        codeHash: "99bb60e56b4cd2642c6847e372b18b6e0f9514229e3086d3a042d60a4c7b78a9";
    }>;
    path: readonly ("TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t" | "TNUC9Qb1rRpS5CbWLmNMxXBjyFoydXjWFR")[];
    swapFunction: "swapExactETHForTokens(uint256,address[],address,uint256)";
    swapSelector: "7ff36ab5";
    quoteFunction: "getAmountsOut(uint256,address[])";
    reservesFunction: "getReserves()";
    maxHeadDriftBlocks: 10;
    pinEvidence: Readonly<{
        verifiedAt: "2026-09-18T04:16:23.000Z";
        verifiedAtBlock: "86344275";
        methods: readonly string[];
        checks: readonly string[];
    }>;
    quoteSource: "onchain_router_getAmountsOut_and_pair_getReserves.v1";
    encodingPolicy: "local-abi-v2-swapExactETHForTokens-owner-recipient.v1";
}>;
export declare const SUNSWAP_PIN_CATALOG_SHA256 = "4c56cd68c83ff0bfcfea3fa6a818ba34ed70b1918ed0a209c37f39e324d5967d";
export type SunSwapPinCatalog = typeof SUNSWAP_PIN_CATALOG;
export type SunSwapPinnedContract = keyof typeof SUNSWAP_V2_CODE_HASHES;
export declare const SUNSWAP_PINNED_CONTRACTS: readonly {
    readonly role: SunSwapPinnedContract;
    readonly address: string;
}[];
export declare function loadSunSwapPinCatalog(value?: unknown): SunSwapPinCatalog;
