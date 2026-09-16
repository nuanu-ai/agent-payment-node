import { getAddress } from "viem";
import type { ErrorCode } from "../errors.js";
import type { EvmChainId } from "../evm-asset.js";
import type { Address, Hex } from "../model.js";
import type { BridgeRouteRequest, BridgeTool } from "./model.js";
import { BRIDGE_ZERO_ADDRESS, bridgeAddress, bridgeExact, bridgeFailure, bridgeUint } from "./validation.js";

/**
 * The single source of admitted bridge chains and assets. Every chain identity, native coin, token address,
 * decimals count and contract pin the rail trusts is a row here; nothing else in `src/lifi/**` may carry its own
 * copy. A row exists only when its on-chain identity can be pinned the way canonical USDC already is.
 */
export const BRIDGE_CHAINS = [1, 8453, 42161] as const;

/** Native coins are first class: the provider's zero-address sentinel is never an admitted asset. */
export interface BridgeNativeCoin {
  readonly kind: "native";
  readonly chainId: EvmChainId;
  readonly symbol: string;
  readonly coinKey: string;
  readonly decimals: 18;
}
/** Each upgradeability shape is pinned explicitly; there is no default shape for an unreviewed proxy. */
export type BridgeTokenCode =
  | { readonly upgradeability: "immutable"; readonly codeHash: Hex }
  | { readonly upgradeability: "legacy_proxy"; readonly codeHash: Hex; readonly implementation: Address;
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

const native = (chainId: EvmChainId): BridgeNativeCoin => ({ kind: "native", chainId, symbol: "ETH", coinKey: "ETH", decimals: 18 });
const config = (values: readonly string[]): BridgeStargatePool["addressConfig"] =>
  values.map((value) => getAddress(value)) as unknown as BridgeStargatePool["addressConfig"];

const USDC_ETHEREUM: BridgeTokenAsset = {
  kind: "erc20", chainId: 1, address: getAddress("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"),
  symbol: "USDC", coinKey: "USDC", pairKey: "usdc", decimals: 6, acrossSupported: true, peers: [8453, 42161],
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
  code: { upgradeability: "immutable", codeHash: "0x131ff5c755b710d543ea70fede2eb38e5d15b1456df0ae932ba12e2786f7e5df" },
};
const WBTC_ARBITRUM: BridgeTokenAsset = {
  kind: "erc20", chainId: 42161, address: getAddress("0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f"),
  symbol: "WBTC", coinKey: "WBTC", pairKey: "wbtc", decimals: 8, acrossSupported: true, stargate: null, peers: [1],
  code: { upgradeability: "beacon_proxy", codeHash: "0x9bb54fba14f3f66acb4acfdcb38af3737d65543274ad5e9bc794080b876ddf18",
    beacon: getAddress("0xE72ba9418b5f2Ce0A6a40501Fe77c6839Aa37333"),
    beaconCodeHash: "0x335bc199b68d92971edf04b2d907a18617249dc49f86d7699c4eec68cb882d6c",
    implementation: getAddress("0x3f770Ac673856F105b586bb393d122721265aD46"),
    implementationCodeHash: "0xc62ae99da1e885d46423d6b467371cda77d1711f0201343950722f6052ddbdfb" },
};

export const BRIDGE_ASSET_REGISTRY: Readonly<Record<EvmChainId, BridgeChainRow>> = {
  1: { chainId: 1, name: "Ethereum", caip2: "eip155:1", rpcEnvironment: "APN_ETHEREUM_RPC_URL",
    nativeCoin: native(1), tokens: [USDC_ETHEREUM, WBTC_ETHEREUM] },
  8453: { chainId: 8453, name: "Base", caip2: "eip155:8453", rpcEnvironment: "APN_BASE_RPC_URL",
    nativeCoin: native(8453), tokens: [USDC_BASE] },
  42161: { chainId: 42161, name: "Arbitrum One", caip2: "eip155:42161", rpcEnvironment: "APN_ARBITRUM_RPC_URL",
    nativeCoin: native(42161), tokens: [USDC_ARBITRUM, WBTC_ARBITRUM] },
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
export function bridgeChainRow(value: unknown, code: ErrorCode = "APN_PROVIDER_PROTOCOL"): BridgeChainRow {
  return BRIDGE_ASSET_REGISTRY[bridgeChain(value, code)];
}
export function bridgeNativeCoin(chainId: unknown, code: ErrorCode = "APN_PROVIDER_PROTOCOL"): BridgeNativeCoin {
  return bridgeChainRow(chainId, code).nativeCoin;
}
/** The one admission point for a bridgeable asset. The zero address is the native sentinel and is never a token. */
export function bridgeTokenRow(chainId: unknown, address: unknown, code: ErrorCode = "APN_PROVIDER_PROTOCOL"): BridgeTokenAsset {
  const row = bridgeChainRow(chainId, code), token = bridgeAddress(address, code);
  if (token === BRIDGE_ZERO_ADDRESS) bridgeFailure(code, "native_sentinel_is_not_a_token");
  const asset = row.tokens.find((entry) => entry.address === token);
  if (asset === undefined) bridgeFailure(code, "asset_not_admitted");
  return asset;
}
/** Native principal is not admitted: the fee forwarder, allowance and Transfer-log evidence are all ERC-20 shaped. */
export function bridgeAssetPair(request: Pick<BridgeRouteRequest, "fromChainId" | "toChainId" | "fromToken" | "toToken">,
  code: ErrorCode = "APN_PROVIDER_PROTOCOL"): { readonly from: BridgeTokenAsset; readonly to: BridgeTokenAsset } {
  const from = bridgeTokenRow(request.fromChainId, request.fromToken, code);
  const to = bridgeTokenRow(request.toChainId, request.toToken, code);
  if (from.chainId === to.chainId || from.pairKey !== to.pairKey || from.decimals !== to.decimals ||
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
export function bridgeAssetTool(asset: BridgeTokenAsset, tool: BridgeTool, code: ErrorCode = "APN_PROVIDER_CAPABILITY_UNAVAILABLE"): BridgeStargatePool | null {
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
  const pair = bridgeAssetPair({ fromChainId: bridgeChain(r.fromChainId, code), toChainId: bridgeChain(r.toChainId, code),
    fromToken: bridgeAddress(r.fromToken, code), toToken: bridgeAddress(r.toToken, code) }, code);
  if (r.fromToken !== pair.from.address || r.toToken !== pair.to.address ||
    bridgeAddress(r.recipient, code) !== r.recipient || r.recipient === BRIDGE_ZERO_ADDRESS) bridgeFailure(code, "canonical_addresses");
  const amount = bridgeUint(r.amountAtomic, true, code), minimum = bridgeUint(r.minOutputAtomic, true, code);
  bridgeUint(r.maxNativeDebitWei, true, code); bridgeUint(r.maxRouteFeeAtomic, false, code);
  if (minimum > amount || typeof r.slippageBps !== "number" || !Number.isInteger(r.slippageBps) ||
    r.slippageBps < 0 || r.slippageBps > 1000) bridgeFailure(code, "output_or_slippage");
  return r as unknown as BridgeRouteRequest;
}
