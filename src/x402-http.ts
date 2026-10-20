import type { X402Asset } from "./x402-network.js";
import { request as httpsRequest } from "node:https";
import type { ClientRequest, IncomingMessage } from "node:http";
import { isIP } from "node:net";
import { performance } from "node:perf_hooks";
import { rootCertificates, type TLSSocket } from "node:tls";
import { canonicalJson, domainHash, sha256 } from "./canonical.js";
import { ApnError } from "./errors.js";
import {
  isPublicIp,
  parsePublicHttpsUrl,
  resolvePublicAddresses,
  sameIpAddress,
  unbracket,
  type PinnedAddress,
} from "./network-policy.js";
import {
  decodePaymentRequiredHeader,
  decodePaymentSignatureHeader,
  encodePaymentSignatureHeader,
} from "./x402-codec.js";
import { CONTROL_HEADERS, optionalSingleHeader, pairRawHeaders, paymentResponseHeader, requireAsciiControl, singleControlHeader,
  validateRawHeaders } from "./x402-http-headers.js";
import { inspectOffers, unsupportedOfferError } from "./x402-offer-inspect.js";
import type { HttpGetRequest, HttpObservation, HttpPort, InspectResult } from "./x402-model.js";
import type { X402HttpObservation } from "./x402-state-integrity.js";
import { decodeX402RequestBody, optionalX402HttpRequest, type X402HttpRequestV1 } from "./x402-http-request.js";
import { observedPaidResult } from "./x402-opaque-result.js";
import { inspectPermit2Offer } from "./x402-permit2/inspection.js";
import type { Address } from "./model.js";

const MAX_BODY_BYTES = 256 * 1024;
export const SELLER_RESPONSE_MAX_HEADER_BYTES = 128 * 1024;

type DeadlineTimer = ReturnType<typeof setTimeout>;
type ScheduleDeadline = (callback: () => void, delayMs: number) => DeadlineTimer;
type CancelDeadline = (timer: DeadlineTimer) => void;

export class HttpsX402Http implements HttpPort {
  private readonly nowMs = (): number => performance.now();
  private readonly scheduleDeadline: ScheduleDeadline = (callback, delayMs) => setTimeout(callback, delayMs);
  private readonly cancelDeadline: CancelDeadline = (timer) => clearTimeout(timer);
  private readonly resolveAddresses = resolvePublicAddresses;
  private readonly request = httpsRequest;

  async get(request: HttpGetRequest): Promise<HttpObservation> {
    const httpRequest = optionalX402HttpRequest(request.url, request.httpRequest);
    const startedMs = this.nowMs();
    const endpoint = parsePublicHttpsUrl(request.url, "APN_HTTP_CONFIG", "Seller URL", 2048);
    const canonicalUrl = endpoint.toString();
    if (canonicalUrl !== request.url) throw httpError("APN_HTTP_CONFIG", "Seller URL must use its canonical WHATWG serialization.");
    if (request.paymentSignature !== undefined) {
      const decodedPaymentSignature = decodePaymentSignatureHeader(request.paymentSignature);
      if (encodePaymentSignatureHeader(decodedPaymentSignature) !== request.paymentSignature) {
        throw httpError("APN_HTTP_PROTOCOL", "PAYMENT-SIGNATURE bytes are not canonical JSON.");
      }
    }
    const timeoutMs = request.timeoutMs ?? 30_000;
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) {
      throw httpError("APN_HTTP_CONFIG", "Seller request timeout is outside the permitted bound.");
    }
    const deadlineMs = startedMs + timeoutMs;
    const addresses = await beforeDeadline(
      () => this.resolveAddresses(endpoint, "APN_HTTP_CONFIG", "Seller URL"),
      deadlineMs,
      this.nowMs,
      this.scheduleDeadline,
      this.cancelDeadline,
    );
    return await getOnce(
      endpoint,
      addresses,
      request.paymentSignature,
      httpRequest,
      deadlineMs,
      this.nowMs,
      this.request,
      this.scheduleDeadline,
      this.cancelDeadline,
    );
  }
}

