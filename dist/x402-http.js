import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { rootCertificates } from "node:tls";
import { canonicalJson, domainHash, sha256 } from "./canonical.js";
import { ApnError } from "./errors.js";
import { isPublicIp, parsePublicHttpsUrl, resolvePublicAddresses, sameIpAddress, unbracket, } from "./network-policy.js";
import { decodePaymentRequiredHeader, decodePaymentSignatureHeader, encodePaymentSignatureHeader, inspectCandidates, } from "./x402-codec.js";
const MAX_HEADER_PAIRS = 64;
const MAX_HEADER_NAME_BYTES = 256;
const MAX_CONTROL_VALUE_BYTES = 64 * 1024;
const MAX_AGGREGATE_HEADER_BYTES = 96 * 1024;
const MAX_BODY_BYTES = 256 * 1024;
const CONTROL_HEADERS = new Set(["payment-required", "payment-signature", "payment-response"]);
export const SELLER_RESPONSE_MAX_HEADER_BYTES = 128 * 1024;
export class HttpsX402Http {
    async get(request) {
        const endpoint = parsePublicHttpsUrl(request.url, "APN_HTTP_CONFIG", "Seller URL", 2048);
        const canonicalUrl = endpoint.toString();
        if (canonicalUrl !== request.url)
            throw httpError("APN_HTTP_CONFIG", "Seller URL must use its canonical WHATWG serialization.");
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
        const addresses = await resolvePublicAddresses(endpoint, "APN_HTTP_CONFIG", "Seller URL");
        return await getOnce(endpoint, addresses, request.paymentSignature, timeoutMs);
    }
}
export async function inspectX402(http, value) {
    const endpoint = parsePublicHttpsUrl(value, "APN_HTTP_CONFIG", "Seller URL", 2048);
    const canonicalUrl = endpoint.toString();
    if (canonicalUrl !== value)
        throw httpError("APN_HTTP_CONFIG", "Seller URL must use its canonical WHATWG serialization.");
    const observation = await http.get({ url: canonicalUrl });
    validateInspectObservation(observation, endpoint);
    const paymentRequired = decodePaymentRequiredHeader(singleControlHeader(observation.rawHeaderPairs, "payment-required"));
    const candidates = inspectCandidates(paymentRequired, canonicalUrl);
    if (candidates.length === 0)
        throw httpError("APN_X402_UNSUPPORTED_OFFER", "Seller challenge has no supported x402 offer.");
    return {
        kind: "x402_inspection",
        x402Version: "2",
        resource: {
            origin: endpoint.origin,
            path: endpoint.pathname,
            urlHash: sha256(canonicalUrl),
        },
        candidates,
    };
}
export function observePaidX402Response(raw, input) {
    const endpoint = new URL(input.canonicalUrl);
    if (raw.status < 100 || raw.status > 599 || !Number.isInteger(raw.status) ||
        raw.finalUrl !== input.canonicalUrl || raw.observedOrigin !== input.origin ||
        endpoint.toString() !== input.canonicalUrl || endpoint.origin !== input.origin)
        throw httpError("APN_HTTP_PROTOCOL", "Paid seller response changed the frozen target.");
    if (raw.safeTransportProvenance.protocol !== "https" || raw.safeTransportProvenance.tlsAuthorized !== true ||
        raw.safeTransportProvenance.redirectCount !== 0 || raw.dnsAddresses.length === 0 ||
        !raw.dnsAddresses.includes(raw.selectedAddress) || raw.dnsAddresses.some((address) => !isPublicIp(address)))
        throw httpError("APN_HTTP_PROTOCOL", "Paid seller transport provenance is unsafe.");
    const selectedFamily = isIP(raw.selectedAddress);
    if (selectedFamily !== 4 && selectedFamily !== 6)
        throw httpError("APN_HTTP_PROTOCOL", "Paid seller selected address is invalid.");
    if (raw.bodyBytes.byteLength > MAX_BODY_BYTES)
        throw resultError("Seller result exceeds the supported bound.");
    validateRawHeaders(raw.rawHeaderPairs);
    if (optionalSingleHeader(raw.rawHeaderPairs, "payment-signature") !== undefined) {
        throw httpError("APN_HTTP_PROTOCOL", "Seller response must not echo PAYMENT-SIGNATURE.");
    }
    const contentEncoding = optionalSingleHeader(raw.rawHeaderPairs, "content-encoding");
    if (contentEncoding !== undefined && contentEncoding !== "identity") {
        throw resultError("Compressed seller results are unsupported.");
    }
    const contentLength = optionalSingleHeader(raw.rawHeaderPairs, "content-length");
    if (contentLength !== undefined &&
        (!/^(?:0|[1-9][0-9]*)$/u.test(contentLength) || BigInt(contentLength) !== BigInt(raw.bodyBytes.byteLength)))
        throw resultError("Seller result length is invalid or truncated.");
    const paymentRequiredHeader = optionalSingleHeader(raw.rawHeaderPairs, "payment-required");
    if (paymentRequiredHeader !== undefined) {
        if (raw.status !== 402)
            throw httpError("APN_HTTP_PROTOCOL", "PAYMENT-REQUIRED is valid only on a paid 402 response.");
        requireAsciiControl(paymentRequiredHeader, "PAYMENT-REQUIRED");
        decodePaymentRequiredHeader(paymentRequiredHeader);
    }
    const paymentResponseHeader = optionalSingleHeader(raw.rawHeaderPairs, "payment-response");
    if (paymentResponseHeader !== undefined)
        requireAsciiControl(paymentResponseHeader, "PAYMENT-RESPONSE");
    let result;
    if (raw.status === 200) {
        const mediaType = singleControlLikeHeader(raw.rawHeaderPairs, "content-type");
        if (Buffer.byteLength(mediaType, "utf8") > 128 ||
            (mediaType !== "application/json" && !/^text\/[a-z0-9!#$%&'*+.^_`|~-]+$/u.test(mediaType))) {
            throw resultError("Seller result media type is unsupported or non-canonical.");
        }
        let bodyText;
        try {
            bodyText = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(raw.bodyBytes);
        }
        catch {
            throw resultError("Seller result is not strict UTF-8.");
        }
        if (mediaType === "application/json") {
            try {
                JSON.parse(bodyText);
            }
            catch {
                throw resultError("Seller JSON result is malformed.");
            }
        }
        result = {
            mediaType,
            bodyText,
            resultHash: domainHash("apn.x402.result-body.v1", raw.bodyBytes),
            byteLength: raw.bodyBytes.byteLength.toString(),
        };
    }
    const observation = {
        attemptNumber: input.attemptNumber,
        purpose: input.purpose,
        targetHash: input.targetHash,
        status: raw.status.toString(),
        rawHeadersHash: domainHash("apn.x402.raw-header-pairs.v1", canonicalJson(raw.rawHeaderPairs)),
        ...(paymentRequiredHeader === undefined ? {} : {
            paymentRequiredHeaderHash: domainHash("apn.x402.payment-required-header.v1", Buffer.from(paymentRequiredHeader, "ascii")),
        }),
        ...(paymentResponseHeader === undefined ? {} : {
            paymentResponseHeaderHash: domainHash("apn.x402.payment-response-header.v1", Buffer.from(paymentResponseHeader, "ascii")),
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
        ...(paymentResponseHeader === undefined ? {} : { paymentResponseHeader }),
        ...(result === undefined ? {} : { result }),
    };
}
function validateInspectObservation(observation, endpoint) {
    if (observation.status !== 402)
        throw httpError("APN_HTTP_PROTOCOL", "Initial x402 inspection must return HTTP 402.");
    if (observation.finalUrl !== endpoint.toString() || observation.observedOrigin !== endpoint.origin) {
        throw httpError("APN_HTTP_PROTOCOL", "Seller target changed during inspection.");
    }
    if (observation.safeTransportProvenance.protocol !== "https" ||
        observation.safeTransportProvenance.tlsAuthorized !== true ||
        observation.safeTransportProvenance.redirectCount !== 0)
        throw httpError("APN_HTTP_PROTOCOL", "Seller transport provenance is unsafe.");
    if (observation.dnsAddresses.length === 0 ||
        !observation.dnsAddresses.includes(observation.selectedAddress) ||
        observation.dnsAddresses.some((address) => !isPublicIp(address)))
        throw httpError("APN_HTTP_PROTOCOL", "Seller DNS provenance is unsafe.");
    if (observation.bodyBytes.byteLength > MAX_BODY_BYTES)
        throw httpError("APN_HTTP_PROTOCOL", "Seller response body exceeds the size limit.");
    validateRawHeaders(observation.rawHeaderPairs);
}
async function getOnce(endpoint, addresses, paymentSignature, timeoutMs) {
    return await new Promise((resolve, reject) => {
        const selected = addresses[0];
        if (selected === undefined) {
            reject(httpError("APN_HTTP_CONFIG", "Seller host has no validated address."));
            return;
        }
        const startedAt = new Date().toISOString();
        const headers = paymentSignature === undefined ? undefined : { "PAYMENT-SIGNATURE": paymentSignature };
        const hostname = unbracket(endpoint.hostname);
        const request = httpsRequest(endpoint, {
            method: "GET",
            agent: false,
            maxHeaderSize: SELLER_RESPONSE_MAX_HEADER_BYTES,
            family: selected.family,
            rejectUnauthorized: true,
            ca: [...rootCertificates],
            ...(isIP(hostname) === 0 ? { servername: hostname } : {}),
            ...(headers === undefined ? {} : { headers }),
            lookup: (_hostname, _options, callback) => callback(null, selected.address, selected.family),
        }, (response) => {
            const status = response.statusCode;
            if (status === undefined || status < 100 || status > 599) {
                response.destroy();
                reject(httpError("APN_HTTP_PROTOCOL", "Seller returned an invalid HTTP status."));
                return;
            }
            if (status >= 300 && status < 400) {
                response.destroy();
                reject(httpError("APN_HTTP_PROTOCOL", "Seller redirects are forbidden."));
                return;
            }
            let rawHeaderPairs;
            try {
                rawHeaderPairs = pairRawHeaders(response.rawHeaders);
                validateRawHeaders(rawHeaderPairs);
                const contentEncoding = optionalSingleHeader(rawHeaderPairs, "content-encoding");
                if (contentEncoding !== undefined && contentEncoding !== "identity")
                    throw httpError("APN_HTTP_PROTOCOL", "Compressed seller responses are forbidden.");
                const contentLength = optionalSingleHeader(rawHeaderPairs, "content-length");
                if (contentLength !== undefined && (!/^(?:0|[1-9][0-9]*)$/u.test(contentLength) || BigInt(contentLength) > BigInt(MAX_BODY_BYTES))) {
                    throw httpError("APN_HTTP_PROTOCOL", "Seller Content-Length is invalid or oversized.");
                }
            }
            catch (error) {
                response.destroy();
                reject(error);
                return;
            }
            const chunks = [];
            let total = 0;
            let failed = false;
            const fail = (error) => {
                if (failed)
                    return;
                failed = true;
                response.destroy();
                reject(error);
            };
            response.on("data", (chunk) => {
                total += chunk.length;
                if (total > MAX_BODY_BYTES) {
                    fail(httpError("APN_HTTP_PROTOCOL", "Seller response body exceeds the size limit."));
                    return;
                }
                chunks.push(chunk);
            });
            response.on("end", () => {
                if (failed)
                    return;
                try {
                    const rawTrailers = pairRawHeaders(response.rawTrailers);
                    if (rawTrailers.some(([name]) => CONTROL_HEADERS.has(name.toLowerCase()))) {
                        throw httpError("APN_HTTP_PROTOCOL", "x402 control trailers are forbidden.");
                    }
                    const socket = response.socket;
                    if (socket.authorized !== true || socket.remoteAddress === undefined || !sameIpAddress(socket.remoteAddress, selected.address)) {
                        throw httpError("APN_HTTP_PROTOCOL", "Seller TLS or address pinning was not proven.");
                    }
                    resolve({
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
                }
                catch (error) {
                    reject(error);
                }
            });
            response.on("error", () => fail(httpError("APN_HTTP_AMBIGUOUS", "Seller response failed safely.")));
        });
        request.setTimeout(timeoutMs, () => request.destroy(httpError("APN_HTTP_AMBIGUOUS", "Seller request timed out.")));
        request.on("error", (error) => reject(error instanceof ApnError ? error : httpError("APN_HTTP_AMBIGUOUS", "Seller transport failed safely.")));
        request.end();
    });
}
function pairRawHeaders(values) {
    if (values.length % 2 !== 0)
        throw httpError("APN_HTTP_PROTOCOL", "Seller raw headers are malformed.");
    const pairs = [];
    for (let index = 0; index < values.length; index += 2) {
        const name = values[index];
        const value = values[index + 1];
        if (name === undefined || value === undefined)
            throw httpError("APN_HTTP_PROTOCOL", "Seller raw headers are malformed.");
        pairs.push([name, value]);
    }
    return pairs;
}
function validateRawHeaders(pairs) {
    if (pairs.length > MAX_HEADER_PAIRS)
        throw httpError("APN_HTTP_PROTOCOL", "Seller returned too many headers.");
    let aggregate = 0;
    const controlCounts = new Map();
    for (const [name, value] of pairs) {
        const nameBytes = Buffer.byteLength(name, "ascii");
        const valueBytes = Buffer.byteLength(value, "utf8");
        aggregate += nameBytes + valueBytes;
        if (nameBytes === 0 || nameBytes > MAX_HEADER_NAME_BYTES || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/u.test(name)) {
            throw httpError("APN_HTTP_PROTOCOL", "Seller header name is invalid.");
        }
        const normalizedName = name.toLowerCase();
        if (CONTROL_HEADERS.has(normalizedName)) {
            if (valueBytes > MAX_CONTROL_VALUE_BYTES)
                throw httpError("APN_HTTP_PROTOCOL", "x402 control header exceeds the size limit.");
            if (value.trim() !== value || value.includes(","))
                throw httpError("APN_HTTP_PROTOCOL", "x402 control header is folded or non-canonical.");
            const count = (controlCounts.get(normalizedName) ?? 0) + 1;
            if (count > 1)
                throw httpError("APN_HTTP_PROTOCOL", `Seller response contains duplicate ${normalizedName} headers.`);
            controlCounts.set(normalizedName, count);
        }
    }
    if (aggregate > MAX_AGGREGATE_HEADER_BYTES)
        throw httpError("APN_HTTP_PROTOCOL", "Seller headers exceed the aggregate size limit.");
}
function singleControlHeader(pairs, name) {
    const value = optionalSingleHeader(pairs, name);
    if (value === undefined)
        throw httpError("APN_HTTP_PROTOCOL", `Seller response requires exactly one ${name.toUpperCase()} header.`);
    if (value.trim() !== value || value.includes(","))
        throw httpError("APN_HTTP_PROTOCOL", "x402 control header is folded or non-canonical.");
    return value;
}
function optionalSingleHeader(pairs, name) {
    const values = pairs.filter(([candidate]) => candidate.toLowerCase() === name).map(([, value]) => value);
    if (values.length > 1)
        throw httpError("APN_HTTP_PROTOCOL", `Seller response contains duplicate ${name} headers.`);
    return values[0];
}
function singleControlLikeHeader(pairs, name) {
    const value = optionalSingleHeader(pairs, name);
    if (value === undefined || value.trim() !== value || value.includes(",")) {
        throw resultError(`Seller response requires one canonical ${name.toUpperCase()} header.`);
    }
    return value;
}
function requireAsciiControl(value, name) {
    if (!/^[\x20-\x7e]+$/u.test(value))
        throw httpError("APN_HTTP_PROTOCOL", `${name} must be exact ASCII.`);
}
function httpError(code, message) {
    return new ApnError(code, message);
}
function resultError(message) {
    return new ApnError("APN_X402_RESULT_INVALID", message);
}
//# sourceMappingURL=x402-http.js.map