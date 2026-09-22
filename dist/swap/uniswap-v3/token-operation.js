import { canonicalJson, domainHash, exactKeys, hashObject, isPlainRecord } from "../../canonical.js";
import { ApnError } from "../../errors.js";
import { parseAtomic } from "../../money.js";
import { getAddress } from "viem";
import { SecureStateStore, stateIdentifier } from "../../secure-state-store.js";
import { validateUniswapTokenRoute } from "./token-route.js";
export const UNISWAP_TOKEN_OPERATION_SCHEMA = "apn.uniswap-token-operation.v1";
export const UNISWAP_TOKEN_RECEIPT_SCHEMA = "apn.uniswap-token-receipt.v1";
export function newUniswapTokenOperation(input) {
    const at = instant(input.now), body = { schemaVersion: UNISWAP_TOKEN_OPERATION_SCHEMA, ...input, phase: "prepared",
        createdAt: at, updatedAt: at, accumulatedNativeDebitWei: "0", usageReservationId: null, usageState: null,
        approvalAttempt: null, swapAttempt: null, cleanupAttempt: null, cleanupReason: null,
        receipt: null, previousIntegrityHash: null };
    delete body.now;
    return validateUniswapTokenOperation({ ...body, integrityHash: hashObject(body) });
}
export function validateUniswapTokenOperation(value) {
    if (!isPlainRecord(value) || !exactKeys(value, ["schemaVersion", "operationId", "profile", "account", "phase", "route", "approvalCapAtomic",
        "allowanceAtPrepare", "approvalGas", "swapGas", "cleanupGas", "maximumNativeDebitWei", "policyDigest", "mechanismDigest", "accumulatedNativeDebitWei",
        "usageReservationId", "usageState", "createdAt", "updatedAt",
        "approvalAttempt", "swapAttempt", "cleanupAttempt", "cleanupReason", "receipt", "previousIntegrityHash", "integrityHash"]) ||
        value.schemaVersion !== UNISWAP_TOKEN_OPERATION_SCHEMA)
        corrupt("Uniswap token operation schema is invalid.");
    const op = value, { integrityHash, ...body } = op, route = validateUniswapTokenRoute(op.route);
    if (!PHASES.includes(op.phase) || canonicalAddress(op.account) !== op.account || op.approvalCapAtomic !== route.amountIn ||
        !["0", route.amountIn].includes(op.allowanceAtPrepare) || uint(op.maximumNativeDebitWei) < maxGas(op.approvalGas) + maxGas(op.swapGas) + maxGas(op.cleanupGas) ||
        uint(op.accumulatedNativeDebitWei) > uint(op.maximumNativeDebitWei) ||
        integrityHash !== hashObject(body) || op.updatedAt < op.createdAt || !canonicalInstant(op.createdAt) || !canonicalInstant(op.updatedAt))
        corrupt("Uniswap token operation binding is invalid.");
    for (const gas of [op.approvalGas, op.swapGas, op.cleanupGas])
        validateGas(gas);
    const usageStates = ["reserved", "submitted", "unknown_finality", "finalized", "failed_before_effect", "failed_confirmed_revert"];
    if ((op.usageReservationId === null) !== (op.usageState === null) || op.usageReservationId !== null && !/^[a-f0-9]{64}$/u.test(op.usageReservationId) ||
        op.usageState !== null && !usageStates.includes(op.usageState) || op.phase !== "prepared" && op.usageReservationId === null)
        corrupt("Uniswap token usage binding is invalid.");
    attempt(op.approvalAttempt);
    attempt(op.swapAttempt);
    attempt(op.cleanupAttempt);
    const approvalStarted = ["approval_submission_started", "approval_submitted", "approval_unknown_finality"].includes(op.phase) || op.approvalAttempt !== null, swapStarted = ["submission_started", "submitted", "unknown_finality", "observed"].includes(op.phase), cleanupStarted = ["cleanup_submission_started", "cleanup_submitted", "cleanup_unknown_finality", "cleaned"].includes(op.phase);
    if (approvalStarted && op.allowanceAtPrepare === "0" && op.approvalAttempt === null || swapStarted && op.swapAttempt === null || cleanupStarted && op.cleanupAttempt === null)
        corrupt("Uniswap token attempt binding is invalid.");
    if (op.phase === "observed" && op.receipt === null || op.phase !== "observed" && op.receipt !== null)
        corrupt("Uniswap token receipt phase is invalid.");
    if (op.receipt !== null)
        validateReceipt(op.receipt, op);
    return op;
}
const PHASES = ["prepared", "approved", "approval_submission_started", "approval_submitted", "approval_unknown_finality",
    "approval_observed", "submission_started", "submitted", "unknown_finality", "observed", "cleanup_required", "cleanup_submission_started",
    "cleanup_submitted", "cleanup_unknown_finality", "cleaned"];