export async function inspectX402(
  http: HttpPort,
  value: string,
  request: X402HttpRequestV1 | undefined,
  /** The network and token whose EIP-3009/Permit2 offers become candidates; null inspects only the Permit2 offer for `payer`. */
  asset: X402Asset | null,
  payer?: Address,
): Promise<InspectResult> {
  const { endpoint, canonicalUrl, paymentRequired } = await readX402Challenge(http, value, request);
  const permit2 = payer === undefined ? undefined : inspectPermit2Offer({ accepts: paymentRequired.accepts, payer });
  const inspected = asset === null ? undefined : inspectOffers(paymentRequired, canonicalUrl, asset);
  if (asset === null && permit2 === undefined) {
    throw new ApnError("APN_X402_UNSUPPORTED_OFFER", "Seller challenge has no Permit2 offer this payer can inspect.", { reason: "x402_offer_asset_not_offered" });
  }
  // Each offer of this network and token that APN cannot sign is named with the field that decided it.
  if (asset !== null && inspected !== undefined && inspected.candidates.length === 0 && permit2 === undefined) {
    throw unsupportedOfferError(asset, paymentRequired, inspected);
  }
  const candidates = inspected?.candidates ?? [];
  return {
    kind: "x402_inspection",
    x402Version: "2",
    resource: {
      origin: endpoint.origin,
      path: endpoint.pathname,
      urlHash: sha256(canonicalUrl),
    },
    candidates,
    ...(permit2 === undefined ? {} : { permit2 }),
  };
}

/** One unpaid request to a canonical public HTTPS URL that must answer 402 with exactly one strict PAYMENT-REQUIRED header. */
export async function readX402Challenge(http: HttpPort, value: string, request?: X402HttpRequestV1) {
  const endpoint = parsePublicHttpsUrl(value, "APN_HTTP_CONFIG", "Seller URL", 2048);
  const canonicalUrl = endpoint.toString();
  if (canonicalUrl !== value) throw httpError("APN_HTTP_CONFIG", "Seller URL must use its canonical WHATWG serialization.");
  const httpRequest = optionalX402HttpRequest(canonicalUrl, request);
  const observation = await http.get({ url: canonicalUrl, ...(httpRequest === undefined ? {} : { httpRequest }) });
  validateInspectObservation(observation, endpoint);
  const header = singleControlHeader(observation.rawHeaderPairs, "payment-required");
  return { endpoint, canonicalUrl, header, paymentRequired: decodePaymentRequiredHeader(header) };
}

export interface PaidHttpResult {
  readonly observation: X402HttpObservation;
  readonly paymentResponseHeader?: string;
  readonly result?: {
    readonly mediaType: string;
    readonly bodyEncoding?: "base64";
    readonly responseStatus?: string;
    readonly bodyText: string;
    readonly resultHash: string;
    readonly byteLength: string;
  };
}

