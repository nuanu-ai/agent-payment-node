import { getAddress } from "viem";
import type { ErrorCode } from "../errors.js";
import type { EvmChainId } from "../evm-asset.js";
import type { Address, Hex } from "../model.js";
import type { BridgeRouteRequest, BridgeTool } from "./model.js";
import { assertBridgeRegistryListed, bridgeTokenListed } from "./asset-listing.js";
import { BRIDGE_ZERO_ADDRESS, bridgeAddress, bridgeExact, bridgeFailure, bridgeUint } from "./validation.js";

/**
 * The single source of admitted bridge chains and assets. Every chain identity, native coin, token address,
 * decimals count and contract pin the rail trusts is a row here; nothing else in `src/lifi/**` may carry its own
 * copy. A row exists only when its on-chain identity can be pinned the way canonical USDC already is.
 */
export const BRIDGE_CHAINS = [1, 8453, 42161] as const;
/**
 * Quote-only destinations whose exact allowlist USDC identity and LI.FI calldata shape were captured from the
 * public quote API. They may be discovered and decoded, but are deliberately absent from `BRIDGE_CHAINS`: no RPC,
 * deployment proof, destination observation or send path may treat them as executable bridge chains.
 */
export const BRIDGE_QUOTE_DESTINATIONS = {
  10: { name: "OP Mainnet", caip2: "eip155:10", token: getAddress("0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85"), tools: ["across", "stargateV2"], endpointId: 30111 },
  137: { name: "Polygon PoS", caip2: "eip155:137", token: getAddress("0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359"), tools: ["across"], endpointId: null },
  43114: { name: "Avalanche C-Chain", caip2: "eip155:43114", token: getAddress("0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E"), tools: ["stargateV2"], endpointId: 30106 },
  130: { name: "Unichain", caip2: "eip155:130", token: getAddress("0x078D782b760474a361dDA0AF3839290b0EF57AD6"), tools: ["across"], endpointId: null },
} as const;
export type BridgeQuoteDestinationChainId = keyof typeof BRIDGE_QUOTE_DESTINATIONS;

/** Each upgradeability shape is pinned explicitly; there is no default shape for an unreviewed proxy. */
export type BridgeTokenCode =
  | { readonly upgradeability: "immutable"; readonly codeHash: Hex }
  | { readonly upgradeability: "legacy_proxy"; readonly codeHash: Hex; readonly implementation: Address;
      readonly implementationCodeHash: Hex; readonly admin: Address }
  | { readonly upgradeability: "eip1967_proxy"; readonly codeHash: Hex; readonly implementation: Address;
      readonly implementationCodeHash: Hex; readonly admin: Address }
  | { readonly upgradeability: "beacon_proxy"; readonly codeHash: Hex; readonly beacon: Address;
      readonly beaconCodeHash: Hex; readonly implementation: Address; readonly implementationCodeHash: Hex };
export interface BridgeStargatePool {
  readonly assetId: 1;
  readonly router: Address;
  readonly routerCodeHash: Hex;
  readonly sharedDecimals: number;
  readonly addressConfig: readonly [Address, Address, Address, Address, Address, Address];
}
/**
 * The wrapped-native contract Across wraps a native deposit into and unwraps a native fill from. Its event shape is
 * pinned per chain: WETH9 emits `Deposit`/`Withdrawal`; Arbitrum's aeWETH mints and burns with `Transfer` logs.
 */
export interface BridgeWrappedNative {
  readonly address: Address;
  readonly code: BridgeTokenCode;
  readonly events: "weth9" | "erc20_mint_burn";
}
/**
 * Native coins are first class. The provider's zero-address wire sentinel names the native coin as a route leg and
 * is never a token. A native principal is carried by Across only: its deposit wraps into the pinned wrapped-native
 * contract and its fill unwraps from it, so both movements are provable by exact logs of that contract.
 */
