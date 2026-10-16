import { getAddress } from "viem";
import type { CandidateAsset } from "../allowlist-inventory.js";
import { canonicalJson, exactKeys, isPlainRecord } from "../canonical.js";
import { MEGAETH_USDM, MERCHANT_ASSET_PINS, type MerchantAssetPin } from "./asset-pins.js";

/** MegaETH: the one chain whose transfer-proof fee model APN implements. Public keyless RPC. */
export const MERCHANT_RPC = "https://mainnet.megaeth.com/rpc";
export const MERCHANT_CHAIN = "eip155:4326";
/** The x402 ERC-20 transfer-proof mechanism. Its reference names the asset: `<chain>/<token>`. */
export const MERCHANT_PROVIDER = "x402-erc20-transfer-proof";
export function merchantAssetMechanism(asset: Pick<MerchantAssetPin, "chain" | "token">): Readonly<{ provider: string; reference: string }> {
  return { provider: MERCHANT_PROVIDER, reference: `${asset.chain}/${asset.token}` };
}
/** The registry entry for an exact (chain, token), or undefined. */
export function merchantAssetPin(chain: unknown, token: unknown, registry: readonly MerchantAssetPin[] = MERCHANT_ASSET_PINS): MerchantAssetPin | undefined {
  if (typeof chain !== "string" || typeof token !== "string") return undefined;
  let canonical: string; try { canonical = getAddress(token); } catch { return undefined; }
  return registry.find((pin) => pin.chain === chain && pin.token === canonical);
}

/**
 * Frozen legacy table (OWNR 5.3): the x402engine Bitcoin-price lane of 0.5.41-0.5.43. Version 1 operations and the
 * policies that admit them keep reading these values; a new prepare never uses the legacy mechanism.
 */
export const LEGACY_MERCHANT_URL = "https://x402engine.app/api/crypto/price?ids=bitcoin";
export const LEGACY_MERCHANT_PAYEE = getAddress("0x7dd5Be069f2d2eAd75eC7C3423B116fF043c2629");
export const LEGACY_MERCHANT_AMOUNT = "1000000000000000";
export const LEGACY_MERCHANT_MECHANISM = { provider: "x402engine-erc20-transfer-proof", reference: "megaeth-usdm-crypto-price-v1" } as const;
export const LEGACY_MERCHANT_ASSET: MerchantAssetPin = MEGAETH_USDM;

/** A stored v2 asset binding: the registry entry exactly as frozen at prepare. Never compared with the current registry. */
export function validMerchantAssetPin(value: unknown): value is MerchantAssetPin {
  if (!isPlainRecord(value) || !exactKeys(value, ["chain", "networkName", "token", "name", "symbol", "decimals", "evidence", ...(value.deployment === undefined ? [] : ["deployment"])])) return false;
  const text = (v: unknown, max: number) => typeof v === "string" && v.length > 0 && v.length <= max;
  let token: string; try { token = getAddress(String(value.token)); } catch { return false; }
  const d = value.deployment;
  return value.chain === MERCHANT_CHAIN && value.networkName === "MegaETH" && token === value.token && text(value.name, 64) && text(value.symbol, 16) &&
    Number.isSafeInteger(value.decimals) && (value.decimals as number) >= 0 && (value.decimals as number) <= 36 && text(value.evidence, 256) &&
    (d === undefined || isPlainRecord(d) && exactKeys(d, ["proxyCodeHash", "implementation", "implementationCodeHash", "domainVersion"]) &&
      [d.proxyCodeHash, d.implementationCodeHash].every((h) => typeof h === "string" && /^0x[0-9a-f]{64}$/u.test(h)) &&
      typeof d.implementation === "string" && /^0x[0-9a-fA-F]{40}$/u.test(d.implementation) && text(d.domainVersion, 32));
}

function candidate(pin: MerchantAssetPin, kind: "token" | "native"): CandidateAsset {
  return { chain: pin.chain, family: "evm", networkName: pin.networkName, kind, identifier: kind === "token" ? pin.token : null,
    symbol: kind === "token" ? pin.symbol : "ETH", decimals: kind === "token" ? pin.decimals : 18, selectionClass: null,
    tokenStandard: kind === "token" ? "ERC-20" : null, eligibility: null, rails: { direct: false, gasless: false, x402: false, bridge: false, swap: false },
    caps: null, evidence: { source: pin.evidence }, admission: "not_admitted_owner_configuration_missing" };
}
/**
 * Policy identity of a merchant asset and its native fee on the x402 rail, only under the exact mechanism that names it:
 * the asset's own `x402-erc20-transfer-proof` reference, or the legacy x402engine reference for USDm. Listing grants no
 * admission; the owner still stages and activates caps.
 */
export function merchantPolicyAsset(input: {
    chain: string;
    kind: string;
    identifier?: string;
    rail: string;
    mechanism?: unknown;
    mechanisms?: unknown;
}): CandidateAsset | undefined {
  if (input.rail !== "x402" || input.mechanisms !== undefined || !isPlainRecord(input.mechanism)) return undefined;
  const mechanism = input.mechanism, legacy = canonicalJson(mechanism) === canonicalJson(LEGACY_MERCHANT_MECHANISM);
  const pin = legacy ? LEGACY_MERCHANT_ASSET : MERCHANT_ASSET_PINS.find((entry) => canonicalJson(merchantAssetMechanism(entry)) === canonicalJson(mechanism));
  if (pin === undefined || input.chain !== pin.chain) return undefined;
  if (input.kind === "native" && input.identifier === undefined) return candidate(pin, "native");
  return input.kind === "token" && input.identifier === pin.token ? candidate(pin, "token") : undefined;
}