export function observePaidX402Response(
  raw: HttpObservation,
  input: {
    readonly attemptNumber: string;
    readonly purpose: "payment" | "result_recovery";
    readonly canonicalUrl: string;
    readonly targetHash: string;
    readonly origin: string;
    readonly opaqueResult?: boolean;
  },
): PaidHttpResult {
  const endpoint = new URL(input.canonicalUrl);
  if (
    raw.status < 100 || raw.status > 599 || !Number.isInteger(raw.status) ||
    raw.finalUrl !== input.canonicalUrl || raw.observedOrigin !== input.origin ||
    endpoint.toString() !== input.canonicalUrl || endpoint.origin !== input.origin
  ) throw httpError("APN_HTTP_PROTOCOL", "Paid seller response changed the frozen target.");
  if (
    raw.safeTransportProvenance.protocol !== "https" || raw.safeTransportProvenance.tlsAuthorized !== true ||
    raw.safeTransportProvenance.redirectCount !== 0 || raw.dnsAddresses.length === 0 ||
    !raw.dnsAddresses.includes(raw.selectedAddress) || raw.dnsAddresses.some((address) => !isPublicIp(address))
  ) throw httpError("APN_HTTP_PROTOCOL", "Paid seller transport provenance is unsafe.");
  const selectedFamily = isIP(raw.selectedAddress);
  if (selectedFamily !== 4 && selectedFamily !== 6) throw httpError("APN_HTTP_PROTOCOL", "Paid seller selected address is invalid.");
  validateRawHeaders(raw.rawHeaderPairs, true);
  if (optionalSingleHeader(raw.rawHeaderPairs, "payment-signature") !== undefined) {
    throw httpError("APN_HTTP_PROTOCOL", "Seller response must not echo PAYMENT-SIGNATURE.");
  }

  const paymentRequiredHeader = optionalSingleHeader(raw.rawHeaderPairs, "payment-required");
  if (paymentRequiredHeader !== undefined) {
    if (raw.status !== 402) throw httpError("APN_HTTP_PROTOCOL", "PAYMENT-REQUIRED is valid only on a paid 402 response.");
    requireAsciiControl(paymentRequiredHeader, "PAYMENT-REQUIRED");
    decodePaymentRequiredHeader(paymentRequiredHeader);
  }
  // Copies that differ or a malformed value are no settlement hint; the paid body below is kept either way.
  const paymentResponse = paymentResponseHeader(raw.rawHeaderPairs);

  const result = observedPaidResult(raw, input.opaqueResult === true, MAX_BODY_BYTES);

  const observation: X402HttpObservation = {
    attemptNumber: input.attemptNumber,
    purpose: input.purpose,
    targetHash: input.targetHash,
    status: raw.status.toString(),
    rawHeadersHash: domainHash("apn.x402.raw-header-pairs.v1", canonicalJson(raw.rawHeaderPairs)),
    ...(paymentRequiredHeader === undefined ? {} : {
      paymentRequiredHeaderHash: domainHash(
        "apn.x402.payment-required-header.v1",
        Buffer.from(paymentRequiredHeader, "ascii"),
      ),
    }),
    ...(paymentResponse === undefined ? {} : {
      paymentResponseHeaderHash: domainHash(
        "apn.x402.payment-response-header.v1",
        Buffer.from(paymentResponse, "ascii"),
      ),
    }),
    bodyHash: domainHash("apn.x402.result-body.v1", raw.bodyBytes),
    bodyByteLength: raw.bodyBytes.byteLength.toString(),
    ...(result === undefined ? {} : { mediaType: result.mediaType }),
    finalUrlHash: sha256(raw.finalUrl),
    origin: raw.observedOrigin,
    selectedIpFamily: selectedFamily === 4 ? "ipv4" : "ipv6",
    startedAt: raw.startedAt,
    observedAt: raw.observedAt,
  };
  return {
    observation,
    ...(paymentResponse === undefined ? {} : { paymentResponseHeader: paymentResponse }),
    ...(result === undefined ? {} : { result }),
  };
}

function validateInspectObservation(observation: HttpObservation, endpoint: URL): void {
  if (observation.status !== 402) throw httpError("APN_HTTP_PROTOCOL", "Initial x402 inspection must return HTTP 402.");
  if (observation.finalUrl !== endpoint.toString() || observation.observedOrigin !== endpoint.origin) {
    throw httpError("APN_HTTP_PROTOCOL", "Seller target changed during inspection.");
  }
  if (
    observation.safeTransportProvenance.protocol !== "https" ||
    observation.safeTransportProvenance.tlsAuthorized !== true ||
    observation.safeTransportProvenance.redirectCount !== 0
  ) throw httpError("APN_HTTP_PROTOCOL", "Seller transport provenance is unsafe.");
  if (
    observation.dnsAddresses.length === 0 ||
    !observation.dnsAddresses.includes(observation.selectedAddress) ||
    observation.dnsAddresses.some((address) => !isPublicIp(address))
  ) throw httpError("APN_HTTP_PROTOCOL", "Seller DNS provenance is unsafe.");
  if (observation.bodyBytes.byteLength > MAX_BODY_BYTES) throw httpError("APN_HTTP_PROTOCOL", "Seller response body exceeds the size limit.");
  validateRawHeaders(observation.rawHeaderPairs);
}

