import { SecureStateStore } from "./secure-state-store.js";
import { StateStore } from "./state.js";
import { type ActiveAssetPolicy } from "./allowlist-active-policy.js";
import { type AssetUsageReservation } from "./asset-usage-ledger.js";
import { validateProviderProfile } from "./provider-profile.js";
import { type MetaMaskNativeDiagnostic } from "./metamask-native-diagnostic.js";
import { type ProviderRequestReferenceBinding } from "./provider-request-reference-store.js";
import type { MetaMaskMfaNotice } from "./metamask-process-output.js";
import { type MetaMaskNativeFeeQuote, type MetaMaskNativeFeeReceiptEvidence } from "./metamask-native-fee-evidence.js";
declare const V1 = "apn.metamask-native-operation.v1", V2 = "apn.metamask-native-operation.v2";
/** Outcomes after which a native transfer can no longer sign, hand off or land. */
export declare const METAMASK_NATIVE_RESOLVED_STATES: readonly string[];
/** Every state a native transfer journal may hold. */
export declare const METAMASK_NATIVE_STATES: readonly ["prepared", "failed_before_effect", "effect_started", "acknowledged", "unknown", "confirmed", "abandoned_unknown"];
declare const STATES: readonly ["prepared", "failed_before_effect", "effect_started", "acknowledged", "unknown", "confirmed", "abandoned_unknown"];
/**
 * The immutable owner context of one native transfer. Version 2 names no APN home path, so moving or renaming the home
 * never voids a journal; the in-process owner scope carries the root it runs under.
 */
export interface MetaMaskNativeOwnedContext {
    readonly profile: string;
    readonly profileHash: string;
    readonly accountBindingHash: string;
    readonly capabilityHash: string;
    readonly profileRevision: number;
    readonly policyDigest: string;
    readonly policyRevision: number;
    readonly activationDigest: string;
    readonly vendorPolicyHash: string;
    readonly vendorProjectHash: string;
    readonly quote: MetaMaskNativeFeeQuote;
    readonly operationId: string;
    readonly consentExpiresAt: string;
    readonly issuedDay: string;
}
/** A version 1 context also names the absolute home it was written under; it is kept as written and never compared (R2). */
type StoredContext = MetaMaskNativeOwnedContext & {
    readonly stateRoot?: string;
};
export type MetaMaskNativeState = typeof STATES[number];
export interface MetaMaskNativeOperation {
    readonly schemaVersion: typeof V1 | typeof V2;
    readonly operationId: string;
    readonly requestHash: string;
    readonly context: StoredContext;
    readonly reservations: readonly AssetUsageReservation[];
    readonly state: MetaMaskNativeState;
    readonly effectAttempts: 0 | 1;
    readonly transactionHash: `0x${string}` | null;
    /** The MetaMask request id itself, as every release up to 0.5.106 kept it; null in a record that seals it. */
    readonly providerRequestId: string | null;
    /**
     * In a record a later release wrote, the hash of the MetaMask request id (metaMaskNativeRequestIdHash), whose id is
     * sealed apart under the Keychain wrapping secret (provider-request-reference-store.ts); providerRequestId is then
     * null. Absent from a record that holds no request and from every record 0.5.106 or earlier wrote.
     */
    readonly providerRequestIdHash?: string;
    /**
     * How the request left, in a record 0.5.108 or later wrote: `sdk_helper`, APN named the request id itself, sealed it and
     * wrote this effect marker with its hash before the sandboxed MetaMask helper sent it; mm's local request list never
     * holds it, so it is read from MetaMask's server by its id. Absent from every earlier record, whose request was handed
     * to `mm wallet send-transaction` and is read with `mm wallet requests watch` first.
     */
    readonly handoffPath?: typeof METAMASK_NATIVE_SDK_HANDOFF;
    /**
     * Why a record a later release wrote keeps no request although the hand-off returned one: the id could not be sealed
     * after the hand-off, so it was dropped, never kept in plaintext. Everything else the hand-off returned is kept.
     */
    readonly providerRequestReason?: typeof METAMASK_NATIVE_REQUEST_UNSEALED;
    readonly receiptEvidence: MetaMaskNativeFeeReceiptEvidence | null;
    readonly createdAt: string;
    readonly updatedAt: string;
    readonly diagnostic?: MetaMaskNativeDiagnostic;
    readonly mfaTask?: MetaMaskNativeMfaTask;
    readonly recordHash: string;
}
export declare const METAMASK_NATIVE_OPERATION_SCHEMA = "apn.metamask-native-operation.v2";
/** The only `providerRequestReason`: the hand-off of a 0.5.107 record returned a request id that could not be sealed. */
export declare const METAMASK_NATIVE_REQUEST_UNSEALED = "provider_request_reference_unsealed";
/** The only `handoffPath`: the request APN named, sealed and journaled before the sandboxed helper sent it (0.5.108+). */
export declare const METAMASK_NATIVE_SDK_HANDOFF = "sdk_helper";
/**
 * The owner's MetaMask approval this transfer waits on: a verified AWAITING_MFA notice (or request status) for its own
 * stored request, from the hand-off (`send`) or a no-send read (`watch`: `mm wallet requests watch`, or MetaMask's server
 * answer when mm's local request list no longer held the request); `evidenceHash` is the SHA-256 of that vendor output.
 * Metadata only, kept apart from the financial state: it is never a payment, an outcome or a reason to release a hold,
 * and it goes when a transaction hash or the provider's own record shows the request past the approval. It names the
 * request as its record does: by the id itself in a record 0.5.106 or earlier wrote, by the id's hash in one that seals it.
 */
