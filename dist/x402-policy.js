import { encodeAbiParameters, keccak256, stringToHex } from "viem";
import { canonicalJson, domainHash, isPlainRecord } from "./canonical.js";
import { BASE_USDC, CHAIN_ID } from "./constants.js";
import { ApnError } from "./errors.js";
import { parseAtomic } from "./money.js";
import { parsePublicHttpsUrl } from "./network-policy.js";
import { decodePaymentRequiredHeader, inspectCandidates } from "./x402-codec.js";
import { inspectX402 } from "./x402-http.js";
const DOMAIN_TYPE_HASH = keccak256(stringToHex("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"));
const HASH = /^[a-f0-9]{64}$/u;
const BYTES32 = /^0x[0-9a-f]{64}$/u;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
export function canonicalPrepareUrl(value) {
    const endpoint = parsePublicHttpsUrl(value, "APN_HTTP_CONFIG", "Seller URL", 2048);
    if (endpoint.toString() !== value)
        throw new ApnError("APN_HTTP_CONFIG", "Seller URL must use its canonical WHATWG serialization.");
    return endpoint;
}
export function positiveCap(value) {
    return parseAtomic(value, { positive: true }).toString();
}
export async function freshChallenge(http, canonicalUrl) {
    let captured;
    const inspection = await inspectX402({
        async get(request) {
            captured = await http.get(request);
            return captured;
        },
    }, canonicalUrl);
    if (captured === undefined)
        throw new ApnError("APN_HTTP_PROTOCOL", "Seller challenge observation is missing.");
    const values = captured.rawHeaderPairs.filter(([name]) => name.toLowerCase() === "payment-required").map(([, value]) => value);
    if (values.length !== 1 || values[0] === undefined)
        throw new ApnError("APN_HTTP_PROTOCOL", "Seller challenge requires one PAYMENT-REQUIRED header.");
    return { paymentRequired: decodePaymentRequiredHeader(values[0]), staticCandidates: inspection.candidates };
}
export function candidatesWithinCap(challenge, capAtomic) {
    const cap = parseAtomic(capAtomic, { positive: true });
    const candidates = challenge.staticCandidates.filter((candidate) => parseAtomic(candidate.amountAtomic, { positive: true }) <= cap);
    if (candidates.length === 0)
        throw new ApnError("APN_X402_CAP_EXCEEDED", "Every supported seller offer exceeds the explicit payment cap.");
    return candidates;
}
export function selectPrepareOffer(challenge, underCap, evidence, wallet, context) {
    validatePrepareEvidence(evidence, wallet, context);
    const balance = parseAtomic(evidence.usdcAtomic);
    let hasSufficientBalance = false;
    for (const candidate of underCap) {
        const amount = parseAtomic(candidate.amountAtomic, { positive: true });
        if (amount > balance)
            continue;
        hasSufficientBalance = true;
        if (candidate.tokenName !== evidence.tokenName || candidate.tokenVersion !== evidence.tokenVersion)
            continue;
        if (tokenDomainSeparator(candidate.tokenName, candidate.tokenVersion) !== evidence.domainSeparator)
            continue;
        const index = Number(candidate.index);
        const requirements = challenge.paymentRequired.accepts[index];
        if (requirements === undefined)
            throw new ApnError("APN_HTTP_PROTOCOL", "Selected seller index is missing from the fresh challenge.");
        const declaredCanonicalJson = canonicalJson(requirements);
        return {
            requirements,
            selectedOffer: {
                index: candidate.index,
                declaredCanonicalJson,
                resolved: {
                    tokenName: candidate.tokenName,
                    tokenVersion: candidate.tokenVersion,
                    assetTransferMethod: "eip3009",
                    paymentFlow: "transferWithAuthorization",
                },
                offerHash: domainHash("apn.x402.offer.v1", declaredCanonicalJson),
            },
            amountAtomic: candidate.amountAtomic,
            payee: candidate.payTo,
            maxTimeoutSeconds: Number(candidate.maxTimeoutSeconds),
        };
    }
    if (!hasSufficientBalance)
        throw new ApnError("APN_INSUFFICIENT_USDC", "USDC balance is insufficient for every offer within the explicit cap.");
    throw new ApnError("APN_X402_UNSUPPORTED_OFFER", "No fresh seller offer matches the pinned token domain.");
}
export function tokenDomainSeparator(name, version) {
    return keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }, { type: "uint256" }, { type: "address" }], [DOMAIN_TYPE_HASH, keccak256(stringToHex(name)), keccak256(stringToHex(version)), BigInt(CHAIN_ID), BASE_USDC]));
}
export function paymentIdentifierState(paymentRequired, operationId) {
    const extensions = paymentRequired.extensions;
    if (extensions === undefined || Object.keys(extensions).length === 0)
        return undefined;
    const declaration = extensions["payment-identifier"];
    if (!isPlainRecord(declaration))
        throw new ApnError("APN_HTTP_PROTOCOL", "Supported payment-identifier declaration is missing.");
    const declarationCanonicalJson = canonicalJson(declaration);
    return {
        declarationCanonicalJson,
        declarationHash: domainHash("apn.x402.payment-identifier-declaration.v1", declarationCanonicalJson),
        value: `apn_${operationId}`,
    };
}
export function materializePaymentIdentifier(paymentIdentifier) {
    if (paymentIdentifier === undefined)
        return undefined;
    const declaration = JSON.parse(paymentIdentifier.declarationCanonicalJson);
    if (!isPlainRecord(declaration) || !isPlainRecord(declaration.info))
        throw new ApnError("APN_STATE_CORRUPT", "Protected payment-identifier declaration is invalid.");
    return { ...declaration, info: { ...declaration.info, id: paymentIdentifier.value } };
}
function validatePrepareEvidence(evidence, wallet, context) {
    const observedAtMs = Date.parse(evidence.observedAt);
    if (evidence.address.toLowerCase() !== wallet.toLowerCase() || evidence.queriedTag !== "safe" ||
        typeof evidence.tokenName !== "string" || evidence.tokenName.length === 0 || Buffer.byteLength(evidence.tokenName, "utf8") > 128 ||
        typeof evidence.tokenVersion !== "string" || evidence.tokenVersion.length === 0 || Buffer.byteLength(evidence.tokenVersion, "utf8") > 128 ||
        !BYTES32.test(evidence.domainSeparator) || !HASH.test(evidence.rpcOriginHash) || evidence.rpcOriginHash !== context.rpcOriginHash ||
        !UTC.test(evidence.observedAt) || !Number.isFinite(observedAtMs) ||
        observedAtMs < context.invocationStartedAtMs || observedAtMs > context.invocationCompletedAtMs ||
        !BYTES32.test(evidence.block.hash) || /^0x0{64}$/u.test(evidence.block.hash))
        throw new ApnError("APN_RPC_PROTOCOL", "x402 prepare RPC evidence is invalid or mismatched.");
    let blockNumber;
    let blockTimestamp;
    try {
        parseAtomic(evidence.usdcAtomic);
        blockNumber = parseAtomic(evidence.block.number, { positive: true });
        blockTimestamp = parseAtomic(evidence.block.timestamp);
    }
    catch {
        throw new ApnError("APN_RPC_PROTOCOL", "x402 prepare RPC quantities are invalid.");
    }
    if (blockNumber === 0n || blockTimestamp > BigInt(Math.floor(observedAtMs / 1000))) {
        throw new ApnError("APN_RPC_PROTOCOL", "x402 prepare RPC block identity is inconsistent with its observation.");
    }
}
//# sourceMappingURL=x402-policy.js.map