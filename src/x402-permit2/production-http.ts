import { request as httpsRequest } from "node:https";
import type { ClientRequest, IncomingMessage } from "node:http";
import { isIP } from "node:net";
import { rootCertificates, type TLSSocket } from "node:tls";
import { canonicalJson, domainHash, sha256 } from "../canonical.js";
import { ApnError } from "../errors.js";
import { LocalWalletNative } from "../local-wallet-native.js";
import { parsePublicHttpsUrl, resolvePublicAddresses, sameIpAddress, unbracket } from "../network-policy.js";
import { decodePermit2PaymentSignatureHeader, encodePermit2PaymentSignatureHeader } from "../x402-codec.js";
import { decodeX402RequestBody, normalizeX402HttpRequest } from "../x402-http-request.js";
import type { HttpObservation } from "../x402-model.js";
import type { Permit2NativeDispatchExecution } from "./production-native-capability.js";

const MAX_HEADER_PAIRS = 64, MAX_HEADER_NAME_BYTES = 256, MAX_CONTROL_VALUE_BYTES = 64 * 1024;
const MAX_AGGREGATE_HEADER_BYTES = 96 * 1024, MAX_BODY_BYTES = 256 * 1024;
const PAYMENT_RESPONSE_HEADERS = new Set(["payment-response", "x-payment-response"]);
const CONTROL_HEADERS = new Set(["payment-required", "payment-signature", ...PAYMENT_RESPONSE_HEADERS]);

/** Concrete single-attempt transport. Only the actual native's private dispatch execution admits it. */
export class Permit2ProductionHttps {
  async submit(execution: Permit2NativeDispatchExecution): Promise<HttpObservation> {
    const { record, signal } = LocalWalletNative.permit2HttpMaterial(execution, this);
    const request = normalizeX402HttpRequest(record.material.checked.request), signed = record.exposureJournal?.signed;
    if (signed === undefined || signed === null || record.exposureJournal?.request?.attempt !== 1 ||
        record.exposureJournal.request.requestHash !== record.material.checked.requestHash ||
        record.exposureJournal.request.headerHash !== signed.headerHash) throw refused();
    const { signedHash, ...signedBody } = signed;
    if (signedHash !== domainHash("apn.x402-permit2-production.signed.v1", canonicalJson(signedBody)) ||
        signed.headerHash !== sha256(signed.paymentSignatureHeader) ||
        encodePermit2PaymentSignatureHeader(decodePermit2PaymentSignatureHeader(signed.paymentSignatureHeader)) !== signed.paymentSignatureHeader) throw refused();
    const endpoint = parsePublicHttpsUrl(request.url, "APN_HTTP_CONFIG", "Seller URL", 2048);
    const pending = new Set<Promise<unknown>>();
    const track = <T>(job: Promise<T>): Promise<T> => { pending.add(job); void job.then(() => pending.delete(job), () => pending.delete(job)); return job; };
    const owner = () => track(LocalWalletNative.assertPermit2HttpOwner(execution, this));
    try {
      await owner();
      const addresses = await track(resolvePublicAddresses(endpoint, "APN_HTTP_CONFIG", "Seller URL"));
      await owner();
      const selected = addresses[0]; if (selected === undefined) throw refused();
      const body = decodeX402RequestBody(request.bodyBase64), hostname = unbracket(endpoint.hostname);
      const headers = { ...request.headers, ...(body === undefined ? {} : { "content-length": String(body.byteLength) }),
        "PAYMENT-SIGNATURE": signed.paymentSignatureHeader };
      return await new Promise<HttpObservation>((resolve, reject) => {
        let wire: ClientRequest | undefined, response: IncomingMessage | undefined, settled = false, ended = false;
        const startedAt = new Date().toISOString();
        const fail = (): void => {
          if (settled) return; settled = true; signal.removeEventListener("abort", fail);
          response?.destroy(); wire?.destroy(); reject(refused());
        };
        signal.addEventListener("abort", fail, { once: true });
        const tls = (socket: TLSSocket): void => {
          if (socket.authorized !== true || socket.remoteAddress === undefined || !sameIpAddress(socket.remoteAddress, selected.address)) throw refused();
        };
        try {
          LocalWalletNative.consumePermit2HttpStep(execution, this, "construct");
          wire = httpsRequest(endpoint, { method: request.method, agent: false, maxHeaderSize: 128 * 1024,
            family: selected.family, rejectUnauthorized: true, ca: [...rootCertificates],
            ...(isIP(hostname) === 0 ? { servername: hostname } : {}), headers,
            lookup: (_name, _options, callback) => callback(null, selected.address, selected.family),
          }, incoming => {
            if (settled || !ended) { incoming.destroy(); fail(); return; } response = incoming;
            const status = incoming.statusCode;
            if (status === undefined || !Number.isInteger(status) || status < 100 || status > 599 || (status >= 300 && status < 400)) { fail(); return; }
            let pairs: readonly (readonly [string, string])[];
            try {
              tls(incoming.socket as TLSSocket); pairs = pairRawHeaders(incoming.rawHeaders); validateRawHeaders(pairs);
              if (optionalSingleHeader(pairs, "payment-signature") !== undefined) throw refused();
              const encoding = optionalSingleHeader(pairs, "content-encoding"), length = optionalSingleHeader(pairs, "content-length");
              if ((encoding !== undefined && encoding !== "identity") || (length !== undefined &&
                  (!/^(?:0|[1-9][0-9]*)$/u.test(length) || BigInt(length) > BigInt(MAX_BODY_BYTES)))) throw refused();
            } catch { fail(); return; }
            const chunks: Buffer[] = []; let total = 0;
            incoming.on("data", (chunk: Buffer) => {
              if (settled) return; total += chunk.length; if (total > MAX_BODY_BYTES) { fail(); return; } chunks.push(Buffer.from(chunk));
            });
            incoming.on("error", fail); incoming.on("aborted", fail);
            incoming.on("end", () => {
              if (settled) return;
              void track((async () => {
                try {
                  const trailers = pairRawHeaders(incoming.rawTrailers); validateRawHeaders(trailers);
                  if (trailers.some(([name]) => CONTROL_HEADERS.has(name.toLowerCase()))) throw refused();
                  const length = optionalSingleHeader(pairs, "content-length"); if (length !== undefined && BigInt(length) !== BigInt(total)) throw refused();
                  await owner(); if (settled) return; tls(incoming.socket as TLSSocket);
                  LocalWalletNative.permit2HttpMaterial(execution, this);
                  settled = true; signal.removeEventListener("abort", fail);
                  resolve({ status, rawHeaderPairs: pairs, bodyBytes: Buffer.concat(chunks, total), finalUrl: request.url,
                    observedOrigin: endpoint.origin, dnsAddresses: addresses.map(a => a.address), selectedAddress: selected.address,
                    startedAt, observedAt: new Date().toISOString(), safeTransportProvenance: { protocol: "https", tlsAuthorized: true, redirectCount: 0 } });
                } catch { fail(); }
              })());
            });
          });
          wire.on("error", fail);
          wire.on("socket", (socket: TLSSocket) => {
            socket.once("secureConnect", () => {
              if (settled) return;
              void track((async () => {
                try {
                  tls(socket); await owner(); if (settled) return; tls(socket);
                  LocalWalletNative.consumePermit2HttpStep(execution, this, "end"); ended = true; wire!.end(body);
                } catch { fail(); }
              })());
            });
            socket.once("error", fail);
          });
          if (signal.aborted) fail();
        } catch { fail(); }
      });
    } finally {
      // The native's caller can time out first. Keep its real metadata locks until pending reads drain.
      while (pending.size !== 0) await Promise.allSettled([...pending]);
    }
  }
}