interface MfaTaskFields {
    readonly expiresAt: string | null;
    readonly authMethod: string | null;
    readonly observedAt: string;
    readonly source: "send" | "watch";
    readonly evidenceHash: string;
}
export interface MetaMaskNativeMfaTaskWithId extends MfaTaskFields {
    readonly requestId: string;
}
export interface MetaMaskNativeMfaTaskWithHash extends MfaTaskFields {
    readonly requestIdHash: string;
}
export type MetaMaskNativeMfaTask = MetaMaskNativeMfaTaskWithId | MetaMaskNativeMfaTaskWithHash;
type MfaEvidence = MetaMaskMfaNotice & {
    readonly evidenceHash: string;
};
/** The task of a record that keeps the request id itself (one 0.5.106 or earlier wrote). */
export declare function metaMaskNativeMfaTask(requestId: string, evidence: MfaEvidence, source: MfaTaskFields["source"], now?: Date): MetaMaskNativeMfaTaskWithId;
/** The task of a record that seals its request id: it names only the id's hash, as the record does. */
export declare function metaMaskNativeSealedMfaTask(requestIdHash: string, evidence: MfaEvidence, source: MfaTaskFields["source"], now?: Date): MetaMaskNativeMfaTaskWithHash;
/**
 * A transfer whose foreground command ended before its effect marker (still `prepared`: nothing was handed off or signed)
 * and whose consent deadline has passed (plus the unstarted margin) can never start: the hand-off needs that consent.
 */
export declare function metaMaskNativeExpiredBeforeEffect(op: Pick<MetaMaskNativeOperation, "state" | "effectAttempts" | "context">, now?: number): boolean;
/** The family's own terminal rule: a resolved outcome, or a transfer that can never start (closed at its next read). */
export declare function metaMaskNativeResolved(op: Pick<MetaMaskNativeOperation, "state" | "effectAttempts" | "context">, now?: number): boolean;
export declare class MetaMaskNativeJournal extends SecureStateStore {
    read(id: string): Promise<MetaMaskNativeOperation | null>;
    private all;
    /** Any other unresolved native transfer of this account and chain, signed or not, holds a new one back. */
    assertAccountAvailable(chainId: number, account: string, exceptId: string): Promise<void>;
    /** Every native transfer of this account and chain. */
    forAccount(chainId: number, account: string): Promise<readonly MetaMaskNativeOperation[]>;
    matchingHold(reservation: AssetUsageReservation): Promise<MetaMaskNativeOperation | null>;
    persist(body: Omit<MetaMaskNativeOperation, "recordHash">): Promise<MetaMaskNativeOperation>;
}
/** The idempotency fingerprint of a request. Version 1 requests named no recipient or amount; their quote fixes both. */
export declare function metaMaskNativeRequestHash(request: {
    readonly chainId: number;
    readonly key: string;
    readonly profile: string;
    readonly recipient: string;
    readonly amountAtomic: string;
}): string;
export declare function metaMaskNativeRequestMatches(op: MetaMaskNativeOperation, request: Parameters<typeof metaMaskNativeRequestHash>[0]): boolean;
/** A field given as undefined (the MFA task once the request is past it) leaves the record. */
export declare function patchMetaMaskNativeOperation(op: MetaMaskNativeOperation, fields: Partial<Omit<MetaMaskNativeOperation, "mfaTask">> & {
    readonly mfaTask?: MetaMaskNativeMfaTask | undefined;
}): Omit<MetaMaskNativeOperation, "recordHash">;
/** The family's own no-send observer: it reads the stored request or transaction and never signs or sends again. */
export declare const metaMaskNativeObserveCommand: (id: string) => string;
/** The hash a record that seals its MetaMask request id keeps in its place (the same hash a direct transfer shows). */
export declare const metaMaskNativeRequestIdHash: (requestId: string) => string;
/** The sealed request id of `op` lives under this binding (provider-request-reference-store.ts). */
export declare function metaMaskNativeRequestReference(op: Pick<MetaMaskNativeOperation, "operationId" | "context">, requestIdHash: string): ProviderRequestReferenceBinding;
/** Whether the record stores a MetaMask request to observe: the id itself (0.5.106 and earlier) or the hash of a sealed one. */
export declare function metaMaskNativeHasRequest(o: Pick<MetaMaskNativeOperation, "providerRequestId" | "providerRequestIdHash">): boolean;
/**
 * How output names the request: `request MetaMask-id` for a record that keeps the id, the APN operation (which the
 * MetaMask request's intent names) for one that seals it.
 */
