/** CCTP V2 Fast from Arbitrum USDC (domain 3). Pins refreshed at safe blocks on 2026-10-09; see reports/.../mm-usdc-bridges/fresh-deployment-pins.json.
 * Primary contracts: https://developers.circle.com/cctp/references/contract-addresses */
import { type Address } from "viem";
export type CircleDestinationChain = 1329 | 59144 | 143;
export declare const CIRCLE_SOURCE_TOKEN: `0x${string}`;
export declare const CIRCLE_MESSENGER: `0x${string}`;
export declare const CIRCLE_TRANSMITTER: `0x${string}`;
export declare const CIRCLE_MINTER: `0x${string}`;
export declare const CIRCLE_IMPLEMENTATION_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
export declare const CIRCLE_TOKEN_IMPLEMENTATION_SLOT = "0x7050c9e0f4ca769c69bd3a8ef740bc37934f8e2c036e5a723fd8ee048ed3f8c3";
/** Protocol data of one destination: chain, CCTP domain, destination USDC, the destination mint gas budget and its RPC.
 * No profile, wallet, recipient or amount: those are per-operation inputs (`--profile`, `--destination-profile`,
 * `--beneficiary`, `--gross-atomic`, `--max-issuer-fee-atomic`, `--min-mint-atomic`). Adding a destination is table data. */
export interface CircleRoute {
    readonly chainId: CircleDestinationChain;
    readonly domain: 16 | 11 | 15;
    readonly token: Address;
    /** `limit`: the chain bills the full signed gas limit (Monad); `used`: gas used. */
    readonly gasBilling: "limit" | "used";
    readonly destinationNativeCap: string;
    readonly rpcEnvironment: string;
    readonly rpcDefault: string;
    /** Blocks one `eth_getLogs` window covers (fromBlock..toBlock inclusive) when finding an external mint. Measured on the
     * default endpoint 2026-10-17: evm-rpc.sei-apis.com allows 2000 blocks, rpc.linea.build a span of 10000, rpc.monad.xyz a
     * span of 100. An endpoint set through `rpcEnvironment` must accept the same window. */
    readonly logRange: number;
}
/** Linea uses rpc.linea.build: linea-rpc.publicnode.com refuses transmitter logs older than about 128 blocks ("archive
 * requests require a personal token"), so an external mint could not be found there. */
export declare const CIRCLE_ROUTES: Readonly<Record<CircleDestinationChain, CircleRoute>>;
export declare function isCircleDestinationChain(chain: unknown): chain is CircleDestinationChain;
export declare function circleRoute(chain: CircleDestinationChain): CircleRoute;
/** The policy mechanism of one destination. The `.v2` reference names protocol shape only, so it admits any profile. */
export declare const circleFundingMechanism: (chain: CircleDestinationChain) => Readonly<{
    provider: "circle-cctp-v2";
    reference: "circle-v2-evm-fast-42161-59144.v2" | "circle-v2-evm-fast-42161-143.v2" | "circle-v2-evm-fast-42161-1329.v2";
}>;
/** Frozen v1 schema (`apn.circle-v2-evm-operation.v1`, written by 0.5.40-0.5.42; read-only since 0.5.43). Its records
 * fixed this source wallet, beneficiary and 40100/100/40000 economics, and each destination's gas wallet by profile.
 * Only v1 readers, v1 recoveries and the historical modules use this section; no new operation does. */