export interface BridgeNativeCoin {
  readonly kind: "native";
  readonly chainId: EvmChainId;
  readonly symbol: string;
  readonly coinKey: string;
  readonly decimals: 18;
  readonly pairKey: "eth";
  readonly acrossSupported: true;
  readonly stargate: null;
  readonly peers: readonly EvmChainId[];
  readonly wrapped: BridgeWrappedNative;
  readonly listing: "frozen_list";
}
export interface BridgeTokenAsset {
  readonly kind: "erc20";
  readonly chainId: EvmChainId;
  readonly address: Address;
  readonly symbol: string;
  readonly coinKey: string;
  /** Two rows may be bridged to each other only when their pair keys match. */
  readonly pairKey: string;
  readonly decimals: number;
  readonly code: BridgeTokenCode;
  readonly acrossSupported: boolean;
  readonly stargate: BridgeStargatePool | null;
  readonly peers: readonly EvmChainId[];
  /** `zero_first`: a nonzero approve over a nonzero allowance reverts and `approve` returns no value (Tether). */
  readonly approval: "standard" | "zero_first";
  /** `tether_fee_zero`: the owner-settable transfer fee, its cap and the deprecation forward are pinned at zero. */
  readonly transferFee: "none" | "tether_fee_zero";
  /** `frozen_list` rows must equal the frozen allowlist identity; `legacy_pinned` rows predate it and stay as pinned. */
  readonly listing: "frozen_list" | "legacy_pinned";
}
export type BridgeAsset = BridgeNativeCoin | BridgeTokenAsset;
export interface BridgeChainRow {
  readonly chainId: EvmChainId;
  readonly name: string;
  readonly caip2: string;
  readonly rpcEnvironment: string;
  readonly nativeCoin: BridgeNativeCoin;
  readonly tokens: readonly BridgeTokenAsset[];
}

const native = (chainId: EvmChainId, peers: readonly EvmChainId[], wrapped: BridgeWrappedNative): BridgeNativeCoin =>
  ({ kind: "native", chainId, symbol: "ETH", coinKey: "ETH", decimals: 18, pairKey: "eth", acrossSupported: true,
    stargate: null, peers, wrapped, listing: "frozen_list" });
/** Read from mainnet: WETH9 on Ethereum and Base has no proxy slot; Arbitrum's aeWETH is an EIP-1967 transparent proxy. */
const WRAPPED_NATIVE: Readonly<Record<EvmChainId, BridgeWrappedNative>> = {
  1: { address: getAddress("0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"), events: "weth9",
    code: { upgradeability: "immutable", codeHash: "0xd0a06b12ac47863b5c7be4185c2deaad1c61557033f56c7d4ea74429cbb25e23" } },
  8453: { address: getAddress("0x4200000000000000000000000000000000000006"), events: "weth9",
    code: { upgradeability: "immutable", codeHash: "0x8a3a1f6a9f9dce633117adee5b458245835a8645a8c8726a26382a4622508b1c" } },
  42161: { address: getAddress("0x82aF49447D8a07e3bd95BD0d56f35241523fBab1"), events: "erc20_mint_burn",
    code: { upgradeability: "eip1967_proxy", codeHash: "0x2d240bb4510ed1acfeaba905eb4bcc4524d63c8ae66e48fcccac55ea714db7a7",
      implementation: getAddress("0x8b194beae1d3e0788a1a35173978001acdfba668"),
      implementationCodeHash: "0x0d1c20f9ed551efe8f402bc9aa1a9b5058f925ec615284c5b4a7a4623c3b2dcd",
      admin: getAddress("0xd570ace65c43af47101fc6250fd6fc63d1c22a86") } },
};
const config = (values: readonly string[]): BridgeStargatePool["addressConfig"] =>
  values.map((value) => getAddress(value)) as unknown as BridgeStargatePool["addressConfig"];

