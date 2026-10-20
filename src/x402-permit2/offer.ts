import { getAddress, isAddress } from "viem";
import { canonicalJson, domainHash, exactKeys, isPlainRecord } from "../canonical.js";
import { ApnError } from "../errors.js";
import type { Address } from "../model.js";
import {
  PERMIT2_ADDRESS,
  X402_EXACT_PERMIT2_PROXY,
  X402_EXACT_PERMIT2_PROXY_CODE_HASH,
  X402_PERMIT2_MAX_TIMEOUT_SECONDS,
  type Permit2AssetResolver,
  type Permit2ListAsset,
} from "./registry.js";

const OFFER_DOMAIN = "apn.x402-permit2.offer.v1";
const MAX_UINT256 = (1n << 256n) - 1n;
const ZERO = "0x0000000000000000000000000000000000000000";

/** One x402 v2 PaymentRequirements object exactly as the seller sent it; never rewritten. */
export interface Permit2Requirement {
  readonly scheme: "exact";
  readonly network: string;
  readonly asset: string;
  readonly amount: string;
  readonly payTo: string;
  readonly maxTimeoutSeconds: number;
  readonly extra: Readonly<Record<string, string>>;
}

export interface Permit2OfferSelection {
  /** Original index in the seller's `accepts` list. */
  readonly index: number;
  readonly requirement: Permit2Requirement;
  readonly listAsset: Permit2ListAsset;
  readonly amountAtomic: string;
  readonly payTo: Address;
  readonly maxTimeoutSeconds: number;
  readonly offerHash: string;
}

export type Permit2OfferRefusal =
  | "x402_permit2_no_listed_offer" | "x402_permit2_offer_invalid" | "x402_permit2_facilitator_unavailable";

/**
 * Select the lowest-index seller offer whose (network, token) `resolve` admits, paid through the exact Permit2 flow.
 * Unsupported offers may coexist; they are skipped, never repaired. An admitted offer with any deviation (unknown
 * field, another transfer method, a token domain hint other than the asset's, unbounded timeout) is not selectable.
 */
export function selectPermit2Offer(accepts: readonly unknown[], payer: Address, resolve: Permit2AssetResolver): Permit2OfferSelection {
  if (!Array.isArray(accepts) || accepts.length === 0) refuse("x402_permit2_no_listed_offer", "The seller offered no payment requirements.");
  const payerAddress = strictAddress(payer);
  if (payerAddress === undefined) throw new ApnError("APN_INVALID_INPUT", "The payer must be an exact EVM address.");
  let listedButInvalid = false;
  for (const [index, offer] of accepts.entries()) {
    if (!isPlainRecord(offer) || typeof offer.network !== "string") continue;
    const token = strictAddress(offer.asset);
    if (token === undefined) continue;
    const listAsset = resolve(offer.network, token, isPlainRecord(offer.extra) ? offer.extra : {});
    if (listAsset === undefined || listAsset.chain !== offer.network || listAsset.token.toLowerCase() !== token.toLowerCase()) continue;
    const selection = validateOffer(index, offer, listAsset, payerAddress);
    if (selection !== undefined) return selection;
    listedButInvalid = true;
  }
  if (listedButInvalid) refuse("x402_permit2_offer_invalid", "The seller's Permit2 offer for an admitted token is not an exact Permit2 offer APN can sign.");
  return refuse("x402_permit2_no_listed_offer", "No seller offer pays an owner-admitted token through the exact Permit2 flow.");
}

/** Revalidate a frozen selection against the asset it carries; any drift is state corruption. */
export function validatePermit2Selection(value: Permit2OfferSelection, payer: Address): Permit2OfferSelection {
  const listAsset = isPlainRecord(value) && validAsset(value.listAsset) ? value.listAsset : undefined;
  const again = listAsset === undefined || !Number.isSafeInteger(value.index) || value.index < 0 ||
    value.requirement?.network !== listAsset.chain || !sameAddress(value.requirement?.asset, listAsset.token)
    ? undefined : validateOffer(value.index, value.requirement as unknown as Record<string, unknown>, listAsset, payer);
  if (again === undefined || canonicalJson(again) !== canonicalJson(value)) {
    throw new ApnError("APN_STATE_CORRUPT", "The frozen x402 Permit2 offer selection is invalid.");
  }
  return again;
}

