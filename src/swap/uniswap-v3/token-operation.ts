import { canonicalJson, domainHash, exactKeys, hashObject, isPlainRecord } from "../../canonical.js";
import { ApnError } from "../../errors.js";
import { parseAtomic } from "../../money.js";
import { getAddress } from "viem";
import { SecureStateStore, stateIdentifier } from "../../secure-state-store.js";
import type { AssetUsageState } from "../../asset-usage-ledger.js";
import { validateUniswapTokenRoute, type UniswapTokenRoute } from "./token-route.js";
export const UNISWAP_TOKEN_OPERATION_SCHEMA_V1 = "apn.uniswap-token-operation.v1" as const;
export const UNISWAP_TOKEN_OPERATION_SCHEMA = "apn.uniswap-token-operation.v2" as const;
export const UNISWAP_TOKEN_RECEIPT_SCHEMA = "apn.uniswap-token-receipt.v1" as const;
export type UniswapTokenPhase = "prepared" | "approved" | "approval_submission_started" | "approval_submitted" | "approval_unknown_finality" | "approval_observed" | "submission_started" | "submitted" | "unknown_finality" | "observed" | "cleanup_required" | "cleanup_submission_started" | "cleanup_submitted" | "cleanup_unknown_finality" | "cleaned";
export interface TokenGasEnvelope {
    readonly gasLimit: string;
    readonly maxFeePerGas: string;
    readonly maxPriorityFeePerGas: string;
}
export interface UniswapTokenAttempt {
    readonly markerHash: string;
    readonly markedAt: string;
    readonly nonce: string;
    readonly transactionHash: string | null;
    readonly attempts: 1;
}
export interface UniswapTokenReceipt {
    readonly schemaVersion: typeof UNISWAP_TOKEN_RECEIPT_SCHEMA;
    readonly operationId: string;
    readonly approvalGasWei: string;
    readonly swapGasWei: string;
    readonly cleanupGasWei: string;
    readonly nativeDebitWei: string;
    readonly inputDebitAtomic: string;
    readonly outputCreditAtomic: string;
    readonly residualAllowanceAtomic: "0";
    readonly transactionHash: string;
    readonly observedAt: string;
    readonly receiptHash: string;
}
export interface UniswapTokenCleanupEvidence { readonly schemaVersion: "apn.uniswap-token-cleanup-evidence.v1";
    readonly kind: "zero_allowance_no_effect"; readonly source: "current_allowance" | "legacy_usage_reconciliation";
    readonly observedAllowanceAtomic: "0"; readonly observedAt: string; }
export interface UniswapTokenExpiredApprovalEvidence { readonly schemaVersion: "apn.uniswap-token-expired-approval-evidence.v1";
    readonly kind: "expired_approval_no_swap"; readonly approvalTransactionHash: string;
    readonly observedAllowanceAtomic: string; readonly observedAt: string; readonly source?: never; }
export interface UniswapTokenFailureDiagnostic { readonly code: string | null; readonly reason: string | null;
    readonly rpcMethod: string | null; readonly endpointRole: string | null; readonly phase: UniswapTokenPhase; }