const USDC_ETHEREUM: BridgeTokenAsset = {
  kind: "erc20", chainId: 1, address: getAddress("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"),
  symbol: "USDC", coinKey: "USDC", pairKey: "usdc", decimals: 6, acrossSupported: true, peers: [8453, 42161],
  approval: "standard", transferFee: "none", listing: "frozen_list",
  code: { upgradeability: "legacy_proxy", codeHash: "0xd80d4b7c890cb9d6a4893e6b52bc34b56b25335cb13716e0d1d31383e6b41505",
    implementation: getAddress("0x43506849d7c04f9138d1a2050bbf3a0c054402dd"),
    implementationCodeHash: "0xcdfb7d322961af3acae7a8f7ee8b69c205b36f576cc5b077f170c7eb8ecbe3ea",
    admin: getAddress("0x807a96288a1a408dbc13de2b1d087d10356395d2") },
  stargate: { assetId: 1, router: getAddress("0xc026395860Db2d07ee33e05fE50ed7bD583189C7"),
    routerCodeHash: "0x576f02c4810c5e367e809a7bfcd31b649f3c4c5b6431c4982dc7c470687977b0", sharedDecimals: 6,
    addressConfig: config(["0x52b35406cb2fb5e0038edecfc129a152a1f74087", "0xe37f7c80ced04c4f243c0fd04a5510d663cb88b5",
      "0x1041d127b2d4bc700f0f563883bc689502606918", "0x6d6620eFa72948C5f68A3C8646d58C00d3f4A980",
      "0x9b4d17b45d60b8173a5904b85a7baaec291e9173", BRIDGE_ZERO_ADDRESS]) },
};
const USDC_BASE: BridgeTokenAsset = {
  kind: "erc20", chainId: 8453, address: getAddress("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"),
  symbol: "USDC", coinKey: "USDC", pairKey: "usdc", decimals: 6, acrossSupported: true, peers: [1, 42161],
  approval: "standard", transferFee: "none", listing: "frozen_list",
  code: { upgradeability: "legacy_proxy", codeHash: "0xa6705a10bb756b5dea144591118be77d7af0c3eee3bf2dfe2583dcb0364fefab",
    implementation: getAddress("0x2ce6311ddae708829bc0784c967b7d77d19fd779"),
    implementationCodeHash: "0x11b75a237997ab8328f65b2d5a55c10f0346d0a175741ed42ddf4f2c66b9e873",
    admin: getAddress("0x4fc7850364958d97b4d3f5a08f79db2493f8ca44") },
  stargate: { assetId: 1, router: getAddress("0x27a16dc786820B16E5c9028b75B99F6f604b5d26"),
    routerCodeHash: "0x83de1e54132ca87de00ada47aa052886e592f06b099de27a51bb34b3172ad2d0", sharedDecimals: 6,
    addressConfig: config(["0x08ed1d79d509a6f1020685535028ae60c144441e", "0xe37f7c80ced04c4f243c0fd04a5510d663cb88b5",
      "0xd47b03ee6d86cf251ee7860fb2acf9f91b9fd4d7", "0x5634c4a5FEd09819E3c46D86A965Dd9447d86e47",
      "0x12dc9256acc9895b076f6638d628382881e62cee", BRIDGE_ZERO_ADDRESS]) },
};
const USDC_ARBITRUM: BridgeTokenAsset = {
  kind: "erc20", chainId: 42161, address: getAddress("0xaf88d065e77c8cC2239327C5EDb3A432268e5831"),
  symbol: "USDC", coinKey: "USDC", pairKey: "usdc", decimals: 6, acrossSupported: true, peers: [1, 8453],
  approval: "standard", transferFee: "none", listing: "frozen_list",
  code: { upgradeability: "legacy_proxy", codeHash: "0xad30d819dbc47814b7e6cb837fd7cc57fcb591479a38596ee93de4fc52e8c435",
    implementation: getAddress("0x86e721b43d4ecfa71119dd38c0f938a75fdb57b3"),
    implementationCodeHash: "0xda0578bf7fe0d04e320e166ab8f98061328fda8ae0a299882aeb38f1543c6a9d",
    admin: getAddress("0x2e0a67588cfbcad40f9e4dd76052436190a77a68") },
  stargate: { assetId: 1, router: getAddress("0xe8CDF27AcD73a434D661C84887215F7598e7d0d3"),
    routerCodeHash: "0x3c7642aec61389f8cf5c96f6fcd821ed40bf9016285c20fb7710ef908855f4e5", sharedDecimals: 6,
    addressConfig: config(["0x80f755e3091b2ad99c08da8d13e9c7635c1b8161", "0xe37f7c80ced04c4f243c0fd04a5510d663cb88b5",
      "0x146c8e409c113ed87c6183f4d25c50251dffbb3a", "0x19cFCE47eD54a88614648DC3f19A5980097007dD",
      "0xf1fcb4cbd57b67d683972a59b6a7b1e2e8bf27e6", BRIDGE_ZERO_ADDRESS]) },
};
/** Across carries WBTC between Ethereum and Arbitrum only; Base has no canonical WBTC, so the peer set is narrower. */
const WBTC_ETHEREUM: BridgeTokenAsset = {
  kind: "erc20", chainId: 1, address: getAddress("0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599"),
  symbol: "WBTC", coinKey: "WBTC", pairKey: "wbtc", decimals: 8, acrossSupported: true, stargate: null, peers: [42161],
  approval: "standard", transferFee: "none", listing: "legacy_pinned",
  code: { upgradeability: "immutable", codeHash: "0x131ff5c755b710d543ea70fede2eb38e5d15b1456df0ae932ba12e2786f7e5df" },
};
const WBTC_ARBITRUM: BridgeTokenAsset = {
  kind: "erc20", chainId: 42161, address: getAddress("0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f"),
  symbol: "WBTC", coinKey: "WBTC", pairKey: "wbtc", decimals: 8, acrossSupported: true, stargate: null, peers: [1],
  approval: "standard", transferFee: "none", listing: "legacy_pinned",
  code: { upgradeability: "beacon_proxy", codeHash: "0x9bb54fba14f3f66acb4acfdcb38af3737d65543274ad5e9bc794080b876ddf18",
    beacon: getAddress("0xE72ba9418b5f2Ce0A6a40501Fe77c6839Aa37333"),
    beaconCodeHash: "0x335bc199b68d92971edf04b2d907a18617249dc49f86d7699c4eec68cb882d6c",
    implementation: getAddress("0x3f770Ac673856F105b586bb393d122721265aD46"),
    implementationCodeHash: "0xc62ae99da1e885d46423d6b467371cda77d1711f0201343950722f6052ddbdfb" },
};

