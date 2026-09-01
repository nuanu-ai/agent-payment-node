import { appendProviderX402Transition, providerX402BindingHash, sealProviderX402Operation, sealProviderX402Receipt, } from "./provider-x402-model.js";
export function transitionProviderX402Operation(operation, state, reason, proofClass, extra, at) {
    const transitions = appendProviderX402Transition(operation.transitions, { at, state, reason, proofClass });
    const { integrityHash: _integrity, ...base } = operation;
    const terminal = ["completed", "failed_before_effect", "failed_settled_without_result"].includes(state);
    return sealProviderX402Operation({
        ...base,
        ...extra,
        state,
        finalityClass: terminal ? "terminal" : ["preparing", "awaiting_approval"].includes(state) ? "pre_effect" : "unknown_finality",
        terminal,
        reason,
        proofClass,
        nextActions: state === "awaiting_approval" ? ["x402.fetch.approve", "operation.status"]
            : terminal ? ["receipt.get"] : ["operation.status", "operation.resume"],
        updatedAt: at,
        transitions,
    });
}
export function providerX402TerminalReceipt(operation, terminalState, reason, proofClass, createdAt) {
    return sealProviderX402Receipt({
        schemaVersion: "apn.provider-x402.receipt.v1",
        kind: "x402_fetch",
        operationId: operation.operationId,
        terminalState,
        reason,
        proofClass,
        fingerprint: operation.fingerprint,
        requestDigest: operation.request.requestDigest,
        requirementDigest: operation.requirement.digest,
        payer: operation.provider.payer,
        payee: operation.requirement.payee,
        amountAtomic: operation.requirement.amountAtomic,
        network: operation.requirement.network,
        token: operation.requirement.token,
        ...(operation.sellerResult === undefined ? {} : { result: {
                classification: operation.sellerResult.classification,
                sha256: operation.sellerResult.sha256,
                byteLength: operation.sellerResult.byte_length,
            } }),
        ...(operation.settlementEvidence === undefined ? {} : { settlement: operation.settlementEvidence }),
        operationBindingHash: providerX402BindingHash(operation),
        createdAt,
    });
}
//# sourceMappingURL=provider-x402-state.js.map