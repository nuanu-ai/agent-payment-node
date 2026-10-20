import { X402_EXACT_PERMIT2_PROXY } from "./x402-permit2/registry.js";

/**
 * The longest seller payment window (`maxTimeoutSeconds`) APN signs for, EIP-3009 and Permit2 alike: the signed
 * authorization (EIP-3009 `validBefore`, Permit2 `deadline`) stays valid this long after prepare. In the public x402
 * discovery catalog (25,959 resources, 71,406 `exact` offers, read 2026-10-21) 95.1% of offers ask at most 300 s and
 * 96.4% at most 3,600 s; about 3.5% ask 604,800–605,400 s (seven days), which APN refuses by name
 * (`x402_offer_timeout_exceeds_bound`) instead of leaving a payment signature live for a week.
 */
export const X402_OFFER_MAX_TIMEOUT_SECONDS = 3600;
/** The shortest window unattended x402 signs for: prepare, the owner's approval, signing and the paid request must fit. */
export const X402_OFFER_MIN_TIMEOUT_SECONDS = 30;

export type X402OfferRefusalReason =
  | "x402_offer_scheme_unsupported" | "x402_offer_amount_invalid" | "x402_offer_payee_invalid" | "x402_offer_method_unsupported"
  | "x402_offer_timeout_exceeds_bound" | "x402_offer_timeout_below_bound" | "x402_offer_extra_invalid"
  | "x402_offer_spender_mismatch" | "x402_offer_chain_mismatch"
  | "x402_token_decimals_mismatch" | "x402_solana_fee_payer_invalid";

/** Why one seller offer cannot be signed: the deciding field, the seller's value and what APN accepts there. */
export interface X402OfferRefusal {
  readonly reason: X402OfferRefusalReason;
  readonly field: string;
  readonly value?: string;
  readonly expected?: string;
}

/** A refused offer as a refusal names it: its place in the seller's list and what it offered. */
export interface X402RefusedOffer extends X402OfferRefusal {
  readonly index: string;
  readonly network: string;
  readonly asset: string;
  readonly method: string;
}

export type X402EvmMethod = "eip3009" | "permit2" | "erc7710";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/u;
const MAX_TEXT = 128;

export function offerRefusal(reason: X402OfferRefusalReason, field: string, value?: unknown, expected?: string): X402OfferRefusal {
  return { reason, field, ...(value === undefined ? {} : { value: shown(value) }), ...(expected === undefined ? {} : { expected }) };
}

export function isOfferRefusal(value: unknown): value is X402OfferRefusal {
  return typeof value === "object" && value !== null && typeof (value as { reason?: unknown }).reason === "string" &&
    typeof (value as { field?: unknown }).field === "string";
}

/** The seller's window must be a whole number of seconds from `minimum` through {@link X402_OFFER_MAX_TIMEOUT_SECONDS}. */
export function timeoutRefusal(value: unknown, minimum: number): X402OfferRefusal | null {
  const bound = `${minimum}..${X402_OFFER_MAX_TIMEOUT_SECONDS}`;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum) {
    return offerRefusal("x402_offer_timeout_below_bound", "maxTimeoutSeconds", value, bound);
  }
  return value > X402_OFFER_MAX_TIMEOUT_SECONDS
    ? offerRefusal("x402_offer_timeout_exceeds_bound", "maxTimeoutSeconds", value, bound) : null;
}

/** `extra.assetTransferMethod`: absent or `eip3009`, `permit2`, `erc7710`; any other method is refused by its name. */
export function evmOfferMethod(extra: Readonly<Record<string, unknown>>): X402EvmMethod | X402OfferRefusal {
  const declared = extra.assetTransferMethod;
  if (declared === undefined || declared === "eip3009") return "eip3009";
  if (declared === "permit2" || declared === "erc7710") return declared;
  return offerRefusal("x402_offer_method_unsupported", "extra.assetTransferMethod", declared, "eip3009, permit2 or erc7710");
}

/**
 * The `extra` keys APN understands, checked strictly: `name`/`version` (bounded text; required for EIP-3009, a pair for
 * Permit2), `decimals` (0..255; the token's own decimals are compared where they are read), `paymentFlow`
 * (`authorization` outside Permit2), Permit2 `spenderAddress` (exactly the x402 exact Permit2 proxy) and `chainId`
 * (exactly the offer's chain). Every other key is the seller's own: never a reason to refuse, carried unchanged in the
 * `accepted` requirements the payment payload echoes.
 */
