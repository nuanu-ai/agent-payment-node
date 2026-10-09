/** Finite mainnet funding lane. Pins refreshed at safe blocks on 2026-10-09; see reports/.../mm-usdc-bridges/fresh-deployment-pins.json.
 * Primary contracts: https://developers.circle.com/cctp/references/contract-addresses */
import { getAddress } from "viem";
export const CIRCLE_AMOUNT = 40100n;
export const CIRCLE_MAX_FEE = 100n;
export const CIRCLE_MIN_MINT = 40000n;
export const CIRCLE_SOURCE_OWNER = getAddress("0x823A3a5BaB1186141b32fC65F8E25Ca24c679Ce7");
export const CIRCLE_SEI_SELLER = getAddress("0x991e254B5C8e0AAf6c244eaa2706BAd059809b04");
export const CIRCLE_SOURCE_TOKEN = getAddress("0xaf88d065e77c8cC2239327C5EDb3A432268e5831");
export const CIRCLE_RECIPIENT = getAddress("0xf41170df51aab52aaa04fbc3ff325cf051644aca");
export const CIRCLE_MESSENGER = getAddress("0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d");
export const CIRCLE_TRANSMITTER = getAddress("0x81D40F21F12A8F0E3252Bccb954D722d4c464B64");
export const CIRCLE_MINTER = getAddress("0xfd78EE919681417d192449715b2594ab58f5D002");
export const CIRCLE_IMPLEMENTATION_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
export const CIRCLE_TOKEN_IMPLEMENTATION_SLOT = "0x7050c9e0f4ca769c69bd3a8ef740bc37934f8e2c036e5a723fd8ee048ed3f8c3";
const routes = {
    1329: { chainId: 1329, domain: 16, token: getAddress("0xe15fC38F6D8c56aF07bbCBe3BAf5708A2Bf42392"), gasPayer: CIRCLE_SOURCE_OWNER,
        gasPayerProfile: "evm-live-buyer", destinationNativeCap: "50000000000000000", rpcEnvironment: "APN_SEI_RPC_URL", rpcDefault: "https://evm-rpc.sei-apis.com" },
    59144: { chainId: 59144, domain: 11, token: getAddress("0x176211869cA2b568f2A7D4EE941E073a821EE1ff"), gasPayer: CIRCLE_SOURCE_OWNER,
        gasPayerProfile: "evm-live-buyer", destinationNativeCap: "100000000000000", rpcEnvironment: "APN_LINEA_RPC_URL", rpcDefault: "https://linea-rpc.publicnode.com" },
    143: { chainId: 143, domain: 15, token: getAddress("0x754704Bc059F8C67012fEd69BC8A327a5aafb603"), gasPayer: getAddress("0x0B4Dd0C3dA001Fa146EEd3f80B01860BEF6B8a14"),
        gasPayerProfile: "default", destinationNativeCap: "100000000000000000", rpcEnvironment: "APN_MONAD_RPC_URL", rpcDefault: "https://rpc.monad.xyz" },
};
const seiSeller = { ...routes[1329], gasPayer: CIRCLE_SEI_SELLER, gasPayerProfile: "evm-live-seller" };
/** An omitted selector retains the historical buyer route. Only Sei has a second finite owner. */
export function circleRoute(chain, destinationProfile) {
    const route = routes[chain];
    if (route === undefined)
        throw new Error("Unsupported finite Circle destination.");
    if (destinationProfile === undefined || destinationProfile === route.gasPayerProfile)
        return route;
    if (chain === 1329 && destinationProfile === "evm-live-seller")
        return seiSeller;
    throw new Error("Unsupported finite Circle destination profile.");
}
export const CIRCLE_DEPLOYMENT_PINS = {
    "42161": {
        "messenger": {
            "address": "0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d",
            "proxyCodeHash": "0xd2c8d48075d832fb7d07f6db5545a1bee37fdf886325c441a8dd1cef4c9dae99",
            "implementation": "0x555e272506c06e7e559d57418563742afe363ec8",
            "implementationCodeHash": "0x6c864e374854e06fd5d42b3e9de53ef9ad4d863b83a8c5dd1cf6e2a67fd2b535"
        },
        "transmitter": {
            "address": "0x81D40F21F12A8F0E3252Bccb954D722d4c464B64",
            "proxyCodeHash": "0xd2c8d48075d832fb7d07f6db5545a1bee37fdf886325c441a8dd1cef4c9dae99",
            "implementation": "0x7b93db2bc72faf642cec0adcac4f91718831a1f4",
            "implementationCodeHash": "0xc627ecd30515b8b6ab2b4ee9bffb4a84277f836fa599a556a1f507dc05eea476"
        },
        "minter": {
            "address": "0xfd78EE919681417d192449715b2594ab58f5D002",
            "proxyCodeHash": "0xfc330d52b7656b971ef47bbb8cd44877181fbc9ac0fe76cb4cb5bb364a992eff",
            "implementation": "0x0000000000000000000000000000000000000000",
            "implementationCodeHash": null
        },
        "token": {
            "address": "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
            "proxyCodeHash": "0xad30d819dbc47814b7e6cb837fd7cc57fcb591479a38596ee93de4fc52e8c435",
            "implementation": "0x86e721b43d4ecfa71119dd38c0f938a75fdb57b3",
            "implementationCodeHash": "0xda0578bf7fe0d04e320e166ab8f98061328fda8ae0a299882aeb38f1543c6a9d"
        }
    },
    "59144": {
        "messenger": {
            "address": "0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d",
            "proxyCodeHash": "0xd2c8d48075d832fb7d07f6db5545a1bee37fdf886325c441a8dd1cef4c9dae99",
            "implementation": "0x555e272506c06e7e559d57418563742afe363ec8",
            "implementationCodeHash": "0x6c864e374854e06fd5d42b3e9de53ef9ad4d863b83a8c5dd1cf6e2a67fd2b535"
        },
        "transmitter": {
            "address": "0x81D40F21F12A8F0E3252Bccb954D722d4c464B64",
            "proxyCodeHash": "0xd2c8d48075d832fb7d07f6db5545a1bee37fdf886325c441a8dd1cef4c9dae99",
            "implementation": "0xcec4e8c3bd65cf40821cb2c63deb0aabbcd9ef1b",
            "implementationCodeHash": "0x5e92eb4385a5a405b929800f49f5a1ed3b565e2bfcf62c833a4bce819cc8dbc0"
        },
        "minter": {
            "address": "0xfd78EE919681417d192449715b2594ab58f5D002",
            "proxyCodeHash": "0xfc330d52b7656b971ef47bbb8cd44877181fbc9ac0fe76cb4cb5bb364a992eff",
            "implementation": "0x0000000000000000000000000000000000000000",
            "implementationCodeHash": null
        },
        "token": {
            "address": "0x176211869cA2b568f2A7D4EE941E073a821EE1ff",
            "proxyCodeHash": "0x469a90ba4c77663d6a9512da10e00f54cae91fda8007c53ad1ba2789457ea5fb",
            "implementation": "0xab838fe7d492c621a5b1b23952af99cc37a2e0d3",
            "implementationCodeHash": "0x19eb6091deb13c10e3b2ef54f19471ae3e6757e350bfe4e423b5e5208c6459e1"
        }
    },
    "143": {
        "messenger": {
            "address": "0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d",
            "proxyCodeHash": "0xd2c8d48075d832fb7d07f6db5545a1bee37fdf886325c441a8dd1cef4c9dae99",
            "implementation": "0x1ccafdffbc1b7b5c499c97322f961b7d929a41b4",
            "implementationCodeHash": "0x09a9af29d53ac3e54c73284527cf86215cd377486855a33ac3de899a2a77c314"
        },
        "transmitter": {
            "address": "0x81D40F21F12A8F0E3252Bccb954D722d4c464B64",
            "proxyCodeHash": "0xd2c8d48075d832fb7d07f6db5545a1bee37fdf886325c441a8dd1cef4c9dae99",
            "implementation": "0xadf351fd4c26fd97fab86b60bf09ca795b22de26",
            "implementationCodeHash": "0x4a51dfaaa487d4b3627752116d3a58f24b03db7d270106cd3167bd0ec33c15b5"
        },
        "minter": {
            "address": "0xfd78EE919681417d192449715b2594ab58f5D002",
            "proxyCodeHash": "0xfc330d52b7656b971ef47bbb8cd44877181fbc9ac0fe76cb4cb5bb364a992eff",
            "implementation": "0x0000000000000000000000000000000000000000",
            "implementationCodeHash": null
        },
        "token": {
            "address": "0x754704Bc059F8C67012fEd69BC8A327a5aafb603",
            "proxyCodeHash": "0xbb3557cf62a26950fb58073e6ce8e130af371e5aa13e5584856a1ce2ca47dc89",
            "implementation": "0xbd520ea8cbb4f81b62aff3c3ffe7affd69800b6d",
            "implementationCodeHash": "0xe96489833045c42bacced6259e6a6372290706ed665e79457aa2fe4d46bc3559"
        }
    },
    "1329": {
        "messenger": {
            "address": "0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d",
            "proxyCodeHash": "0xd2c8d48075d832fb7d07f6db5545a1bee37fdf886325c441a8dd1cef4c9dae99",
            "implementation": "0x1ccafdffbc1b7b5c499c97322f961b7d929a41b4",
            "implementationCodeHash": "0x09a9af29d53ac3e54c73284527cf86215cd377486855a33ac3de899a2a77c314"
        },
        "transmitter": {
            "address": "0x81D40F21F12A8F0E3252Bccb954D722d4c464B64",
            "proxyCodeHash": "0xd2c8d48075d832fb7d07f6db5545a1bee37fdf886325c441a8dd1cef4c9dae99",
            "implementation": "0x2c6c1c5901b9c3a2cad7a6ae4f7c7e291340d286",
            "implementationCodeHash": "0x3ea22c6f70852d9fa3964c13be60e02b15ed276131c1c362bcb56bde7ed354e1"
        },
        "minter": {
            "address": "0xfd78EE919681417d192449715b2594ab58f5D002",
            "proxyCodeHash": "0xfc330d52b7656b971ef47bbb8cd44877181fbc9ac0fe76cb4cb5bb364a992eff",
            "implementation": "0x0000000000000000000000000000000000000000",
            "implementationCodeHash": null
        },
        "token": {
            "address": "0xe15fC38F6D8c56aF07bbCBe3BAf5708A2Bf42392",
            "proxyCodeHash": "0xe43587ffe1bcce27e2c8d97957762667ac603083224e5028ccf00990de9b8071",
            "implementation": "0xcafdc392214661c8c6c7165e491890ad84bed171",
            "implementationCodeHash": "0x9efaef237ba96760e6b2de3cb24bda8b987e9b54352c3fd2100396363526f2e0"
        }
    }
};
//# sourceMappingURL=catalog.js.map