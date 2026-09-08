import { encodeAbiParameters, encodeFunctionData, getAddress, parseAbiParameters } from "viem";
import { ACROSS_SELECTOR, deploymentAbi, FEE_FORWARDER, FEE_FORWARDER_SELECTOR, FEE_RECIPIENT, LAYER_ZERO_ENDPOINT, STARGATE_SELECTOR } from "./abi.js";
import { BRIDGE_DIAMOND, BRIDGE_USDC, bridgeFailure } from "./validation.js";
const EIP1967_IMPLEMENTATION = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
const LEGACY_IMPLEMENTATION = "0x7050c9e0f4ca769c69bd3a8ef740bc37934f8e2c036e5a723fd8ee048ed3f8c3";
const LEGACY_ADMIN = "0x10d6a54a4754c8869d6886b5f5d7fbfa5b4522237ea5c60d11bc4e7a1ff9390b";
const TRUE_WORD = `0x${"0".repeat(63)}1`;
const SIX_WORD = `0x${"0".repeat(63)}6`;
const FEE_FORWARDER_OWNER = getAddress("0x08647cc950813966142a416d40c382e2c5db73bb");
const COMMON = {
    1: { diamondHash: "0x828f8a0694bfba25c80a406283f149d701cdc944acbbc18b57315cf157db9220", tokenImpl: getAddress("0x43506849d7c04f9138d1a2050bbf3a0c054402dd"), tokenImplHash: "0xcdfb7d322961af3acae7a8f7ee8b69c205b36f576cc5b077f170c7eb8ecbe3ea", tokenAdmin: getAddress("0x807a96288a1a408dbc13de2b1d087d10356395d2") },
    8453: { diamondHash: "0x5efa2ebe1ed041ce83c069f1cedc04945f1438680dacf5f88068ef6c7d94110a", tokenImpl: getAddress("0x2ce6311ddae708829bc0784c967b7d77d19fd779"), tokenImplHash: "0x11b75a237997ab8328f65b2d5a55c10f0346d0a175741ed42ddf4f2c66b9e873", tokenAdmin: getAddress("0x4fc7850364958d97b4d3f5a08f79db2493f8ca44") },
    42161: { diamondHash: "0x828f8a0694bfba25c80a406283f149d701cdc944acbbc18b57315cf157db9220", tokenImpl: getAddress("0x86e721b43d4ecfa71119dd38c0f938a75fdb57b3"), tokenImplHash: "0xda0578bf7fe0d04e320e166ab8f98061328fda8ae0a299882aeb38f1543c6a9d", tokenAdmin: getAddress("0x2e0a67588cfbcad40f9e4dd76052436190a77a68") },
};
const TOKEN_PROXY_HASH = {
    1: "0xd80d4b7c890cb9d6a4893e6b52bc34b56b25335cb13716e0d1d31383e6b41505",
    8453: "0xa6705a10bb756b5dea144591118be77d7af0c3eee3bf2dfe2583dcb0364fefab",
    42161: "0xad30d819dbc47814b7e6cb837fd7cc57fcb591479a38596ee93de4fc52e8c435",
};
const ACROSS = {
    1: {
        facet: code("0xAd3f1634a917924cBb54A0F76e43ca035D2B6BCd", "0x3018e22e23c2513b0a199a42882e855aa98777883cc7e68062fe3828ff6e2689"),
        spoke: code("0x5c7BCd6E7De5423a257D81B442095A1a6ced35C5", "0x932cddc50793da935ccf915651ad67f6b746e9936fcc5614f0ff492563782c75"),
        implementation: code("0x456ac26e5ec083ee9889eba0d1a0a582502b8e84", "0x94cc890a705ae8f4b973b6531b201fcd53c6bcbefba7caa12d1812f6fcede5bf"),
        wrapped: "0x000000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
    },
    8453: {
        facet: code("0xAd3f1634a917924cBb54A0F76e43ca035D2B6BCd", "0x0d049cb64bfcb713b3fe8fa4727ae763cc1efe1e741ea5c43d41d07add0fb1f8"),
        spoke: code("0x09aea4b2242abC8bb4BB78D537A67a245A7bEC64", "0x932cddc50793da935ccf915651ad67f6b746e9936fcc5614f0ff492563782c75"),
        implementation: code("0xf23c6c04a2b88e8651fe99bbdccbb5c9d306e6b0", "0xb36f3bbdffcc931890a4354aa13c9756f032cf6f968d1d1a9604cb3ece9eb480"),
        wrapped: "0x0000000000000000000000004200000000000000000000000000000000000006",
    },
    42161: {
        facet: code("0xAd3f1634a917924cBb54A0F76e43ca035D2B6BCd", "0xf55f58c8e685178b358b945bcc6c6c7ba0d96cc78f6f22878a4a862f2ba8d339"),
        spoke: code("0xe35e9842fceaCA96570B734083f4a58e8F7C5f2A", "0x932cddc50793da935ccf915651ad67f6b746e9936fcc5614f0ff492563782c75"),
        implementation: code("0xcfcda84333431bcc9155f2368b8362f0d1dff8c9", "0xa860f20748abfdf98f4e55411b5db7630457bec1abfb5d88f1ecd5f25b4ec24b"),
        wrapped: "0x00000000000000000000000082af49447d8a07e3bd95bd0d56f35241523fbab1",
    },
};
const STARGATE = {
    1: stargate("0xbF4aD13FA0e6E05916a78C201f147c5152dbe1C9", "0x23db18775c54e7533c4a6cc48d1dee2d2f43957a7a1ec25e48b06a519119dde7", "0x6d6620eFa72948C5f68A3C8646d58C00d3f4A980", "0xef22a8fb9189866e656f799d686af5c5cdeb0ab47e1baa4f636f6d8253af970c", "0xc026395860Db2d07ee33e05fE50ed7bD583189C7", "0x576f02c4810c5e367e809a7bfcd31b649f3c4c5b6431c4982dc7c470687977b0", "0xb747fab405fadff7fc9d8adb083d18d3454ac58ffdefe9121ed5f008f57d93e0", 30101, ["0x52b35406cb2fb5e0038edecfc129a152a1f74087", "0xe37f7c80ced04c4f243c0fd04a5510d663cb88b5", "0x1041d127b2d4bc700f0f563883bc689502606918", "0x6d6620eFa72948C5f68A3C8646d58C00d3f4A980", "0x9b4d17b45d60b8173a5904b85a7baaec291e9173", "0x0000000000000000000000000000000000000000"]),
    8453: stargate("0x6e378C84e657C57b2a8d183CFf30ee5CC8989b61", "0xadfcb37ab133b53cd78cd2a81d408f9317c386cd5891ce37730a755db7984113", "0x5634c4a5FEd09819E3c46D86A965Dd9447d86e47", "0x39a8d1450f34fc251bc4e7a0ca2af68a26802e21f6f8630b62bd3681d4fee784", "0x27a16dc786820B16E5c9028b75B99F6f604b5d26", "0x83de1e54132ca87de00ada47aa052886e592f06b099de27a51bb34b3172ad2d0", "0x086c2e9e37f5bdaf45013882cf40f7a43b35c879302ff1ad4a4010d09b4d7237", 30184, ["0x08ed1d79d509a6f1020685535028ae60c144441e", "0xe37f7c80ced04c4f243c0fd04a5510d663cb88b5", "0xd47b03ee6d86cf251ee7860fb2acf9f91b9fd4d7", "0x5634c4a5FEd09819E3c46D86A965Dd9447d86e47", "0x12dc9256acc9895b076f6638d628382881e62cee", "0x0000000000000000000000000000000000000000"]),
    42161: stargate("0x6e378C84e657C57b2a8d183CFf30ee5CC8989b61", "0x2537550abf651bb5f281dc46b99769b3e8564e43e41724a62e33c9986ad33801", "0x19cFCE47eD54a88614648DC3f19A5980097007dD", "0xb3a802ede13975c1edc960bb6e6eacbf651ee0cc8fe3d051716d93bca063cd1e", "0xe8CDF27AcD73a434D661C84887215F7598e7d0d3", "0x3c7642aec61389f8cf5c96f6fcd821ed40bf9016285c20fb7710ef908855f4e5", "0xab987ace8dc096407e8073f5fa459238326e8501775b320dc285d81b59e48721", 30110, ["0x80f755e3091b2ad99c08da8d13e9c7635c1b8161", "0xe37f7c80ced04c4f243c0fd04a5510d663cb88b5", "0x146c8e409c113ed87c6183f4d25c50251dffbb3a", "0x19cFCE47eD54a88614648DC3f19A5980097007dD", "0xf1fcb4cbd57b67d683972a59b6a7b1e2e8bf27e6", "0x0000000000000000000000000000000000000000"]),
};
export function bridgeDeployment(chainId, peerChainId, tool) {
    if (!Object.prototype.hasOwnProperty.call(COMMON, chainId) || !Object.prototype.hasOwnProperty.call(COMMON, peerChainId)) {
        bridgeFailure("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "finite_chain");
    }
    if (tool !== "across" && tool !== "stargateV2")
        bridgeFailure("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "finite_tool");
    if (chainId === peerChainId)
        bridgeFailure("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "finite_direction");
    const common = COMMON[chainId];
    const commonCode = [code(BRIDGE_DIAMOND, common.diamondHash), code(FEE_FORWARDER, "0x7ee455a6853068874bfd201f93d6383ed6d88934a922316db5575b057e2ebe74"), code(BRIDGE_USDC[chainId], TOKEN_PROXY_HASH[chainId]), code(common.tokenImpl, common.tokenImplHash)];
    const reads = [
        call(BRIDGE_DIAMOND, "isContractSelectorWhitelisted", [FEE_FORWARDER, FEE_FORWARDER_SELECTOR], TRUE_WORD),
        call(FEE_FORWARDER, "owner", [], wordAddress(FEE_FORWARDER_OWNER)),
        call(BRIDGE_USDC[chainId], "decimals", [], SIX_WORD),
        storage(BRIDGE_USDC[chainId], LEGACY_IMPLEMENTATION, wordAddress(common.tokenImpl)),
        storage(BRIDGE_USDC[chainId], LEGACY_ADMIN, wordAddress(common.tokenAdmin)),
    ];
    if (tool === "across") {
        const a = ACROSS[chainId];
        return {
            chainId, peerChainId, tool, diamond: BRIDGE_DIAMOND, feeForwarder: FEE_FORWARDER, feeRecipient: FEE_RECIPIENT,
            token: BRIDGE_USDC[chainId], protocolEmitter: a.spoke.address, endpointId: null,
            quoteTimeBufferAtomic: "3600", fillDeadlineBufferAtomic: "21600",
            code: [...commonCode, a.facet, a.spoke, a.implementation],
            reads: [
                ...reads,
                call(BRIDGE_DIAMOND, "facetAddress", [ACROSS_SELECTOR], wordAddress(a.facet.address)),
                call(a.facet.address, "SPOKEPOOL", [], wordAddress(a.spoke.address)),
                call(a.facet.address, "WRAPPED_NATIVE", [], a.wrapped),
                call(a.spoke.address, "depositQuoteTimeBuffer", [], wordUint(3600)),
                call(a.spoke.address, "fillDeadlineBuffer", [], wordUint(21600)),
                storage(a.spoke.address, EIP1967_IMPLEMENTATION, wordAddress(a.implementation.address)),
            ],
        };
    }
    const s = STARGATE[chainId], peer = STARGATE[peerChainId];
    return {
        chainId, peerChainId, tool, diamond: BRIDGE_DIAMOND, feeForwarder: FEE_FORWARDER, feeRecipient: FEE_RECIPIENT,
        token: BRIDGE_USDC[chainId], protocolEmitter: s.router.address, endpointId: s.localEid,
        quoteTimeBufferAtomic: null, fillDeadlineBufferAtomic: null,
        code: [...commonCode, s.facet, s.messaging, s.router, s.endpoint],
        reads: [
            ...reads,
            call(BRIDGE_DIAMOND, "facetAddress", [STARGATE_SELECTOR], wordAddress(s.facet.address)),
            call(s.facet.address, "tokenMessaging", [], wordAddress(s.messaging.address)),
            call(s.messaging.address, "stargateImpls", [1], wordAddress(s.router.address)),
            call(s.messaging.address, "assetIds", [s.router.address], wordUint(1)),
            call(s.messaging.address, "peers", [peer.localEid], wordAddress(s.messaging.address === peer.messaging.address ? s.messaging.address : peer.messaging.address)),
            call(s.router.address, "token", [], wordAddress(BRIDGE_USDC[chainId])),
            call(s.router.address, "localEid", [], wordUint(s.localEid)),
            call(s.router.address, "endpoint", [], wordAddress(LAYER_ZERO_ENDPOINT)),
            call(s.router.address, "sharedDecimals", [], SIX_WORD),
            call(s.router.address, "getAddressConfig", [], encodeAbiParameters(parseAbiParameters("address,address,address,address,address,address"), s.addressConfig)),
        ],
    };
}
export function bridgeProtocolEmitter(chainId, tool) {
    return tool === "across" ? ACROSS[chainId].spoke.address : STARGATE[chainId].router.address;
}
export function bridgeEndpointId(chainId) { return STARGATE[chainId].localEid; }
function code(address, codeHash) { return { address: getAddress(address), codeHash }; }
function stargate(facet, facetHash, messaging, messagingHash, router, routerHash, endpointHash, localEid, config) {
    return { facet: code(facet, facetHash), messaging: code(messaging, messagingHash), router: code(router, routerHash), endpoint: code(LAYER_ZERO_ENDPOINT, endpointHash), localEid, addressConfig: config.map((address) => getAddress(address)) };
}
function wordAddress(address) { return `0x${"0".repeat(24)}${address.slice(2).toLowerCase()}`; }
function wordUint(value) { return `0x${BigInt(value).toString(16).padStart(64, "0")}`; }
function call(address, functionName, args, expected) {
    return { kind: "call", address, data: encodeFunctionData({ abi: deploymentAbi, functionName: functionName, args: args }), expected };
}
function storage(address, data, expected) { return { kind: "storage", address, data, expected }; }
//# sourceMappingURL=deployments.js.map