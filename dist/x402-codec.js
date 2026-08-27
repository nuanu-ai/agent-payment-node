import { decodePaymentRequiredHeader as decodeOfficialPaymentRequiredHeader, decodePaymentResponseHeader as decodeOfficialPaymentResponseHeader, decodePaymentSignatureHeader as decodeOfficialPaymentSignatureHeader, encodePaymentRequiredHeader as encodeOfficialPaymentRequiredHeader, } from "@x402/core/http";
import { canonicalJson, domainHash, exactKeys, isPlainRecord } from "./canonical.js";
import { BASE_USDC, CHAIN_CAIP2 } from "./constants.js";
import { ApnError } from "./errors.js";
const MAX_DECODED_X402_BYTES = 48 * 1024;
const MAX_ACCEPTS = 16;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/u;
const LOWER_ADDRESS = /^0x[0-9a-f]{40}$/u;
const BYTES32 = /^0x[0-9a-f]{64}$/u;
const TRANSACTION_HASH = /^0x[0-9a-f]{64}$/u;
const POSITIVE_UINT = /^[1-9][0-9]*$/u;
const SECP256K1_ORDER = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const SECP256K1_HALF_ORDER = 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0n;
const READINESS = {
    cap: "unverified",
    walletBalance: "unverified",
    tokenDomain: "unverified",
    payment: "unverified",
};
export function encodeCanonicalBase64Json(value) {
    const json = JSON.stringify(value);
    if (json === undefined)
        throw protocol("x402 JSON value is not encodable.");
    return Buffer.from(json, "utf8").toString("base64");
}
export function decodeCanonicalBase64Json(value) {
    const bytes = decodeCanonicalBase64(value);
    let json;
    try {
        json = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    }
    catch {
        throw protocol("x402 header is not strict UTF-8.");
    }
    return parseJsonWithDuplicateRejection(json);
}
export function encodePaymentRequiredHeader(value) {
    validatePaymentRequired(value);
    const encoded = encodeOfficialPaymentRequiredHeader(value);
    decodeCanonicalBase64(encoded);
    return encoded;
}
export function decodePaymentRequiredHeader(value) {
    const strict = decodeCanonicalBase64Json(value);
    validatePaymentRequired(strict);
    let official;
    try {
        official = decodeOfficialPaymentRequiredHeader(value);
    }
    catch {
        throw protocol("Official x402 v2 representation rejected PAYMENT-REQUIRED.");
    }
    if (JSON.stringify(official) !== JSON.stringify(strict)) {
        throw protocol("Official and strict x402 representations disagree.");
    }
    return strict;
}
export function encodePaymentSignatureHeader(value) {
    validatePaymentPayload(value);
    const encoded = Buffer.from(canonicalJson(value), "utf8").toString("base64");
    let official;
    try {
        official = decodeOfficialPaymentSignatureHeader(encoded);
    }
    catch {
        throw protocol("Official x402 v2 representation rejected canonical PAYMENT-SIGNATURE.");
    }
    if (canonicalJson(official) !== canonicalJson(value)) {
        throw protocol("Official and canonical PAYMENT-SIGNATURE representations disagree.");
    }
    return encoded;
}
export function decodePaymentSignatureHeader(value) {
    const strict = decodeCanonicalBase64Json(value);
    validatePaymentPayload(strict);
    let official;
    try {
        official = decodeOfficialPaymentSignatureHeader(value);
    }
    catch {
        throw protocol("Official x402 v2 representation rejected PAYMENT-SIGNATURE.");
    }
    if (JSON.stringify(official) !== JSON.stringify(strict)) {
        throw protocol("Official and strict PAYMENT-SIGNATURE representations disagree.");
    }
    return strict;
}
export function decodeAndNormalizePaymentResponseHeader(value, expected) {
    try {
        return decodeAndNormalizePaymentResponseHeaderUnsafe(value, expected);
    }
    catch (error) {
        if (error instanceof ApnError && error.code === "APN_X402_SETTLEMENT_INVALID")
            throw error;
        throw settlement("PAYMENT-RESPONSE violates the strict settlement schema.");
    }
}
function decodeAndNormalizePaymentResponseHeaderUnsafe(value, expected) {
    const strict = decodeCanonicalBase64Json(value);
    const response = record(strict, "PAYMENT-RESPONSE");
    allowedKeys(response, ["success", "transaction", "network"], ["errorReason", "payer", "amount", "extensions"]);
    let official;
    try {
        official = decodeOfficialPaymentResponseHeader(value);
    }
    catch {
        throw settlement("Official x402 v2 representation rejected PAYMENT-RESPONSE.");
    }
    if (canonicalJson(official) !== canonicalJson(strict)) {
        throw settlement("Official and strict PAYMENT-RESPONSE representations disagree.");
    }
    if (response.success !== true && response.success !== false)
        throw settlement("PAYMENT-RESPONSE success is invalid.");
    if (typeof response.transaction !== "string" || !TRANSACTION_HASH.test(response.transaction) ||
        /^0x0{64}$/u.test(response.transaction))
        throw settlement("PAYMENT-RESPONSE transaction is invalid.");
    if (response.network !== CHAIN_CAIP2)
        throw settlement("PAYMENT-RESPONSE network is invalid.");
    let payer;
    if (response.payer !== undefined) {
        if (typeof response.payer !== "string" || !ADDRESS.test(response.payer) || /^0x0{40}$/iu.test(response.payer)) {
            throw settlement("PAYMENT-RESPONSE payer is invalid.");
        }
        payer = response.payer.toLowerCase();
        if (payer !== expected.payer)
            throw settlement("PAYMENT-RESPONSE payer conflicts with the frozen operation.");
    }
    if (response.amount !== undefined && (typeof response.amount !== "string" || !POSITIVE_UINT.test(response.amount) || response.amount !== expected.amountAtomic))
        throw settlement("PAYMENT-RESPONSE amount conflicts with the frozen operation.");
    if (response.extensions !== undefined && (!isPlainRecord(response.extensions) || Object.keys(response.extensions).length !== 0))
        throw settlement("PAYMENT-RESPONSE extensions are invalid.");
    let classification;
    if (response.success) {
        if (response.errorReason !== undefined)
            throw settlement("Successful PAYMENT-RESPONSE must omit errorReason.");
        classification = "success";
    }
    else {
        if (typeof response.errorReason !== "string" || response.errorReason.length === 0 ||
            Buffer.byteLength(response.errorReason, "utf8") > 512)
            throw settlement("Failed PAYMENT-RESPONSE errorReason is invalid.");
        classification = response.errorReason === "settlement_pending" ? "settlement_pending" : "failure_with_transaction";
    }
    const normalized = {
        success: response.success,
        ...(response.errorReason === undefined ? {} : { errorReason: response.errorReason }),
        ...(payer === undefined ? {} : { payer }),
        transaction: response.transaction,
        network: CHAIN_CAIP2,
        ...(response.amount === undefined ? {} : { amount: response.amount }),
        ...(response.extensions === undefined ? {} : { extensions: {} }),
    };
    const normalizedCanonicalJson = canonicalJson(normalized);
    return {
        classification,
        normalizedCanonicalJson,
        transactionHash: response.transaction,
        paymentResponseHeaderHash: domainHash("apn.x402.payment-response-header.v1", Buffer.from(value, "ascii")),
        settlementResponseHash: domainHash("apn.x402.settlement.v1", normalizedCanonicalJson),
    };
}
export function inspectCandidates(paymentRequired, requestedUrl) {
    if (paymentRequired.x402Version !== 2 || !resourceMatches(paymentRequired.resource.url, requestedUrl))
        return [];
    const output = [];
    paymentRequired.accepts.forEach((requirements, index) => {
        const candidate = inspectCandidate(requirements, index);
        if (candidate !== null)
            output.push(candidate);
    });
    return output;
}
function inspectCandidate(requirements, index) {
    const extra = requirements.extra;
    if (requirements.scheme !== "exact" || requirements.network !== CHAIN_CAIP2 ||
        !ADDRESS.test(requirements.asset) || requirements.asset.toLowerCase() !== BASE_USDC.toLowerCase() ||
        !POSITIVE_UINT.test(requirements.amount) || !ADDRESS.test(requirements.payTo) || /^0x0{40}$/iu.test(requirements.payTo) ||
        !Number.isInteger(requirements.maxTimeoutSeconds) || requirements.maxTimeoutSeconds < 30 || requirements.maxTimeoutSeconds > 300 ||
        !isPlainRecord(extra) || typeof extra.name !== "string" || extra.name.length === 0 ||
        typeof extra.version !== "string" || extra.version.length === 0 ||
        (extra.assetTransferMethod !== undefined && extra.assetTransferMethod !== "eip3009") ||
        (extra.paymentFlow !== undefined && extra.paymentFlow !== "authorization"))
        return null;
    const declaredCanonicalJson = canonicalJson(requirements);
    return {
        index: index.toString(),
        scheme: "exact",
        network: CHAIN_CAIP2,
        asset: requirements.asset.toLowerCase(),
        amountAtomic: requirements.amount,
        payTo: requirements.payTo.toLowerCase(),
        maxTimeoutSeconds: requirements.maxTimeoutSeconds.toString(),
        tokenName: extra.name,
        tokenVersion: extra.version,
        assetTransferMethod: "eip3009",
        paymentFlow: "transferWithAuthorization",
        offerHash: domainHash("apn.x402.offer.v1", declaredCanonicalJson),
        readiness: READINESS,
    };
}
function validatePaymentRequired(value) {
    const paymentRequired = record(value, "PAYMENT-REQUIRED");
    allowedKeys(paymentRequired, ["x402Version", "resource", "accepts"], ["extensions"]);
    if (paymentRequired.x402Version !== 2)
        throw protocol("Only x402Version 2 is supported.");
    validateResource(paymentRequired.resource);
    if (!Array.isArray(paymentRequired.accepts) || paymentRequired.accepts.length === 0 || paymentRequired.accepts.length > MAX_ACCEPTS) {
        throw protocol("PAYMENT-REQUIRED accepts must contain 1 through 16 entries.");
    }
    paymentRequired.accepts.forEach(validateRequirements);
    if (paymentRequired.extensions !== undefined)
        validateExtensions(paymentRequired.extensions);
}
function validatePaymentPayload(value) {
    const paymentPayload = record(value, "PAYMENT-SIGNATURE");
    allowedKeys(paymentPayload, ["x402Version", "resource", "accepted", "payload"], ["extensions"]);
    if (paymentPayload.x402Version !== 2)
        throw protocol("Only x402Version 2 PaymentPayload is supported.");
    validateResource(paymentPayload.resource);
    validateRequirements(paymentPayload.accepted);
    const accepted = paymentPayload.accepted;
    if (inspectCandidate(accepted, 0) === null)
        throw protocol("PAYMENT-SIGNATURE accepted requirements are unsupported.");
    const payload = record(paymentPayload.payload, "exact-EVM payload");
    allowedKeys(payload, ["signature", "authorization"], []);
    validateEvmSignature(payload.signature);
    const authorization = record(payload.authorization, "exact-EVM authorization");
    allowedKeys(authorization, ["from", "to", "value", "validAfter", "validBefore", "nonce"], []);
    if (typeof authorization.from !== "string" || !LOWER_ADDRESS.test(authorization.from) || /^0x0{40}$/u.test(authorization.from) ||
        typeof authorization.to !== "string" || !LOWER_ADDRESS.test(authorization.to) || /^0x0{40}$/u.test(authorization.to) ||
        typeof authorization.value !== "string" || !POSITIVE_UINT.test(authorization.value) ||
        authorization.validAfter !== "0" || typeof authorization.validBefore !== "string" || !POSITIVE_UINT.test(authorization.validBefore) ||
        typeof authorization.nonce !== "string" || !BYTES32.test(authorization.nonce))
        throw protocol("PAYMENT-SIGNATURE authorization shape is invalid.");
    if (authorization.to !== accepted.payTo.toLowerCase() || authorization.value !== accepted.amount) {
        throw protocol("PAYMENT-SIGNATURE authorization economics disagree with accepted requirements.");
    }
    if (paymentPayload.extensions !== undefined)
        validateExtensions(paymentPayload.extensions, true);
}
function validateResource(value) {
    const resource = record(value, "resource");
    allowedKeys(resource, ["url"], ["description", "mimeType", "serviceName", "tags", "iconUrl"]);
    boundedString(resource.url, 2048, "resource.url");
    if (resource.description !== undefined)
        boundedString(resource.description, 512, "resource.description");
    if (resource.mimeType !== undefined)
        asciiString(resource.mimeType, 128, "resource.mimeType");
    if (resource.serviceName !== undefined)
        printableAscii(resource.serviceName, 32, "resource.serviceName");
    if (resource.tags !== undefined) {
        if (!Array.isArray(resource.tags) || resource.tags.length > 5)
            throw protocol("resource.tags is invalid.");
        resource.tags.forEach((tag) => printableAscii(tag, 32, "resource.tags entry"));
    }
    if (resource.iconUrl !== undefined) {
        boundedString(resource.iconUrl, 2048, "resource.iconUrl");
        let icon;
        try {
            icon = new URL(resource.iconUrl);
        }
        catch {
            throw protocol("resource.iconUrl is invalid.");
        }
        if (icon.protocol !== "https:" && icon.protocol !== "http:")
            throw protocol("resource.iconUrl scheme is invalid.");
    }
}
function validateRequirements(value) {
    const requirements = record(value, "payment requirements");
    allowedKeys(requirements, ["scheme", "network", "amount", "asset", "payTo", "maxTimeoutSeconds"], ["extra"]);
    boundedString(requirements.scheme, 64, "requirements.scheme");
    boundedString(requirements.network, 128, "requirements.network");
    boundedString(requirements.amount, 128, "requirements.amount");
    boundedString(requirements.asset, 256, "requirements.asset");
    boundedString(requirements.payTo, 256, "requirements.payTo");
    if (!Number.isSafeInteger(requirements.maxTimeoutSeconds))
        throw protocol("requirements.maxTimeoutSeconds is invalid.");
    if (requirements.extra === undefined)
        return;
    const extra = record(requirements.extra, "requirements.extra");
    allowedKeys(extra, ["name", "version"], ["assetTransferMethod", "paymentFlow"]);
    boundedString(extra.name, 128, "requirements.extra.name");
    boundedString(extra.version, 128, "requirements.extra.version");
    if (extra.assetTransferMethod !== undefined)
        boundedString(extra.assetTransferMethod, 64, "requirements.extra.assetTransferMethod");
    if (extra.paymentFlow !== undefined)
        boundedString(extra.paymentFlow, 64, "requirements.extra.paymentFlow");
}
function validateExtensions(value, paymentPayload = false) {
    const extensions = record(value, "extensions");
    const keys = Object.keys(extensions);
    if (keys.length === 0)
        return;
    if (!exactKeys(extensions, ["payment-identifier"]))
        throw protocol("Only the payment-identifier extension is supported.");
    const declaration = record(extensions["payment-identifier"], "payment-identifier declaration");
    allowedKeys(declaration, ["info", "schema"], []);
    const info = record(declaration.info, "payment-identifier info");
    allowedKeys(info, paymentPayload ? ["required", "id"] : ["required"], []);
    if (typeof info.required !== "boolean")
        throw protocol("payment-identifier required posture is invalid.");
    if (paymentPayload && (typeof info.id !== "string" || info.id.length < 16 || info.id.length > 128 || !/^[a-zA-Z0-9_-]+$/u.test(info.id)))
        throw protocol("payment-identifier id is invalid.");
    validatePaymentIdentifierSchema(declaration.schema);
}
function validateEvmSignature(value) {
    if (typeof value !== "string" || !/^0x[0-9a-f]{130}$/u.test(value)) {
        throw protocol("PAYMENT-SIGNATURE EVM signature is not canonical.");
    }
    const r = BigInt(`0x${value.slice(2, 66)}`);
    const s = BigInt(`0x${value.slice(66, 130)}`);
    const recovery = value.slice(130);
    if (r === 0n || r >= SECP256K1_ORDER || s === 0n || s > SECP256K1_HALF_ORDER || (recovery !== "1b" && recovery !== "1c")) {
        throw protocol("PAYMENT-SIGNATURE EVM signature scalar or recovery byte is invalid.");
    }
}
function validatePaymentIdentifierSchema(value) {
    const schema = record(value, "payment-identifier schema");
    allowedKeys(schema, ["$schema", "type", "properties", "required"], []);
    if (schema.$schema !== "https://json-schema.org/draft/2020-12/schema" || schema.type !== "object") {
        throw protocol("payment-identifier schema identity is invalid.");
    }
    const properties = record(schema.properties, "payment-identifier schema properties");
    allowedKeys(properties, ["required", "id"], []);
    const requiredProperty = record(properties.required, "payment-identifier required property");
    allowedKeys(requiredProperty, ["type"], []);
    if (requiredProperty.type !== "boolean")
        throw protocol("payment-identifier required property schema is invalid.");
    const idProperty = record(properties.id, "payment-identifier id property");
    allowedKeys(idProperty, ["type", "minLength", "maxLength", "pattern"], []);
    if (idProperty.type !== "string" || idProperty.minLength !== 16 || idProperty.maxLength !== 128 ||
        idProperty.pattern !== "^[a-zA-Z0-9_-]+$")
        throw protocol("payment-identifier id property schema is invalid.");
    if (!Array.isArray(schema.required) || schema.required.length !== 1 || schema.required[0] !== "required") {
        throw protocol("payment-identifier required-member schema is invalid.");
    }
}
function decodeCanonicalBase64(value) {
    if (value.length === 0 || value.length % 4 !== 0 || !BASE64.test(value) || Buffer.byteLength(value, "ascii") > 64 * 1024) {
        throw protocol("x402 header is not canonical base64.");
    }
    const bytes = Buffer.from(value, "base64");
    if (bytes.length > MAX_DECODED_X402_BYTES || bytes.toString("base64") !== value) {
        throw protocol("x402 header is oversized or has non-canonical pad bits.");
    }
    return bytes;
}
function parseJsonWithDuplicateRejection(text) {
    let offset = 0;
    const skipWhitespace = () => { while (/\s/u.test(text[offset] ?? ""))
        offset += 1; };
    const parseValue = () => {
        skipWhitespace();
        const token = text[offset];
        if (token === "{")
            return parseObject();
        if (token === "[")
            return parseArray();
        if (token === '"')
            return parseString();
        if (text.startsWith("true", offset)) {
            offset += 4;
            return true;
        }
        if (text.startsWith("false", offset)) {
            offset += 5;
            return false;
        }
        if (text.startsWith("null", offset)) {
            offset += 4;
            return null;
        }
        const match = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/u.exec(text.slice(offset));
        if (match === null)
            throw protocol("x402 JSON syntax is invalid.");
        offset += match[0].length;
        const number = Number(match[0]);
        if (!Number.isSafeInteger(number))
            throw protocol("x402 JSON contains an unsafe or non-integral number.");
        return number;
    };
    const parseObject = () => {
        offset += 1;
        skipWhitespace();
        const object = {};
        const keys = new Set();
        if (text[offset] === "}") {
            offset += 1;
            return object;
        }
        while (true) {
            skipWhitespace();
            if (text[offset] !== '"')
                throw protocol("x402 JSON object key is invalid.");
            const key = parseString();
            if (keys.has(key))
                throw protocol("x402 JSON contains a duplicate member name.");
            keys.add(key);
            skipWhitespace();
            if (text[offset] !== ":")
                throw protocol("x402 JSON object separator is invalid.");
            offset += 1;
            object[key] = parseValue();
            skipWhitespace();
            if (text[offset] === "}") {
                offset += 1;
                return object;
            }
            if (text[offset] !== ",")
                throw protocol("x402 JSON object delimiter is invalid.");
            offset += 1;
        }
    };
    const parseArray = () => {
        offset += 1;
        skipWhitespace();
        const array = [];
        if (text[offset] === "]") {
            offset += 1;
            return array;
        }
        while (true) {
            array.push(parseValue());
            skipWhitespace();
            if (text[offset] === "]") {
                offset += 1;
                return array;
            }
            if (text[offset] !== ",")
                throw protocol("x402 JSON array delimiter is invalid.");
            offset += 1;
        }
    };
    const parseString = () => {
        const start = offset;
        offset += 1;
        let escaped = false;
        while (offset < text.length) {
            const character = text[offset];
            if (!escaped && character === '"') {
                offset += 1;
                try {
                    return JSON.parse(text.slice(start, offset));
                }
                catch {
                    throw protocol("x402 JSON string is invalid.");
                }
            }
            if (!escaped && character === "\\")
                escaped = true;
            else
                escaped = false;
            offset += 1;
        }
        throw protocol("x402 JSON string is unterminated.");
    };
    const value = parseValue();
    skipWhitespace();
    if (offset !== text.length)
        throw protocol("x402 JSON has trailing data.");
    return value;
}
function resourceMatches(value, requested) {
    try {
        const resource = new URL(value);
        return resource.protocol === "https:" && resource.username === "" && resource.password === "" && resource.hash === "" && resource.toString() === requested;
    }
    catch {
        return false;
    }
}
function allowedKeys(value, required, optional) {
    const allowed = new Set([...required, ...optional]);
    if (!required.every((key) => key in value) || Object.keys(value).some((key) => !allowed.has(key))) {
        throw protocol("x402 object contains missing or unknown fields.");
    }
}
function record(value, label) {
    if (!isPlainRecord(value))
        throw protocol(`${label} must be a plain object.`);
    return value;
}
function boundedString(value, maxBytes, label) {
    if (typeof value !== "string" || value.length === 0 || Buffer.byteLength(value, "utf8") > maxBytes)
        throw protocol(`${label} is invalid.`);
}
function asciiString(value, maxBytes, label) {
    boundedString(value, maxBytes, label);
    if (!/^[\x20-\x7e]+$/u.test(value))
        throw protocol(`${label} must be ASCII.`);
}
function printableAscii(value, maxBytes, label) {
    asciiString(value, maxBytes, label);
}
function protocol(message) {
    return new ApnError("APN_HTTP_PROTOCOL", message);
}
function settlement(message) {
    return new ApnError("APN_X402_SETTLEMENT_INVALID", message);
}
//# sourceMappingURL=x402-codec.js.map