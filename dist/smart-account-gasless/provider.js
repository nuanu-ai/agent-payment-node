import { canonicalJson, domainHash, exactKeys, isPlainRecord } from "../canonical.js";
import { GaslessHttps } from "../gasless/https.js";
import { parseJsonWithDuplicateRejection } from "../x402-strict-json.js";
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
    async verify(operation, material) {
        const value = await this.post("verify", operation, material);
        if (!isPlainRecord(value) || !knownKeys(value, ["isValid", "invalidReason", "invalidMessage", "payer", "extensions", "extra"]) ||
            typeof value.isValid !== "boolean" || !optionalString(value.invalidReason) || !optionalString(value.invalidMessage) ||
            !optionalRecord(value.extensions) || !optionalRecord(value.extra))
            saFail("sa_gasless_provider_protocol");
        if (value.isValid !== true)
            saFail("sa_gasless_verify_rejected");
        const payer = payerAddress(value.payer);
        if (payer !== operation.intent.binding.ownerAddress)
            saFail("sa_gasless_verify_rejected");
        return { observedAt: instant(this.now()), payer, isValid: true,
            responseHash: domainHash(VERIFY_DOMAIN, canonicalJson(value)) };
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
    const registry = saRegistry(8453), approved = new Set(registry.facilitatorAddresses);
    const intersection = offered.filter((address) => approved.has(address)).sort();
    if (intersection.length === 0)
        saFail("sa_gasless_capability");
    const wildcard = value.signers["eip155:*"];
    if (!Array.isArray(wildcard) || !wildcard.map((address) => payerAddress(address))
        .some((address) => intersection.includes(address))) {
        saFail("sa_gasless_provider_protocol");
    }
    return intersection;
}
function knownKeys(value, allowed) {
    return Object.keys(value).every(key => allowed.includes(key));
}
function optionalString(value) { return value === undefined || typeof value === "string"; }
function optionalRecord(value) { return value === undefined || isPlainRecord(value); }
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