async function getOnce(
  endpoint: URL,
  addresses: readonly PinnedAddress[],
  paymentSignature: string | undefined,
  httpRequest: X402HttpRequestV1 | undefined,
  deadlineMs: number,
  nowMs: () => number,
  requestOnce: typeof httpsRequest,
  scheduleDeadline: ScheduleDeadline,
  cancelDeadline: CancelDeadline,
): Promise<HttpObservation> {
  return await new Promise<HttpObservation>((resolve, reject) => {
    const selected = addresses[0];
    if (selected === undefined) { reject(httpError("APN_HTTP_CONFIG", "Seller host has no validated address.")); return; }
    const startedAt = new Date().toISOString();
    const body = decodeX402RequestBody(httpRequest?.bodyBase64 ?? null);
    const headers = { ...httpRequest?.headers, ...(body === undefined ? {} : { "content-length": String(body.byteLength) }),
      ...(paymentSignature === undefined ? {} : { "PAYMENT-SIGNATURE": paymentSignature }) };
    const hostname = unbracket(endpoint.hostname);
    let request: ClientRequest | undefined;
    let activeResponse: IncomingMessage | undefined;
    let settled = false;
    const finishError = (error: unknown): void => {
      if (settled) return;
      settled = true;
      cancelDeadline(timer);
      activeResponse?.destroy();
      request?.destroy();
      reject(error instanceof ApnError ? error : httpError("APN_HTTP_AMBIGUOUS", "Seller transport failed safely."));
    };
    const finishValue = (value: HttpObservation): void => {
      if (remainingBudgetMs(deadlineMs, nowMs) < 1) {
        finishError(httpError("APN_HTTP_AMBIGUOUS", "Seller request timed out."));
        return;
      }
      if (settled) return;
      settled = true;
      cancelDeadline(timer);
      resolve(value);
    };
    const timeoutMs = remainingMs(deadlineMs, nowMs);
    const timer = scheduleDeadline(
      () => finishError(httpError("APN_HTTP_AMBIGUOUS", "Seller request timed out.")),
      timeoutMs,
    );
    try {
      request = requestOnce(endpoint, {
        method: httpRequest?.method ?? "GET",
        agent: false,
        maxHeaderSize: SELLER_RESPONSE_MAX_HEADER_BYTES,
        family: selected.family,
        rejectUnauthorized: true,
        ca: [...rootCertificates],
        ...(isIP(hostname) === 0 ? { servername: hostname } : {}),
        ...(headers === undefined ? {} : { headers }),
        lookup: (_hostname, _options, callback) => callback(null, selected.address, selected.family),
      }, (response) => {
        if (settled) { response.destroy(); return; }
        activeResponse = response;
        const status = response.statusCode;
        if (status === undefined || status < 100 || status > 599) {
          finishError(httpError("APN_HTTP_PROTOCOL", "Seller returned an invalid HTTP status.")); return;
        }
        if (status >= 300 && status < 400) {
          finishError(httpError("APN_HTTP_PROTOCOL", "Seller redirects are forbidden.")); return;
        }
        let rawHeaderPairs: readonly (readonly [string, string])[];
        try {
          rawHeaderPairs = pairRawHeaders(response.rawHeaders);
          validateRawHeaders(rawHeaderPairs, paymentSignature !== undefined);
          const contentEncoding = optionalSingleHeader(rawHeaderPairs, "content-encoding");
          if (contentEncoding !== undefined && contentEncoding !== "identity") throw httpError("APN_HTTP_PROTOCOL", "Compressed seller responses are forbidden.");
          const contentLength = optionalSingleHeader(rawHeaderPairs, "content-length");
          if (contentLength !== undefined && (!/^(?:0|[1-9][0-9]*)$/u.test(contentLength) || BigInt(contentLength) > BigInt(MAX_BODY_BYTES))) {
            throw httpError("APN_HTTP_PROTOCOL", "Seller Content-Length is invalid or oversized.");
          }
        } catch (error) {
          finishError(error); return;
        }
        const chunks: Buffer[] = [];
        let total = 0;
        const fail = (error: ApnError): void => {
          finishError(error);
        };
        response.on("data", (chunk: Buffer) => {
          if (settled) return;
          total += chunk.length;
          if (total > MAX_BODY_BYTES) { fail(httpError("APN_HTTP_PROTOCOL", "Seller response body exceeds the size limit.")); return; }
          chunks.push(chunk);
        });
        response.on("end", () => {
          if (settled) return;
          try {
            const rawTrailers = pairRawHeaders(response.rawTrailers);
            if (rawTrailers.some(([name]) => CONTROL_HEADERS.has(name.toLowerCase()))) {
              throw httpError("APN_HTTP_PROTOCOL", "x402 control trailers are forbidden.");
            }
            const socket = response.socket as TLSSocket;
            if (socket.authorized !== true || socket.remoteAddress === undefined || !sameIpAddress(socket.remoteAddress, selected.address)) {
              throw httpError("APN_HTTP_PROTOCOL", "Seller TLS or address pinning was not proven.");
            }
            finishValue({
              status,
              rawHeaderPairs,
              bodyBytes: Buffer.concat(chunks, total),
              finalUrl: endpoint.toString(),
              observedOrigin: endpoint.origin,
              dnsAddresses: addresses.map((address) => address.address),
              selectedAddress: selected.address,
              startedAt,
              observedAt: new Date().toISOString(),
              safeTransportProvenance: { protocol: "https", tlsAuthorized: true, redirectCount: 0 },
            });
          } catch (error) {
            finishError(error);
          }
        });
        response.on("error", () => fail(httpError("APN_HTTP_AMBIGUOUS", "Seller response failed safely.")));
      });
      request.on("error", (error) => finishError(error));
      request.end(body);
    } catch (error) {
      finishError(error);
    }
  });
}

