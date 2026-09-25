import { encodeAbiParameters, encodeFunctionData, getAddress, parseAbiParameters } from "viem";
import type { BridgeChainId } from "./chains.js";
import type { Address, Hex } from "../model.js";
import { ACROSS_SELECTOR, deploymentAbi, FEE_FORWARDER, FEE_FORWARDER_SELECTOR, FEE_RECIPIENT, LAYER_ZERO_ENDPOINT, STARGATE_SELECTOR } from "./abi.js";
import { BRIDGE_ASSET_REGISTRY, bridgeAssetRow, bridgeAssetTool, bridgeChain, bridgePeerToken, type BridgeAsset, type BridgeTokenAsset, type BridgeTokenCode } from "./asset-registry.js";
import type { BridgeDeploymentContract, BridgeTool } from "./model.js";
import { BRIDGE_DIAMOND, BRIDGE_ZERO_ADDRESS, bridgeFailure } from "./validation.js";
import { BNB_COMPOSITE } from "./bnb-composite.js";

const EIP1967_IMPLEMENTATION = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc" as Hex;
const EIP1967_BEACON = "0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50" as Hex;
const EIP1967_ADMIN = "0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103" as Hex;
const FALSE_WORD = `0x${"0".repeat(64)}` as Hex;
const LEGACY_IMPLEMENTATION = "0x7050c9e0f4ca769c69bd3a8ef740bc37934f8e2c036e5a723fd8ee048ed3f8c3" as Hex;
const LEGACY_ADMIN = "0x10d6a54a4754c8869d6886b5f5d7fbfa5b4522237ea5c60d11bc4e7a1ff9390b" as Hex;
const TRUE_WORD = `0x${"0".repeat(63)}1` as Hex;
const FEE_FORWARDER_OWNER = getAddress("0x08647cc950813966142a416d40c382e2c5db73bb");

type Code = Readonly<{ address: Address; codeHash: Hex }>;
type Across = Readonly<{ facet?: Code; spoke: Code; implementation?: Code }>;
type Stargate = Readonly<{ facet: Code; messaging: Code; endpoint: Code; localEid: number }>;

const DIAMOND_HASH: Readonly<Partial<Record<BridgeChainId, Hex>>> = {
  1: "0x828f8a0694bfba25c80a406283f149d701cdc944acbbc18b57315cf157db9220",
  8453: "0x5efa2ebe1ed041ce83c069f1cedc04945f1438680dacf5f88068ef6c7d94110a",
  42161: "0x828f8a0694bfba25c80a406283f149d701cdc944acbbc18b57315cf157db9220",
};

const ACROSS: Readonly<Partial<Record<BridgeChainId, Across>>> = {
  1: {
    facet: code("0xAd3f1634a917924cBb54A0F76e43ca035D2B6BCd", "0x3018e22e23c2513b0a199a42882e855aa98777883cc7e68062fe3828ff6e2689"),
    spoke: code("0x5c7BCd6E7De5423a257D81B442095A1a6ced35C5", "0x932cddc50793da935ccf915651ad67f6b746e9936fcc5614f0ff492563782c75"),
    implementation: code("0x456ac26e5ec083ee9889eba0d1a0a582502b8e84", "0x94cc890a705ae8f4b973b6531b201fcd53c6bcbefba7caa12d1812f6fcede5bf"),
  },
  8453: {
    facet: code("0xAd3f1634a917924cBb54A0F76e43ca035D2B6BCd", "0x0d049cb64bfcb713b3fe8fa4727ae763cc1efe1e741ea5c43d41d07add0fb1f8"),
    spoke: code("0x09aea4b2242abC8bb4BB78D537A67a245A7bEC64", "0x932cddc50793da935ccf915651ad67f6b746e9936fcc5614f0ff492563782c75"),
    implementation: code("0xf23c6c04a2b88e8651fe99bbdccbb5c9d306e6b0", "0xb36f3bbdffcc931890a4354aa13c9756f032cf6f968d1d1a9604cb3ece9eb480"),
  },
  42161: {
    facet: code("0xAd3f1634a917924cBb54A0F76e43ca035D2B6BCd", "0xf55f58c8e685178b358b945bcc6c6c7ba0d96cc78f6f22878a4a862f2ba8d339"),
    spoke: code("0xe35e9842fceaCA96570B734083f4a58e8F7C5f2A", "0x932cddc50793da935ccf915651ad67f6b746e9936fcc5614f0ff492563782c75"),
    implementation: code("0xcfcda84333431bcc9155f2368b8362f0d1dff8c9", "0xa860f20748abfdf98f4e55411b5db7630457bec1abfb5d88f1ecd5f25b4ec24b"),
  },
  56: { spoke: code("0x4e8e101924ede233c13e2d8622dc8aed2872d505", "0x932cddc50793da935ccf915651ad67f6b746e9936fcc5614f0ff492563782c75") },
  143: {
    spoke: code("0xd2ecb3afe598b746F8123CaE365a598DA831A449", "0x932cddc50793da935ccf915651ad67f6b746e9936fcc5614f0ff492563782c75"),
    implementation: code("0x3266a6de0f3533b042ffdb1a8183168422be7349", "0x67f63f0bce352f1c92ead8a198ebf1b2861659d75524f6a0fc0fdf4cd73fc5c3"),
  },
  59144: {
    spoke: code("0x7E63A5f1a8F0B4d0934B2f2327DAED3F6bb2ee75", "0x932cddc50793da935ccf915651ad67f6b746e9936fcc5614f0ff492563782c75"),
    implementation: code("0x263c0E973fd0Ca9dE57bb22a91C57Fc367A81915", "0x87a80b6ff28516c1df2d3a3be7f4945d04ec7538cc500074a1f90a7306cae1ed"),
  },
};

