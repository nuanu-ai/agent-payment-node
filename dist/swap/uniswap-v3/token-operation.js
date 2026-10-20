import { canonicalJson, domainHash, exactKeys, hashObject, isPlainRecord } from "../../canonical.js";
import { ApnError } from "../../errors.js";
import { parseAtomic } from "../../money.js";
import { getAddress } from "viem";
import { SecureStateStore, stateIdentifier } from "../../secure-state-store.js";
import { validateUniswapTokenRoute } from "./token-route.js";
export const UNISWAP_TOKEN_OPERATION_SCHEMA_V1 = "apn.uniswap-token-operation.v1";
export const UNISWAP_TOKEN_OPERATION_SCHEMA = "apn.uniswap-token-operation.v2";
export const UNISWAP_TOKEN_RECEIPT_SCHEMA = "apn.uniswap-token-receipt.v1";
const FAILURE_DIAGNOSTIC_VALUES = {
    code: new Set(["APN_OPERATION_BLOCKED", "APN_RPC_PROTOCOL", "APN_RPC_AMBIGUOUS", "APN_RPC_BUDGET_EXCEEDED", "APN_RPC_RATE_LIMITED",
        "APN_PROVIDER_CAPABILITY_UNAVAILABLE", "APN_PROVIDER_UNAVAILABLE", "APN_CHAIN_MISMATCH", "APN_STATE_CORRUPT", "APN_WALLET_MISMATCH", "APN_RPC_CONFIG", "APN_REPREPARE_REQUIRED"]),
    reason: new Set(["http_status", "request_deadline", "DNS_deadline", "request_interrupted", "response_aborted", "response_interrupted", "deadline", "maxHttpAttempts", "http_429", "batch_unsupported",
        "swap_owner_admission_required", "uniswap_code_pin_drift", "uniswap_token_quote_expired", "uniswap_token_allowance_drift", "uniswap_token_source_balance", "uniswap_token_deadline", "uniswap_token_nonce_drift",
        "uniswap_token_wallet_drift", "uniswap_token_approval_simulation", "uniswap_token_gas_cap", "uniswap_token_native_balance", "uniswap_token_fee_cap", "uniswap_token_output_floor",
        "bridge_RPC_response", "bridge_RPC_method", "bridge_RPC_read_method", "bridge_archive_RPC_method", "distinct_archive_RPC_required"]),
    rpcMethod: new Set(["batch", "rpc", "eth_chainId", "eth_getBlockByNumber", "eth_getBalance", "eth_getCode", "eth_getStorageAt", "eth_getTransactionCount", "eth_call", "eth_estimateGas", "eth_maxPriorityFeePerGas", "eth_getTransactionByHash", "eth_getTransactionReceipt"]),
    endpointRole: new Set(["primary", "archive", "receipt"]),
};
export function sanitizeUniswapTokenFailureField(field, value) {
    return typeof value === "string" && FAILURE_DIAGNOSTIC_VALUES[field].has(value) ? value : null;
}
export function newUniswapTokenOperation(input) {
    const at = instant(input.now), body = { schemaVersion: UNISWAP_TOKEN_OPERATION_SCHEMA, ...input, phase: "prepared",
        createdAt: at, updatedAt: at, accumulatedNativeDebitWei: "0", usageReservationId: null, usageState: null,
        approvalAttempt: null, swapAttempt: null, cleanupAttempt: null, cleanupReason: null, cleanupEvidence: null, preSignFailure: null,
        receipt: null, previousIntegrityHash: null };
    delete body.now;
    return validateUniswapTokenOperation({ ...body, integrityHash: hashObject(body) });
}
export function validateUniswapTokenOperation(value) {
    const common = ["schemaVersion", "operationId", "profile", "account", "phase", "route", "approvalCapAtomic",
        "allowanceAtPrepare", "approvalGas", "swapGas", "cleanupGas", "maximumNativeDebitWei", "policyDigest", "mechanismDigest", "accumulatedNativeDebitWei",
        "usageReservationId", "usageState", "createdAt", "updatedAt",
        "approvalAttempt", "swapAttempt", "cleanupAttempt", "cleanupReason", "receipt", "previousIntegrityHash", "integrityHash"];
    if (!isPlainRecord(value) || value.schemaVersion !== UNISWAP_TOKEN_OPERATION_SCHEMA && value.schemaVersion !== UNISWAP_TOKEN_OPERATION_SCHEMA_V1 ||
        !exactKeys(value, value.schemaVersion === UNISWAP_TOKEN_OPERATION_SCHEMA ? [...common, "cleanupEvidence", "preSignFailure",
            ...(Object.hasOwn(value, "retiredEffects") ? ["retiredEffects"] : []), ...(Object.hasOwn(value, "quoteBlock") ? ["quoteBlock"] : []),
            ...(Object.hasOwn(value, "cleanupFeeQuote") ? ["cleanupFeeQuote"] : []), ...(Object.hasOwn(value, "principalRelease") ? ["principalRelease"] : [])] : common))
        corrupt("Uniswap token operation schema is invalid.");
    const op = value, { integrityHash, ...body } = op, route = validateUniswapTokenRoute(op.route);
    if (!UNISWAP_TOKEN_PHASES.includes(op.phase) || canonicalAddress(op.account) !== op.account || op.approvalCapAtomic !== route.amountIn ||
        !["0", route.amountIn].includes(op.allowanceAtPrepare) || uint(op.maximumNativeDebitWei) < maxGas(op.approvalGas) + maxGas(op.swapGas) + maxGas(op.cleanupGas) ||
        uint(op.accumulatedNativeDebitWei) > uint(op.maximumNativeDebitWei) ||
        integrityHash !== hashObject(body) || op.updatedAt < op.createdAt || !canonicalInstant(op.createdAt) || !canonicalInstant(op.updatedAt))
        corrupt("Uniswap token operation binding is invalid.");
    for (const gas of [op.approvalGas, op.swapGas, op.cleanupGas])
        validateGas(gas);
    const usageStates = ["reserved", "submitted", "unknown_finality", "finalized", "failed_before_effect", "failed_confirmed_revert",
        "released_unsubmitted"];
    if ((op.usageReservationId === null) !== (op.usageState === null) || op.usageReservationId !== null && !/^[a-f0-9]{64}$/u.test(op.usageReservationId) ||
        op.usageState !== null && !usageStates.includes(op.usageState) || op.phase !== "prepared" && op.usageReservationId === null &&
        !(op.phase === "cleaned" && op.cleanupEvidence?.kind === "zero_allowance_no_effect" && op.usageState === null &&
            op.approvalAttempt === null && op.swapAttempt === null && op.cleanupAttempt === null && op.accumulatedNativeDebitWei === "0"))
        corrupt("Uniswap token usage binding is invalid.");
    attempt(op.approvalAttempt);
    attempt(op.swapAttempt);
    attempt(op.cleanupAttempt);
    if (op.schemaVersion === UNISWAP_TOKEN_OPERATION_SCHEMA) {
        validateCleanupEvidence(op.cleanupEvidence);
        validateFailureDiagnostic(op.preSignFailure);
        if (op.retiredEffects !== undefined)
            validateRetired(op.retiredEffects, op.updatedAt);
        if (op.quoteBlock !== undefined && (!isPlainRecord(op.quoteBlock) || !exactKeys(op.quoteBlock, ["number", "hash"]) ||
            uint(op.quoteBlock.number) < 0n || !/^0x[a-f0-9]{64}$/u.test(op.quoteBlock.hash)))
            corrupt("Uniswap token quote block is invalid.");
    }
    const evidence = op.cleanupEvidence ?? null, failure = op.preSignFailure ?? null;
    const approvalStarted = ["approval_submission_started", "approval_submitted", "approval_unknown_finality"].includes(op.phase) || op.approvalAttempt !== null, swapStarted = ["submission_started", "submitted", "unknown_finality", "observed"].includes(op.phase), cleanupStarted = ["cleanup_submission_started", "cleanup_submitted", "cleanup_unknown_finality"].includes(op.phase) || op.phase === "cleaned" && evidence === null;
    if (approvalStarted && op.allowanceAtPrepare === "0" && op.approvalAttempt === null || swapStarted && op.swapAttempt === null || cleanupStarted && op.cleanupAttempt === null)
        corrupt("Uniswap token attempt binding is invalid.");
    const hashes = [op.approvalAttempt, op.swapAttempt, op.cleanupAttempt].some((row) => row?.transactionHash !== null && row?.transactionHash !== undefined);
    if (evidence?.kind === "zero_allowance_no_effect" && (op.phase !== "cleanup_required" && op.phase !== "cleaned" || op.cleanupReason !== "zero_allowance_no_effect" ||
        op.accumulatedNativeDebitWei !== "0" || hashes || op.phase === "cleaned" && op.usageState !== "failed_before_effect" &&
        !(op.usageState === null && op.usageReservationId === null && op.approvalAttempt === null && op.swapAttempt === null && op.cleanupAttempt === null &&
            evidence.source === "current_allowance" && Date.parse(evidence.observedAt) >= route.deadline * 1000 && evidence.observedAt <= op.updatedAt)))
        corrupt("Uniswap token no-effect cleanup evidence is invalid.");
    if (evidence?.kind === "expired_approval_no_swap" && (op.phase !== "cleaned" || op.cleanupReason !== "deadline_expired_after_approval" ||
        op.approvalAttempt?.transactionHash !== evidence.approvalTransactionHash || op.swapAttempt !== null || op.cleanupAttempt !== null ||
        evidence.observedAllowanceAtomic !== route.amountIn || !["reserved", "failed_before_effect"].includes(op.usageState ?? "") ||
        Date.parse(evidence.observedAt) < route.deadline * 1000 || evidence.observedAt > op.updatedAt))
        corrupt("Uniswap token expired approval evidence is invalid.");
    if (evidence?.kind === "zero_allowance_after_effect" && (op.phase !== "cleaned" || op.cleanupReason !== "zero_allowance_after_effect" ||
        !hashes && (op.retiredEffects ?? []).length === 0 || evidence.observedAt > op.updatedAt))
        corrupt("Uniswap token zero allowance evidence is invalid.");
    if (op.usageState === "released_unsubmitted" && !(op.retiredEffects ?? []).some((row) => row.kind === "swap" && row.reason === "never_landed"))
        corrupt("Uniswap token usage release has no never-landed swap.");
    // The diagnostic is the history of why cleanup became required: it stays through the owner's cleanup and its outcome.
    if (failure !== null && !PRE_SIGN_DIAGNOSTIC_PHASES.includes(op.phase))
        corrupt("Uniswap token pre-sign diagnostic phase is invalid.");
    if (op.cleanupFeeQuote !== undefined)
        validateCleanupFeeQuote(op);
    if (op.principalRelease !== undefined)
        validatePrincipalRelease(op);
    if (op.phase === "observed" && op.receipt === null || op.phase !== "observed" && op.receipt !== null)
        corrupt("Uniswap token receipt phase is invalid.");
    if (op.receipt !== null)
        validateReceipt(op.receipt, op);
    return op;
}
/** Every phase of a Uniswap token swap; `observed` and `cleaned` are its outcomes (nothing of it signs, sends or lands after them). */
export const UNISWAP_TOKEN_TERMINAL_PHASES = ["observed", "cleaned", "abandoned_unknown"];
export const UNISWAP_TOKEN_PHASES = ["prepared", "approved", "approval_submission_started", "approval_submitted", "approval_unknown_finality",
    "approval_observed", "submission_started", "submitted", "unknown_finality", "observed", "cleanup_required", "cleanup_submission_started",
    "cleanup_submitted", "cleanup_unknown_finality", "cleaned", "abandoned_unknown"];
