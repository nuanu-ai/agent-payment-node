import { canonicalJson } from "./canonical.js";
import { stateCorrupt } from "./secure-state-store.js";
import { x402TransactionHintSourceBindingHash, } from "./x402-state-integrity.js";
export function validateX402AppendOnly(previous, next) {
    const immutableKeys = [
        "schemaVersion", "kind", "operationId", "idempotencyHash", "profile", "profileHash", "requestHash", "fingerprint",
        "resource", "sellerWire", "chainId", "network", "token", "wallet", "payee", "amountAtomic", "capAtomic",
        "selectedOffer", "preparedBlock", "paymentIdentifier", "authorization", "createdAt",
    ];
    for (const key of immutableKeys) {
        if (!sameOptionalCanonical(previous[key], next[key]))
            stateCorrupt(`x402 overwrite changed frozen member ${key}.`);
    }
    const freezeOnceKeys = [
        "signatureHash", "paymentPayloadHash", "paymentHeaderHash", "settlementResponseObservation", "transactionHint",
        "settlementEvidence", "unusedExpiryEvidence", "resultLink", "receiptLink",
    ];
    const recoveryObservationAdvance = isExactX402RecoveryObservationAdvance(previous, next);
    const scanReorgReset = isExactX402ScanReorgReset(previous, next);
    for (const key of freezeOnceKeys) {
        if (previous[key] !== undefined && !sameOptionalCanonical(previous[key], next[key])) {
            if (recoveryObservationAdvance && (key === "settlementResponseObservation" || key === "transactionHint"))
                continue;
            if (scanReorgReset && (key === "transactionHint" || key === "settlementEvidence"))
                continue;
            stateCorrupt(`x402 overwrite removed or replaced durable member ${key}.`);
        }
    }
    if (next.attempts.length < previous.attempts.length)
        stateCorrupt("x402 attempt history is not append-only.");
    for (let index = 0; index < previous.attempts.length; index += 1) {
        const prior = previous.attempts[index];
        const current = next.attempts[index];
        if (prior === undefined || current === undefined)
            stateCorrupt("x402 attempt history is not append-only.");
        if (canonicalJson(prior) === canonicalJson(current))
            continue;
        const pendingBody = {
            attemptNumber: prior.attemptNumber,
            purpose: prior.purpose,
            requestHeaderHash: prior.requestHeaderHash,
            persistedAt: prior.persistedAt,
        };
        const currentBody = {
            attemptNumber: current.attemptNumber,
            purpose: current.purpose,
            requestHeaderHash: current.requestHeaderHash,
            persistedAt: current.persistedAt,
        };
        if (prior.phase !== "pending" || (current.phase !== "observed" && current.phase !== "ambiguous") ||
            canonicalJson(pendingBody) !== canonicalJson(currentBody))
            stateCorrupt("x402 attempt history replaced a durable attempt.");
    }
    for (let index = previous.attempts.length; index < next.attempts.length; index += 1) {
        if (next.attempts[index]?.phase !== "pending") {
            stateCorrupt("A newly persisted x402 attempt must begin with an exact pending marker.");
        }
    }
    if (next.transitions.length < previous.transitions.length ||
        previous.transitions.some((item, index) => canonicalJson(item) !== canonicalJson(next.transitions[index])))
        stateCorrupt("x402 transition history is not append-only.");
    if (next.transitions.length > previous.transitions.length + 1) {
        stateCorrupt("x402 overwrite appended more than one durable transition.");
    }
}
function isExactX402RecoveryObservationAdvance(previous, next) {
    if (previous.state !== "seller_result_recovery_pending" || next.state !== "seller_result_recovery_pending" ||
        previous.resultLink !== undefined || next.resultLink !== undefined ||
        previous.receiptLink !== undefined || next.receiptLink !== undefined ||
        previous.paymentIdentifier === undefined || next.paymentIdentifier === undefined ||
        next.attempts.length !== previous.attempts.length ||
        next.transitions.length !== previous.transitions.length + 1 ||
        next.transitions.at(-1)?.state !== "seller_result_recovery_pending")
        return false;
    const response = next.settlementResponseObservation;
    const hint = next.transactionHint;
    if (response === undefined || hint?.source !== "payment_response")
        return false;
    if (hint.sourceBindingHash !== x402TransactionHintSourceBindingHash("payment_response", response.settlementResponseHash) ||
        hint.transactionHash !== next.settlementEvidence?.transactionHash)
        return false;
    const attemptIndex = Number(response.httpAttemptNumber) - 1;
    if (!Number.isSafeInteger(attemptIndex) || attemptIndex < 0 || attemptIndex !== previous.attempts.length - 1)
        return false;
    const priorAttempt = previous.attempts[attemptIndex];
    const currentAttempt = next.attempts[attemptIndex];
    if (priorAttempt?.purpose !== "result_recovery" || priorAttempt.phase !== "pending" ||
        currentAttempt?.purpose !== "result_recovery" || currentAttempt.phase !== "observed" ||
        currentAttempt.observation === undefined ||
        currentAttempt.observation.paymentResponseHeaderHash !== response.paymentResponseHeaderHash)
        return false;
    const pendingBody = {
        attemptNumber: priorAttempt.attemptNumber,
        purpose: priorAttempt.purpose,
        requestHeaderHash: priorAttempt.requestHeaderHash,
        persistedAt: priorAttempt.persistedAt,
    };
    const observedBody = {
        attemptNumber: currentAttempt.attemptNumber,
        purpose: currentAttempt.purpose,
        requestHeaderHash: currentAttempt.requestHeaderHash,
        persistedAt: currentAttempt.persistedAt,
    };
    if (canonicalJson(pendingBody) !== canonicalJson(observedBody))
        return false;
    const priorHint = previous.transactionHint;
    if (priorHint?.transactionHash !== hint.transactionHash)
        return false;
    if (priorHint.source === "authorization_used_log") {
        return previous.settlementResponseObservation === undefined;
    }
    const priorResponse = previous.settlementResponseObservation;
    return priorHint.source === "payment_response" && priorResponse !== undefined &&
        priorHint.sourceBindingHash === x402TransactionHintSourceBindingHash("payment_response", priorResponse.settlementResponseHash) &&
        Number(priorResponse.httpAttemptNumber) < Number(response.httpAttemptNumber);
}
function isExactX402ScanReorgReset(previous, next) {
    const priorScan = previous.authorizationUsedScan;
    const nextScan = next.authorizationUsedScan;
    if (priorScan === undefined || nextScan === undefined ||
        previous.transactionHint?.source !== "authorization_used_log" || next.transactionHint !== undefined ||
        next.settlementEvidence !== undefined ||
        !sameOptionalCanonical(previous.settlementResponseObservation, next.settlementResponseObservation) ||
        previous.unusedExpiryEvidence !== undefined || next.unusedExpiryEvidence !== undefined ||
        previous.resultLink !== undefined || next.resultLink !== undefined ||
        previous.receiptLink !== undefined || next.receiptLink !== undefined ||
        next.state !== "effect_unknown" || next.terminal ||
        next.attempts.length !== previous.attempts.length ||
        next.transitions.length !== previous.transitions.length + 1 ||
        next.transitions.at(-1)?.state !== "effect_unknown")
        return false;
    return nextScan.searchStartBlock === priorScan.searchStartBlock &&
        nextScan.nextFromBlock === nextScan.searchStartBlock &&
        nextScan.lastCompletedChunk === undefined && nextScan.candidates.length === 0 &&
        nextScan.status === "active";
}
function isExactX402ScanOnlyTransition(previous, next) {
    const { integrityHash: _previousIntegrityHash, authorizationUsedScan: _previousScan, updatedAt: _previousUpdatedAt, transitions: _previousTransitions, nextActions: _previousNextActions, ...previousBody } = previous;
    const { integrityHash: _nextIntegrityHash, authorizationUsedScan: _nextScan, updatedAt: _nextUpdatedAt, transitions: _nextTransitions, nextActions: _nextNextActions, ...nextBody } = next;
    const appendedSelfTransition = next.transitions.length === previous.transitions.length + 1 &&
        next.transitions.at(-1)?.state === previous.state &&
        next.transitions.at(-1)?.at === next.updatedAt;
    return canonicalJson(previousBody) === canonicalJson(nextBody) && appendedSelfTransition;
}
function isExactX402CompletedZeroScanExtension(previous, next) {
    const priorScan = previous.authorizationUsedScan;
    const nextScan = next.authorizationUsedScan;
    if (priorScan === undefined || nextScan === undefined ||
        priorScan.status !== "complete" || priorScan.candidates.length !== 0 || nextScan.status !== "active" ||
        previous.transactionHint !== undefined || previous.settlementEvidence !== undefined || previous.resultLink !== undefined ||
        !((previous.state === "effect_unknown" && (previous.attempts.some((attempt) => attempt.purpose === "payment") ||
            isZeroAttemptPreSendReorgLineage(previous))) ||
            (previous.state === "authorized_not_sent" && !previous.attempts.some((attempt) => attempt.purpose === "payment"))) ||
        !isExactX402ScanOnlyTransition(previous, next))
        return false;
    return nextScan.searchStartBlock === priorScan.searchStartBlock &&
        nextScan.nextFromBlock === priorScan.nextFromBlock &&
        sameOptionalCanonical(nextScan.lastCompletedChunk, priorScan.lastCompletedChunk) &&
        canonicalJson(nextScan.candidates) === canonicalJson(priorScan.candidates) &&
        BigInt(nextScan.targetSafeHead.number) > BigInt(priorScan.targetSafeHead.number);
}
function isZeroAttemptPreSendReorgLineage(operation) {
    return operation.state === "effect_unknown" && operation.attempts.length === 0 &&
        operation.transitions.at(-2)?.state === "effect_unknown" &&
        operation.transitions.at(-1)?.state === "effect_unknown";
}
function isExactX402UnavailableScanResume(previous, next) {
    const priorScan = previous.authorizationUsedScan;
    const nextScan = next.authorizationUsedScan;
    if (priorScan === undefined || nextScan === undefined || priorScan.status !== "unavailable" || nextScan.status !== "active" ||
        !isExactX402ScanOnlyTransition(previous, next))
        return false;
    return nextScan.searchStartBlock === priorScan.searchStartBlock &&
        nextScan.nextFromBlock === priorScan.nextFromBlock &&
        sameOptionalCanonical(nextScan.lastCompletedChunk, priorScan.lastCompletedChunk) &&
        canonicalJson(nextScan.candidates) === canonicalJson(priorScan.candidates) &&
        canonicalJson(nextScan.targetSafeHead) === canonicalJson(priorScan.targetSafeHead);
}
export function validateX402ScanContinuity(previous, next) {
    const priorScan = previous.authorizationUsedScan;
    const nextScan = next.authorizationUsedScan;
    if (priorScan === undefined) {
        if (nextScan?.lastCompletedChunk !== undefined &&
            nextScan.lastCompletedChunk.fromBlock !== nextScan.searchStartBlock)
            stateCorrupt("The first x402 authorization-used chunk does not begin at the frozen search start.");
        return;
    }
    if (nextScan === undefined)
        stateCorrupt("x402 authorization-used scan cannot be silently discarded.");
    if (canonicalJson(nextScan) === canonicalJson(priorScan))
        return;
    const unavailableWithoutAdvance = nextScan.status === "unavailable" &&
        nextScan.nextFromBlock === priorScan.nextFromBlock &&
        sameOptionalCanonical(nextScan.lastCompletedChunk, priorScan.lastCompletedChunk) &&
        canonicalJson(nextScan.candidates) === canonicalJson(priorScan.candidates) &&
        canonicalJson(nextScan.targetSafeHead) === canonicalJson(priorScan.targetSafeHead) &&
        (priorScan.status !== "unavailable" || nextScan.unavailableReason === priorScan.unavailableReason) &&
        isExactX402ScanOnlyTransition(previous, next);
    if (unavailableWithoutAdvance)
        return;
    if (isExactX402UnavailableScanResume(previous, next) || isExactX402CompletedZeroScanExtension(previous, next))
        return;
    const reset = nextScan.nextFromBlock === nextScan.searchStartBlock &&
        nextScan.lastCompletedChunk === undefined && nextScan.candidates.length === 0 && nextScan.status === "active";
    if (nextScan.searchStartBlock !== priorScan.searchStartBlock ||
        (!reset && canonicalJson(nextScan.targetSafeHead) !== canonicalJson(priorScan.targetSafeHead)))
        stateCorrupt("x402 authorization-used scan provenance changed during continuation.");
    if (reset) {
        if (next.transitions.length !== previous.transitions.length + 1) {
            stateCorrupt("x402 authorization-used scan reset lacks its durable state transition.");
        }
        return;
    }
    if (nextScan.lastCompletedChunk !== undefined && nextScan.lastCompletedChunk.fromBlock !== priorScan.nextFromBlock) {
        stateCorrupt("x402 authorization-used scan skipped or repeated a cursor range.");
    }
    if (BigInt(nextScan.nextFromBlock) < BigInt(priorScan.nextFromBlock))
        stateCorrupt("x402 authorization-used scan cursor moved backward.");
    const nextCandidates = new Map(nextScan.candidates.map((candidate) => [
        `${candidate.blockHash}\0${candidate.transactionHash}\0${candidate.logIndex}`,
        canonicalJson(candidate),
    ]));
    for (const candidate of priorScan.candidates) {
        const key = `${candidate.blockHash}\0${candidate.transactionHash}\0${candidate.logIndex}`;
        if (nextCandidates.get(key) !== canonicalJson(candidate))
            stateCorrupt("x402 authorization-used scan discarded or changed a prior candidate.");
    }
    const priorCandidates = canonicalJson(priorScan.candidates);
    if (nextScan.status === "unavailable" && (nextScan.nextFromBlock !== priorScan.nextFromBlock || canonicalJson(nextScan.candidates) !== priorCandidates))
        stateCorrupt("Unavailable x402 authorization-used scan advanced or accepted new candidates.");
}
export function sameOptionalCanonical(left, right) {
    if (left === undefined || right === undefined)
        return left === right;
    return canonicalJson(left) === canonicalJson(right);
}
//# sourceMappingURL=x402-state-continuity.js.map