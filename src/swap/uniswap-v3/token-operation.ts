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
export type UniswapTokenPhase = "prepared" | "approved" | "approval_submission_started" | "approval_submitted" | "approval_unknown_finality" | "approval_observed" | "submission_started" | "submitted" | "unknown_finality" | "observed" | "cleanup_required" | "cleanup_submission_started" | "cleanup_submitted" | "cleanup_unknown_finality" | "cleaned" | "abandoned_unknown";
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
/** The residual allowance was observed zero after an effect of this swap landed (or was retired): nothing is left to clean. */
export interface UniswapTokenZeroAllowanceEvidence { readonly schemaVersion: "apn.uniswap-token-zero-allowance-evidence.v1";
    readonly kind: "zero_allowance_after_effect"; readonly observedAllowanceAtomic: "0"; readonly observedAt: string; readonly source?: never; }
/**
 * An attempt that can no longer land, kept when its slot is freed (R4): never landed (at the finalized tag the account's
 * nonce passed the attempt's nonce and the node knows neither its transaction nor a receipt) or, for a cleanup, landed
 * without zeroing the allowance (reverted, or another approval followed in its block). A freed cleanup slot is re-armed
 * under a new round with fresh owner consent; approval and swap slots are never signed again.
 */
export interface UniswapTokenRetiredEffect { readonly kind: "approval" | "swap" | "cleanup"; readonly attempt: UniswapTokenAttempt;
    readonly reason: "never_landed" | "reverted" | "landed_allowance_nonzero"; readonly finalizedNonceAtomic: string | null; readonly observedAt: string; }
/** The owner's own cleanup fee caps replaced the frozen ones at a fresh, consented fee quote (this cleanup only). */
export interface UniswapTokenCleanupFeeQuote { readonly schemaVersion: "apn.uniswap-token-cleanup-fee-quote.v1"; readonly blockNumber: string;
    readonly blockHash: string; readonly baseFeePerGasWei: string; readonly priorityFeePerGasWei: string; readonly previousCleanupGas: TokenGasEnvelope;
    readonly previousMaximumNativeDebitWei: string; readonly quotedAt: string; }
/**
 * Why a cleaned swap's principal hold was released although an approval of it landed (R4 exit 2): no swap of it was ever
 * signed (no swap marker is left; a marker is dropped only when custody showed no signed bytes for it), or the hashless
 * swap marker's nonce is consumed in the finalized chain by this operation's own landed cleanup, so no swap of it can
 * ever land. Spent gas and every attempt stay in the record. An owner-abandoned swap (QA 0.5.54, 867244e9…) keeps its
 * hashless marker and names it: custody, opened under the account lock, held no signed bytes for it and freed its nonce.
 */
export type UniswapTokenPrincipalRelease = { readonly schemaVersion: "apn.uniswap-token-principal-release.v1"; readonly kind: "swap_never_signed";
        readonly swapNonce?: string; readonly swapMarkerHash?: string; readonly chainProof?: UniswapTokenSwapNonceProof; readonly observedAt: string }
    | { readonly schemaVersion: "apn.uniswap-token-principal-release.v1"; readonly kind: "swap_nonce_consumed_by_cleanup"; readonly swapNonce: string;
        readonly cleanupTransactionHash: string; readonly cleanupBlockNumber: string; readonly cleanupBlockHash: string;
        readonly finalizedBlockNumber: string; readonly finalizedNonce: string; readonly chainProof?: UniswapTokenSwapNonceProof; readonly observedAt: string };
/**
 * Custody's "no signed bytes" is local state; this is the finalized chain's word that no swap with a marker's nonce can land
 * (0.5.56 on): each nonce is held by a landed cleanup of this operation at a finalized block, or the account's nonce at a
 * finalized block past the route's deadline is at or below it (a swap included later reverts on that deadline). A release
 * recorded before the proof existed carries none.
 */