async function beforeDeadline<T>(
  operation: () => Promise<T>,
  deadlineMs: number,
  nowMs: () => number,
  scheduleDeadline: ScheduleDeadline,
  cancelDeadline: CancelDeadline,
): Promise<T> {
  return await new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      cancelDeadline(timer);
      callback();
    };
    const timer = scheduleDeadline(
      () => finish(() => reject(httpError("APN_HTTP_AMBIGUOUS", "Seller request timed out."))),
      remainingMs(deadlineMs, nowMs),
    );
    try {
      operation().then(
        (value) => remainingBudgetMs(deadlineMs, nowMs) < 1
          ? finish(() => reject(httpError("APN_HTTP_AMBIGUOUS", "Seller request timed out.")))
          : finish(() => resolve(value)),
        (error: unknown) => finish(() => reject(error)),
      );
    } catch (error) {
      finish(() => reject(error));
    }
  });
}

function remainingMs(deadlineMs: number, nowMs: () => number): number {
  const remaining = remainingBudgetMs(deadlineMs, nowMs);
  if (remaining < 1) throw httpError("APN_HTTP_AMBIGUOUS", "Seller request timed out.");
  return remaining;
}

function remainingBudgetMs(deadlineMs: number, nowMs: () => number): number { return Math.floor(deadlineMs - nowMs()); }

function httpError(
  code: "APN_HTTP_CONFIG" | "APN_HTTP_PROTOCOL" | "APN_HTTP_AMBIGUOUS" | "APN_X402_UNSUPPORTED_OFFER",
  message: string,
): ApnError {
  return new ApnError(code, message);
}
