import { existsSync, readFileSync } from "node:fs";
import { canonicalJson, domainHash, exactKeys, isPlainRecord } from "../canonical.js";
import { ApnError } from "../errors.js";
import { compileSwapProtocolRegistry } from "./protocol-registry.js";
import { swapMechanismDigest, validateSwapMechanismPin } from "./pin.js";
export const UNISWAP_PIN_CATALOG_SCHEMA = "apn.uniswap-official-pin-catalog.v1";
export const UNISWAP_CHAIN_ID = 1;
export const UNISWAP_CHAIN = "eip155:1";
export const UNISWAP_NATIVE = "0x0000000000000000000000000000000000000000";
export const UNISWAP_USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
export const UNISWAP_ROUTER = "0x0542093271A31f6FC1DADB232bd59eeb27de780F";
export const UNISWAP_PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
export const UNISWAP_API = "https://trade-api.gateway.uniswap.org/v1";
export const UNISWAP_ROUTER_VERSION = "2.2.0";
export const UNISWAP_PIN_CATALOG_DIGEST = "7e646f00f18cf99e4da50682eff06d901b6b6439a8681ec5e07adcb7980893f1";
const catalogUrl = [new URL("../../data/swap/uniswap-ethereum-2026-09-17.json", import.meta.url),
    new URL("../../../data/swap/uniswap-ethereum-2026-09-17.json", import.meta.url)].find(existsSync);
if (catalogUrl === undefined)
    throw new ApnError("APN_INTERNAL", "Bundled Uniswap official pin catalog is missing.");
const rawCatalog = JSON.parse(readFileSync(catalogUrl, "utf8"));
export const UNISWAP_OFFICIAL_PIN_CATALOG = validateUniswapOfficialPinCatalog(rawCatalog);
export const UNISWAP_MECHANISM_PIN = UNISWAP_OFFICIAL_PIN_CATALOG.mechanismPin;
/** Presence records official identity only. Owners must still admit both assets under a sealed policy. */
export const UNISWAP_OFFICIAL_PROTOCOL_REGISTRY = compileSwapProtocolRegistry({
    registryVersion: UNISWAP_OFFICIAL_PIN_CATALOG.catalogVersion,
    pins: [UNISWAP_MECHANISM_PIN],
});
export function validateUniswapOfficialPinCatalog(value) {
    if (!isPlainRecord(value) || !exactKeys(value, ["schemaVersion", "catalogVersion", "mechanismPin", "api", "pair",
        "sdkReleases", "officialSources", "catalogDigest"]) || value.schemaVersion !== UNISWAP_PIN_CATALOG_SCHEMA ||
        typeof value.catalogVersion !== "string" || typeof value.catalogDigest !== "string")
        invalid();
    const pin = validateSwapMechanismPin(value.mechanismPin);
    if (pin.protocolFamily !== "uniswap_ethereum" || pin.networkFamily !== "evm" || pin.chain !== UNISWAP_CHAIN ||
        pin.protocolVersion !== UNISWAP_ROUTER_VERSION || pin.constructorKind !== "builder_api" ||
        pin.constructorIdentity !== UNISWAP_API || pin.constructorVersion !== "1.0.0" ||
        pin.routerProgramIdentity !== UNISWAP_ROUTER || pin.auxiliaryContractProgramIdentities.length !== 1 ||
        pin.auxiliaryContractProgramIdentities[0] !== UNISWAP_PERMIT2 ||
        pin.quoteSchemaVersion !== "uniswap-trading-quote.1" || pin.transactionSchemaVersion !== "uniswap-trading-swap.1" ||
        pin.validationPolicyIdentity !== "apn.uniswap.ethereum-native-usdc" || pin.validationPolicyVersion !== "1.0.0")
        invalid();
    if (!isPlainRecord(value.api) || !exactKeys(value.api, ["baseUrl", "paths", "universalRouterVersionHeader"]) ||
        value.api.baseUrl !== UNISWAP_API || value.api.universalRouterVersionHeader !== UNISWAP_ROUTER_VERSION ||
        canonicalJson(value.api.paths) !== canonicalJson(["/check_approval", "/quote", "/swap"]))
        invalid();
    if (!isPlainRecord(value.pair) || !exactKeys(value.pair, ["chainId", "chain", "type", "nativeInput", "outputToken",
        "permitAmount", "tokenApprovalApplicable"]) || value.pair.chainId !== 1 || value.pair.chain !== UNISWAP_CHAIN ||
        value.pair.type !== "EXACT_INPUT" || value.pair.nativeInput !== UNISWAP_NATIVE || value.pair.outputToken !== UNISWAP_USDC ||
        value.pair.permitAmount !== "EXACT" || value.pair.tokenApprovalApplicable !== false)
        invalid();
    if (!isPlainRecord(value.sdkReleases) || !Array.isArray(value.officialSources) || value.officialSources.length !== 6)
        invalid();
    const expectedVersions = { "@uniswap/universal-router-sdk": "5.11.1", "@uniswap/router-sdk": "2.11.1",
        "@uniswap/v3-sdk": "3.31.1", "@uniswap/sdk-core": "7.19.0" };
    if (Object.keys(value.sdkReleases).sort().join("\0") !== Object.keys(expectedVersions).sort().join("\0"))
        invalid();
    for (const [name, version] of Object.entries(expectedVersions)) {
        const row = value.sdkReleases[name];
        if (!isPlainRecord(row) || !exactKeys(row, ["version", "gitHead", "integrity"]) || row.version !== version ||
            row.gitHead !== "57f126ee4ae5d435938569ad22c489e4a0262ca2" || typeof row.integrity !== "string" || !row.integrity.startsWith("sha512-"))
            invalid();
    }
    for (const source of value.officialSources)
        if (!isPlainRecord(source) || !exactKeys(source, ["url", "commit", "sha256"]) ||
            typeof source.url !== "string" || (source.commit !== null && (typeof source.commit !== "string" || !/^[a-f0-9]{40}$/u.test(source.commit))) ||
            typeof source.sha256 !== "string" || source.sha256.length < 32)
            invalid();
    const { catalogDigest, ...body } = value;
    if (catalogDigest !== UNISWAP_PIN_CATALOG_DIGEST || catalogDigest !== domainHash(UNISWAP_PIN_CATALOG_SCHEMA, canonicalJson(body)) ||
        swapMechanismDigest(pin) !== swapMechanismDigest(value.mechanismPin))
        invalid();
    return value;
}
function invalid() { throw new ApnError("APN_STATE_CORRUPT", "Bundled Uniswap official pin catalog is invalid or changed."); }
//# sourceMappingURL=uniswap-pin.js.map