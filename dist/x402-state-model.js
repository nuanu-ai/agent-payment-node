import { canonicalJson, domainHash, hashObject, sha256 } from "./canonical.js";
const HASH = /^[a-f0-9]{64}$/u;
const ADDRESS = /^0x[0-9a-f]{40}$/u;
const BYTES32 = /^0x[0-9a-f]{64}$/u;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
export const ZERO_HASH = "0".repeat(64);
export const X402_STATE_VERSION = "apn.x402.state.v1";
export const TRANSITION_VERSION = "apn.x402.transition.v1";
export function x402RequestHash(input) {
    return hashObject({
        method: "x402.fetch.prepare",
        profile: input.profile,
        canonicalUrl: input.canonicalUrl,
        capAtomic: input.capAtomic,
    });
}
export function x402Fingerprint(input) {
    return domainHash("apn.x402.request.v1", canonicalJson({
        kind: input.kind,
        profile: input.profile,
        operationId: input.operationId,
        method: "GET",
        canonicalFullUrl: input.resource.canonicalUrl,
        chainId: input.chainId,
        network: input.network,
        token: input.token,
        capAtomic: input.capAtomic,
        selectedOfferHash: input.selectedOffer.offerHash,
        wallet: input.wallet,
        ...(input.providerSigner === undefined ? {} : { providerSigner: input.providerSigner }),
        ...(input.delegatedMaterial === undefined ? {} : { delegatedMaterial: input.delegatedMaterial }),
        acceptedResolvedDefaults: input.selectedOffer.resolved,
        paymentIdentifier: input.paymentIdentifier === undefined
            ? { advertised: false }
            : { advertised: true, declarationHash: input.paymentIdentifier.declarationHash, value: input.paymentIdentifier.value },
    }));
}
export function x402AuthorizationIntentHash(value) {
    return domainHash("apn.x402.authorization-intent.v1", canonicalJson(value));
}
export function x402OperationBindingHash(operation) {
    return domainHash("apn.x402.binding.v1", canonicalJson({
        version: 1,
        x402Version: 2,
        method: "GET",
        canonicalFullUrl: operation.resource.canonicalUrl,
        resource: JSON.parse(operation.sellerWire.resourceCanonicalJson),
        acceptedResolvedDefaults: operation.selectedOffer.resolved,
        payer: operation.wallet,
        operationId: operation.operationId,
        ...(operation.paymentIdentifier === undefined ? {} : { paymentIdentifier: operation.paymentIdentifier.value }),
        ...(operation.delegatedMaterial === undefined ? {} : { delegatedMaterial: operation.delegatedMaterial }),
    }));
}
export function x402TransactionHintSourceBindingHash(source, sourceHash) {
    return domainHash("apn.x402.transaction-hint.v1", canonicalJson(source === "payment_response"
        ? { source, settlementResponseHash: sourceHash }
        : { source, authorizationUsedScanEvidenceHash: sourceHash }));
}
export function appendX402Transition(previous, input) {
    const last = previous.at(-1);
    const body = {
        sequence: (BigInt(last?.sequence ?? "0") + 1n).toString(),
        ...input,
        previousHash: last?.hash ?? ZERO_HASH,
    };
    return [...previous, { ...body, hash: domainHash(TRANSITION_VERSION, canonicalJson(body)) }];
}
export function sealX402Operation(value) {
    return { ...value, integrityHash: domainHash(X402_STATE_VERSION, canonicalJson(value)) };
}
//# sourceMappingURL=x402-state-model.js.map