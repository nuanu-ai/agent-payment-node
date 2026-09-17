import { type SwapProtocolRegistry } from "./protocol-registry.js";
import { type SwapMechanismPin } from "./pin.js";
export declare const UNISWAP_PIN_CATALOG_SCHEMA: "apn.uniswap-official-pin-catalog.v1";
export declare const UNISWAP_CHAIN_ID: 1;
export declare const UNISWAP_CHAIN: "eip155:1";
export declare const UNISWAP_NATIVE: "0x0000000000000000000000000000000000000000";
export declare const UNISWAP_USDC: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
export declare const UNISWAP_ROUTER: "0x0542093271A31f6FC1DADB232bd59eeb27de780F";
export declare const UNISWAP_PERMIT2: "0x000000000022D473030F116dDEE9F6B43aC78BA3";
export declare const UNISWAP_API: "https://trade-api.gateway.uniswap.org/v1";
export declare const UNISWAP_ROUTER_VERSION: "2.2.0";
export declare const UNISWAP_PIN_CATALOG_DIGEST: "7e646f00f18cf99e4da50682eff06d901b6b6439a8681ec5e07adcb7980893f1";
export interface UniswapOfficialPinCatalog {
    readonly schemaVersion: typeof UNISWAP_PIN_CATALOG_SCHEMA;
    readonly catalogVersion: string;
    readonly mechanismPin: SwapMechanismPin;
    readonly api: {
        readonly baseUrl: string;
        readonly paths: readonly string[];
        readonly universalRouterVersionHeader: string;
    };
    readonly pair: {
        readonly chainId: 1;
        readonly chain: typeof UNISWAP_CHAIN;
        readonly type: "EXACT_INPUT";
        readonly nativeInput: typeof UNISWAP_NATIVE;
        readonly outputToken: typeof UNISWAP_USDC;
        readonly permitAmount: "EXACT";
        readonly tokenApprovalApplicable: false;
    };
    readonly sdkReleases: Readonly<Record<string, {
        readonly version: string;
        readonly gitHead: string;
        readonly integrity: string;
    }>>;
    readonly officialSources: readonly {
        readonly url: string;
        readonly commit: string | null;
        readonly sha256: string;
    }[];
    readonly catalogDigest: string;
}
export declare const UNISWAP_OFFICIAL_PIN_CATALOG: UniswapOfficialPinCatalog;
export declare const UNISWAP_MECHANISM_PIN: SwapMechanismPin;
/** Presence records official identity only. Owners must still admit both assets under a sealed policy. */
export declare const UNISWAP_OFFICIAL_PROTOCOL_REGISTRY: SwapProtocolRegistry;
export declare function validateUniswapOfficialPinCatalog(value: unknown): UniswapOfficialPinCatalog;