export declare function metaMaskNativeRequestLabel(o: Pick<MetaMaskNativeOperation, "operationId" | "providerRequestId">): string;
export declare function publicMetaMaskNativeOperation(o: MetaMaskNativeOperation, now?: Date): {
    next_actions: string[];
    mfa_task?: never;
    receipt?: import("./metamask-native-fee-evidence.js").MetaMaskNativeFeeReceiptVerdict;
    provider_request_reason?: "provider_request_reference_unsealed";
    diagnostic?: MetaMaskNativeDiagnostic;
    operation_id: string;
    state: string;
    chain_id: 1 | 10 | 59144 | 143 | 1329;
    profile: string;
    sender: `0x${string}`;
    recipient: `0x${string}`;
    token: `0x${string}`;
    usdc_atomic: string;
    usdc: string;
    maximum_native_fee_atomic: string;
    transaction_hash: `0x${string}` | null;
    effect_attempts: 0 | 1;
    proof_class: string;
} | {
    next_actions: string[];
    mfa_task: {
        auth_method: string | null;
        expires_at: string | null;
        observed_at: string;
        source: "send" | "watch";
        evidence_hash: string;
        owner_action: string;
        observe_command: string;
        request_id: string;
        request_id_hash?: never;
        status: string;
        provider: string;
        provider_state: string;
    } | {
        auth_method: string | null;
        expires_at: string | null;
        observed_at: string;
        source: "send" | "watch";
        evidence_hash: string;
        owner_action: string;
        observe_command: string;
        request_id_hash: string;
        request_id?: never;
        status: string;
        provider: string;
        provider_state: string;
    };
    receipt?: import("./metamask-native-fee-evidence.js").MetaMaskNativeFeeReceiptVerdict;
    provider_request_reason?: "provider_request_reference_unsealed";
    diagnostic?: MetaMaskNativeDiagnostic;
    operation_id: string;
    state: string;
    chain_id: 1 | 10 | 59144 | 143 | 1329;
    profile: string;
    sender: `0x${string}`;
    recipient: `0x${string}`;
    token: `0x${string}`;
    usdc_atomic: string;
    usdc: string;
    maximum_native_fee_atomic: string;
    transaction_hash: `0x${string}` | null;
    effect_attempts: 0 | 1;
    proof_class: string;
};
export declare function metaMaskNativeOperationExists(stateRoot: string, id: string): Promise<boolean>;
/** Durable, read-only proof extraction for the common ledger; accepts no DTO as permission. */
export declare function readMetaMaskNativeSettlement(stateRoot: string, id: string): Promise<{
    operationId: string;
    policyDigest: string;
    reservations: readonly AssetUsageReservation[];
    receipt: import("./metamask-native-fee-evidence.js").MetaMaskNativeFeeReceiptVerdict;
    tokenAmountAtomic: string;
    proof: {
        kind: "metamask_native_actual_fee";
        operationId: string;
        quoteHash: string;
        receiptHash: string;
        actualFee: string;
        reservedFee: string;
    };
}>;
export declare function assertMetaMaskNativeFailedBeforeEffect(stateRoot: string, id: string): Promise<void>;
/** Existing-only durable guard also protects a hold whose public marker was removed. */
export declare function assertMetaMaskNativeGenericCapacityRelease(stateRoot: string, value: AssetUsageReservation): Promise<void>;
/** The profile's bound MetaMask provider custody and its active owner policy, whose EVM account must be that custody. */
export declare function loadMetaMaskNativeOwner(state: StateStore, profileName: string): Promise<{
    profile: ReturnType<typeof validateProviderProfile>;
    policy: ActiveAssetPolicy;
}>;
/** Existing normal journal only; no caller quote, policy or approval is admitted. The reservation re-checks the recipient pin. */
export declare function readMetaMaskNativeReservation(stateRoot: string, id: string): Promise<{
    operationId: string;
    quote: MetaMaskNativeFeeQuote;
    registry: import("./asset-policy-registry.js").AssetPolicyRegistry;
    tokenAmountAtomic: string;
}>;
export {};