export function evmExtraRefusal(extra: Readonly<Record<string, unknown>>, method: X402EvmMethod, chainId: number): X402OfferRefusal | null {
  for (const key of ["name", "version"] as const) {
    const value = extra[key];
    if (value !== undefined && !boundedText(value)) return offerRefusal("x402_offer_extra_invalid", `extra.${key}`, value, "1..128 UTF-8 bytes");
  }
  if (method === "eip3009" || method === "permit2" && (extra.name === undefined) !== (extra.version === undefined)) {
    const missing = extra.name === undefined ? "name" : extra.version === undefined ? "version" : null;
    if (missing !== null) return offerRefusal("x402_offer_extra_invalid", `extra.${missing}`, undefined, "the token's EIP-712 domain name and version");
  }
  const decimals = extra.decimals;
  if (decimals !== undefined && (typeof decimals !== "number" || !Number.isSafeInteger(decimals) || decimals < 0 || decimals > 255)) {
    return offerRefusal("x402_offer_extra_invalid", "extra.decimals", decimals, "0..255");
  }
  if (method !== "permit2" && extra.paymentFlow !== undefined && extra.paymentFlow !== "authorization") {
    return offerRefusal("x402_offer_extra_invalid", "extra.paymentFlow", extra.paymentFlow, "authorization");
  }
  const spender = extra.spenderAddress;
  if (method === "permit2" && spender !== undefined &&
    !(typeof spender === "string" && ADDRESS.test(spender) && spender.toLowerCase() === X402_EXACT_PERMIT2_PROXY.toLowerCase())) {
    return offerRefusal("x402_offer_spender_mismatch", "extra.spenderAddress", spender, X402_EXACT_PERMIT2_PROXY);
  }
  if (extra.chainId !== undefined && !sameChain(extra.chainId, chainId)) {
    return offerRefusal("x402_offer_chain_mismatch", "extra.chainId", extra.chainId, String(chainId));
  }
  return null;
}

/** The offer's declared token decimals must equal the token's own; absent, nothing is compared. */
export function decimalsRefusal(extra: Readonly<Record<string, unknown>>, decimals: number): X402OfferRefusal | null {
  return extra.decimals === undefined || extra.decimals === decimals ? null
    : offerRefusal("x402_token_decimals_mismatch", "extra.decimals", extra.decimals, String(decimals));
}

/** The method an offer names, as text for a refusal's details (never trusted for anything else). */
export function declaredMethod(extra: unknown): string {
  const declared = typeof extra === "object" && extra !== null ? (extra as Record<string, unknown>).assetTransferMethod : undefined;
  return declared === undefined ? "eip3009" : shown(declared);
}

/**
 * The refusal details for offers of the selected chain and token that were all refused: the reason they share (or
 * `x402_offers_refused` when they differ), the first one's deciding field with the seller's value and what APN accepts
 * there, a message naming it, and every refused offer in seller order as one line each (at most 16).
 */
export function refusedOffersDetails(refused: readonly X402RefusedOffer[]): {
  readonly message: string;
  readonly details: { readonly reason: string; readonly field: string; readonly sellerValue?: string; readonly accepted?: string; readonly refused: readonly string[] };
} {
  const first = refused[0];
  if (first === undefined) throw new Error("No refused offer to name.");
  const reason = refused.every((offer) => offer.reason === first.reason) ? first.reason : "x402_offers_refused";
  return {
    message: `The seller's offer ${first.index} (${first.network} ${first.asset} ${first.method}) was refused: ${refusedLine(first, false)}.`,
    details: { reason, field: first.field, ...(first.value === undefined ? {} : { sellerValue: first.value }),
      ...(first.expected === undefined ? {} : { accepted: first.expected }), refused: refused.slice(0, 16).map((offer) => refusedLine(offer, true)) },
  };
}

function refusedLine(offer: X402RefusedOffer, withOffer: boolean): string {
  const head = withOffer ? `offer ${offer.index} ${offer.network} ${offer.asset} ${offer.method}: ` : "";
  return `${head}${offer.reason} ${offer.field}${offer.value === undefined ? "" : `=${offer.value}`}` +
    (offer.expected === undefined ? "" : ` (APN accepts ${offer.expected})`);
}

function sameChain(value: unknown, chainId: number): boolean {
  return typeof value === "number" ? value === chainId : typeof value === "string" && value === String(chainId);
}

function boundedText(value: unknown): boolean {
  return typeof value === "string" && value.length > 0 && Buffer.byteLength(value, "utf8") <= MAX_TEXT;
}

function shown(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value) ?? typeof value;
  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}…` : text;
}