const STARGATE: Readonly<Partial<Record<BridgeChainId, Stargate>>> = {
  1: stargate("0xbF4aD13FA0e6E05916a78C201f147c5152dbe1C9", "0x23db18775c54e7533c4a6cc48d1dee2d2f43957a7a1ec25e48b06a519119dde7", "0x6d6620eFa72948C5f68A3C8646d58C00d3f4A980", "0xef22a8fb9189866e656f799d686af5c5cdeb0ab47e1baa4f636f6d8253af970c", "0xb747fab405fadff7fc9d8adb083d18d3454ac58ffdefe9121ed5f008f57d93e0", 30101),
  8453: stargate("0x6e378C84e657C57b2a8d183CFf30ee5CC8989b61", "0xadfcb37ab133b53cd78cd2a81d408f9317c386cd5891ce37730a755db7984113", "0x5634c4a5FEd09819E3c46D86A965Dd9447d86e47", "0x39a8d1450f34fc251bc4e7a0ca2af68a26802e21f6f8630b62bd3681d4fee784", "0x086c2e9e37f5bdaf45013882cf40f7a43b35c879302ff1ad4a4010d09b4d7237", 30184),
  42161: stargate("0x6e378C84e657C57b2a8d183CFf30ee5CC8989b61", "0x2537550abf651bb5f281dc46b99769b3e8564e43e41724a62e33c9986ad33801", "0x19cFCE47eD54a88614648DC3f19A5980097007dD", "0xb3a802ede13975c1edc960bb6e6eacbf651ee0cc8fe3d051716d93bca063cd1e", "0xab987ace8dc096407e8073f5fa459238326e8501775b320dc285d81b59e48721", 30110),
};

/**
 * The exact code and configuration pins for one direction, tool and asset. Every asset-specific pin comes from the
 * registry row; an asset the registry does not admit, or one whose tool has not been reviewed for it, is refused.
 * A native leg pins the wrapped-native contract whose logs prove the wrap and the unwrap instead of a token contract.
 */