/**
 * Tether on Ethereum, the list's only USDT deployment on these chains. The frozen list pins no USDT on Base or
 * Arbitrum One, so the row has no peer and every USDT route is refused until the list names a destination.
 * The code hash, a zero `basisPointsRate`, a zero `maximumFee` and `deprecated() == false` were read at a safe block.
 */
const USDT_ETHEREUM: BridgeTokenAsset = {
  kind: "erc20", chainId: 1, address: getAddress("0xdAC17F958D2ee523a2206206994597C13D831ec7"),
  symbol: "USDT", coinKey: "USDT", pairKey: "usdt", decimals: 6, acrossSupported: true, stargate: null, peers: [],
  approval: "zero_first", transferFee: "tether_fee_zero", listing: "frozen_list",
  code: { upgradeability: "immutable", codeHash: "0xb44fb4e949d0f78f87f79ee46428f23a2a5713ce6fc6e0beb3dda78c2ac1ea55" },
};

export const BRIDGE_ASSET_REGISTRY: Readonly<Record<EvmChainId, BridgeChainRow>> = {
  1: { chainId: 1, name: "Ethereum", caip2: "eip155:1", rpcEnvironment: "APN_ETHEREUM_RPC_URL",
    nativeCoin: native(1, [8453, 42161], WRAPPED_NATIVE[1]), tokens: [USDC_ETHEREUM, USDT_ETHEREUM, WBTC_ETHEREUM] },
  8453: { chainId: 8453, name: "Base", caip2: "eip155:8453", rpcEnvironment: "APN_BASE_RPC_URL",
    nativeCoin: native(8453, [1, 42161], WRAPPED_NATIVE[8453]), tokens: [USDC_BASE] },
  42161: { chainId: 42161, name: "Arbitrum One", caip2: "eip155:42161", rpcEnvironment: "APN_ARBITRUM_RPC_URL",
    nativeCoin: native(42161, [1, 8453], WRAPPED_NATIVE[42161]), tokens: [USDC_ARBITRUM, WBTC_ARBITRUM] },
};

