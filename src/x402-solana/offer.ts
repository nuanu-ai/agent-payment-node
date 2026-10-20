import { canonicalJson, domainHash, isPlainRecord } from "../canonical.js";
import { ApnError } from "../errors.js";
import { solanaAddress } from "../solana/rpc.js";
import { X402_SOLANA_NETWORK } from "./constants.js";

const U64_MAX = (1n << 64n) - 1n;

/** One seller `exact` offer on Solana mainnet, parsed without trusting anything but its own fields. */
export interface X402SolanaOffer {
  readonly index: number;
  readonly mint: string;
  readonly amountAtomic: string;
  readonly payee: string;
  readonly feePayer: string;
  readonly maxTimeoutSeconds: number;
  /** The seller's declared requirements, sent back verbatim as `accepted`. */
  readonly declaredCanonicalJson: string;
  readonly offerHash: string;
  readonly memo: boolean;
}

/** Every structurally valid Solana `exact` offer in seller order; anything else is skipped, never repaired. */
export function solanaExactOffers(accepts: readonly unknown[]): readonly X402SolanaOffer[] {
  const offers: X402SolanaOffer[] = [];
  accepts.forEach((value, index) => {
    const offer = parseOffer(value, index);
    if (offer !== null) offers.push(offer);
  });
  return offers;
}

function parseOffer(value: unknown, index: number): X402SolanaOffer | null {
  if (!isPlainRecord(value) || value.scheme !== "exact" || value.network !== X402_SOLANA_NETWORK) return null;
  const extra = value.extra;
  if (!isPlainRecord(extra) || typeof value.amount !== "string" || !/^[1-9][0-9]{0,19}$/u.test(value.amount) ||
      BigInt(value.amount) > U64_MAX || typeof value.maxTimeoutSeconds !== "number" || !Number.isSafeInteger(value.maxTimeoutSeconds) ||
      value.maxTimeoutSeconds < 1) return null;
  const mint = canonical(value.asset), payee = canonical(value.payTo), feePayer = canonical(extra.feePayer);
  if (mint === null || payee === null || feePayer === null) return null;
  const declaredCanonicalJson = canonicalJson(value);
  return { index, mint, amountAtomic: value.amount, payee, feePayer, maxTimeoutSeconds: value.maxTimeoutSeconds, declaredCanonicalJson,
    offerHash: domainHash("apn.x402.offer.v1", declaredCanonicalJson), memo: extra.memo !== undefined };
}

function canonical(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try { return solanaAddress(value); } catch { return null; }
}

export interface SolanaOfferSelectionInput {
  readonly accepts: readonly unknown[];
  readonly mint: string;
  readonly payer: string;
  /** The smaller of the caller's `--max-amount` and the owner's per-payment cap. */
  readonly capAtomic: bigint;
  readonly payeeAdmitted: (payee: string) => boolean;
}

/**
 * The deterministic rule: the lowest-index Solana `exact` offer for the admitted mint whose price is within the cap, whose
 * payee the owner's pin admits, which binds no memo (APN signs exactly the compute budget and one transfer), and whose fee
 * payer is a third party (never the payer, the payee or the mint).
 */
export function selectSolanaOffer(input: SolanaOfferSelectionInput): X402SolanaOffer {
  const offers = solanaExactOffers(input.accepts), forMint = offers.filter((offer) => offer.mint === input.mint);
  if (forMint.length === 0) {
    throw new ApnError("APN_X402_UNSUPPORTED_OFFER", `Seller challenge has no Solana x402 exact offer for the mint ${input.mint}.`,
      { reason: "x402_offer_asset_not_offered", chain: X402_SOLANA_NETWORK, asset: input.mint,
        offered: [...new Set(offers.map((offer) => `${X402_SOLANA_NETWORK} ${offer.mint}`))].slice(0, 16) });
  }
  let memo = false, overCap = false, payeeRefused = false, feePayerRefused = false;
  for (const offer of forMint) {
    if (offer.memo) { memo = true; continue; }
    if (BigInt(offer.amountAtomic) > input.capAtomic) { overCap = true; continue; }
    if ([input.payer, offer.payee, offer.mint].includes(offer.feePayer) || offer.payee === input.payer) { feePayerRefused = true; continue; }
    if (!input.payeeAdmitted(offer.payee)) { payeeRefused = true; continue; }
    return offer;
  }
  if (payeeRefused) {
    throw new ApnError("APN_ALLOWLIST_REFUSED", "The active owner allowlist policy pins the recipients of this admission; no offered payee is one of them.",
      { reason: "allowlist_recipient_not_admitted", rail: "x402", chain: X402_SOLANA_NETWORK });
  }
  if (overCap) {
    throw new ApnError("APN_X402_CAP_EXCEEDED", "Every Solana offer for this mint exceeds the explicit maximum or the owner's per-payment cap.",
      { reason: "x402_offer_exceeds_cap", chain: X402_SOLANA_NETWORK, asset: input.mint, capAtomic: input.capAtomic.toString() });
  }
  if (feePayerRefused) {
    throw new ApnError("APN_X402_UNSUPPORTED_OFFER", "The seller's fee payer is the payer, the payee or the mint; APN pays only through a third-party fee payer.",
      { reason: "x402_solana_fee_payer_invalid" });
  }
  if (memo) {
    throw new ApnError("APN_X402_UNSUPPORTED_OFFER", "The seller binds a memo to the payment; APN signs only the compute budget and one transfer.",
      { reason: "x402_solana_memo_unsupported" });
  }
  throw new ApnError("APN_X402_UNSUPPORTED_OFFER", "No Solana offer can be paid.", { reason: "x402_solana_no_payable_offer" });
}
