import { canonicalJson, domainHash, exactKeys, isPlainRecord } from "../canonical.js";
import { GaslessHttps } from "../gasless/https.js";
import { parseJsonWithDuplicateRejection } from "../x402-strict-json.js";
import { saProviderReasonToken } from "./model.js";
import { saFail } from "./reasons.js";
import { saRegistry } from "./registry.js";
const MAX_RESPONSE = 256 * 1024;
const MAX_BODY = 64 * 1024;
const SUPPORT_DOMAIN = "apn.smart-account.gasless.provider-supported.v1";
const VERIFY_DOMAIN = "apn.smart-account.gasless.provider-verify.v1";
const SETTLE_DOMAIN = "apn.smart-account.gasless.provider-settle.v1";
/** Exactly one transport call per method; the lifecycle owns every dispatch marker. */
export class MetaMaskSmartAccountGaslessProvider {
    transport;
    now;
    constructor(transport = new GaslessHttps(), now = () => new Date()) {
        this.transport = transport;
        this.now = now;
    }
    async supported() {
        const registry = saRegistry(8453);
        let response;
        try {
            response = await this.transport.request(`${registry.facilitatorUrl}/supported`, "GET", null, MAX_RESPONSE, "APN_HTTP_CONFIG");
        }
        catch {
            return saFail("sa_gasless_provider_unavailable");
        }
        if (response.status !== 200)
            saFail("sa_gasless_provider_unavailable");
        const value = parse(response.body), facilitators = supportedFacilitators(value);
        return { endpointOrigin: registry.facilitatorOrigin, endpointHash: registry.facilitatorEndpointHash,
            facilitatorAddresses: facilitators, supportedResponseHash: domainHash(SUPPORT_DOMAIN, canonicalJson(value)),
            observedAt: instant(this.now()) };
    }
    /** A refused answer is returned, not thrown, so the journal keeps what the facilitator said without asking again. */
    async verify(operation, material) {
        const value = await this.post("verify", operation, material);
        if (!isPlainRecord(value) || !knownKeys(value, ["isValid", "invalidReason", "invalidMessage", "payer", "extensions", "extra"]) ||
            typeof value.isValid !== "boolean" || !optionalString(value.invalidReason) || !optionalString(value.invalidMessage) ||
            !optionalRecord(value.extensions) || !optionalRecord(value.extra))
            saFail("sa_gasless_provider_protocol");
        const observedAt = instant(this.now()), responseHash = domainHash(VERIFY_DOMAIN, canonicalJson(value));
        if (value.isValid !== true) {
            return { observedAt, payer: claimedPayer(value.payer), isValid: false,
                invalidReason: saProviderReasonToken(value.invalidReason), responseHash };
        }
        const payer = payerAddress(value.payer);
        if (payer !== operation.intent.binding.ownerAddress) {
            return { observedAt, payer, isValid: true, invalidReason: saProviderReasonToken(value.invalidReason), responseHash };
        }
        return { observedAt, payer, isValid: true, responseHash };
    }
    async settle(operation, material) {
        const value = await this.post("settle", operation, material);
        if (!isPlainRecord(value) || !knownKeys(value, ["success", "errorReason", "errorMessage", "payer", "transaction",
            "network", "amount", "extensions", "extra"]) || typeof value.success !== "boolean" ||
            !optionalString(value.errorReason) || !optionalString(value.errorMessage) || !optionalString(value.amount) ||
            !optionalRecord(value.extensions) || !optionalRecord(value.extra))
            saFail("sa_gasless_provider_protocol");
        if (value.success !== true)
            saFail("sa_gasless_unknown");
        if (payerAddress(value.payer) !== operation.intent.binding.ownerAddress || value.network !== "eip155:8453" ||
            typeof value.transaction !== "string" || !/^0x[0-9a-fA-F]{64}$/u.test(value.transaction) ||
            (value.amount !== undefined && value.amount !== operation.intent.request.grossAtomic))
            saFail("sa_gasless_provider_protocol");
        return { observedAt: instant(this.now()), transactionHash: value.transaction.toLowerCase(),
            responseHash: domainHash(SETTLE_DOMAIN, canonicalJson(value)) };
    }
    async post(path, operation, material) {
        if (material.phase !== "exposed" || canonicalJson(material.paymentPayload.accepted) !== canonicalJson(operation.intent.requirements) ||
            material.descriptor.materialHash !== operation.material?.materialHash)
            saFail("sa_gasless_state_corrupt");
        const registry = saRegistry(8453);
        const body = canonicalJson({ x402Version: 2, paymentPayload: material.paymentPayload,
            paymentRequirements: operation.intent.requirements });
        if (Buffer.byteLength(body, "utf8") > MAX_BODY)
            saFail("sa_gasless_provider_protocol");
        let response;
        try {
            response = await this.transport.request(`${registry.facilitatorUrl}/${path}`, "POST", body, MAX_RESPONSE, "APN_HTTP_CONFIG");
        }
        catch {
            return saFail("sa_gasless_provider_unavailable");
        }
        if (response.status !== 200)
            saFail("sa_gasless_provider_unavailable");
        return parse(response.body);
    }
}
function supportedFacilitators(value) {
    if (!isPlainRecord(value) || !exactKeys(value, ["kinds", "extensions", "signers"]) || !Array.isArray(value.kinds) ||
        !Array.isArray(value.extensions) || !value.extensions.every(item => typeof item === "string") ||
        !isPlainRecord(value.signers))
        saFail("sa_gasless_provider_protocol");
    const rows = value.kinds.filter(row => isPlainRecord(row) && row.network === "eip155:8453");
    if (rows.length !== 1)
        saFail("sa_gasless_provider_protocol");
    const row = rows[0];
    if (!exactKeys(row, ["x402Version", "scheme", "network", "extra"]) || row.x402Version !== 2 ||
        row.scheme !== "exact" || !isPlainRecord(row.extra) || !Array.isArray(row.extra.assetTransferMethods) ||
        !row.extra.assetTransferMethods.includes("erc7710") || !Array.isArray(row.extra.facilitatorAddresses)) {
        saFail("sa_gasless_provider_protocol");
    }
    const offered = row.extra.facilitatorAddresses.map((address) => payerAddress(address));
    if (new Set(offered).size !== offered.length)
        saFail("sa_gasless_provider_protocol");
    const wildcard = value.signers["eip155:*"];
    if (!Array.isArray(wildcard) || wildcard.length === 0)
        saFail("sa_gasless_provider_protocol");
    const signers = wildcard.map((address) => payerAddress(address));
    if (new Set(signers).size !== signers.length)
        saFail("sa_gasless_provider_protocol");
    // The facilitator may redeem with any address it publishes. A delegation that names only some of them can be refused at
    // verify after its one exposure, so a published set other than the pinned one stops the transfer before signing.
    const pinned = [...saRegistry(8453).facilitatorAddresses].sort();
    if (canonicalJson([...offered].sort()) !== canonicalJson(pinned) ||
        !signers.every((address) => pinned.includes(address)))
        saFail("sa_gasless_facilitator_set");
    return pinned;
}
function knownKeys(value, allowed) {
    return Object.keys(value).every(key => allowed.includes(key));
}
function optionalString(value) { return value === undefined || typeof value === "string"; }
function optionalRecord(value) { return value === undefined || isPlainRecord(value); }
/** A refused answer may name no payer or a malformed one; that is recorded as none, never as a protocol failure. */
function claimedPayer(value) {
    return typeof value === "string" && /^0x[0-9a-fA-F]{40}$/u.test(value) ? value.toLowerCase() : null;
}
function payerAddress(value) {
    if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/u.test(value))
        saFail("sa_gasless_provider_protocol");
    return value.toLowerCase();
}
function parse(body) {
    if (Buffer.byteLength(body, "utf8") > MAX_RESPONSE)
        saFail("sa_gasless_provider_protocol");
    try {
        return parseJsonWithDuplicateRejection(body);
    }
    catch {
        return saFail("sa_gasless_provider_protocol");
    }
}
function instant(value) {
    if (!Number.isFinite(value.getTime()))
        saFail("sa_gasless_clock");
    return value.toISOString();
}
//# sourceMappingURL=provider.js.map