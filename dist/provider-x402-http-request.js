import { canonicalJson, domainHash, hashObject, sha256 } from "./canonical.js";
import { ApnError } from "./errors.js";
import { normalizeX402HttpRequest, validateFrozenX402HttpRequest } from "./x402-http-request.js";
export function providerHttpRequest(endpoint, httpRequest) {
    const canonicalUrl = endpoint.toString();
    const bodyState = httpRequest === undefined || httpRequest.bodyBase64 === null ? "absent" : "present";
    const method = httpRequest?.method ?? "GET";
    const bodyDigest = bodyState === "absent"
        ? domainHash("apn.x402.absent-body.v1", canonicalJson({ state: "absent" }))
        : domainHash("apn.http-body.v1", canonicalJson({ bodyBase64: httpRequest?.bodyBase64 }));
    const metadata = { method, bodyState, headers: httpRequest?.headers ?? "none" };
    return {
        canonicalUrl, origin: endpoint.origin, path: endpoint.pathname, urlHash: sha256(canonicalUrl),
        method, bodyState, bodyDigest, metadataDigest: hashObject(metadata),
        requestDigest: httpRequest === undefined
            ? domainHash("apn.provider-x402.request.v1", canonicalJson({ canonicalUrl, ...metadata, bodyDigest }))
            : domainHash("apn.provider-x402.request.v2", canonicalJson(httpRequest)),
        ...(httpRequest === undefined ? {} : { httpRequest }),
    };
}
export function validateProviderHttpRequest(request) {
    try {
        validateFrozenX402HttpRequest(request.canonicalUrl, request.httpRequest);
        const expected = providerHttpRequest(new URL(request.canonicalUrl), request.httpRequest);
        if (canonicalJson(request) === canonicalJson(expected))
            return;
    }
    catch { }
    throw new ApnError("APN_STATE_CORRUPT", "Provider HTTP request binding is invalid.");
}
export function assertProviderHttpRequest(port, request) {
    if (request === undefined)
        return;
    if (port.assertCompatibleRequest === undefined) {
        throw new ApnError("APN_PROVIDER_PROTOCOL", "Provider has not declared exact HTTP request support.");
    }
    port.assertCompatibleRequest(request);
}
export function assertAwalHttpRequest(request) {
    normalizeX402HttpRequest(request);
    if (request.bodyBase64 !== null) {
        throw new ApnError("APN_PROVIDER_PROTOCOL", "Pinned Coinbase AWAL cannot forward opaque body bytes unchanged; no provider payment was started.");
    }
}
//# sourceMappingURL=provider-x402-http-request.js.map