type FailureDiagnosticField = "code" | "reason" | "rpcMethod" | "endpointRole";
const FAILURE_DIAGNOSTIC_VALUES: Readonly<Record<FailureDiagnosticField, ReadonlySet<string>>> = {
    code: new Set(["APN_OPERATION_BLOCKED", "APN_RPC_PROTOCOL", "APN_RPC_AMBIGUOUS", "APN_RPC_BUDGET_EXCEEDED", "APN_RPC_RATE_LIMITED",
        "APN_PROVIDER_CAPABILITY_UNAVAILABLE", "APN_PROVIDER_UNAVAILABLE", "APN_CHAIN_MISMATCH", "APN_STATE_CORRUPT", "APN_WALLET_MISMATCH", "APN_RPC_CONFIG", "APN_REPREPARE_REQUIRED"]),
    reason: new Set(["http_status", "request_deadline", "DNS_deadline", "request_interrupted", "response_aborted", "response_interrupted", "deadline", "maxHttpAttempts", "http_429", "batch_unsupported",
        "swap_owner_admission_required", "uniswap_code_pin_drift", "uniswap_token_quote_expired", "uniswap_token_allowance_drift", "uniswap_token_source_balance", "uniswap_token_deadline", "uniswap_token_nonce_drift",
        "uniswap_token_wallet_drift", "uniswap_token_approval_simulation", "uniswap_token_gas_cap", "uniswap_token_native_balance", "uniswap_token_fee_cap", "uniswap_token_output_floor",
        "bridge_RPC_response", "bridge_RPC_method", "bridge_RPC_read_method", "bridge_archive_RPC_method", "distinct_archive_RPC_required"]),
    rpcMethod: new Set(["batch", "rpc", "eth_chainId", "eth_getBlockByNumber", "eth_getBalance", "eth_getCode", "eth_getStorageAt", "eth_getTransactionCount", "eth_call", "eth_estimateGas", "eth_maxPriorityFeePerGas", "eth_getTransactionByHash", "eth_getTransactionReceipt"]),
    endpointRole: new Set(["primary", "archive", "receipt"]),
};
export function sanitizeUniswapTokenFailureField(field: FailureDiagnosticField, value: unknown): string | null {
    return typeof value === "string" && FAILURE_DIAGNOSTIC_VALUES[field].has(value) ? value : null;
}
export interface UniswapTokenOperation {
    readonly schemaVersion: typeof UNISWAP_TOKEN_OPERATION_SCHEMA | typeof UNISWAP_TOKEN_OPERATION_SCHEMA_V1;
    readonly operationId: string;
    readonly profile: string;
    readonly account: string;
    readonly phase: UniswapTokenPhase;
    readonly route: UniswapTokenRoute;
    readonly approvalCapAtomic: string;
    readonly allowanceAtPrepare: string;
    readonly approvalGas: TokenGasEnvelope;
    readonly swapGas: TokenGasEnvelope;
    readonly cleanupGas: TokenGasEnvelope;
    readonly maximumNativeDebitWei: string;
    readonly policyDigest: string;
    readonly mechanismDigest: string;
    readonly accumulatedNativeDebitWei: string;
    readonly usageReservationId: string | null;
    readonly usageState: AssetUsageState | null;
    readonly createdAt: string;
    readonly updatedAt: string;
    readonly approvalAttempt: UniswapTokenAttempt | null;
    readonly swapAttempt: UniswapTokenAttempt | null;
    readonly cleanupAttempt: UniswapTokenAttempt | null;
    readonly cleanupReason: string | null;
    readonly cleanupEvidence?: UniswapTokenCleanupEvidence | UniswapTokenExpiredApprovalEvidence | null;
    readonly preSignFailure?: UniswapTokenFailureDiagnostic | null;
    readonly receipt: UniswapTokenReceipt | null;
    readonly previousIntegrityHash: string | null;
    readonly integrityHash: string;
}
export function newUniswapTokenOperation(input: Omit<UniswapTokenOperation, "schemaVersion" | "phase" | "createdAt" | "updatedAt" | "accumulatedNativeDebitWei" | "usageReservationId" | "usageState" | "approvalAttempt" | "swapAttempt" | "cleanupAttempt" | "cleanupReason" | "cleanupEvidence" | "preSignFailure" | "receipt" | "previousIntegrityHash" | "integrityHash"> & {
    readonly now: Date;
}) {
    const at = instant(input.now), body = { schemaVersion: UNISWAP_TOKEN_OPERATION_SCHEMA, ...input, phase: "prepared" as const,
        createdAt: at, updatedAt: at, accumulatedNativeDebitWei: "0", usageReservationId: null, usageState: null,
        approvalAttempt: null, swapAttempt: null, cleanupAttempt: null, cleanupReason: null, cleanupEvidence: null, preSignFailure: null,
        receipt: null, previousIntegrityHash: null };
    delete (body as any).now;
    return validateUniswapTokenOperation({ ...body, integrityHash: hashObject(body) });
}
export function validateUniswapTokenOperation(value: unknown): UniswapTokenOperation {
    const common = ["schemaVersion", "operationId", "profile", "account", "phase", "route", "approvalCapAtomic",
        "allowanceAtPrepare", "approvalGas", "swapGas", "cleanupGas", "maximumNativeDebitWei", "policyDigest", "mechanismDigest", "accumulatedNativeDebitWei",
        "usageReservationId", "usageState", "createdAt", "updatedAt",
        "approvalAttempt", "swapAttempt", "cleanupAttempt", "cleanupReason", "receipt", "previousIntegrityHash", "integrityHash"];
    if (!isPlainRecord(value) || value.schemaVersion !== UNISWAP_TOKEN_OPERATION_SCHEMA && value.schemaVersion !== UNISWAP_TOKEN_OPERATION_SCHEMA_V1 ||
        !exactKeys(value, value.schemaVersion === UNISWAP_TOKEN_OPERATION_SCHEMA ? [...common, "cleanupEvidence", "preSignFailure"] : common))
        corrupt("Uniswap token operation schema is invalid.");
    const op = value as unknown as UniswapTokenOperation, { integrityHash, ...body } = op, route = validateUniswapTokenRoute(op.route);
    if (!PHASES.includes(op.phase) || canonicalAddress(op.account) !== op.account || op.approvalCapAtomic !== route.amountIn ||
        !["0", route.amountIn].includes(op.allowanceAtPrepare) || uint(op.maximumNativeDebitWei) < maxGas(op.approvalGas) + maxGas(op.swapGas) + maxGas(op.cleanupGas) ||
        uint(op.accumulatedNativeDebitWei) > uint(op.maximumNativeDebitWei) ||
        integrityHash !== hashObject(body) || op.updatedAt < op.createdAt || !canonicalInstant(op.createdAt) || !canonicalInstant(op.updatedAt))
        corrupt("Uniswap token operation binding is invalid.");
    for (const gas of [op.approvalGas, op.swapGas, op.cleanupGas])
        validateGas(gas);
    const usageStates: readonly AssetUsageState[] = ["reserved", "submitted", "unknown_finality", "finalized", "failed_before_effect", "failed_confirmed_revert"];
    if ((op.usageReservationId === null) !== (op.usageState === null) || op.usageReservationId !== null && !/^[a-f0-9]{64}$/u.test(op.usageReservationId) ||
        op.usageState !== null && !usageStates.includes(op.usageState) || op.phase !== "prepared" && op.usageReservationId === null &&
        !(op.phase === "cleaned" && op.cleanupEvidence?.kind === "zero_allowance_no_effect" && op.usageState === null &&
          op.approvalAttempt === null && op.swapAttempt === null && op.cleanupAttempt === null && op.accumulatedNativeDebitWei === "0"))
        corrupt("Uniswap token usage binding is invalid.");
    attempt(op.approvalAttempt);
    attempt(op.swapAttempt);
    attempt(op.cleanupAttempt);
    if (op.schemaVersion === UNISWAP_TOKEN_OPERATION_SCHEMA) { validateCleanupEvidence(op.cleanupEvidence); validateFailureDiagnostic(op.preSignFailure); }
    const evidence = op.cleanupEvidence ?? null, failure = op.preSignFailure ?? null;
    const approvalStarted = ["approval_submission_started", "approval_submitted", "approval_unknown_finality"].includes(op.phase) || op.approvalAttempt !== null, swapStarted = ["submission_started", "submitted", "unknown_finality", "observed"].includes(op.phase), cleanupStarted = ["cleanup_submission_started", "cleanup_submitted", "cleanup_unknown_finality"].includes(op.phase) || op.phase === "cleaned" && evidence === null;
    if (approvalStarted && op.allowanceAtPrepare === "0" && op.approvalAttempt === null || swapStarted && op.swapAttempt === null || cleanupStarted && op.cleanupAttempt === null)
        corrupt("Uniswap token attempt binding is invalid.");
    const hashes = [op.approvalAttempt, op.swapAttempt, op.cleanupAttempt].some((row) => row?.transactionHash !== null && row?.transactionHash !== undefined);
    if (evidence?.kind === "zero_allowance_no_effect" && (op.phase !== "cleanup_required" && op.phase !== "cleaned" || op.cleanupReason !== "zero_allowance_no_effect" ||
        op.accumulatedNativeDebitWei !== "0" || hashes || op.phase === "cleaned" && op.usageState !== "failed_before_effect" &&
        !(op.usageState === null && op.usageReservationId === null && op.approvalAttempt === null && op.swapAttempt === null && op.cleanupAttempt === null)))
        corrupt("Uniswap token no-effect cleanup evidence is invalid.");
    if (evidence?.kind === "expired_approval_no_swap" && (op.phase !== "cleaned" || op.cleanupReason !== "deadline_expired_after_approval" ||
        op.approvalAttempt?.transactionHash !== evidence.approvalTransactionHash || op.swapAttempt !== null || op.cleanupAttempt !== null ||
        evidence.observedAllowanceAtomic !== route.amountIn || !["reserved", "failed_before_effect"].includes(op.usageState ?? "") ||
        Date.parse(evidence.observedAt) < route.deadline * 1000 || evidence.observedAt > op.updatedAt))
        corrupt("Uniswap token expired approval evidence is invalid.");
    if (failure !== null && op.phase !== "cleanup_required" && op.phase !== "cleaned") corrupt("Uniswap token pre-sign diagnostic phase is invalid.");
    if (op.phase === "observed" && op.receipt === null || op.phase !== "observed" && op.receipt !== null)
        corrupt("Uniswap token receipt phase is invalid.");
    if (op.receipt !== null)
        validateReceipt(op.receipt, op);
    return op;
}
const PHASES: readonly UniswapTokenPhase[] = ["prepared", "approved", "approval_submission_started", "approval_submitted", "approval_unknown_finality",
    "approval_observed", "submission_started", "submitted", "unknown_finality", "observed", "cleanup_required", "cleanup_submission_started",
    "cleanup_submitted", "cleanup_unknown_finality", "cleaned"];
