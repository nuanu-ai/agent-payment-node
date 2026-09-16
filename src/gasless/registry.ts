import { encodeAbiParameters, getAddress, hashDomain, parseAbiParameters, toFunctionSelector } from "viem";
import { hashObject } from "../canonical.js";
import type { Address, Hex } from "../model.js";
import type { GaslessAsset, GaslessChainId, GaslessDeployment, GaslessIntent, GaslessTokenDomain } from "./model.js";
import { GASLESS_REGISTRY_DATA } from "./registry-data.js";
import { gaslessChain, gaslessFailure, gaslessSame } from "./validation.js";

const ENTRY_POINT = getAddress("0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108");
const DELEGATE = getAddress("0xe6Cae83BdE06E4c305530e199D7217f42808555B");
const MAX_DECIMALS = 36;
/** `GaslessAsset.code` holds the token proxy, its implementation and its signature library, then the paymaster pair. */
const TOKEN_CODE_PINS = 3;
const DOMAIN_TYPES = { EIP712Domain: [{ name: "name", type: "string" }, { name: "version", type: "string" },
  { name: "chainId", type: "uint256" }, { name: "verifyingContract", type: "address" }] } as const;
const word = (value: string): Hex => `0x${value.replace(/^0x/u, "").toLowerCase().padStart(64, "0")}`;
const call = (address: Address, signature: string, expected: Hex) => ({
  kind: "call" as const, address, data: toFunctionSelector(signature), expected,
});
const storage = (address: Address, slot: Hex, expected: Hex) => ({ kind: "storage" as const, address, data: slot, expected });

type TokenRow = typeof GASLESS_REGISTRY_DATA[number]["tokens"][number];

function gaslessAssetRow(chainId: GaslessChainId, t: TokenRow): GaslessAsset {
  const token = getAddress(t.address), paymaster = getAddress(t.paymaster.address);
  const domain: GaslessTokenDomain = { name: t.name, version: t.permitDomainVersion, chainId,
    verifyingContract: token, domainSeparator: t.domainSeparator };
  if (hashDomain({ domain: { name: domain.name, version: domain.version, chainId: BigInt(chainId),
    verifyingContract: token }, types: DOMAIN_TYPES }) !== domain.domainSeparator) {
    gaslessFailure("APN_STATE_CORRUPT", "gasless_registry_domain");
  }
  if (!Number.isSafeInteger(t.decimals) || t.decimals < 0 || t.decimals > MAX_DECIMALS ||
    !/^(?:0|[1-9][0-9]{0,18})$/u.test(t.balanceLayout.mappingSlotAtomic)) {
    gaslessFailure("APN_STATE_CORRUPT", "gasless_registry_asset");
  }
  return { chainId, token, symbol: t.symbol, decimals: t.decimals, domain, paymaster,
    wrappedNativeToken: getAddress(t.paymaster.wrappedNativeToken),
    implementation: getAddress(t.implementation), implementationHash: t.implementationHash,
    balanceLayout: t.balanceLayout,
    code: [
      { address: token, codeHash: t.proxyHash },
      { address: getAddress(t.implementation), codeHash: t.implementationHash },
      { address: getAddress(t.signatureChecker), codeHash: t.signatureCheckerHash },
      { address: paymaster, codeHash: t.paymaster.proxyHash },
      { address: getAddress(t.paymaster.implementation), codeHash: t.paymaster.implementationHash },
    ] };
}

export const GASLESS_DEPLOYMENTS: readonly GaslessDeployment[] = deepFreeze(GASLESS_REGISTRY_DATA.map((r) => {
  const chainId = gaslessChain(r.chainId, "APN_STATE_CORRUPT");
  const assets = r.tokens.map((t) => gaslessAssetRow(chainId, t));
  const primary = assets[0];
  if (primary === undefined || new Set(assets.map((a) => a.token)).size !== assets.length) {
    gaslessFailure("APN_STATE_CORRUPT", "gasless_registry_asset");
  }
  return { chainId, network: r.label, rpcEnv: `APN_${r.network}_RPC_URL`,
    bundlerEnv: `APN_${r.network}_BUNDLER_RPC_URL`, publicBundlerUrl: r.publicBundlerUrl,
    token: primary.token, tokenDomain: primary.domain, paymaster: primary.paymaster,
    entryPoint: ENTRY_POINT, delegate: DELEGATE, assets,
    // Token side of every asset, then the chain-level pair, then each asset's paymaster side.
    code: [
      ...assets.flatMap((a) => a.code.slice(0, TOKEN_CODE_PINS)),
      { address: ENTRY_POINT, codeHash: r.entryPointHash },
      { address: DELEGATE, codeHash: r.delegateHash },
      ...assets.flatMap((a) => a.code.slice(TOKEN_CODE_PINS)),
    ], reads: [
      ...r.tokens.map((t) => storage(getAddress(t.address), t.implementationSlot, word(t.implementation))),
      ...r.tokens.map((t) => storage(getAddress(t.paymaster.address), t.paymaster.implementationSlot,
        word(t.paymaster.implementation))),
      ...assets.flatMap((a) => [call(a.paymaster, "entryPoint()", word(ENTRY_POINT)),
        call(a.paymaster, "token()", word(a.token)),
        call(a.paymaster, "wrappedNativeToken()", word(a.wrappedNativeToken))]),
      call(DELEGATE, "entryPoint()", word(ENTRY_POINT)),
      ...assets.flatMap((a) => [
        call(a.token, "name()", encodeAbiParameters(parseAbiParameters("string"), [a.domain.name])),
        call(a.token, "decimals()", word(a.decimals.toString())),
        call(a.token, "DOMAIN_SEPARATOR()", a.domain.domainSeparator)]),
    ], evidenceHash: "b05aca1551fafb5734cccc0fe2b51d493782471544d03e63ae267c4b58104972" } satisfies GaslessDeployment;
}));

export function gaslessDeployment(chainId: GaslessChainId): GaslessDeployment {
  const row = GASLESS_DEPLOYMENTS.find((d) => d.chainId === gaslessChain(chainId));
  if (row === undefined) gaslessFailure("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "gasless_chain_unavailable");
  return row;
}
/** The admitted asset a chain/token pair names. No token outside its chain's row is ever addressable. */
export function gaslessAsset(chainId: GaslessChainId, token: Address): GaslessAsset {
  const asset = gaslessDeployment(chainId).assets.find((a) => a.token === token);
  if (asset === undefined) gaslessFailure("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "gasless_asset_unavailable");
  return asset;
}
/**
 * Re-validates a stored intent's asset identity against the registry row it names: the permit domain, the sponsoring
 * paymaster and the chain must all still be the row's, so a durable record can never widen what it was admitted under.
 */
export function gaslessIntentAsset(intent: Pick<GaslessIntent, "request" | "token" | "tokenDomain" | "paymaster">): GaslessAsset {
  const asset = gaslessAsset(intent.request.chainId, intent.token);
  if (!gaslessSame(intent.tokenDomain, asset.domain) || intent.paymaster !== asset.paymaster) {
    gaslessFailure("APN_PROVIDER_PROTOCOL", "gasless_protocol_identity");
  }
  return asset;
}
export function gaslessProtocolHash(row: GaslessDeployment): string {
  return hashObject({ chainId: row.chainId, token: row.token, tokenDomain: row.tokenDomain,
    paymaster: row.paymaster, entryPoint: row.entryPoint, delegate: row.delegate, code: row.code, reads: row.reads });
}
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