const PRE_SIGN_DIAGNOSTIC_PHASES = ["cleanup_required", "cleanup_submission_started", "cleanup_submitted",
    "cleanup_unknown_finality", "cleaned", "abandoned_unknown"];
/** The round of an effect slot: how many attempts of that kind were retired before it. Round 0 keeps the original keys. */
export function tokenEffectRound(op, kind) {
    return (op.retiredEffects ?? []).filter((row) => row.kind === kind).length;
}
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
    /** Lock-free read without creating the state root (the operation index's reader). */
    async read(id) { stateIdentifier(id, "Uniswap token operation"); const v = await this.readJson(this.path(id)); return v === null ? null : validateUniswapTokenOperation(v); }
    path(id) { return `uniswap-token-operations/${id}.json`; }
}
export function transitionUniswapToken(opValue, phase, patch, now) {
    const op = validateUniswapTokenOperation(opValue), { integrityHash, ...body } = op;
    const upgraded = op.schemaVersion === UNISWAP_TOKEN_OPERATION_SCHEMA_V1
        ? { ...body, schemaVersion: UNISWAP_TOKEN_OPERATION_SCHEMA, cleanupEvidence: null, preSignFailure: null } : body;
    const nextBody = { ...upgraded, ...patch, phase, updatedAt: instant(now), previousIntegrityHash: integrityHash };
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
function validateRetired(rows, updatedAt) {
    if (!Array.isArray(rows) || rows.length < 1 || rows.length > 8)
        corrupt("Uniswap token retired effects are invalid.");
    for (const value of rows) {
        if (!isPlainRecord(value) || !exactKeys(value, ["kind", "attempt", "reason", "finalizedNonceAtomic", "observedAt"]))
            corrupt("Uniswap token retired effect is invalid.");
        const row = value;
        if (!["approval", "swap", "cleanup"].includes(row.kind) || !["never_landed", "reverted", "landed_allowance_nonzero"].includes(row.reason) ||
            !canonicalInstant(row.observedAt) || row.observedAt > updatedAt)
            corrupt("Uniswap token retired effect is invalid.");
        attempt(row.attempt);
        if (row.attempt.transactionHash === null || (row.reason === "never_landed"
            ? typeof row.finalizedNonceAtomic !== "string" || uint(row.finalizedNonceAtomic) <= uint(row.attempt.nonce)
            : row.kind !== "cleanup" || row.finalizedNonceAtomic !== null))
            corrupt("Uniswap token retired effect is invalid.");
    }
}
function validateCleanupEvidence(v) {
    if (v === null)
        return;
    if (isPlainRecord(v) && v.kind === "zero_allowance_after_effect") {
        if (!exactKeys(v, ["schemaVersion", "kind", "observedAllowanceAtomic", "observedAt"]) || v.schemaVersion !== "apn.uniswap-token-zero-allowance-evidence.v1" ||
            v.observedAllowanceAtomic !== "0" || !canonicalInstant(v.observedAt))
            corrupt("Uniswap token zero allowance evidence is invalid.");
        return;
    }
    if (isPlainRecord(v) && v.kind === "expired_approval_no_swap") {
        if (!exactKeys(v, ["schemaVersion", "kind", "approvalTransactionHash", "observedAllowanceAtomic", "observedAt"]) ||
            v.schemaVersion !== "apn.uniswap-token-expired-approval-evidence.v1" || !/^0x[a-f0-9]{64}$/u.test(v.approvalTransactionHash) ||
            !/^[1-9][0-9]*$/u.test(v.observedAllowanceAtomic) || !canonicalInstant(v.observedAt))
            corrupt("Uniswap token expired approval evidence is invalid.");
        return;
    }
    if (!isPlainRecord(v) || !exactKeys(v, ["schemaVersion", "kind", "source", "observedAllowanceAtomic", "observedAt"]) ||
        v.schemaVersion !== "apn.uniswap-token-cleanup-evidence.v1" || v.kind !== "zero_allowance_no_effect" ||
        !["current_allowance", "legacy_usage_reconciliation"].includes(v.source) || v.observedAllowanceAtomic !== "0" ||
        !canonicalInstant(v.observedAt))
        corrupt("Uniswap token cleanup evidence is invalid.");
}
/** A cleanup of this operation that landed (current, or retired after landing) and so consumed its nonce. */
export function landedTokenCleanups(op) {
    return [...(op.cleanupAttempt?.transactionHash != null ? [op.cleanupAttempt] : []),
        ...(op.retiredEffects ?? []).filter((row) => row.kind === "cleanup" && row.reason !== "never_landed").map((row) => row.attempt)];
}
function validatePrincipalRelease(op) {
    const v = op.principalRelease;
    if (op.phase !== "cleaned" && op.phase !== "abandoned_unknown" || op.receipt !== null || !["reserved", "failed_before_effect"].includes(op.usageState ?? "") ||
        (op.retiredEffects ?? []).some((row) => row.kind === "swap") || !isPlainRecord(v) || v.schemaVersion !== "apn.uniswap-token-principal-release.v1" ||
        typeof v.observedAt !== "string" || !canonicalInstant(v.observedAt) || v.observedAt > op.updatedAt)
        corrupt("Uniswap token principal release is invalid.");
    // An owner-abandoned swap keeps its hashless marker as history; the release names the marker custody proved unsigned.
    const marker = op.phase === "abandoned_unknown" ? op.swapAttempt : null;
    if (v.kind === "swap_never_signed") {
        if (marker === null ? !exactKeys(v, ["schemaVersion", "kind", "observedAt"]) || op.swapAttempt !== null
            : !exactKeys(v, ["schemaVersion", "kind", "swapNonce", "swapMarkerHash", "observedAt"]) || marker.transactionHash !== null ||
                v.swapNonce !== marker.nonce || v.swapMarkerHash !== marker.markerHash)
            corrupt("Uniswap token principal release is invalid.");
        return;
    }
    if (op.phase !== "cleaned")
        corrupt("Uniswap token principal release is invalid.");
    const swap = op.swapAttempt, cleanup = landedTokenCleanups(op).find((row) => row.transactionHash === v.cleanupTransactionHash);
    if (v.kind !== "swap_nonce_consumed_by_cleanup" || !exactKeys(v, ["schemaVersion", "kind", "swapNonce", "cleanupTransactionHash", "cleanupBlockNumber",
        "cleanupBlockHash", "finalizedBlockNumber", "finalizedNonce", "observedAt"]) || swap === null || swap.transactionHash !== null ||
        cleanup === undefined || cleanup.nonce !== swap.nonce || v.swapNonce !== swap.nonce || typeof v.cleanupBlockHash !== "string" ||
        !/^0x[a-f0-9]{64}$/u.test(v.cleanupBlockHash) || uint(v.finalizedBlockNumber) < uint(v.cleanupBlockNumber) || uint(v.finalizedNonce) <= uint(v.swapNonce))
        corrupt("Uniswap token principal release is invalid.");
}
function validateCleanupFeeQuote(op) {
    const q = op.cleanupFeeQuote;
    if (!PRE_SIGN_DIAGNOSTIC_PHASES.includes(op.phase) || !isPlainRecord(q) || !exactKeys(q, ["schemaVersion", "blockNumber", "blockHash", "baseFeePerGasWei",
        "priorityFeePerGasWei", "previousCleanupGas", "previousMaximumNativeDebitWei", "quotedAt"]) || q.schemaVersion !== "apn.uniswap-token-cleanup-fee-quote.v1" ||
        !/^0x[a-f0-9]{64}$/u.test(q.blockHash) || !canonicalInstant(q.quotedAt) || q.quotedAt > op.updatedAt)
        corrupt("Uniswap token cleanup fee quote is invalid.");
    uint(q.blockNumber);
    uint(q.baseFeePerGasWei);
    uint(q.priorityFeePerGasWei);
    validateGas(q.previousCleanupGas);
    if (q.previousCleanupGas.gasLimit !== op.cleanupGas.gasLimit || uint(q.previousMaximumNativeDebitWei) > uint(op.maximumNativeDebitWei))
        corrupt("Uniswap token cleanup fee quote is invalid.");
}
function validateFailureDiagnostic(v) {
    if (v === null)
        return;
    if (!isPlainRecord(v) || !exactKeys(v, ["code", "reason", "rpcMethod", "endpointRole", "phase"]) || !UNISWAP_TOKEN_PHASES.includes(v.phase) ||
        ["code", "reason", "rpcMethod", "endpointRole"].some((field) => v[field] !== null && sanitizeUniswapTokenFailureField(field, v[field]) !== v[field]))
        corrupt("Uniswap token pre-sign diagnostic is invalid.");
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