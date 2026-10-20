import { canonicalJson, domainHash, isPlainRecord, sha256 } from "../canonical.js";
import { ApnError } from "../errors.js";
import type { HttpPort } from "../ports.js";
import { solanaSignature } from "../solana/rpc.js";
import { decodeCanonicalBase64Json, encodePaymentSignatureHeader } from "../x402-codec.js";
import { observePaidX402Response, readX402Challenge } from "../x402-http.js";
import { X402_SOLANA_NETWORK } from "./constants.js";
import type { X402SolanaRecord, X402SolanaTerms } from "./model.js";

export interface X402SolanaChallenge {
  readonly url: string;
  readonly origin: string;
  readonly urlHash: string;
  readonly challengeHash: string;
  readonly resourceCanonicalJson: string;
  readonly accepts: readonly unknown[];
}

/** The unpaid GET: a canonical public HTTPS URL answering 402 with one strict x402 v2 PAYMENT-REQUIRED header. */
export async function readSolanaChallenge(http: HttpPort, url: string): Promise<X402SolanaChallenge> {
  const read = await readX402Challenge(http, url);
  return { url: read.canonicalUrl, origin: read.endpoint.origin, urlHash: sha256(read.canonicalUrl),
    challengeHash: domainHash("apn.x402.payment-required-header.v1", Buffer.from(read.header, "ascii")),
    resourceCanonicalJson: canonicalJson(read.paymentRequired.resource), accepts: read.paymentRequired.accepts };
}

/** The PAYMENT-SIGNATURE header: the seller's own resource and offer, and the partially signed transaction. */
export function solanaPaymentHeader(terms: X402SolanaTerms, rawPayload: string): string {
  return encodePaymentSignatureHeader({ x402Version: 2, resource: JSON.parse(terms.resourceCanonicalJson) as unknown,
    accepted: JSON.parse(terms.offerCanonicalJson) as unknown, payload: { transaction: rawPayload } });
}

export type X402SolanaResponse = NonNullable<X402SolanaRecord["response"]>;

/**
 * The single paid request. The seller's PAYMENT-RESPONSE is kept only as a hint (its transaction signature), which
 * settles nothing until the chain shows the frozen bytes under it; a malformed one is simply no hint.
 */
export async function sendSolanaPayment(http: HttpPort, terms: X402SolanaTerms, header: string, now: () => Date): Promise<X402SolanaResponse> {
  const raw = await http.get({ url: terms.url, paymentSignature: header });
  const paid = observePaidX402Response(raw, { attemptNumber: "1", purpose: "payment", canonicalUrl: terms.url, targetHash: terms.urlHash, origin: terms.origin });
  const hint = paid.paymentResponseHeader === undefined ? null : settlementHint(paid.paymentResponseHeader);
  return { status: raw.status, observedAt: now().toISOString(),
    ...(paid.paymentResponseHeader === undefined ? {} : {
      paymentResponseHeaderHash: domainHash("apn.x402.payment-response-header.v1", Buffer.from(paid.paymentResponseHeader, "ascii")) }),
    ...(hint?.signature === undefined ? {} : { settlementHint: hint.signature }),
    ...(hint?.success === undefined ? {} : { settlementSuccess: hint.success }),
    ...(paid.result === undefined ? {} : { result: paid.result }) };
}

function settlementHint(header: string): { readonly signature?: string; readonly success?: boolean } | null {
  let value: unknown;
  try { value = decodeCanonicalBase64Json(header); } catch { return null; }
  if (!isPlainRecord(value) || (value.network !== undefined && value.network !== X402_SOLANA_NETWORK)) return null;
  let signature: string | undefined;
  try { signature = value.transaction === undefined || value.transaction === "" ? undefined : solanaSignature(value.transaction); }
  catch { signature = undefined; }
  return { ...(signature === undefined ? {} : { signature }), ...(typeof value.success === "boolean" ? { success: value.success } : {}) };
}

export function requireSolanaRpcUrl(value: string | undefined): string {
  if (value === undefined || value === "") {
    throw new ApnError("APN_RPC_CONFIG", "Solana x402 needs an explicit Solana mainnet RPC: set APN_SOLANA_RPC_URL.",
      { reason: "x402_rpc_required", chain: X402_SOLANA_NETWORK, setting: "APN_SOLANA_RPC_URL",
        nextActions: ["Set APN_SOLANA_RPC_URL to the intended Solana mainnet HTTPS endpoint, then rerun the same command."] });
  }
  return value;
}
