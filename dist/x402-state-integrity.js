import { canonicalJson, domainHash } from "./canonical.js";
import { ApnError } from "./errors.js";
import { validateX402ResultUnsafe, validateX402ReceiptUnsafe } from "./x402-artifact-validation.js";
import { validateX402OperationUnsafe } from "./x402-operation-validation.js";
import { stateCorrupt } from "./x402-state-validation-primitives.js";
export * from "./x402-state-model.js";
export function validateX402Operation(value) {
    try {
        return validateX402OperationUnsafe(value);
    }
    catch (error) {
        if (error instanceof ApnError && error.code === "APN_STATE_CORRUPT")
            throw error;
        stateCorrupt("x402 operation protected state validation failed.");
    }
}
export function x402WaitProjectedStatus(status, settlementWait) {
    return settlementWait?.outcome === "timeout" && !status.terminal
        ? { reason: "x402_settlement_wait_timeout", proofClass: "x402_unknown_finality" }
        : { reason: status.reason, proofClass: status.proofClass };
}
export function publicX402Operation(operation, result, settlementWait) {
    const waitStatus = x402WaitProjectedStatus(operation, settlementWait);
    const value = {
        schemaVersion: "apn.x402.public-operation.v1",
        kind: operation.kind,
        operationId: operation.operationId,
        state: operation.state,
        finalityClass: operation.finalityClass,
        terminal: operation.terminal,
        reason: waitStatus.reason,
        proofClass: waitStatus.proofClass,
        nextActions: operation.nextActions,
        createdAt: operation.createdAt,
        updatedAt: operation.updatedAt,
        resource: {
            origin: operation.resource.origin,
            path: operation.resource.path,
            urlHash: operation.resource.urlHash,
        },
        payer: operation.wallet,
        ...(operation.providerSigner === undefined ? {} : {
            signer: {
                provider: operation.providerSigner.providerId,
                mode: operation.providerSigner.executionMode,
            },
        }),
        payee: operation.payee,
        amountAtomic: operation.amountAtomic,
        network: operation.network,
        token: operation.token,
        ...(operation.paymentIdentifier === undefined ? {} : { paymentIdentifier: operation.paymentIdentifier.value }),
        ...(operation.transactionHint === undefined ? {} : { transactionHash: operation.transactionHint.transactionHash }),
        ...(operation.settlementEvidence === undefined ? {} : {
            blockNumber: operation.settlementEvidence.transactionBlock.number,
            blockHash: operation.settlementEvidence.transactionBlock.hash,
            authorizationState: {
                value: true,
                blockNumber: operation.settlementEvidence.authorizationState.blockNumber,
                blockHash: operation.settlementEvidence.authorizationState.blockHash,
            },
        }),
        ...(result === undefined ? {} : {
            result: { resultHash: result.resultHash, mediaType: result.mediaType, byteLength: result.byteLength },
        }),
        ...(settlementWait === undefined ? {} : { settlementWait }),
    };
    return { ...value, integrityHash: domainHash("apn.x402.public-operation.v1", canonicalJson(value)) };
}
export function publicX402ResultData(result) {
    return {
        kind: "x402_result",
        media_type: result.mediaType,
        body: result.mediaType === "application/json"
            ? JSON.parse(result.bodyText)
            : result.bodyText,
        sha256: result.resultHash,
        byte_length: result.byteLength,
    };
}
export function sealX402Result(value) {
    return { ...value, integrityHash: domainHash("apn.x402.result.v1", canonicalJson(value)) };
}
export function sealX402Receipt(value) {
    return { ...value, integrityHash: domainHash("apn.x402.receipt.v1", canonicalJson(value)) };
}
export function validateX402Result(value) {
    try {
        return validateX402ResultUnsafe(value);
    }
    catch (error) {
        if (error instanceof ApnError && error.code === "APN_STATE_CORRUPT")
            throw error;
        stateCorrupt("x402 result protected state validation failed.");
    }
}
export function validateX402Receipt(value) {
    try {
        return validateX402ReceiptUnsafe(value);
    }
    catch (error) {
        if (error instanceof ApnError && error.code === "APN_STATE_CORRUPT")
            throw error;
        stateCorrupt("x402 receipt protected state validation failed.");
    }
}
//# sourceMappingURL=x402-state-integrity.js.map