// Header shape/bounds follow the generic seller transport; this dedicated codec admits no generic Permit2 authority.
function pairRawHeaders(values: readonly string[]): readonly (readonly [string, string])[] {
  if (values.length % 2 !== 0) throw refused();
  const pairs: Array<readonly [string, string]> = [];
  for (let index = 0; index < values.length; index += 2) {
    const name = values[index], value = values[index + 1]; if (name === undefined || value === undefined) throw refused(); pairs.push([name, value]);
  }
  return pairs;
}
function validateRawHeaders(pairs: readonly (readonly [string, string])[]): void {
  if (pairs.length > MAX_HEADER_PAIRS) throw refused(); let aggregate = 0; const counts = new Map<string, number>();
  for (const [name, value] of pairs) {
    const nameBytes = Buffer.byteLength(name, "ascii"), valueBytes = Buffer.byteLength(value, "utf8"); aggregate += nameBytes + valueBytes;
    if (nameBytes === 0 || nameBytes > MAX_HEADER_NAME_BYTES || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/u.test(name) || /[\x00-\x1f\x7f]/u.test(value)) throw refused();
    const normalized = name.toLowerCase();
    if (CONTROL_HEADERS.has(normalized)) {
      if (valueBytes > MAX_CONTROL_VALUE_BYTES || !/^[\x20-\x7e]+$/u.test(value) || value.trim() !== value || value.includes(",")) throw refused();
      const semantic = PAYMENT_RESPONSE_HEADERS.has(normalized) ? "payment-response" : normalized, count = (counts.get(semantic) ?? 0) + 1;
      if (count > 1) throw refused(); counts.set(semantic, count);
    }
  }
  if (aggregate > MAX_AGGREGATE_HEADER_BYTES) throw refused();
}
function optionalSingleHeader(pairs: readonly (readonly [string, string])[], name: string): string | undefined {
  const values = pairs.filter(([candidate]) => candidate.toLowerCase() === name).map(([, value]) => value);
  if (values.length > 1) throw refused(); return values[0];
}
function refused(): ApnError { return new ApnError("APN_HTTP_AMBIGUOUS", "Permit2 seller attempt remains held."); }
