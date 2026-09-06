import { canonicalJson, domainHash, exactKeys, isPlainRecord, sha256 } from "./canonical.js";
import { ApnError } from "./errors.js";
import { parsePublicHttpsUrl } from "./network-policy.js";
import { parseJsonWithDuplicateRejection } from "./x402-strict-json.js";
export const X402_REQUEST_BODY_LIMIT = 64 * 1024;
const TOKEN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/u;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
const FORBIDDEN_HEADERS = new Set([
    "host", "connection", "content-length", "transfer-encoding", "trailer", "te", "upgrade", "expect",
    "keep-alive", "authorization", "proxy-authorization", "proxy-authenticate", "cookie", "set-cookie",
    "forwarded", "via", "x-api-key", "api-key", "payment-signature", "payment-required", "payment-response",
    "x-payment", "x-payment-response", "x-real-ip", "accept-encoding",
]);
export function decodeX402RequestBody(value) {
    if (value === null)
        return undefined;
    if (typeof value !== "string" || value.length > Math.ceil(X402_REQUEST_BODY_LIMIT / 3) * 4 || !BASE64.test(value)) {
        throw invalid("HTTP body must be canonical base64 within 64 KiB.");
    }
    const bytes = Buffer.from(value, "base64");
    if (bytes.byteLength > X402_REQUEST_BODY_LIMIT || bytes.toString("base64") !== value) {
        throw invalid("HTTP body must be canonical base64 within 64 KiB.");
    }
    return bytes;
}
export function normalizeX402HttpRequest(value) {
    if (!isPlainRecord(value) || !exactKeys(value, ["schemaVersion", "url", "method", "headers", "bodyBase64"]) ||
        value.schemaVersion !== "apn.http-request.v1" || typeof value.url !== "string" ||
        typeof value.method !== "string" || value.method.length > 32 || !TOKEN.test(value.method)) {
        throw invalid("HTTP request envelope is invalid.");
    }
    const endpoint = parsePublicHttpsUrl(value.url, "APN_HTTP_CONFIG", "Seller URL", 2048);
    if (endpoint.toString() !== value.url)
        throw invalid("HTTP request URL must be canonical.");
    const method = value.method.toUpperCase();
    if (method === "CONNECT" || method === "TRACE")
        throw invalid("HTTP tunneling and trace methods are forbidden.");
    if (!isPlainRecord(value.headers) || Object.keys(value.headers).length > 32)
        throw invalid("HTTP headers are invalid.");
    const entries = [];
    const names = new Set();
    let headerBytes = 0;
    for (const [originalName, headerValue] of Object.entries(value.headers)) {
        const name = originalName.toLowerCase();
        if (name.length > 128 || !TOKEN.test(name) || names.has(name) || FORBIDDEN_HEADERS.has(name) ||
            /^(?:proxy-|sec-|x-forwarded-|x-apn-)/u.test(name) || typeof headerValue !== "string" ||
            headerValue.length > 2048 || !/^[\x20-\x7e]*$/u.test(headerValue) || headerValue.trim() !== headerValue) {
            throw invalid("HTTP headers contain an unsafe, duplicate or oversized entry.");
        }
        names.add(name);
        headerBytes += name.length + headerValue.length + 4;
        if (headerBytes > 8192)
            throw invalid("HTTP headers exceed 8 KiB.");
        entries.push([name, headerValue]);
    }
    decodeX402RequestBody(value.bodyBase64);
    return Object.freeze({
        schemaVersion: "apn.http-request.v1",
        url: value.url,
        method,
        headers: Object.freeze(Object.fromEntries(entries.sort(([left], [right]) => left.localeCompare(right)))),
        bodyBase64: value.bodyBase64,
    });
}
export function optionalX402HttpRequest(url, value) {
    if (value === undefined)
        return undefined;
    const request = normalizeX402HttpRequest(value);
    if (request.url !== url)
        throw invalid("HTTP request does not match the seller URL.");
    return request;
}
export function bindX402HttpRequest(options) {
    if (options["--method"] === undefined && options["--headers-json"] === undefined && options["--body-base64"] === undefined)
        return {};
    let headers = {};
    const encodedHeaders = options["--headers-json"];
    if (encodedHeaders !== undefined) {
        if (Buffer.byteLength(encodedHeaders, "utf8") > 16 * 1024)
            throw invalid("HTTP headers JSON is oversized.");
        try {
            headers = parseJsonWithDuplicateRejection(encodedHeaders);
        }
        catch {
            throw invalid("HTTP headers must be a JSON object without duplicate names.");
        }
    }
    return { httpRequest: normalizeX402HttpRequest({
            schemaVersion: "apn.http-request.v1",
            url: options["--url"],
            method: options["--method"] ?? "GET",
            headers,
            bodyBase64: options["--body-base64"] ?? null,
        }) };
}
export function x402HttpRequestBinding(request) {
    return request === undefined ? {} : { httpRequestHash: domainHash("apn.http-request.v1", canonicalJson(request)) };
}
export function validateFrozenX402HttpRequest(url, value) {
    if (value === undefined)
        return;
    try {
        if (canonicalJson(optionalX402HttpRequest(url, value)) === canonicalJson(value))
            return;
    }
    catch { }
    throw new ApnError("APN_STATE_CORRUPT", "Frozen HTTP request is invalid or non-canonical.");
}
function invalid(message) {
    return new ApnError("APN_INVALID_INPUT", message);
}
export function validateX402Resource(value) {
    try {
        if (!isPlainRecord(value) || !exactKeys(value, ["canonicalUrl", "origin", "path", "urlHash",
            ...(value.httpRequest === undefined ? [] : ["httpRequest"])]) || typeof value.canonicalUrl !== "string") {
            throw invalid("Invalid resource.");
        }
        const endpoint = parsePublicHttpsUrl(value.canonicalUrl, "APN_HTTP_CONFIG", "Seller URL", 2048);
        if (endpoint.toString() !== value.canonicalUrl || value.origin !== endpoint.origin ||
            value.path !== endpoint.pathname || value.urlHash !== sha256(value.canonicalUrl))
            throw invalid("Invalid resource binding.");
        validateFrozenX402HttpRequest(value.canonicalUrl, value.httpRequest);
        return value;
    }
    catch {
        throw new ApnError("APN_STATE_CORRUPT", "Frozen x402 resource is invalid.");
    }
}
export function isX402ResultStatus(resource, status) {
    return isPlainRecord(resource) && (resource.httpRequest === undefined
        ? status === "200" : typeof status === "string" && /^2[0-9]{2}$/u.test(status));
}
//# sourceMappingURL=x402-http-request.js.map