import { isBaseUsdc } from "./x402-network.js";
import { canonicalJson, domainHash } from "./canonical.js";
import { x402HttpRequestBinding } from "./x402-http-request.js";
export { x402Fingerprint, x402RequestHash } from "./x402-request-identity.js";
export const ZERO_HASH = "0".repeat(64);
export const X402_STATE_VERSION = "apn.x402.state.v1";
export const TRANSITION_VERSION = "apn.x402.transition.v1";
/** A seller body that arrives with a success or a pending settlement answer is the purchased result. */
export function deliversX402Result(classification) {
    return classification === "success" || classification === "settlement_pending";
}
/**
 * The paid attempt whose body is the operation's result: the attempt the seller's settlement answer came with (only a
 * success or pending answer delivers), or, when the seller gave no usable answer, the last attempt. The caller still
 * checks that attempt was observed with a result status and this exact body.
 */
export function x402ResultAttempt(operation) {
    const response = operation.settlementResponseObservation;
    if (response === undefined)
        return operation.attempts.at(-1);
    if (!deliversX402Result(response.classification))
        return undefined;
    const index = Number(response.httpAttemptNumber) - 1;
    return Number.isSafeInteger(index) && index >= 0 ? operation.attempts[index] : undefined;
}
export function x402AuthorizationIntentHash(value) {
    return domainHash("apn.x402.authorization-intent.v1", canonicalJson(value));
}
export function x402OperationBindingHash(operation) {
    return domainHash("apn.x402.binding.v1", canonicalJson({
        version: 1,
        ...(isBaseUsdc({ chainId: Number(operation.chainId), token: operation.token }) ? {} : { network: operation.network, chainId: operation.chainId, token: operation.token }),
        x402Version: 2,
        method: operation.resource.httpRequest?.method ?? "GET",
        ...x402HttpRequestBinding(operation.resource.httpRequest),
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