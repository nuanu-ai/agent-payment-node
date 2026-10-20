import { SecureStateStore } from "./secure-state-store.js";
import { StateStore } from "./state.js";
import { type ActiveAssetPolicy } from "./allowlist-active-policy.js";
import { type AssetUsageReservation } from "./asset-usage-ledger.js";
import { validateProviderProfile } from "./provider-profile.js";
import { type MetaMaskNativeDiagnostic } from "./metamask-native-diagnostic.js";
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
    readonly providerRequestId: string | null;
    readonly receiptEvidence: MetaMaskNativeFeeReceiptEvidence | null;
    readonly createdAt: string;
    readonly updatedAt: string;
    readonly diagnostic?: MetaMaskNativeDiagnostic;
    readonly mfaTask?: MetaMaskNativeMfaTask;
    readonly recordHash: string;
}
export declare const METAMASK_NATIVE_OPERATION_SCHEMA = "apn.metamask-native-operation.v2";
/**
 * The owner's MetaMask approval this transfer waits on: a verified AWAITING_MFA notice (or request status) for its own
 * stored request, from the hand-off (`send`) or a no-send watch (`watch`); `evidenceHash` is the SHA-256 of that vendor
 * output. Metadata only, kept apart from the financial state: it is never a payment, an outcome or a reason to release a
 * hold, and it goes when a transaction hash or the provider's own record shows the request past the approval.
 */
export interface MetaMaskNativeMfaTask {
    readonly requestId: string;
    readonly expiresAt: string | null;
    readonly authMethod: string | null;
    readonly observedAt: string;
    readonly source: "send" | "watch";
    readonly evidenceHash: string;
}
export declare function metaMaskNativeMfaTask(requestId: string, evidence: MetaMaskMfaNotice & {
    readonly evidenceHash: string;
}, source: MetaMaskNativeMfaTask["source"], now?: Date): MetaMaskNativeMfaTask;
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
export declare function publicMetaMaskNativeOperation(o: MetaMaskNativeOperation, now?: Date): {
    next_actions: string[];
    mfa_task?: never;
    receipt?: import("./metamask-native-fee-evidence.js").MetaMaskNativeFeeReceiptVerdict;
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
        status: string;
        provider: string;
        provider_state: string;
        request_id: string;
        auth_method: string | null;
        expires_at: string | null;
        observed_at: string;
        source: "send" | "watch";
        evidence_hash: string;
        owner_action: string;
        observe_command: string;
    };
    receipt?: import("./metamask-native-fee-evidence.js").MetaMaskNativeFeeReceiptVerdict;
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