export function bridgeDeployment(chainId: BridgeChainId, peerChainId: BridgeChainId, tool: BridgeTool, token: Address): BridgeDeploymentContract {
  bridgeChain(chainId, "APN_PROVIDER_CAPABILITY_UNAVAILABLE"); bridgeChain(peerChainId, "APN_PROVIDER_CAPABILITY_UNAVAILABLE");
  if (chainId === peerChainId) bridgeFailure("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "finite_direction");
  if (tool !== "across" && tool !== "stargateV2") bridgeFailure("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "finite_tool");
  if (chainId === 56) {
    if (peerChainId !== 1 || tool !== "across" || token !== BRIDGE_ZERO_ADDRESS) bridgeFailure("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "bnb_composite_finite_direction");
    const spoke = getAddress("0x4e8e101924ede233c13e2d8622dc8aed2872d505");
    return { chainId, peerChainId, tool, diamond: BRIDGE_DIAMOND, feeForwarder: FEE_FORWARDER, feeRecipient: FEE_RECIPIENT,
      token, protocolEmitter: spoke, endpointId: null, quoteTimeBufferAtomic: "3600", fillDeadlineBufferAtomic: "21600",
      code: [
        code(BNB_COMPOSITE.flyRouter, "0xaffe8098fa7a152f718c07de0ea7657382e535a301aaf12f89bbba8f91e4b352"),
        code(BNB_COMPOSITE.core, "0xc3508fb257eee0d20085dfdf41a56e95e8912ca82e3d0a9a9f6e696a261ed1cd"),
        code(BNB_COMPOSITE.vault, "0x6a4e88ca30a16ae895be058f307388265b2c66a79fdd7bbcdcd9ee8bc2053b01"),
        code(BNB_COMPOSITE.poolId.slice(0, 42), "0x2b3cdb059e60c9fafdc7c9f66eb07f53c9be869b5d5799422872c88c173d2b27"),
        code(BNB_COMPOSITE.executor, "0x60134c855342605905c28c4d6bb3d8bf04beff523cdf7e05028a345d8d0c9713"),
        code(BNB_COMPOSITE.receiver, "0x63e17243f25e66ca76ad9a7a6e640c7eec84caa6382881121c9cccf9f1855002"),
        code(spoke, "0x932cddc50793da935ccf915651ad67f6b746e9936fcc5614f0ff492563782c75"),
        code(BNB_COMPOSITE.weth, "0x24d639ec3ab0dfc14d482da65b0dfc3c325351d938d8cfffa4aa47e4ac8f0e65"),
        code(BNB_COMPOSITE.wbnb, "0xb7d84205eaaf83ce7b3940c6beaad6d22790255e34a9a2b486aa8cdfff118fe6"),
      ],
      reads: [
        call(BNB_COMPOSITE.flyRouter, "internalCallers", [BNB_COMPOSITE.signer], TRUE_WORD),
        call(BNB_COMPOSITE.flyRouter, "coreAddress", [], wordAddress(BNB_COMPOSITE.core)),
        call(BNB_COMPOSITE.flyRouter, "weth", [], wordAddress(BNB_COMPOSITE.wbnb)),
        call(BNB_COMPOSITE.core, "whitelist", [BNB_COMPOSITE.flyRouter], TRUE_WORD),
        call(BNB_COMPOSITE.receiver, "EXECUTOR", [], wordAddress(BNB_COMPOSITE.executor)),
        call(BNB_COMPOSITE.receiver, "SPOKEPOOL", [], wordAddress(spoke)),
        call(spoke, "depositQuoteTimeBuffer", [], wordUint(3600)), call(spoke, "fillDeadlineBuffer", [], wordUint(21600)),
      ] };
  }
  const asset = bridgeAssetRow(chainId, token, "APN_PROVIDER_CAPABILITY_UNAVAILABLE");
  if (!asset.peers.includes(peerChainId)) bridgeFailure("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "finite_chain");
  const pool = bridgeAssetTool(asset, tool);
  if (tool === "stargateV2" && asset.kind === "native") {
    if (!((chainId === 1 && peerChainId === 8453) || (chainId === 8453 && peerChainId === 1)) ||
      pool === null || pool.assetId !== 13) bridgeFailure("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "stargate_native_pair_unreviewed");
    const s = STARGATE[chainId];
    if (s === undefined) bridgeFailure("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "stargate_chain_unreviewed");
    return { chainId, peerChainId, tool, diamond: BRIDGE_DIAMOND, feeForwarder: FEE_FORWARDER,
      feeRecipient: FEE_RECIPIENT, token: BRIDGE_ZERO_ADDRESS, protocolEmitter: pool.router,
      endpointId: s.localEid, quoteTimeBufferAtomic: null, fillDeadlineBufferAtomic: null,
      code: [code(pool.router, pool.routerCodeHash), s.messaging, code(BRIDGE_DIAMOND, DIAMOND_HASH[chainId]!), s.facet],
      reads: [
        call(s.messaging.address, "stargateImpls", [13], wordAddress(pool.router)),
        // The paired capture covered 0x14d53077. The executable swap-and-start selector is distinct and
        // must be checked at the same fresh safe block before any operation is admitted.
        call(BRIDGE_DIAMOND, "facetAddress", ["0x14d53077"], wordAddress(s.facet.address)),
        call(BRIDGE_DIAMOND, "facetAddress", [STARGATE_SELECTOR], wordAddress(s.facet.address)),
        call(pool.router, "getAddressConfig", [], encodeAbiParameters(parseAbiParameters("address,address,address,address,address,address"), pool.addressConfig)),
        call(s.facet.address, "tokenMessaging", [], wordAddress(s.messaging.address)),
      ] };
  }
  const wrapped = BRIDGE_ASSET_REGISTRY[chainId].nativeCoin.wrapped;
  const destinationOnly = (chainId === 143 || chainId === 59144) && peerChainId === 1 && tool === "across" && asset.kind === "native";
  const diamondHash = DIAMOND_HASH[chainId];
  const commonCode = [...(destinationOnly ? [] : [code(BRIDGE_DIAMOND, diamondHash ?? bridgeFailure("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "diamond_deployment")),
    code(FEE_FORWARDER, "0x7ee455a6853068874bfd201f93d6383ed6d88934a922316db5575b057e2ebe74")]),
    ...(asset.kind === "native" ? proxyCode(wrapped.address, wrapped.code) : proxyCode(asset.address, asset.code))];
  const reads = [...(destinationOnly ? [] : [
    call(BRIDGE_DIAMOND, "isContractSelectorWhitelisted", [FEE_FORWARDER, FEE_FORWARDER_SELECTOR], TRUE_WORD),
    call(FEE_FORWARDER, "owner", [], wordAddress(FEE_FORWARDER_OWNER)),
  ]), ...assetReads(asset)];
  if (pool === null) {
    const a = ACROSS[chainId];
    if (a === undefined) bridgeFailure("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "across_chain_unreviewed");
    const facet = a.facet;
    return {
      chainId, peerChainId, tool, diamond: BRIDGE_DIAMOND, feeForwarder: FEE_FORWARDER, feeRecipient: FEE_RECIPIENT,
      token: asset.kind === "native" ? BRIDGE_ZERO_ADDRESS : asset.address, protocolEmitter: a.spoke.address, endpointId: null,
      quoteTimeBufferAtomic: "3600", fillDeadlineBufferAtomic: "21600",
      code: [...commonCode, ...(facet === undefined ? [] : [facet]), a.spoke,
        ...(a.implementation === undefined ? [] : [a.implementation])],
      reads: [
        ...reads,
        ...(facet === undefined ? [] : [
          call(BRIDGE_DIAMOND, "facetAddress", [ACROSS_SELECTOR], wordAddress(facet.address)),
          call(facet.address, "SPOKEPOOL", [], wordAddress(a.spoke.address)),
          call(facet.address, "WRAPPED_NATIVE", [], wordAddress(wrapped.address)),
        ]),
        call(a.spoke.address, "depositQuoteTimeBuffer", [], wordUint(3600)),
        call(a.spoke.address, "fillDeadlineBuffer", [], wordUint(21600)),
        ...(a.implementation === undefined ? [] : [storage(a.spoke.address, EIP1967_IMPLEMENTATION, wordAddress(a.implementation.address))]),
      ],
    };
  }
  if (asset.kind === "native") return bridgeFailure("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "stargate_pool_asset_unreviewed");
  const s = STARGATE[chainId], peer = STARGATE[peerChainId];
  if (s === undefined || peer === undefined) bridgeFailure("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "stargate_chain_unreviewed");
  const peerPool = bridgeAssetTool(bridgePeerToken(asset, peerChainId), tool);
  if (peerPool === null || peerPool.assetId !== pool.assetId) bridgeFailure("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "stargate_pool_asset_unreviewed");
  return {
    chainId, peerChainId, tool, diamond: BRIDGE_DIAMOND, feeForwarder: FEE_FORWARDER, feeRecipient: FEE_RECIPIENT,
    token: asset.address, protocolEmitter: pool.router, endpointId: s.localEid,
    quoteTimeBufferAtomic: null, fillDeadlineBufferAtomic: null,
    code: [...commonCode, s.facet, s.messaging, code(pool.router, pool.routerCodeHash), s.endpoint],
    reads: [
      ...reads,
      call(BRIDGE_DIAMOND, "facetAddress", [STARGATE_SELECTOR], wordAddress(s.facet.address)),
      call(s.facet.address, "tokenMessaging", [], wordAddress(s.messaging.address)),
      call(s.messaging.address, "stargateImpls", [pool.assetId], wordAddress(pool.router)),
      call(s.messaging.address, "assetIds", [pool.router], wordUint(pool.assetId)),
      call(s.messaging.address, "peers", [peer.localEid], wordAddress(s.messaging.address === peer.messaging.address ? s.messaging.address : peer.messaging.address)),
      call(pool.router, "token", [], wordAddress(asset.address)),
      call(pool.router, "localEid", [], wordUint(s.localEid)),
      call(pool.router, "endpoint", [], wordAddress(LAYER_ZERO_ENDPOINT)),
      call(pool.router, "sharedDecimals", [], wordUint(pool.sharedDecimals)),
      call(pool.router, "getAddressConfig", [], encodeAbiParameters(parseAbiParameters("address,address,address,address,address,address"), pool.addressConfig)),
    ],
  };
}

export function bridgeProtocolEmitter(chainId: BridgeChainId, tool: BridgeTool, token: Address): Address {
  bridgeChain(chainId, "APN_PROVIDER_CAPABILITY_UNAVAILABLE");
  if (tool === "across") {
    const across = ACROSS[chainId];
    if (across === undefined) return bridgeFailure("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "across_chain_unreviewed");
    return across.spoke.address;
  }
  const pool = bridgeAssetTool(bridgeAssetRow(chainId, token, "APN_PROVIDER_CAPABILITY_UNAVAILABLE"), tool);
  if (pool === null) bridgeFailure("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "stargate_pool_asset_unreviewed");
  return pool.router;
}

export function bridgeEndpointId(chainId: BridgeChainId): number {
  const row = STARGATE[bridgeChain(chainId, "APN_PROVIDER_CAPABILITY_UNAVAILABLE")];
  if (row === undefined) return bridgeFailure("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "stargate_chain_unreviewed");
  return row.localEid;
}

function proxyCode(address: Address, c: BridgeTokenCode): readonly Code[] {
  const proxy = code(address, c.codeHash);
  if (c.upgradeability === "immutable") return [proxy];
  if (c.upgradeability === "legacy_proxy" || c.upgradeability === "eip1967_proxy") return [proxy, code(c.implementation, c.implementationCodeHash)];
  return [proxy, code(c.beacon, c.beaconCodeHash), code(c.implementation, c.implementationCodeHash)];
}
function proxyReads(address: Address, c: BridgeTokenCode): readonly BridgeDeploymentContract["reads"][number][] {
  if (c.upgradeability === "immutable") return [];
  if (c.upgradeability === "legacy_proxy") {
    return [storage(address, LEGACY_IMPLEMENTATION, wordAddress(c.implementation)), storage(address, LEGACY_ADMIN, wordAddress(c.admin))];
  }
  if (c.upgradeability === "eip1967_proxy") {
    return [storage(address, EIP1967_IMPLEMENTATION, wordAddress(c.implementation)), storage(address, EIP1967_ADMIN, wordAddress(c.admin))];
  }
  return [storage(address, EIP1967_BEACON, wordAddress(c.beacon)), call(c.beacon, "implementation", [], wordAddress(c.implementation))];
}
/**
 * A native leg reads the wrapped-native proxy slots and its 18 decimals. A token leg reads its exact `decimals()`, its
 * upgradeability slots and, for Tether, the owner-settable fee rate, fee cap and deprecation forward, all pinned at zero.
 */
function assetReads(asset: BridgeAsset): readonly BridgeDeploymentContract["reads"][number][] {
  if (asset.kind === "native") {
    const wrapped = BRIDGE_ASSET_REGISTRY[asset.chainId].nativeCoin.wrapped;
    return [call(wrapped.address, "decimals", [], wordUint(asset.decimals)), ...proxyReads(wrapped.address, wrapped.code)];
  }
  return [call(asset.address, "decimals", [], wordUint(asset.decimals)), ...proxyReads(asset.address, asset.code), ...feeReads(asset)];
}
function feeReads(asset: BridgeTokenAsset): readonly BridgeDeploymentContract["reads"][number][] {
  if (asset.transferFee === "none") return [];
  return [call(asset.address, "basisPointsRate", [], FALSE_WORD), call(asset.address, "maximumFee", [], FALSE_WORD),
    call(asset.address, "deprecated", [], FALSE_WORD)];
}
function code(address: string, codeHash: Hex): Code { return { address: getAddress(address), codeHash }; }
function stargate(facet: string, facetHash: Hex, messaging: string, messagingHash: Hex, endpointHash: Hex, localEid: number): Stargate {
  return { facet: code(facet, facetHash), messaging: code(messaging, messagingHash), endpoint: code(LAYER_ZERO_ENDPOINT, endpointHash), localEid };
}
function wordAddress(address: Address): Hex { return `0x${"0".repeat(24)}${address.slice(2).toLowerCase()}` as Hex; }
function wordUint(value: number): Hex { return `0x${BigInt(value).toString(16).padStart(64, "0")}` as Hex; }
function call(address: Address, functionName: string, args: readonly unknown[], expected: Hex): BridgeDeploymentContract["reads"][number] {
  return { kind: "call", address, data: encodeFunctionData({ abi: deploymentAbi, functionName: functionName as never, args: args as never }), expected };
}
function storage(address: Address, data: Hex, expected: Hex): BridgeDeploymentContract["reads"][number] { return { kind: "storage", address, data, expected }; }
