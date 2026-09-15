import { canonicalJson, domainHash, isPlainRecord } from "../canonical.js";
import { GaslessHttps } from "../gasless/https.js";
import { parseJsonWithDuplicateRejection } from "../x402-strict-json.js";
import { facilitatorFail } from "./failure.js";
import { AVALANCHE_FACILITATOR as R } from "./registry.js";
const MAX_RESPONSE = 256 * 1024;
const MAX_BODY = 64 * 1024;
const SUPPORT_DOMAIN = "apn.facilitator-gasless.supported.v1";
const VERIFY_DOMAIN = "apn.facilitator-gasless.verify.v1";
const SETTLE_DOMAIN = "apn.facilitator-gasless.settle.v1";
/** Exactly one transport call per method; the lifecycle owns every durable marker around it. */
export class PayAiFacilitator {
    transport;
    now;
    constructor(transport = new GaslessHttps(), now = () => new Date()) {
        this.transport = transport;
        this.now = now;
    }
    async supported() {
        const value = parse(await this.call("supported", null));
        if (!isPlainRecord(value) || !Array.isArray(value.kinds) || !isPlainRecord(value.signers))
            facilitatorFail("facilitator_gasless_provider_protocol");
        const kind = value.kinds.some(row => isPlainRecord(row) && row.x402Version === 2 && row.scheme === "exact" && row.network === R.network);
        if (!kind)
            facilitatorFail("facilitator_gasless_capability");
        const listed = [...signerList(value.signers["eip155:*"]), ...signerList(value.signers[R.network])];
        const signers = R.approvedSigners.filter(signer => listed.includes(signer));
        if (signers.length === 0)
            facilitatorFail("facilitator_gasless_capability");
        return { endpointOrigin: R.facilitatorOrigin, endpointHash: R.facilitatorEndpointHash, signers,
            supportedResponseHash: domainHash(SUPPORT_DOMAIN, canonicalJson(value)), observedAt: instant(this.now()) };
    }
    async verify(payment) {
        const value = parse(await this.call("verify", body(payment)));
        if (!isPlainRecord(value) || typeof value.isValid !== "boolean")
            facilitatorFail("facilitator_gasless_provider_protocol");
        if (value.isValid !== true || address(value.payer) !== payment.authorization.from)
            facilitatorFail("facilitator_gasless_verify_rejected");
        return { observedAt: instant(this.now()), payer: payment.authorization.from, responseHash: domainHash(VERIFY_DOMAIN, canonicalJson(value)) };
    }
    async settle(payment) {
        const value = parse(await this.call("settle", body(payment)));
        if (!isPlainRecord(value) || typeof value.success !== "boolean")
            facilitatorFail("facilitator_gasless_provider_protocol");
        const transactionHash = typeof value.transaction === "string" && /^0x[0-9a-fA-F]{64}$/u.test(value.transaction)
            ? value.transaction.toLowerCase() : null;
        if ((value.network !== undefined && value.network !== R.network) ||
            (value.payer !== undefined && address(value.payer) !== payment.authorization.from))
            facilitatorFail("facilitator_gasless_provider_protocol");
        const pending = value.success !== true && value.errorReason === "settlement_pending" && transactionHash !== null;
        if (value.success !== true && !pending)
            facilitatorFail("facilitator_gasless_settle_unknown");
        if (value.success === true && transactionHash === null)
            facilitatorFail("facilitator_gasless_provider_protocol");
        return { observedAt: instant(this.now()), transactionHash, pending, responseHash: domainHash(SETTLE_DOMAIN, canonicalJson(value)) };
    }
    async call(path, payload) {
        if (payload !== null && Buffer.byteLength(payload, "utf8") > MAX_BODY)
            facilitatorFail("facilitator_gasless_provider_protocol");
        let response;
        try {
            response = await this.transport.request(`${R.facilitatorUrl}/${path}`, payload === null ? "GET" : "POST", payload, MAX_RESPONSE, "APN_HTTP_CONFIG");
        }
        catch {
            return facilitatorFail("facilitator_gasless_provider_unavailable");
        }
        if (response.status !== 200)
            facilitatorFail("facilitator_gasless_provider_unavailable");
        return response.body;
    }
}
/** `resource` is omitted: the requirement is APN's own, not a seller offer. */
function body(payment) {
    return canonicalJson({ x402Version: 2, paymentRequirements: payment.requirement, paymentPayload: {
            x402Version: 2, accepted: payment.requirement, payload: { signature: payment.signature, authorization: payment.authorization }
        } });
}
function signerList(value) {
    return Array.isArray(value) ? value.filter((item) => typeof item === "string").map(item => item.toLowerCase()) : [];
}
function address(value) {
    if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/u.test(value))
        facilitatorFail("facilitator_gasless_provider_protocol");
    return value.toLowerCase();
}
function parse(text) {
    if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE)
        facilitatorFail("facilitator_gasless_provider_protocol");
    try {
        return parseJsonWithDuplicateRejection(text);
    }
    catch {
        return facilitatorFail("facilitator_gasless_provider_protocol");
    }
}
function instant(value) {
    if (!Number.isFinite(value.getTime()))
        facilitatorFail("facilitator_gasless_state_corrupt");
    return value.toISOString();
}
//# sourceMappingURL=facilitator.js.map