function validateOffer(index: number, offer: Record<string, unknown>, listAsset: Permit2ListAsset, payer: Address): Permit2OfferSelection | undefined {
  if (!exactKeys(offer, ["scheme", "network", "asset", "amount", "payTo", "maxTimeoutSeconds", "extra"]) || offer.scheme !== "exact") return undefined;
  if (!validExtra(offer.extra, listAsset)) return undefined;
  if (typeof offer.amount !== "string" || !/^[1-9][0-9]{0,77}$/u.test(offer.amount) || BigInt(offer.amount) > MAX_UINT256) return undefined;
  if (typeof offer.maxTimeoutSeconds !== "number" || !Number.isSafeInteger(offer.maxTimeoutSeconds) ||
      offer.maxTimeoutSeconds < 1 || offer.maxTimeoutSeconds > X402_PERMIT2_MAX_TIMEOUT_SECONDS) return undefined;
  const payTo = strictAddress(offer.payTo);
  if (payTo === undefined || [ZERO, payer, listAsset.token, PERMIT2_ADDRESS, X402_EXACT_PERMIT2_PROXY].some((address) => sameAddress(payTo, address))) {
    return undefined;
  }
  const requirement = structuredClone(offer) as unknown as Permit2Requirement;
  return {
    index,
    requirement,
    listAsset,
    amountAtomic: offer.amount,
    payTo,
    maxTimeoutSeconds: offer.maxTimeoutSeconds,
    offerHash: domainHash(OFFER_DOMAIN, canonicalJson(requirement)),
  };
}

/** `name`/`version` are optional seller hints; when present they must equal the asset's token domain exactly. */
function validExtra(value: unknown, listAsset: Permit2ListAsset): boolean {
  if (!isPlainRecord(value) || value.assetTransferMethod !== "permit2") return false;
  if (exactKeys(value, ["assetTransferMethod"])) return true;
  return exactKeys(value, ["assetTransferMethod", "name", "version"]) && listAsset.tokenDomain !== null &&
    value.name === listAsset.tokenDomain.name && value.version === listAsset.tokenDomain.version;
}

/** A carried asset is self-consistent: CAIP-2 and chain id agree, exact token, the one proxy code, well-formed domain facts. */
function validAsset(value: unknown): value is Permit2ListAsset {
  if (!isPlainRecord(value) || !exactKeys(value, ["chain", "chainId", "networkName", "token", "symbol", "decimals", "tokenDomain",
    "tokenDomainSeparator", "proxyCodeHash"])) return false;
  const domain = value.tokenDomain;
  return typeof value.chainId === "number" && Number.isSafeInteger(value.chainId) && value.chainId > 0 && value.chain === `eip155:${value.chainId}` &&
    strictAddress(value.token) === value.token && typeof value.networkName === "string" && typeof value.symbol === "string" &&
    typeof value.decimals === "number" && Number.isSafeInteger(value.decimals) && value.decimals >= 0 && value.decimals <= 255 &&
    value.proxyCodeHash === X402_EXACT_PERMIT2_PROXY_CODE_HASH &&
    (domain === null || isPlainRecord(domain) && exactKeys(domain, ["name", "version"]) && typeof domain.name === "string" && typeof domain.version === "string") &&
    (value.tokenDomainSeparator === null || typeof value.tokenDomainSeparator === "string" && /^0x[0-9a-f]{64}$/u.test(value.tokenDomainSeparator));
}

function strictAddress(value: unknown): Address | undefined {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/u.test(value)) return undefined;
  // Mixed case must be a valid EIP-55 checksum; all-lowercase or all-uppercase hex carries no checksum.
  const hex = value.slice(2), unchecksummed = hex === hex.toLowerCase() || hex === hex.toUpperCase();
  if (!unchecksummed && !isAddress(value, { strict: true })) return undefined;
  return getAddress(value.toLowerCase()) as Address;
}

function sameAddress(left: unknown, right: string): boolean {
  const parsed = strictAddress(left);
  return parsed !== undefined && parsed.toLowerCase() === right.toLowerCase();
}

function refuse(reason: Permit2OfferRefusal, message: string): never {
  throw new ApnError("APN_X402_UNSUPPORTED_OFFER", message, { reason, rail: "x402" });
}
