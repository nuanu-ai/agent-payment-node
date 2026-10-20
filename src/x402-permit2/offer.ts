import { getAddress, isAddress } from "viem";
import { canonicalJson, domainHash, exactKeys, isPlainRecord } from "../canonical.js";
import { ApnError } from "../errors.js";
import type { Address } from "../model.js";
import { decimalsRefusal, declaredMethod, evmExtraRefusal, evmOfferMethod, isOfferRefusal, offerRefusal, refusedOffersDetails, timeoutRefusal,
  type X402OfferRefusal, type X402RefusedOffer } from "../x402-offer-terms.js";
import {
  PERMIT2_ADDRESS,
  X402_EXACT_PERMIT2_PROXY,
  X402_EXACT_PERMIT2_PROXY_CODE_HASH,
  type Permit2AssetResolver,
  type Permit2ListAsset,
} from "./registry.js";

const OFFER_DOMAIN = "apn.x402-permit2.offer.v1";
const MAX_UINT256 = (1n << 256n) - 1n;
const ZERO = "0x0000000000000000000000000000000000000000";
const OFFER_KEYS = ["scheme", "network", "asset", "amount", "payTo", "maxTimeoutSeconds", "extra"];

/** One x402 v2 PaymentRequirements object exactly as the seller sent it; never rewritten. */
export interface Permit2Requirement {
  readonly scheme: "exact";
  readonly network: string;
  readonly asset: string;
  readonly amount: string;
  readonly payTo: string;
  readonly maxTimeoutSeconds: number;
  /** The seller's `extra`: the keys APN understands are checked; every other key is carried unchanged. */
  readonly extra: Readonly<Record<string, unknown>>;
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
 * Unsupported offers may coexist; they are skipped, never repaired. An admitted offer that APN cannot sign (another
 * scheme or transfer method, an unknown top-level field, a timeout outside the bound, an `extra` key APN understands
 * with a wrong value) is refused by the field that decided it.
 */
export function selectPermit2Offer(accepts: readonly unknown[], payer: Address, resolve: Permit2AssetResolver): Permit2OfferSelection {
  if (!Array.isArray(accepts) || accepts.length === 0) refuse("x402_permit2_no_listed_offer", "The seller offered no payment requirements.");
  const payerAddress = strictAddress(payer);
  if (payerAddress === undefined) throw new ApnError("APN_INVALID_INPUT", "The payer must be an exact EVM address.");
  const refused: X402RefusedOffer[] = [];
  for (const [index, offer] of accepts.entries()) {
    if (!isPlainRecord(offer) || typeof offer.network !== "string") continue;
    const token = strictAddress(offer.asset);
    if (token === undefined) continue;
    const listAsset = resolve(offer.network, token, isPlainRecord(offer.extra) ? offer.extra : {});
    if (listAsset === undefined || listAsset.chain !== offer.network || listAsset.token.toLowerCase() !== token.toLowerCase()) continue;
    const selection = validateOffer(index, offer, listAsset, payerAddress);
    if (!isOfferRefusal(selection)) return selection;
    refused.push({ index: index.toString(), network: offer.network, asset: token.toLowerCase(), method: declaredMethod(offer.extra), ...selection });
  }
  if (refused.length > 0) {
    const named = refusedOffersDetails(refused);
    throw new ApnError("APN_X402_UNSUPPORTED_OFFER", named.message, { ...named.details, rail: "x402" });
  }
  return refuse("x402_permit2_no_listed_offer", "No seller offer pays an owner-admitted token through the exact Permit2 flow.");
}

/** Revalidate a frozen selection against the asset it carries; any drift is state corruption. */
export function validatePermit2Selection(value: Permit2OfferSelection, payer: Address): Permit2OfferSelection {
  const listAsset = isPlainRecord(value) && validAsset(value.listAsset) ? value.listAsset : undefined;
  const again = listAsset === undefined || !Number.isSafeInteger(value.index) || value.index < 0 ||
    value.requirement?.network !== listAsset.chain || !sameAddress(value.requirement?.asset, listAsset.token)
    ? undefined : validateOffer(value.index, value.requirement as unknown as Record<string, unknown>, listAsset, payer);
  if (again === undefined || isOfferRefusal(again) || canonicalJson(again) !== canonicalJson(value)) {
    throw new ApnError("APN_STATE_CORRUPT", "The frozen x402 Permit2 offer selection is invalid.");
  }
  return again;
}

function validateOffer(index: number, offer: Record<string, unknown>, listAsset: Permit2ListAsset, payer: Address): Permit2OfferSelection | X402OfferRefusal {
  if (offer.scheme !== "exact") return offerRefusal("x402_offer_scheme_unsupported", "scheme", offer.scheme, "exact");
  const extra = isPlainRecord(offer.extra) ? offer.extra : {};
  const method = evmOfferMethod(extra);
  if (isOfferRefusal(method) || method !== "permit2") {
    return offerRefusal("x402_offer_method_unsupported", "extra.assetTransferMethod", extra.assetTransferMethod ?? "eip3009", "permit2");
  }
  const unknown = Object.keys(offer).find((key) => !OFFER_KEYS.includes(key));
  if (unknown !== undefined) return offerRefusal("x402_offer_field_unsupported", unknown, undefined, OFFER_KEYS.join(", "));
  if (typeof offer.amount !== "string" || !/^[1-9][0-9]{0,77}$/u.test(offer.amount) || BigInt(offer.amount) > MAX_UINT256) {
    return offerRefusal("x402_offer_amount_invalid", "amount", offer.amount);
  }
  const refusal = timeoutRefusal(offer.maxTimeoutSeconds, 1) ?? evmExtraRefusal(extra, "permit2", listAsset.chainId) ??
    tokenDomainRefusal(extra, listAsset) ?? decimalsRefusal(extra, listAsset.decimals);
  if (refusal !== null) return refusal;
  const payTo = strictAddress(offer.payTo);
  if (payTo === undefined || [ZERO, payer, listAsset.token, PERMIT2_ADDRESS, X402_EXACT_PERMIT2_PROXY].some((address) => sameAddress(payTo, address))) {
    return offerRefusal("x402_offer_payee_invalid", "payTo", offer.payTo, "a payee other than the payer, the token and the Permit2 contracts");
  }
  const requirement = structuredClone(offer) as unknown as Permit2Requirement;
  return {
    index,
    requirement,
    listAsset,
    amountAtomic: offer.amount,
    payTo,
    maxTimeoutSeconds: offer.maxTimeoutSeconds as number,
    offerHash: domainHash(OFFER_DOMAIN, canonicalJson(requirement)),
  };
}

/** `name`/`version` are optional seller hints; when present they must equal the asset's token domain exactly. */
function tokenDomainRefusal(extra: Readonly<Record<string, unknown>>, listAsset: Permit2ListAsset): X402OfferRefusal | null {
  if (extra.name === undefined) return null;
  const domain = listAsset.tokenDomain;
  if (domain === null || extra.name !== domain.name) return offerRefusal("x402_offer_extra_invalid", "extra.name", extra.name, domain?.name);
  return extra.version === domain.version ? null : offerRefusal("x402_offer_extra_invalid", "extra.version", extra.version, domain.version);
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