export function bridgeChain(value: unknown, code: ErrorCode = "APN_PROVIDER_PROTOCOL"): EvmChainId {
  if (typeof value !== "number" || !BRIDGE_CHAINS.includes(value as EvmChainId)) bridgeFailure(code, "chain_identity");
  return value as EvmChainId;
}
export function bridgeCaip2(value: unknown): EvmChainId {
  const row = BRIDGE_CHAINS.map((id) => BRIDGE_ASSET_REGISTRY[id]).find((entry) => entry.caip2 === value);
  if (row === undefined) bridgeFailure("APN_INVALID_INPUT", "bridge_chain_CAIP2");
  return row.chainId;
}
/** CLI/request admission for a destination. Quote-only rows are returned with the legacy type at this boundary;
 * every execution boundary still calls `bridgeChain` and therefore refuses them. */
export function bridgeDestinationCaip2(value: unknown): EvmChainId {
  const execution = BRIDGE_CHAINS.map((id) => BRIDGE_ASSET_REGISTRY[id]).find((entry) => entry.caip2 === value);
  if (execution !== undefined) return execution.chainId;
  const quoted = Object.entries(BRIDGE_QUOTE_DESTINATIONS).find(([, entry]) => entry.caip2 === value);
  if (quoted === undefined) bridgeFailure("APN_INVALID_INPUT", "bridge_chain_CAIP2");
  return Number(quoted[0]) as EvmChainId;
}
export function bridgeQuoteDestination(value: unknown, code: ErrorCode = "APN_PROVIDER_PROTOCOL") {
  if (typeof value !== "number" || !(value in BRIDGE_QUOTE_DESTINATIONS)) bridgeFailure(code, "quote_destination_chain_identity");
  return BRIDGE_QUOTE_DESTINATIONS[value as BridgeQuoteDestinationChainId];
}
export function bridgeDestinationChain(value: unknown, code: ErrorCode = "APN_PROVIDER_PROTOCOL"): EvmChainId {
  if (typeof value === "number" && BRIDGE_CHAINS.includes(value as EvmChainId)) return value as EvmChainId;
  bridgeQuoteDestination(value, code);
  return value as EvmChainId;
}
export function bridgeExecutionDestination(value: unknown): value is EvmChainId {
  return typeof value === "number" && BRIDGE_CHAINS.includes(value as EvmChainId);
}
export function bridgeChainRow(value: unknown, code: ErrorCode = "APN_PROVIDER_PROTOCOL"): BridgeChainRow {
  return BRIDGE_ASSET_REGISTRY[bridgeChain(value, code)];
}
export function bridgeNativeCoin(chainId: unknown, code: ErrorCode = "APN_PROVIDER_PROTOCOL"): BridgeNativeCoin {
  return bridgeChainRow(chainId, code).nativeCoin;
}
/** The one admission point for a bridgeable token. The zero address is the native sentinel and is never a token. */
export function bridgeTokenRow(chainId: unknown, address: unknown, code: ErrorCode = "APN_PROVIDER_PROTOCOL"): BridgeTokenAsset {
  const asset = bridgeAssetRow(bridgeChain(chainId, code), address, code);
  if (asset.kind === "native") bridgeFailure(code, "native_sentinel_is_not_a_token");
  return asset;
}
/**
 * The one admission point for a route leg. The zero address names the chain's native coin; any other address must be
 * a registry row. An address the frozen list does not name is refused as unlisted, never matched by symbol.
 */
