import { ApnError } from "../errors.js";
import type { Address } from "../model.js";
import { normalizeX402HttpRequest, type X402HttpRequestV1 } from "../x402-http-request.js";
import { inspectX402 } from "../x402-http.js";
import { decodePaymentRequiredHeader } from "../x402-codec.js";
import type { HttpPort } from "../x402-model.js";
import { checkPermit2Challenge, type Permit2CheckedChallenge } from "./checked-challenge.js";

/** Internal private inspection reuses the existing target, DNS, TLS, header and offer checks. */
export async function inspectCheckedPermit2Challenge(http: HttpPort, request: X402HttpRequestV1,
  payer: Address): Promise<Permit2CheckedChallenge> {
  const exact = normalizeX402HttpRequest(request);
  let header: string | undefined;
  await inspectX402({ get: async input => {
    const observed = await http.get(input);
    // The existing inspector validates exactly one control header before this value is consumed.
    header = observed.rawHeaderPairs.find(([name]) => name.toLowerCase() === "payment-required")?.[1];
    return observed;
  } }, exact.url, exact, undefined, payer);
  if (header === undefined) throw new ApnError("APN_HTTP_PROTOCOL", "Checked challenge header is missing.");
  return checkPermit2Challenge(decodePaymentRequiredHeader(header), exact);
}