export declare const CIRCLE_AMOUNT = 40100n;
export declare const CIRCLE_MAX_FEE = 100n;
export declare const CIRCLE_MIN_MINT = 40000n;
export declare const CIRCLE_SOURCE_OWNER: `0x${string}`;
export declare const CIRCLE_SEI_SELLER: `0x${string}`;
export declare const CIRCLE_RECIPIENT: `0x${string}`;
export interface CircleLegacyRoute extends CircleRoute {
    readonly gasPayer: Address;
    readonly gasPayerProfile: "evm-live-buyer" | "evm-live-seller" | "default";
}
/** The v1 record's destination gas wallet. An omitted selector is the historical buyer route; Sei also had a seller one. */
export declare function circleLegacyRoute(chain: CircleDestinationChain, destinationProfile?: string): CircleLegacyRoute;
export declare const CIRCLE_DEPLOYMENT_PINS: {
    readonly "42161": {
        readonly messenger: {
            readonly address: "0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d";
            readonly proxyCodeHash: "0xd2c8d48075d832fb7d07f6db5545a1bee37fdf886325c441a8dd1cef4c9dae99";
            readonly implementation: "0x555e272506c06e7e559d57418563742afe363ec8";
            readonly implementationCodeHash: "0x6c864e374854e06fd5d42b3e9de53ef9ad4d863b83a8c5dd1cf6e2a67fd2b535";
        };
        readonly transmitter: {
            readonly address: "0x81D40F21F12A8F0E3252Bccb954D722d4c464B64";
            readonly proxyCodeHash: "0xd2c8d48075d832fb7d07f6db5545a1bee37fdf886325c441a8dd1cef4c9dae99";
            readonly implementation: "0x7b93db2bc72faf642cec0adcac4f91718831a1f4";
            readonly implementationCodeHash: "0xc627ecd30515b8b6ab2b4ee9bffb4a84277f836fa599a556a1f507dc05eea476";
        };
        readonly minter: {
            readonly address: "0xfd78EE919681417d192449715b2594ab58f5D002";
            readonly proxyCodeHash: "0xfc330d52b7656b971ef47bbb8cd44877181fbc9ac0fe76cb4cb5bb364a992eff";
            readonly implementation: "0x0000000000000000000000000000000000000000";
            readonly implementationCodeHash: null;
        };
        readonly token: {
            readonly address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";
            readonly proxyCodeHash: "0xad30d819dbc47814b7e6cb837fd7cc57fcb591479a38596ee93de4fc52e8c435";
            readonly implementation: "0x86e721b43d4ecfa71119dd38c0f938a75fdb57b3";
            readonly implementationCodeHash: "0xda0578bf7fe0d04e320e166ab8f98061328fda8ae0a299882aeb38f1543c6a9d";
        };
    };
    readonly "59144": {
        readonly messenger: {
            readonly address: "0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d";
            readonly proxyCodeHash: "0xd2c8d48075d832fb7d07f6db5545a1bee37fdf886325c441a8dd1cef4c9dae99";
            readonly implementation: "0x555e272506c06e7e559d57418563742afe363ec8";
            readonly implementationCodeHash: "0x6c864e374854e06fd5d42b3e9de53ef9ad4d863b83a8c5dd1cf6e2a67fd2b535";
        };
        readonly transmitter: {
            readonly address: "0x81D40F21F12A8F0E3252Bccb954D722d4c464B64";
            readonly proxyCodeHash: "0xd2c8d48075d832fb7d07f6db5545a1bee37fdf886325c441a8dd1cef4c9dae99";
            readonly implementation: "0xcec4e8c3bd65cf40821cb2c63deb0aabbcd9ef1b";
            readonly implementationCodeHash: "0x5e92eb4385a5a405b929800f49f5a1ed3b565e2bfcf62c833a4bce819cc8dbc0";
        };
        readonly minter: {
            readonly address: "0xfd78EE919681417d192449715b2594ab58f5D002";
            readonly proxyCodeHash: "0xfc330d52b7656b971ef47bbb8cd44877181fbc9ac0fe76cb4cb5bb364a992eff";
            readonly implementation: "0x0000000000000000000000000000000000000000";
            readonly implementationCodeHash: null;
        };
        readonly token: {
            readonly address: "0x176211869cA2b568f2A7D4EE941E073a821EE1ff";
            readonly proxyCodeHash: "0x469a90ba4c77663d6a9512da10e00f54cae91fda8007c53ad1ba2789457ea5fb";
            readonly implementation: "0xab838fe7d492c621a5b1b23952af99cc37a2e0d3";
            readonly implementationCodeHash: "0x19eb6091deb13c10e3b2ef54f19471ae3e6757e350bfe4e423b5e5208c6459e1";
        };
    };
    readonly "143": {
        readonly messenger: {
            readonly address: "0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d";
            readonly proxyCodeHash: "0xd2c8d48075d832fb7d07f6db5545a1bee37fdf886325c441a8dd1cef4c9dae99";
            readonly implementation: "0x1ccafdffbc1b7b5c499c97322f961b7d929a41b4";
            readonly implementationCodeHash: "0x09a9af29d53ac3e54c73284527cf86215cd377486855a33ac3de899a2a77c314";
        };
        readonly transmitter: {
            readonly address: "0x81D40F21F12A8F0E3252Bccb954D722d4c464B64";
            readonly proxyCodeHash: "0xd2c8d48075d832fb7d07f6db5545a1bee37fdf886325c441a8dd1cef4c9dae99";
            readonly implementation: "0xadf351fd4c26fd97fab86b60bf09ca795b22de26";
            readonly implementationCodeHash: "0x4a51dfaaa487d4b3627752116d3a58f24b03db7d270106cd3167bd0ec33c15b5";
        };
        readonly minter: {
            readonly address: "0xfd78EE919681417d192449715b2594ab58f5D002";
            readonly proxyCodeHash: "0xfc330d52b7656b971ef47bbb8cd44877181fbc9ac0fe76cb4cb5bb364a992eff";
            readonly implementation: "0x0000000000000000000000000000000000000000";
            readonly implementationCodeHash: null;
        };
        readonly token: {
            readonly address: "0x754704Bc059F8C67012fEd69BC8A327a5aafb603";
            readonly proxyCodeHash: "0xbb3557cf62a26950fb58073e6ce8e130af371e5aa13e5584856a1ce2ca47dc89";
            readonly implementation: "0xbd520ea8cbb4f81b62aff3c3ffe7affd69800b6d";
            readonly implementationCodeHash: "0xe96489833045c42bacced6259e6a6372290706ed665e79457aa2fe4d46bc3559";
        };
    };
    readonly "1329": {
        readonly messenger: {
            readonly address: "0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d";
            readonly proxyCodeHash: "0xd2c8d48075d832fb7d07f6db5545a1bee37fdf886325c441a8dd1cef4c9dae99";
            readonly implementation: "0x1ccafdffbc1b7b5c499c97322f961b7d929a41b4";
            readonly implementationCodeHash: "0x09a9af29d53ac3e54c73284527cf86215cd377486855a33ac3de899a2a77c314";
        };
        readonly transmitter: {
            readonly address: "0x81D40F21F12A8F0E3252Bccb954D722d4c464B64";
            readonly proxyCodeHash: "0xd2c8d48075d832fb7d07f6db5545a1bee37fdf886325c441a8dd1cef4c9dae99";
            readonly implementation: "0x2c6c1c5901b9c3a2cad7a6ae4f7c7e291340d286";
            readonly implementationCodeHash: "0x3ea22c6f70852d9fa3964c13be60e02b15ed276131c1c362bcb56bde7ed354e1";
        };
        readonly minter: {
            readonly address: "0xfd78EE919681417d192449715b2594ab58f5D002";
            readonly proxyCodeHash: "0xfc330d52b7656b971ef47bbb8cd44877181fbc9ac0fe76cb4cb5bb364a992eff";
            readonly implementation: "0x0000000000000000000000000000000000000000";
            readonly implementationCodeHash: null;
        };
        readonly token: {
            readonly address: "0xe15fC38F6D8c56aF07bbCBe3BAf5708A2Bf42392";
            readonly proxyCodeHash: "0xe43587ffe1bcce27e2c8d97957762667ac603083224e5028ccf00990de9b8071";
            readonly implementation: "0xcafdc392214661c8c6c7165e491890ad84bed171";
            readonly implementationCodeHash: "0x9efaef237ba96760e6b2de3cb24bda8b987e9b54352c3fd2100396363526f2e0";
        };
    };
};
