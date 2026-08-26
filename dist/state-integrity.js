import { exactKeys, hashObject, isPlainRecord } from "./canonical.js";
import { STATE_VERSION } from "./constants.js";
import { ApnError } from "./errors.js";
import { parseAtomic } from "./money.js";
const ZERO_HASH = "0".repeat(64);
export function appendTransition(previous, input) {
    const last = previous.at(-1);
    const body = {
        sequence: (BigInt(last?.sequence ?? "0") + 1n).toString(),
        at: input.at,
        state: input.state,
        terminal: input.terminal,
        reason: input.reason,
        proofClass: input.proofClass,
        previousHash: last?.hash ?? ZERO_HASH,
    };
    return [...previous, { ...body, hash: hashObject(body) }];
}
export function sealWallet(value) {
    return { ...value, integrityHash: hashObject(value) };
}
export function sealOperation(value) {
    return { ...value, integrityHash: hashObject(value) };
}
export function sealReceipt(value) {
    return { ...value, integrityHash: hashObject(value) };
}
export function validateWallet(value) {
    if (!isPlainRecord(value) || !exactKeys(value, [
        "schemaVersion", "profile", "profileHash", "address", "createdAt", "bindingHash", "integrityHash",
    ]))
        stateCorrupt("Wallet state has an unexpected schema.");
    const wallet = value;
    if (wallet.schemaVersion !== STATE_VERSION || typeof wallet.profile !== "string" ||
        typeof wallet.profileHash !== "string" || typeof wallet.address !== "string" ||
        typeof wallet.createdAt !== "string" || typeof wallet.bindingHash !== "string" ||
        wallet.integrityHash !== hashObject(withoutIntegrity(wallet)))
        stateCorrupt("Wallet state integrity validation failed.");
    return wallet;
}
export function validateOperation(value) {
    if (!isPlainRecord(value))
        stateCorrupt("Operation state is not an object.");
    const requiredKeys = [
        "schemaVersion", "operationId", "idempotencyHash", "profile", "profileHash", "requestHash",
        "fingerprint", "walletAddress", "recipient", "amountAtomic", "amountDecimal", "chainId", "token",
        "transactionData", "economics", "preparedAt", "preparedBlockNumberAtomic", "expiresAt", "state", "terminal", "reason",
        "proofClass", "transitions", "integrityHash",
    ];
    const optionalKeys = ["transactionHash", "rawTransactionHash", "lastSubmissionAt"];
    const actualKeys = Object.keys(value);
    if (requiredKeys.some((key) => !actualKeys.includes(key)) ||
        actualKeys.some((key) => !requiredKeys.includes(key) && !optionalKeys.includes(key)))
        stateCorrupt("Operation state has an unexpected schema.");
    const operation = value;
    if (operation.schemaVersion !== STATE_VERSION || !Array.isArray(operation.transitions)) {
        stateCorrupt("Operation state has an unexpected schema.");
    }
    validateTransitions(operation.transitions);
    if (operation.integrityHash !== hashObject(withoutIntegrity(operation))) {
        stateCorrupt("Operation state integrity validation failed.");
    }
    const last = operation.transitions.at(-1);
    if (last === undefined || last.state !== operation.state || last.terminal !== operation.terminal ||
        last.reason !== operation.reason || last.proofClass !== operation.proofClass)
        stateCorrupt("Operation summary does not match its transition chain.");
    parseAtomic(operation.amountAtomic, { positive: true });
    parseAtomic(operation.preparedBlockNumberAtomic);
    parseAtomic(operation.economics.nonceAtomic);
    parseAtomic(operation.economics.gasLimitAtomic, { positive: true });
    parseAtomic(operation.economics.maxFeePerGasAtomic, { positive: true });
    parseAtomic(operation.economics.maxPriorityFeePerGasAtomic);
    parseAtomic(operation.economics.maximumGasCostAtomic, { positive: true });
    return operation;
}
export function validateReceipt(value) {
    if (!isPlainRecord(value))
        stateCorrupt("Receipt state is not an object.");
    const requiredKeys = [
        "schemaVersion", "operationId", "state", "terminal", "reason", "proofClass", "createdAt",
        "operationIntegrityHash", "integrityHash",
    ];
    const optionalKeys = ["transactionHash", "blockNumberAtomic", "exactTransferLog"];
    const actualKeys = Object.keys(value);
    if (requiredKeys.some((key) => !actualKeys.includes(key)) ||
        actualKeys.some((key) => !requiredKeys.includes(key) && !optionalKeys.includes(key)))
        stateCorrupt("Receipt state has an unexpected schema.");
    const receipt = value;
    if (receipt.schemaVersion !== STATE_VERSION || receipt.integrityHash !== hashObject(withoutIntegrity(receipt))) {
        stateCorrupt("Receipt integrity validation failed.");
    }
    return receipt;
}
function validateTransitions(values) {
    let previousHash = ZERO_HASH;
    let sequence = 1n;
    for (const transition of values) {
        if (!isPlainRecord(transition) || !exactKeys(transition, [
            "sequence", "at", "state", "terminal", "reason", "proofClass", "previousHash", "hash",
        ]))
            stateCorrupt("Operation transition has an unexpected schema.");
        if (transition.sequence !== sequence.toString() || transition.previousHash !== previousHash) {
            stateCorrupt("Operation transition chain is discontinuous.");
        }
        if (transition.hash !== hashObject(transitionBody(transition))) {
            stateCorrupt("Operation transition hash is invalid.");
        }
        previousHash = transition.hash;
        sequence += 1n;
    }
    if (values.length === 0)
        stateCorrupt("Operation has no transition history.");
}
function withoutIntegrity(value) {
    const { integrityHash: _ignored, ...rest } = value;
    return rest;
}
function transitionBody(value) {
    const { hash: _ignored, ...rest } = value;
    return rest;
}
function stateCorrupt(message) {
    throw new ApnError("APN_STATE_CORRUPT", message);
}
//# sourceMappingURL=state-integrity.js.map