export interface UniswapTokenSwapNonceProof { readonly swapNonces: readonly string[];
    readonly cleanups: readonly { readonly swapNonce: string; readonly cleanupTransactionHash: string; readonly cleanupBlockNumber: string;
        readonly cleanupBlockHash: string; readonly finalizedBlockNumber: string; readonly finalizedNonce: string }[];
    readonly unused: { readonly fromNonce: string; readonly finalizedNonce: string; readonly finalizedBlockNumber: string;
        readonly finalizedBlockHash: string; readonly finalizedBlockTimestamp: string } | null; }
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
    /** The quote's Ethereum block, read before anything of the swap was signed (R4 exit 2 needs a node indexing it); absent on older records. */
    readonly quoteBlock?: { readonly number: string; readonly hash: string };
    readonly accumulatedNativeDebitWei: string;
    readonly usageReservationId: string | null;
    readonly usageState: AssetUsageState | null;
    readonly createdAt: string;
    readonly updatedAt: string;
    readonly approvalAttempt: UniswapTokenAttempt | null;
    readonly swapAttempt: UniswapTokenAttempt | null;
    readonly cleanupAttempt: UniswapTokenAttempt | null;
    readonly cleanupReason: string | null;
    readonly cleanupEvidence?: UniswapTokenCleanupEvidence | UniswapTokenExpiredApprovalEvidence | UniswapTokenZeroAllowanceEvidence | null;
    readonly preSignFailure?: UniswapTokenFailureDiagnostic | null;
    /** Present only once the owner re-quoted the cleanup fee caps. */
    readonly cleanupFeeQuote?: UniswapTokenCleanupFeeQuote;
    /** Present only once an attempt was retired (v2 records without it read as before). */
    readonly retiredEffects?: readonly UniswapTokenRetiredEffect[];
    /** Present only once a cleaned swap's principal hold was released on proof that no swap of it can land. */
    readonly principalRelease?: UniswapTokenPrincipalRelease;
    /** Swap markers dropped because custody showed no signed bytes for them (0.5.56 on): their nonces a release must prove on chain. */
    readonly freedSwapMarkers?: readonly UniswapTokenAttempt[];
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
        !exactKeys(value, value.schemaVersion === UNISWAP_TOKEN_OPERATION_SCHEMA ? [...common, "cleanupEvidence", "preSignFailure",
          ...(Object.hasOwn(value, "retiredEffects") ? ["retiredEffects"] : []), ...(Object.hasOwn(value, "quoteBlock") ? ["quoteBlock"] : []),
          ...(Object.hasOwn(value, "cleanupFeeQuote") ? ["cleanupFeeQuote"] : []), ...(Object.hasOwn(value, "principalRelease") ? ["principalRelease"] : []),
          ...(Object.hasOwn(value, "freedSwapMarkers") ? ["freedSwapMarkers"] : [])] : common))
        corrupt("Uniswap token operation schema is invalid.");
    const op = value as unknown as UniswapTokenOperation, { integrityHash, ...body } = op, route = validateUniswapTokenRoute(op.route);
    if (!UNISWAP_TOKEN_PHASES.includes(op.phase) || canonicalAddress(op.account) !== op.account || op.approvalCapAtomic !== route.amountIn ||
        !["0", route.amountIn].includes(op.allowanceAtPrepare) || uint(op.maximumNativeDebitWei) < maxGas(op.approvalGas) + maxGas(op.swapGas) + maxGas(op.cleanupGas) ||
        uint(op.accumulatedNativeDebitWei) > uint(op.maximumNativeDebitWei) ||
        integrityHash !== hashObject(body) || op.updatedAt < op.createdAt || !canonicalInstant(op.createdAt) || !canonicalInstant(op.updatedAt))
        corrupt("Uniswap token operation binding is invalid.");
    for (const gas of [op.approvalGas, op.swapGas, op.cleanupGas])
        validateGas(gas);
    const usageStates: readonly AssetUsageState[] = ["reserved", "submitted", "unknown_finality", "finalized", "failed_before_effect", "failed_confirmed_revert",
        "released_unsubmitted"];
    if ((op.usageReservationId === null) !== (op.usageState === null) || op.usageReservationId !== null && !/^[a-f0-9]{64}$/u.test(op.usageReservationId) ||
        op.usageState !== null && !usageStates.includes(op.usageState) || op.phase !== "prepared" && op.usageReservationId === null &&
        !(op.phase === "cleaned" && op.cleanupEvidence?.kind === "zero_allowance_no_effect" && op.usageState === null &&
          op.approvalAttempt === null && op.swapAttempt === null && op.cleanupAttempt === null && op.accumulatedNativeDebitWei === "0"))
        corrupt("Uniswap token usage binding is invalid.");
    attempt(op.approvalAttempt);
    attempt(op.swapAttempt);
    attempt(op.cleanupAttempt);
    if (op.schemaVersion === UNISWAP_TOKEN_OPERATION_SCHEMA) { validateCleanupEvidence(op.cleanupEvidence); validateFailureDiagnostic(op.preSignFailure);
        if (op.retiredEffects !== undefined) validateRetired(op.retiredEffects, op.updatedAt);
        if (op.freedSwapMarkers !== undefined && (!Array.isArray(op.freedSwapMarkers) || op.freedSwapMarkers.length < 1 || op.freedSwapMarkers.length > 8 ||
            op.freedSwapMarkers.some((row) => { attempt(row); return row.transactionHash !== null || row.markedAt > op.updatedAt; })))
            corrupt("Uniswap token freed swap markers are invalid.");
        if (op.quoteBlock !== undefined && (!isPlainRecord(op.quoteBlock) || !exactKeys(op.quoteBlock, ["number", "hash"]) ||
            uint(op.quoteBlock.number) < 0n || !/^0x[a-f0-9]{64}$/u.test(op.quoteBlock.hash))) corrupt("Uniswap token quote block is invalid."); }
    const evidence = op.cleanupEvidence ?? null, failure = op.preSignFailure ?? null;
    const approvalStarted = ["approval_submission_started", "approval_submitted", "approval_unknown_finality"].includes(op.phase) || op.approvalAttempt !== null, swapStarted = ["submission_started", "submitted", "unknown_finality", "observed"].includes(op.phase), cleanupStarted = ["cleanup_submission_started", "cleanup_submitted", "cleanup_unknown_finality"].includes(op.phase) || op.phase === "cleaned" && evidence === null;
    if (approvalStarted && op.allowanceAtPrepare === "0" && op.approvalAttempt === null || swapStarted && op.swapAttempt === null || cleanupStarted && op.cleanupAttempt === null)
        corrupt("Uniswap token attempt binding is invalid.");
    const hashes = [op.approvalAttempt, op.swapAttempt, op.cleanupAttempt].some((row) => row?.transactionHash !== null && row?.transactionHash !== undefined);
    if (evidence?.kind === "zero_allowance_no_effect" && (op.phase !== "cleanup_required" && op.phase !== "cleaned" || op.cleanupReason !== "zero_allowance_no_effect" ||
        op.accumulatedNativeDebitWei !== "0" || hashes || op.phase === "cleaned" && op.usageState !== "failed_before_effect" &&
        // A freed swap marker keeps the hold until the chain proves its nonce (the principal release).
        !(op.usageState === "reserved" && op.freedSwapMarkers !== undefined) &&
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
    if (failure !== null && !PRE_SIGN_DIAGNOSTIC_PHASES.includes(op.phase)) corrupt("Uniswap token pre-sign diagnostic phase is invalid.");
    if (op.cleanupFeeQuote !== undefined) validateCleanupFeeQuote(op);
    if (op.principalRelease !== undefined) validatePrincipalRelease(op);
    if (op.phase === "observed" && op.receipt === null || op.phase !== "observed" && op.receipt !== null)
        corrupt("Uniswap token receipt phase is invalid.");
    if (op.receipt !== null)
        validateReceipt(op.receipt, op);
    return op;
}
/** Every phase of a Uniswap token swap; `observed` and `cleaned` are its outcomes (nothing of it signs, sends or lands after them). */
export const UNISWAP_TOKEN_TERMINAL_PHASES: readonly UniswapTokenPhase[] = ["observed", "cleaned", "abandoned_unknown"];
export const UNISWAP_TOKEN_PHASES: readonly UniswapTokenPhase[] = ["prepared", "approved", "approval_submission_started", "approval_submitted", "approval_unknown_finality",
    "approval_observed", "submission_started", "submitted", "unknown_finality", "observed", "cleanup_required", "cleanup_submission_started",
    "cleanup_submitted", "cleanup_unknown_finality", "cleaned", "abandoned_unknown"];
const PRE_SIGN_DIAGNOSTIC_PHASES: readonly UniswapTokenPhase[] = ["cleanup_required", "cleanup_submission_started", "cleanup_submitted",
    "cleanup_unknown_finality", "cleaned", "abandoned_unknown"];
/** The round of an effect slot: how many attempts of that kind were retired before it. Round 0 keeps the original keys. */
export function tokenEffectRound(op: Pick<UniswapTokenOperation, "retiredEffects">, kind: "approval" | "swap" | "cleanup"): number {
    return (op.retiredEffects ?? []).filter((row) => row.kind === kind).length;
}
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
    /** Lock-free read without creating the state root (the operation index's reader). */
    async read(id: string) { stateIdentifier(id, "Uniswap token operation"); const v = await this.readJson(this.path(id)); return v === null ? null : validateUniswapTokenOperation(v); }
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
function validateRetired(rows: readonly UniswapTokenRetiredEffect[], updatedAt: string) {
    if (!Array.isArray(rows) || rows.length < 1 || rows.length > 8) corrupt("Uniswap token retired effects are invalid.");
    for (const value of rows as readonly unknown[]) {
        if (!isPlainRecord(value) || !exactKeys(value, ["kind", "attempt", "reason", "finalizedNonceAtomic", "observedAt"])) corrupt("Uniswap token retired effect is invalid.");
        const row = value as unknown as UniswapTokenRetiredEffect;
        if (
            !["approval", "swap", "cleanup"].includes(row.kind) || !["never_landed", "reverted", "landed_allowance_nonzero"].includes(row.reason) ||
            !canonicalInstant(row.observedAt) || row.observedAt > updatedAt) corrupt("Uniswap token retired effect is invalid.");
        attempt(row.attempt);
        if (row.attempt.transactionHash === null || (row.reason === "never_landed"
            ? typeof row.finalizedNonceAtomic !== "string" || uint(row.finalizedNonceAtomic) <= uint(row.attempt.nonce)
            : row.kind !== "cleanup" || row.finalizedNonceAtomic !== null)) corrupt("Uniswap token retired effect is invalid.");
    }
}
function validateCleanupEvidence(v: UniswapTokenCleanupEvidence | UniswapTokenExpiredApprovalEvidence | UniswapTokenZeroAllowanceEvidence | null | undefined) { if (v === null) return;
    if (isPlainRecord(v) && v.kind === "zero_allowance_after_effect") {
      if (!exactKeys(v, ["schemaVersion", "kind", "observedAllowanceAtomic", "observedAt"]) || v.schemaVersion !== "apn.uniswap-token-zero-allowance-evidence.v1" ||
          v.observedAllowanceAtomic !== "0" || !canonicalInstant(v.observedAt as string)) corrupt("Uniswap token zero allowance evidence is invalid.");
      return;
    }
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
/** The nonces of the swap markers custody freed and of `kept` (a hashless marker the record still holds), ascending and distinct. */
export function swapMarkerNonces(op: Pick<UniswapTokenOperation, "freedSwapMarkers">, kept: UniswapTokenAttempt | null): readonly string[] {
    const nonces = [...(op.freedSwapMarkers ?? []), ...(kept === null ? [] : [kept])].map((row) => BigInt(row.nonce));
    return [...new Set(nonces)].sort((a, b) => a < b ? -1 : a > b ? 1 : 0).map(String);
}
/** A cleanup of this operation that landed (current, or retired after landing) and so consumed its nonce. */
export function landedTokenCleanups(op: Pick<UniswapTokenOperation, "cleanupAttempt" | "retiredEffects">): readonly UniswapTokenAttempt[] {
    return [...(op.cleanupAttempt?.transactionHash != null ? [op.cleanupAttempt] : []),
        ...(op.retiredEffects ?? []).filter((row) => row.kind === "cleanup" && row.reason !== "never_landed").map((row) => row.attempt)];
}
function validatePrincipalRelease(op: UniswapTokenOperation) { const v = op.principalRelease as unknown;
    if (op.phase !== "cleaned" && op.phase !== "abandoned_unknown" || op.receipt !== null || !["reserved", "failed_before_effect"].includes(op.usageState ?? "") ||
        (op.retiredEffects ?? []).some((row) => row.kind === "swap") || !isPlainRecord(v) || v.schemaVersion !== "apn.uniswap-token-principal-release.v1" ||
        typeof v.observedAt !== "string" || !canonicalInstant(v.observedAt) || v.observedAt > op.updatedAt) corrupt("Uniswap token principal release is invalid.");
    // An owner-abandoned swap keeps its hashless marker as history; the release names the marker custody proved unsigned.
    const marker = op.phase === "abandoned_unknown" ? op.swapAttempt : null, proof = Object.hasOwn(v, "chainProof") ? ["chainProof"] : [];
    if (v.kind === "swap_never_signed") { if (marker === null ? !exactKeys(v, ["schemaVersion", "kind", ...proof, "observedAt"]) || op.swapAttempt !== null
        : !exactKeys(v, ["schemaVersion", "kind", "swapNonce", "swapMarkerHash", ...proof, "observedAt"]) || marker.transactionHash !== null ||
          v.swapNonce !== marker.nonce || v.swapMarkerHash !== marker.markerHash) corrupt("Uniswap token principal release is invalid.");
        validateSwapNonceProof(op, v.chainProof, swapMarkerNonces(op, marker)); return; }
    if (op.phase !== "cleaned") corrupt("Uniswap token principal release is invalid.");
    validateSwapNonceProof(op, v.chainProof, swapMarkerNonces(op, null));
    const swap = op.swapAttempt, cleanup = landedTokenCleanups(op).find((row) => row.transactionHash === v.cleanupTransactionHash);
    if (v.kind !== "swap_nonce_consumed_by_cleanup" || !exactKeys(v, ["schemaVersion", "kind", "swapNonce", "cleanupTransactionHash", "cleanupBlockNumber",
        "cleanupBlockHash", "finalizedBlockNumber", "finalizedNonce", ...proof, "observedAt"]) || swap === null || swap.transactionHash !== null ||
        cleanup === undefined || cleanup.nonce !== swap.nonce || v.swapNonce !== swap.nonce || typeof v.cleanupBlockHash !== "string" ||
        !/^0x[a-f0-9]{64}$/u.test(v.cleanupBlockHash) || uint(v.finalizedBlockNumber) < uint(v.cleanupBlockNumber) || uint(v.finalizedNonce) <= uint(v.swapNonce))
        corrupt("Uniswap token principal release is invalid."); }
/** The chain proof over `nonces` (required once custody freed a swap marker); each nonce held by a landed cleanup or unused past the deadline. */
function validateSwapNonceProof(op: UniswapTokenOperation, value: unknown, nonces: readonly string[]) {
    if (value === undefined) { if (op.freedSwapMarkers !== undefined) corrupt("Uniswap token swap nonce proof is missing."); return; }
    const hash = (v: unknown) => typeof v === "string" && /^0x[a-f0-9]{64}$/u.test(v), landed = landedTokenCleanups(op), held = new Set<string>();
    if (nonces.length === 0 || !isPlainRecord(value) || !exactKeys(value, ["swapNonces", "cleanups", "unused"]) ||
        canonicalJson(value.swapNonces) !== canonicalJson(nonces) || !Array.isArray(value.cleanups)) corrupt("Uniswap token swap nonce proof is invalid.");
    for (const row of value.cleanups as readonly unknown[]) {
        if (!isPlainRecord(row) || !exactKeys(row, ["swapNonce", "cleanupTransactionHash", "cleanupBlockNumber", "cleanupBlockHash", "finalizedBlockNumber",
            "finalizedNonce"]) || !nonces.includes(row.swapNonce as string) || held.has(row.swapNonce as string) || !hash(row.cleanupBlockHash) ||
            !landed.some((cleanup) => cleanup.transactionHash === row.cleanupTransactionHash && cleanup.nonce === row.swapNonce) ||
            uint(row.finalizedBlockNumber) < uint(row.cleanupBlockNumber) || uint(row.finalizedNonce) <= uint(row.swapNonce))
            corrupt("Uniswap token swap nonce proof is invalid.");
        held.add(row.swapNonce as string);
    }
    const open = nonces.filter((nonce) => !held.has(nonce)), unused = value.unused;
    if (open.length === 0 ? unused !== null : !isPlainRecord(unused) || !exactKeys(unused, ["fromNonce", "finalizedNonce", "finalizedBlockNumber",
        "finalizedBlockHash", "finalizedBlockTimestamp"]) || unused.fromNonce !== open[0] || uint(unused.finalizedNonce) > uint(open[0]) ||
        uint(unused.finalizedBlockNumber) < 0n || !hash(unused.finalizedBlockHash) || uint(unused.finalizedBlockTimestamp) <= BigInt(op.route.deadline))
        corrupt("Uniswap token swap nonce proof is invalid.");
}
function validateCleanupFeeQuote(op: UniswapTokenOperation) { const q = op.cleanupFeeQuote as unknown;
    if (!PRE_SIGN_DIAGNOSTIC_PHASES.includes(op.phase) || !isPlainRecord(q) || !exactKeys(q, ["schemaVersion", "blockNumber", "blockHash", "baseFeePerGasWei",
        "priorityFeePerGasWei", "previousCleanupGas", "previousMaximumNativeDebitWei", "quotedAt"]) || q.schemaVersion !== "apn.uniswap-token-cleanup-fee-quote.v1" ||
        !/^0x[a-f0-9]{64}$/u.test(q.blockHash as string) || !canonicalInstant(q.quotedAt as string) || (q.quotedAt as string) > op.updatedAt)
        corrupt("Uniswap token cleanup fee quote is invalid.");
    uint(q.blockNumber); uint(q.baseFeePerGasWei); uint(q.priorityFeePerGasWei); validateGas(q.previousCleanupGas);
    if ((q.previousCleanupGas as TokenGasEnvelope).gasLimit !== op.cleanupGas.gasLimit || uint(q.previousMaximumNativeDebitWei) > uint(op.maximumNativeDebitWei))
        corrupt("Uniswap token cleanup fee quote is invalid."); }
function validateFailureDiagnostic(v: UniswapTokenFailureDiagnostic | null | undefined) { if (v === null) return;
    if (!isPlainRecord(v) || !exactKeys(v, ["code", "reason", "rpcMethod", "endpointRole", "phase"]) || !UNISWAP_TOKEN_PHASES.includes(v.phase as UniswapTokenPhase) ||
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
