import { canonicalJson, sha256 } from "../../canonical.js";
import { ApnError } from "../../errors.js";
import { tronAddress } from "../../tron/codec.js";
export const SUNSWAP_TRON_CHAIN_ID = 728126428;
export const SUNSWAP_TRON_CHAIN = "tron:00000000000000001ebf88508a03865c71d452e25f4d51194196a1d22b6653dc";
export const SUNSWAP_WTRX = "TNUC9Qb1rRpS5CbWLmNMxXBjyFoydXjWFR";
export const SUNSWAP_USDT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
export const SUNSWAP_V2_ROUTER = "TKzxdSv2FZKQrEqkKVgp5DcwEXBEKMg2Ax";
export const SUNSWAP_V2_FACTORY = "TKWJdrQkqHisa1X8HUdHEfREvTzw4pMAaY";
export const SUNSWAP_V2_WTRX_USDT_PAIR = "TFGDbUyP8xez44C76fin3bn3Ss6jugoUwJ";
/** Frozen head drift, in 3-second TRON blocks, between the recorded quote block and every later read. */
export const SUNSWAP_MAX_HEAD_DRIFT_BLOCKS = 10;
/** keccak256(wallet/getcontractinfo.runtimecode), equal to wallet/getcontract.code_hash at pin time. */
export const SUNSWAP_V2_CODE_HASHES = Object.freeze({
    router: "cb5fd0396849833189158afd71529ee326e7d65e8f852d1b510b520bc16a3fb5",
    factory: "4d942d934b574c09244bf6876f248e0cbac1fa3d18128e8efcb82aa6b234b1fe",
    pair: "41625dc36ebfc3d0d2d89132975e84ad64738f2b4ee892f4561cbf33796d14d8",
    wrappedNative: "12573415957a15017dd28752d528e7de25262abd102afd3f5d0529909c3dc03e",
    usdt: "99bb60e56b4cd2642c6847e372b18b6e0f9514229e3086d3a042d60a4c7b78a9",
});
export const SUNSWAP_PIN_CATALOG = Object.freeze({
    schemaVersion: "apn.sunswap-tron-v2-pins.v1",
    chainId: SUNSWAP_TRON_CHAIN_ID,
    chain: SUNSWAP_TRON_CHAIN,
    router: Object.freeze({ address: SUNSWAP_V2_ROUTER, contractName: "UniswapV2Router02", codeHash: SUNSWAP_V2_CODE_HASHES.router,
        factory: SUNSWAP_V2_FACTORY, wrappedNative: SUNSWAP_WTRX }),
    factory: Object.freeze({ address: SUNSWAP_V2_FACTORY, contractName: "UniswapV2Factory", codeHash: SUNSWAP_V2_CODE_HASHES.factory }),
    pair: Object.freeze({ address: SUNSWAP_V2_WTRX_USDT_PAIR, token0: SUNSWAP_WTRX, token1: SUNSWAP_USDT, codeHash: SUNSWAP_V2_CODE_HASHES.pair,
        lpFeeNumerator: 997, lpFeeDenominator: 1000 }),
    wrappedNative: Object.freeze({ address: SUNSWAP_WTRX, contractName: "WTRX", symbol: "WTRX", decimals: 6,
        codeHash: SUNSWAP_V2_CODE_HASHES.wrappedNative }),
    usdt: Object.freeze({ address: SUNSWAP_USDT, contractName: "TetherToken", symbol: "USDT", decimals: 6, codeHash: SUNSWAP_V2_CODE_HASHES.usdt }),
    path: Object.freeze([SUNSWAP_WTRX, SUNSWAP_USDT]),
    swapFunction: "swapExactETHForTokens(uint256,address[],address,uint256)",
    swapSelector: "7ff36ab5",
    quoteFunction: "getAmountsOut(uint256,address[])",
    reservesFunction: "getReserves()",
    maxHeadDriftBlocks: SUNSWAP_MAX_HEAD_DRIFT_BLOCKS,
    pinEvidence: Object.freeze({ verifiedAt: "2026-09-18T04:16:23.000Z", verifiedAtBlock: "86344275",
        methods: Object.freeze(["wallet/getcontract", "wallet/getcontractinfo", "wallet/triggerconstantcontract"]),
        checks: Object.freeze(["router.WETH()==WTRX", "router.factory()==factory", "factory.getPair(WTRX,USDT)==pair",
            "factory.getPair(USDT,WTRX)==pair", "pair.token0()==WTRX", "pair.token1()==USDT", "WTRX.symbol()==WTRX",
            "WTRX.decimals()==6", "USDT.symbol()==USDT", "USDT.decimals()==6", "USDT.deprecated()==false",
            "getAmountsOut==997/1000 constant-product formula over getReserves", "code_hash==keccak256(runtimecode)"]) }),
    quoteSource: "onchain_router_getAmountsOut_and_pair_getReserves.v1",
    encodingPolicy: "local-abi-v2-swapExactETHForTokens-owner-recipient.v1",
});
export const SUNSWAP_PIN_CATALOG_SHA256 = "4c56cd68c83ff0bfcfea3fa6a818ba34ed70b1918ed0a209c37f39e324d5967d";
export const SUNSWAP_PINNED_CONTRACTS = Object.freeze([
    { role: "router", address: SUNSWAP_V2_ROUTER }, { role: "factory", address: SUNSWAP_V2_FACTORY },
    { role: "pair", address: SUNSWAP_V2_WTRX_USDT_PAIR }, { role: "wrappedNative", address: SUNSWAP_WTRX },
    { role: "usdt", address: SUNSWAP_USDT },
]);
export function loadSunSwapPinCatalog(value = SUNSWAP_PIN_CATALOG) {
    if (!sameShape(value, SUNSWAP_PIN_CATALOG) || canonicalJson(value) !== canonicalJson(SUNSWAP_PIN_CATALOG) ||
        sha256(canonicalJson(value)) !== SUNSWAP_PIN_CATALOG_SHA256) {
        throw new ApnError("APN_STATE_CORRUPT", "SunSwap pins conflict with the frozen on-chain verified catalog.");
    }
    for (const { address } of SUNSWAP_PINNED_CONTRACTS) {
        if (tronAddress(address) !== address)
            throw new ApnError("APN_STATE_CORRUPT", "A frozen SunSwap address is not canonical.");
    }
    return SUNSWAP_PIN_CATALOG;
}
function sameShape(value, expected) {
    if (Array.isArray(expected)) {
        if (!Array.isArray(value) || value.length !== expected.length)
            return false;
        for (let index = 0; index < expected.length; index++)
            if (!Object.hasOwn(value, index) || !sameShape(value[index], expected[index]))
                return false;
        return true;
    }
    if (expected !== null && typeof expected === "object") {
        if (value === null || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype)
            return false;
        const actualKeys = Object.keys(value), expectedKeys = Object.keys(expected);
        return actualKeys.length === expectedKeys.length && expectedKeys.every((key) => Object.hasOwn(value, key) &&
            sameShape(value[key], expected[key]));
    }
    return typeof value === typeof expected;
}
//# sourceMappingURL=catalog.js.map