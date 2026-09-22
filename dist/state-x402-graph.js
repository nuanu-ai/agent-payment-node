import { join } from "node:path";
import { stateCorrupt } from "./secure-state-store.js";
import { sameOptionalCanonical } from "./x402-state-continuity.js";
import { x402OperationBindingHash, validateX402Receipt, validateX402Result, } from "./x402-state-integrity.js";
export async function validateX402TerminalGraph(readJson, operation) {
    let linkedResult;
    if (operation.resultLink !== undefined) {
        const resultValue = await readJson(join("x402-results", operation.profileHash, `${operation.operationId}.json`));
        if (resultValue === null)
            stateCorrupt("x402 operation has a dangling result link.");
        const result = validateX402Result(resultValue);
        linkedResult = result;
        const response = operation.settlementResponseObservation;
        const attemptIndex = Number(response?.httpAttemptNumber ?? "0") - 1;
        const attempt = Number.isSafeInteger(attemptIndex) && attemptIndex >= 0
            ? operation.attempts[attemptIndex]
            : undefined;
        if (linkedResult.operationId !== operation.operationId || linkedResult.integrityHash !== operation.resultLink.resultIntegrityHash ||
            linkedResult.resultHash !== operation.resultLink.resultHash || response?.classification !== "success" ||
            attempt?.phase !== "observed" || attempt.observation?.status !== result.responseStatus ||
            attempt.observation.bodyHash !== result.resultHash || attempt.observation.bodyByteLength !== result.byteLength ||
            attempt.observation.mediaType !== result.mediaType)
            stateCorrupt("x402 linked result graph is inconsistent.");
    }
    if (!operation.terminal)
        return;
    const receiptValue = await readJson(join("x402-receipts", operation.profileHash, `${operation.operationId}.json`));
    if (receiptValue === null)
        stateCorrupt("Terminal x402 operation has no durable receipt.");
    const receipt = validateX402Receipt(receiptValue);
    if (receipt.operationId !== operation.operationId || receipt.integrityHash !== operation.receiptLink?.receiptIntegrityHash ||
        receipt.terminalState !== operation.state || receipt.reason !== operation.reason || receipt.proofClass !== operation.proofClass ||
        receipt.resource.origin !== operation.resource.origin || receipt.resource.path !== operation.resource.path ||
        receipt.resource.urlHash !== operation.resource.urlHash || receipt.fingerprint !== operation.fingerprint ||
        receipt.offerHash !== operation.selectedOffer.offerHash || receipt.payer !== operation.wallet || receipt.payee !== operation.payee ||
        receipt.amountAtomic !== operation.amountAtomic || receipt.network !== operation.network || receipt.token !== operation.token ||
        receipt.paymentIdentifier !== operation.paymentIdentifier?.value ||
        receipt.operationBindingHash !== x402OperationBindingHash(operation) || receipt.createdAt !== operation.updatedAt ||
        receipt.previousLinkHash !== operation.transitions.at(-1)?.previousHash ||
        receipt.settlementResponseHash !== operation.settlementResponseObservation?.settlementResponseHash ||
        !sameOptionalCanonical(receipt.settlementEvidence, operation.settlementEvidence) ||
        !sameOptionalCanonical(receipt.unusedExpiryEvidence, operation.unusedExpiryEvidence))
        stateCorrupt("Terminal x402 receipt does not bind the protected operation.");
    if (operation.resultLink === undefined) {
        if (receipt.result !== undefined)
            stateCorrupt("Terminal x402 receipt has an unexpected result link.");
        return;
    }
    const result = linkedResult;
    if (result === undefined)
        stateCorrupt("Terminal x402 operation has a dangling result link.");
    const responseAttemptNumber = Number(operation.settlementResponseObservation?.httpAttemptNumber ?? "0");
    const responseObservation = operation.attempts[responseAttemptNumber - 1]?.observation;
    if (result.operationId !== operation.operationId || result.integrityHash !== operation.resultLink.resultIntegrityHash ||
        result.resultHash !== operation.resultLink.resultHash || receipt.result === undefined ||
        receipt.result.resultHash !== result.resultHash || receipt.result.resultIntegrityHash !== result.integrityHash ||
        receipt.result.mediaType !== result.mediaType || receipt.result.byteLength !== result.byteLength ||
        responseObservation?.bodyHash !== result.resultHash || responseObservation.bodyByteLength !== result.byteLength ||
        responseObservation.mediaType !== result.mediaType)
        stateCorrupt("Terminal x402 result graph is inconsistent.");
}
export function validateX402RecoveryReceiptAuthority(operation, receipt) {
    if (receipt.operationId !== operation.operationId ||
        receipt.resource.origin !== operation.resource.origin || receipt.resource.path !== operation.resource.path ||
        receipt.resource.urlHash !== operation.resource.urlHash || receipt.fingerprint !== operation.fingerprint ||
        receipt.offerHash !== operation.selectedOffer.offerHash || receipt.payer !== operation.wallet || receipt.payee !== operation.payee ||
        receipt.amountAtomic !== operation.amountAtomic || receipt.network !== operation.network || receipt.token !== operation.token ||
        receipt.paymentIdentifier !== operation.paymentIdentifier?.value ||
        receipt.operationBindingHash !== x402OperationBindingHash(operation) ||
        receipt.previousLinkHash !== operation.transitions.at(-1)?.hash ||
        receipt.settlementResponseHash !== operation.settlementResponseObservation?.settlementResponseHash ||
        !sameOptionalCanonical(receipt.settlementEvidence, operation.settlementEvidence) ||
        !sameOptionalCanonical(receipt.unusedExpiryEvidence, operation.unusedExpiryEvidence))
        stateCorrupt("x402 recovery receipt does not bind its authoritative operation.");
}
//# sourceMappingURL=state-x402-graph.js.map