export class UniswapTokenJournal extends SecureStateStore {
    async save(value: UniswapTokenOperation): Promise<UniswapTokenOperation> {
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
    async load(id: string) { stateIdentifier(id, "Uniswap token operation"); await this.initialize(); const v = await this.readJson(this.path(id)); return v === null ? null : validateUniswapTokenOperation(v); }
    private path(id: string) { return `uniswap-token-operations/${id}.json`; }
}
export function transitionUniswapToken(opValue: UniswapTokenOperation, phase: UniswapTokenPhase, patch: Partial<UniswapTokenOperation>, now: Date) {
    const op = validateUniswapTokenOperation(opValue), { integrityHash, ...body } = op;
    const upgraded = op.schemaVersion === UNISWAP_TOKEN_OPERATION_SCHEMA_V1
        ? { ...body, schemaVersion: UNISWAP_TOKEN_OPERATION_SCHEMA, cleanupEvidence: null, preSignFailure: null } : body;
    const nextBody = { ...upgraded, ...patch, phase, updatedAt: instant(now), previousIntegrityHash: integrityHash };
    return validateUniswapTokenOperation({ ...nextBody, integrityHash: hashObject(nextBody) });
}
export function tokenAttempt(op: UniswapTokenOperation, kind: "approval" | "swap" | "cleanup", nonce: string, now: Date): UniswapTokenAttempt {
    const markedAt = instant(now), markerHash = domainHash("apn.uniswap-token-attempt.v1", canonicalJson({ operationId: op.operationId, integrityHash: op.integrityHash, kind, nonce, markedAt }));
    return { markerHash, markedAt, nonce: uint(nonce).toString(), transactionHash: null, attempts: 1 };
}
function validateGas(v: unknown): asserts v is TokenGasEnvelope { if (!isPlainRecord(v) || !exactKeys(v, ["gasLimit", "maxFeePerGas", "maxPriorityFeePerGas"]) || uint(v.gasLimit) === 0n || uint(v.maxFeePerGas) === 0n || uint(v.maxPriorityFeePerGas) > uint(v.maxFeePerGas))
    corrupt("Uniswap token gas envelope is invalid."); }
function maxGas(v: TokenGasEnvelope) { validateGas(v); return BigInt(v.gasLimit) * BigInt(v.maxFeePerGas); }
function attempt(v: UniswapTokenAttempt | null) { if (v === null)
    return; if (!isPlainRecord(v) || !exactKeys(v, ["markerHash", "markedAt", "nonce", "transactionHash", "attempts"]) || v.attempts !== 1 || !/^[a-f0-9]{64}$/u.test(v.markerHash) || !canonicalInstant(v.markedAt) || (v.transactionHash !== null && !/^0x[a-f0-9]{64}$/u.test(v.transactionHash)))
    corrupt("Uniswap token attempt is invalid."); uint(v.nonce); }
function validateCleanupEvidence(v: UniswapTokenCleanupEvidence | UniswapTokenExpiredApprovalEvidence | null | undefined) { if (v === null) return;
    if (isPlainRecord(v) && v.kind === "expired_approval_no_swap") {
      if (!exactKeys(v, ["schemaVersion", "kind", "approvalTransactionHash", "observedAllowanceAtomic", "observedAt"]) ||
          v.schemaVersion !== "apn.uniswap-token-expired-approval-evidence.v1" || !/^0x[a-f0-9]{64}$/u.test(v.approvalTransactionHash as string) ||
          !/^[1-9][0-9]*$/u.test(v.observedAllowanceAtomic as string) || !canonicalInstant(v.observedAt as string))
          corrupt("Uniswap token expired approval evidence is invalid.");
      return;
    }
    if (!isPlainRecord(v) || !exactKeys(v, ["schemaVersion", "kind", "source", "observedAllowanceAtomic", "observedAt"]) ||
        v.schemaVersion !== "apn.uniswap-token-cleanup-evidence.v1" || v.kind !== "zero_allowance_no_effect" ||
        !["current_allowance", "legacy_usage_reconciliation"].includes(v.source as string) || v.observedAllowanceAtomic !== "0" ||
        !canonicalInstant(v.observedAt as string)) corrupt("Uniswap token cleanup evidence is invalid."); }
function validateFailureDiagnostic(v: UniswapTokenFailureDiagnostic | null | undefined) { if (v === null) return;
    if (!isPlainRecord(v) || !exactKeys(v, ["code", "reason", "rpcMethod", "endpointRole", "phase"]) || !PHASES.includes(v.phase as UniswapTokenPhase) ||
        (["code", "reason", "rpcMethod", "endpointRole"] as const).some((field) => v[field] !== null && sanitizeUniswapTokenFailureField(field, v[field]) !== v[field]))
        corrupt("Uniswap token pre-sign diagnostic is invalid."); }
function validateReceipt(v: UniswapTokenReceipt, op: UniswapTokenOperation) { if (!isPlainRecord(v) || !exactKeys(v, ["schemaVersion", "operationId", "approvalGasWei", "swapGasWei", "cleanupGasWei", "nativeDebitWei", "inputDebitAtomic", "outputCreditAtomic", "residualAllowanceAtomic", "transactionHash", "observedAt", "receiptHash"]) || v.schemaVersion !== UNISWAP_TOKEN_RECEIPT_SCHEMA || v.operationId !== op.operationId || v.inputDebitAtomic !== op.route.amountIn || v.residualAllowanceAtomic !== "0" || v.nativeDebitWei !== op.accumulatedNativeDebitWei || !/^0x[a-f0-9]{64}$/u.test(v.transactionHash) || !canonicalInstant(v.observedAt))
    corrupt("Uniswap token receipt is invalid."); const { receiptHash, ...body } = v; if (receiptHash !== domainHash(UNISWAP_TOKEN_RECEIPT_SCHEMA, canonicalJson(body)))
    corrupt("Uniswap token receipt hash is invalid."); }
function canonicalAddress(v: string) { try {
    return getAddress(v);
}
catch {
    return "";
} }
function uint(v: unknown) { try {
    if (typeof v !== "string")
        throw new Error();
    return parseAtomic(v);
}
catch {
    return corrupt("Uniswap token integer is invalid.");
} }
function instant(v: Date) { if (!(v instanceof Date) || !Number.isFinite(v.getTime()))
    corrupt("Uniswap token time is invalid."); return v.toISOString(); }
function canonicalInstant(v: string) { return Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v; }
function corrupt(message: string): never { throw new ApnError("APN_STATE_CORRUPT", message); }
