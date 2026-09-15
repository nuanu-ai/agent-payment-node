import { canonicalJson } from "./canonical.js";
import { ApnError } from "./errors.js";
import { validateOperation } from "./state-integrity.js";
export function validateEvmOperationWrite(next, previousValue) {
    if (next.providerDirect !== undefined || (previousValue !== null && typeof previousValue === "object" && "providerDirect" in previousValue)) {
        validateProviderOperationWrite(next, previousValue);
        return;
    }
    if (next.evm === undefined && (previousValue === null || typeof previousValue !== "object" || !("evm" in previousValue)))
        return;
    validateOperation(next);
    if (previousValue === null) {
        if (next.state !== "awaiting_approval" || next.transitions.length !== 1)
            corrupt();
        return;
    }
    const previous = validateOperation(previousValue);
    if (previous.evm === undefined || next.evm === undefined || previous.fingerprint !== next.fingerprint ||
        previous.requestHash !== next.requestHash || previous.operationId !== next.operationId || previous.profileHash !== next.profileHash ||
        previous.idempotencyHash !== next.idempotencyHash || previous.preparedBlockNumberAtomic !== next.preparedBlockNumberAtomic ||
        (previous.transactionHash !== undefined && (previous.transactionHash !== next.transactionHash || previous.rawTransactionHash !== next.rawTransactionHash)) ||
        next.transitions.length < previous.transitions.length ||
        canonicalJson(next.transitions.slice(0, previous.transitions.length)) !== canonicalJson(previous.transitions) ||
        (next.transitions.length === previous.transitions.length && previous.integrityHash !== next.integrityHash) ||
        (previous.terminal && previous.integrityHash !== next.integrityHash))
        corrupt();
}
function validateProviderOperationWrite(next, previousValue) {
    validateOperation(next);
    if (next.providerDirect === undefined)
        corrupt();
    if (previousValue === null) {
        if (next.state !== "awaiting_approval" || next.transitions.length !== 1)
            corrupt();
        return;
    }
    const previous = validateOperation(previousValue);
    if (previous.providerDirect === undefined ||
        canonicalJson(providerFrozen(previous)) !== canonicalJson(providerFrozen(next)) ||
        (previous.providerEffect !== undefined && canonicalJson(previous.providerEffect) !== canonicalJson(next.providerEffect)) ||
        (previous.coinbaseGaslessLocator !== undefined && canonicalJson(previous.coinbaseGaslessLocator) !== canonicalJson(next.coinbaseGaslessLocator)) ||
        (previous.coinbaseGaslessCursor !== undefined && next.coinbaseGaslessCursor !== undefined &&
            (BigInt(next.coinbaseGaslessCursor.nextBlockAtomic) < BigInt(previous.coinbaseGaslessCursor.nextBlockAtomic) ||
                (next.coinbaseGaslessCursor.nextBlockAtomic === previous.coinbaseGaslessCursor.nextBlockAtomic &&
                    canonicalJson(next.coinbaseGaslessCursor) !== canonicalJson(previous.coinbaseGaslessCursor)))) ||
        (previous.coinbaseGaslessSettlement !== undefined && canonicalJson(previous.coinbaseGaslessSettlement) !== canonicalJson(next.coinbaseGaslessSettlement)) ||
        (previous.transactionHash !== undefined && previous.transactionHash !== next.transactionHash) ||
        next.transitions.length < previous.transitions.length ||
        canonicalJson(next.transitions.slice(0, previous.transitions.length)) !== canonicalJson(previous.transitions) ||
        (next.transitions.length === previous.transitions.length && previous.integrityHash !== next.integrityHash) ||
        (previous.terminal && previous.integrityHash !== next.integrityHash))
        corrupt();
}
function providerFrozen(value) {
    const { state: _state, terminal: _terminal, reason: _reason, proofClass: _proofClass, transitions: _transitions, integrityHash: _integrityHash, providerEffect: _providerEffect, transactionHash: _transactionHash, coinbaseGaslessLocator: _coinbaseGaslessLocator, coinbaseGaslessCursor: _coinbaseGaslessCursor, coinbaseGaslessSettlement: _coinbaseGaslessSettlement, ...frozen } = value;
    return frozen;
}
function corrupt() { throw new ApnError("APN_STATE_CORRUPT", "Generic direct operation cannot replace or rewind its frozen durable authority."); }
//# sourceMappingURL=evm-operation-write.js.map