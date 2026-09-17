import { canonicalJson, sha256 } from "../../canonical.js";
import { ApnError } from "../../errors.js";
import { tronAddress } from "../../tron/codec.js";
export const SUNSWAP_TRON_CHAIN_ID = 728126428;
export const SUNSWAP_TRON_CHAIN = "tron:00000000000000001ebf88508a03865c71d452e25f4d51194196a1d22b6653dc";
export const SUNSWAP_NATIVE_TRX = "T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb";
export const SUNSWAP_USDT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
export const SUNSWAP_V4_UNIVERSAL_ROUTER = "TQqgNg13s2DjvXhW1ky4v6TsR8wZGvb7Y4";
export const SUNSWAP_V4_POOL_MANAGER = "TVjuTE3V5bMVdpfNhid8kD2v35T2k1u1Br";
export const SUNSWAP_PERMIT2 = "TTJxU3P8rHycAyFY4kVtGNfmnMH4ezcuM9";
export const SUNSWAP_QUOTE_URL = "https://open.sun.io/apiv2/quote/swap/routingInV2";
export const SUNSWAP_PIN_CATALOG = Object.freeze({
    schemaVersion: "apn.sunswap-tron-pins.v1",
    chainId: SUNSWAP_TRON_CHAIN_ID,
    chain: SUNSWAP_TRON_CHAIN,
    router: SUNSWAP_V4_UNIVERSAL_ROUTER,
    poolManager: SUNSWAP_V4_POOL_MANAGER,
    permit2: SUNSWAP_PERMIT2,
    nativeTrx: SUNSWAP_NATIVE_TRX,
    usdt: SUNSWAP_USDT,
    quoteUrl: SUNSWAP_QUOTE_URL,
    sources: Object.freeze([
        Object.freeze({ url: "https://docs.sun.io/protocols/universal-router/reference/functions-and-command/", sha256: "9e84195ee7ab8fb8141233df87400b4dbdad3a4ad772537eb26b2c4d0655538b" }),
        Object.freeze({ url: "https://docs.sun.io/protocols/smart-router/reference/calculation-service/", sha256: "c48525943912904562ce619626c41ed39395f99b1ca850376a3b109e9f1e6632" }),
    ]),
    researchVersions: Object.freeze({ universalRouterSdk: "1.1.1", permit2: "1.0.0", sunKit: "1.2.0", tronWeb: "6.2.1" }),
    installedTronWebVersion: "6.5.0",
    encodingPolicy: "official-universal-router-v2-exact-input-only.v1",
});
export const SUNSWAP_PIN_CATALOG_SHA256 = "c92ea3f303452e28ffaf30feb7b68e55185bfe3d29cdf188e17ab2f6caf4eb1a";
export function loadSunSwapPinCatalog(value = SUNSWAP_PIN_CATALOG) {
    if (!sameShape(value, SUNSWAP_PIN_CATALOG) || canonicalJson(value) !== canonicalJson(SUNSWAP_PIN_CATALOG) ||
        sha256(canonicalJson(value)) !== SUNSWAP_PIN_CATALOG_SHA256) {
        throw new ApnError("APN_STATE_CORRUPT", "SunSwap pins conflict with the frozen official catalog.");
    }
    for (const address of [SUNSWAP_NATIVE_TRX, SUNSWAP_USDT, SUNSWAP_V4_UNIVERSAL_ROUTER, SUNSWAP_V4_POOL_MANAGER, SUNSWAP_PERMIT2]) {
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