export function bridgeAssetRow(chainId: unknown, address: unknown, code: ErrorCode = "APN_PROVIDER_PROTOCOL"): BridgeAsset {
  if (!bridgeExecutionDestination(chainId)) {
    const row = bridgeQuoteDestination(chainId, code), token = bridgeAddress(address, code);
    if (token !== row.token) bridgeFailure(code, bridgeTokenListed(row.caip2, token) ? "asset_listed_not_bridge_admitted" : "asset_not_on_frozen_list");
    if (!bridgeTokenListed(row.caip2, token)) bridgeFailure("APN_INTERNAL", "bridge_quote_destination_list_drift");
    return { kind: "erc20", chainId: chainId as EvmChainId, address: row.token, symbol: "USDC", coinKey: "USDC",
      pairKey: "usdc", decimals: 6, acrossSupported: row.tools.includes("across" as never), stargate: null, peers: [1],
      approval: "standard", transferFee: "none", listing: "frozen_list",
      code: { upgradeability: "immutable", codeHash: `0x${"0".repeat(64)}` } };
  }
  const row = bridgeChainRow(chainId, code), token = bridgeAddress(address, code);
  assertBridgeRegistryListed(BRIDGE_ASSET_REGISTRY);
  if (token === BRIDGE_ZERO_ADDRESS) return row.nativeCoin;
  const asset = row.tokens.find((entry) => entry.address === token);
  if (asset === undefined) bridgeFailure(code, bridgeTokenListed(row.caip2, token) ? "asset_listed_not_bridge_admitted" : "asset_not_on_frozen_list");
  return asset;
}
/** The wire identity of a route leg: the token contract, or the provider's zero-address sentinel for the native coin. */
export function bridgeAssetAddress(asset: BridgeAsset): Address { return asset.kind === "native" ? BRIDGE_ZERO_ADDRESS : asset.address; }
/** The identity a declared fee row carries for this asset: `"native"` for the native coin, else the token contract. */
export function bridgeFeeAsset(asset: BridgeAsset): Address | "native" { return asset.kind === "native" ? "native" : asset.address; }
export function bridgeNativePrincipal(request: Pick<BridgeRouteRequest, "fromToken">): boolean { return request.fromToken === BRIDGE_ZERO_ADDRESS; }
/** Both legs must share a pair key, decimals and each other's chain as a peer: native pairs with native, a token with its own. */
export function bridgeAssetPair(request: Pick<BridgeRouteRequest, "fromChainId" | "toChainId" | "fromToken" | "toToken">,
  code: ErrorCode = "APN_PROVIDER_PROTOCOL"): { readonly from: BridgeAsset; readonly to: BridgeAsset } {
  const from = bridgeAssetRow(request.fromChainId, request.fromToken, code);
  const to = bridgeAssetRow(request.toChainId, request.toToken, code);
  if (!bridgeExecutionDestination(request.toChainId)) {
    if (request.fromChainId !== 1 || from.kind !== "erc20" || to.kind !== "erc20" || from.symbol !== "USDC" ||
      from.pairKey !== to.pairKey || from.decimals !== to.decimals) bridgeFailure(code, "admitted_quote_asset_pair");
    return { from, to };
  }
  if (from.peers.length === 0) bridgeFailure(code, "asset_has_no_listed_peer");
  if (from.chainId === to.chainId || from.kind !== to.kind || from.pairKey !== to.pairKey || from.decimals !== to.decimals ||
    !from.peers.includes(to.chainId) || !to.peers.includes(from.chainId)) bridgeFailure(code, "admitted_asset_pair");
  return { from, to };
}
/** The peer chain's row for the same pair key, which is what a cross-chain tool pin and a route pair must agree on. */
export function bridgePeerToken(asset: BridgeTokenAsset, peerChainId: EvmChainId,
  code: ErrorCode = "APN_PROVIDER_CAPABILITY_UNAVAILABLE"): BridgeTokenAsset {
  if (!asset.peers.includes(peerChainId)) bridgeFailure(code, "finite_chain");
  const row = bridgeChainRow(peerChainId, code).tokens.find((entry) => entry.pairKey === asset.pairKey && entry.decimals === asset.decimals);
  if (row === undefined) bridgeFailure(code, "asset_peer_not_admitted");
  return row;
}
export function bridgeAssetTool(asset: BridgeAsset, tool: BridgeTool, code: ErrorCode = "APN_PROVIDER_CAPABILITY_UNAVAILABLE"): BridgeStargatePool | null {
  if (tool === "across") {
    if (!asset.acrossSupported) bridgeFailure(code, "across_asset_unsupported");
    return null;
  }
  if (tool !== "stargateV2") bridgeFailure(code, "finite_tool");
  if (asset.stargate === null) bridgeFailure(code, "stargate_pool_asset_unreviewed");
  return asset.stargate;
}
/** Parses one decimal amount at the admitted asset's exact precision. */
export function bridgeDecimal(value: unknown, decimals: number, positive = false): string {
  if (!Number.isSafeInteger(decimals) || decimals < 0 || decimals > 18) bridgeFailure("APN_INVALID_INPUT", "asset_decimals");
  const pattern = new RegExp(`^(?:0|[1-9][0-9]{0,71})${decimals === 0 ? "" : `(?:\\.[0-9]{1,${decimals}})?`}$`, "u");
  if (typeof value !== "string" || !pattern.test(value)) bridgeFailure("APN_INVALID_INPUT", "asset_decimal_amount");
  const [whole, fraction = ""] = value.split(".");
  const result = BigInt(whole!) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, "0") || "0");
  bridgeUint(result.toString(), positive, "APN_INVALID_INPUT");
  return result.toString();
}
export function validateBridgeRequest(value: unknown, code: ErrorCode = "APN_INVALID_INPUT"): BridgeRouteRequest {
  const r = bridgeExact(value, ["fromChainId", "toChainId", "fromToken", "toToken", "amountAtomic", "recipient",
    "minOutputAtomic", "maxNativeDebitWei", "maxRouteFeeAtomic", "slippageBps"], code);
  const pair = bridgeAssetPair({ fromChainId: bridgeChain(r.fromChainId, code), toChainId: bridgeDestinationChain(r.toChainId, code),
    fromToken: bridgeAddress(r.fromToken, code), toToken: bridgeAddress(r.toToken, code) }, code);
  if (r.fromToken !== bridgeAssetAddress(pair.from) || r.toToken !== bridgeAssetAddress(pair.to) ||
    bridgeAddress(r.recipient, code) !== r.recipient || r.recipient === BRIDGE_ZERO_ADDRESS) bridgeFailure(code, "canonical_addresses");
  const amount = bridgeUint(r.amountAtomic, true, code), minimum = bridgeUint(r.minOutputAtomic, true, code);
  bridgeUint(r.maxNativeDebitWei, true, code); bridgeUint(r.maxRouteFeeAtomic, false, code);
  if (minimum > amount || typeof r.slippageBps !== "number" || !Number.isInteger(r.slippageBps) ||
    r.slippageBps < 0 || r.slippageBps > 1000) bridgeFailure(code, "output_or_slippage");
  return r as unknown as BridgeRouteRequest;
}