export class UniswapTokenJournal extends SecureStateStore {
    async save(value) {
        const op = validateUniswapTokenOperation(value);
        await this.initialize();
        await this.ensureDirectory("uniswap-token-operations");
        return await this.withLocks([`uniswap-token:${op.operationId}`], async () => {
            const prior = await this.readJson(this.path(op.operationId));
            if (prior !== null) {
                const p = validateUniswapTokenOperation(prior);
                if (op.previousIntegrityHash !== p.integrityHash)
                    corrupt("Uniswap token operation transition raced.");
            }
            await this.writeJson(this.path(op.operationId), op, prior === null);
            return op;
        });
    }
    async load(id) { stateIdentifier(id, "Uniswap token operation"); await this.initialize(); const v = await this.readJson(this.path(id)); return v === null ? null : validateUniswapTokenOperation(v); }
    path(id) { return `uniswap-token-operations/${id}.json`; }
}
export function transitionUniswapToken(opValue, phase, patch, now) {
    const op = validateUniswapTokenOperation(opValue), { integrityHash, ...body } = op, nextBody = { ...body, ...patch, phase, updatedAt: instant(now), previousIntegrityHash: integrityHash };
    return validateUniswapTokenOperation({ ...nextBody, integrityHash: hashObject(nextBody) });
}
export function tokenAttempt(op, kind, nonce, now) {
    const markedAt = instant(now), markerHash = domainHash("apn.uniswap-token-attempt.v1", canonicalJson({ operationId: op.operationId, integrityHash: op.integrityHash, kind, nonce, markedAt }));
    return { markerHash, markedAt, nonce: uint(nonce).toString(), transactionHash: null, attempts: 1 };
}
function validateGas(v) {
    if (!isPlainRecord(v) || !exactKeys(v, ["gasLimit", "maxFeePerGas", "maxPriorityFeePerGas"]) || uint(v.gasLimit) === 0n || uint(v.maxFeePerGas) === 0n || uint(v.maxPriorityFeePerGas) > uint(v.maxFeePerGas))
        corrupt("Uniswap token gas envelope is invalid.");
}
function maxGas(v) { validateGas(v); return BigInt(v.gasLimit) * BigInt(v.maxFeePerGas); }
function attempt(v) {
    if (v === null)
        return;
    if (!isPlainRecord(v) || !exactKeys(v, ["markerHash", "markedAt", "nonce", "transactionHash", "attempts"]) || v.attempts !== 1 || !/^[a-f0-9]{64}$/u.test(v.markerHash) || !canonicalInstant(v.markedAt) || (v.transactionHash !== null && !/^0x[a-f0-9]{64}$/u.test(v.transactionHash)))
        corrupt("Uniswap token attempt is invalid.");
    uint(v.nonce);
}
function validateReceipt(v, op) {
    if (!isPlainRecord(v) || !exactKeys(v, ["schemaVersion", "operationId", "approvalGasWei", "swapGasWei", "cleanupGasWei", "nativeDebitWei", "inputDebitAtomic", "outputCreditAtomic", "residualAllowanceAtomic", "transactionHash", "observedAt", "receiptHash"]) || v.schemaVersion !== UNISWAP_TOKEN_RECEIPT_SCHEMA || v.operationId !== op.operationId || v.inputDebitAtomic !== op.route.amountIn || v.residualAllowanceAtomic !== "0" || v.nativeDebitWei !== op.accumulatedNativeDebitWei || !/^0x[a-f0-9]{64}$/u.test(v.transactionHash) || !canonicalInstant(v.observedAt))
        corrupt("Uniswap token receipt is invalid.");
    const { receiptHash, ...body } = v;
    if (receiptHash !== domainHash(UNISWAP_TOKEN_RECEIPT_SCHEMA, canonicalJson(body)))
        corrupt("Uniswap token receipt hash is invalid.");
}
function canonicalAddress(v) {
    try {
        return getAddress(v);
    }
    catch {
        return "";
    }
}
function uint(v) {
    try {
        if (typeof v !== "string")
            throw new Error();
        return parseAtomic(v);
    }
    catch {
        return corrupt("Uniswap token integer is invalid.");
    }
}
function instant(v) {
    if (!(v instanceof Date) || !Number.isFinite(v.getTime()))
        corrupt("Uniswap token time is invalid.");
    return v.toISOString();
}
function canonicalInstant(v) { return Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v; }
function corrupt(message) { throw new ApnError("APN_STATE_CORRUPT", message); }
//# sourceMappingURL=token-operation.js.map