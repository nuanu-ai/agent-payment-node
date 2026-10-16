import { type MetaMaskNativeDeadline, type MetaMaskNativeDiagnostic } from "./metamask-native-diagnostic.js";
import { type AssetUsageReservation } from "./asset-usage-ledger.js";
import type { OperationAbandonIntent } from "./operation-abandon-approval.js";
import { type MetaMaskNativeFeeQuote } from "./metamask-native-fee-evidence.js";
import { type MetaMaskNativeReadObservation } from "./metamask-native-transfer-adapter.js";
export declare const METAMASK_NATIVE_OWNER_PROFILE: "metamask-live-v042";
export declare const METAMASK_NATIVE_OWNER_ADDRESS: "0xf41170df51aab52aaa04fbc3ff325cf051644aca";
declare const scopeBrand: unique symbol;
export interface MetaMaskNativeOwnedScope {
    readonly [scopeBrand]: true;
}
export interface MetaMaskNativeOwnedContext {
    readonly stateRoot: string;
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
/** Claim is deliberately synchronous: no second SDK action can claim the same foreground consent. */
export declare function claimMetaMaskNativeOwnedScope(scope: MetaMaskNativeOwnedScope, context: MetaMaskNativeOwnedContext): void;
export declare function assertMetaMaskNativeOwnedScope(scope: MetaMaskNativeOwnedScope, context: MetaMaskNativeOwnedContext): MetaMaskNativeDeadline;
/** Static owner guard, never a caller supplied callback. Adapter must invoke this after every awaited seam. */
export declare function assertMetaMaskNativeOwnedContextCurrent(scope: MetaMaskNativeOwnedScope, context: MetaMaskNativeOwnedContext): Promise<void>;
/** Read-only central conflict guard. No namespace creation, caller skip ID or financial proof DTO. */
export declare function assertMetaMaskNativeConflictDomainAvailable(stateRoot: string, chainId: number | string, account: string): Promise<void>;
/** Exact own-journal exclusion is available only to a currently claimed foreground owner scope. */
export declare function assertMetaMaskNativeOwnedConflictDomainAvailable(scope: MetaMaskNativeOwnedScope, context: MetaMaskNativeOwnedContext): Promise<void>;
/** Normal finite command owner. No injected provider, terminal, scope issuer or arbitrary effect is accepted. */
export declare function runFixedMetaMaskNativeTransfer(stateRoot: string, chainInput: number, keyInput: string, profileInput?: string): Promise<{
    receipt?: import("./metamask-native-fee-evidence.js").MetaMaskNativeFeeReceiptVerdict;
    diagnostic?: MetaMaskNativeDiagnostic;
    operation_id: string;
    state: string;
    chain_id: 1 | 10 | 59144 | 143 | 1329;
    profile: string;
    sender: `0x${string}`;
    seller: "0x991e254b5c8e0aaf6c244eaa2706bad059809b04";
    token: `0x${string}`;
    usdc_atomic: string;
    maximum_native_fee_atomic: string;
    transaction_hash: `0x${string}` | null;
    effect_attempts: 0 | 1;
    proof_class: string;
}>;
export declare function readFixedMetaMaskNativeTransfer(stateRoot: string, idInput: string, observe?: boolean): Promise<{
    read_observation?: MetaMaskNativeReadObservation;
    receipt?: import("./metamask-native-fee-evidence.js").MetaMaskNativeFeeReceiptVerdict;
    diagnostic?: MetaMaskNativeDiagnostic;
    operation_id: string;
    state: string;
    chain_id: 1 | 10 | 59144 | 143 | 1329;
    profile: string;
    sender: `0x${string}`;
    seller: "0x991e254b5c8e0aaf6c244eaa2706bad059809b04";
    token: `0x${string}`;
    usdc_atomic: string;
    maximum_native_fee_atomic: string;
    transaction_hash: `0x${string}` | null;
    effect_attempts: 0 | 1;
    proof_class: string;
}>;
export declare function metaMaskNativeOperationExists(stateRoot: string, id: string): Promise<boolean>;
/**
 * Owner release (R4) of a native transfer whose outcome stayed unknown after its quote expired. It observes once,
 * never sends, keeps the stored transaction hash or request id, and leaves the held usage consumed.
 */
export declare function abandonFixedMetaMaskNativeTransfer(stateRoot: string, idInput: string, approve: (intent: OperationAbandonIntent) => Promise<void>, now: () => Date): Promise<{
    receipt?: import("./metamask-native-fee-evidence.js").MetaMaskNativeFeeReceiptVerdict;
    diagnostic?: MetaMaskNativeDiagnostic;
    operation_id: string;
    state: string;
    chain_id: 1 | 10 | 59144 | 143 | 1329;
    profile: string;
    sender: `0x${string}`;
    seller: "0x991e254b5c8e0aaf6c244eaa2706bad059809b04";
    token: `0x${string}`;
    usdc_atomic: string;
    maximum_native_fee_atomic: string;
    transaction_hash: `0x${string}` | null;
    effect_attempts: 0 | 1;
    proof_class: string;
}>;
/** Durable, read-only proof extraction for the common ledger; accepts no DTO as permission. */
export declare function readMetaMaskNativeSettlement(stateRoot: string, id: string): Promise<{
    operationId: string;
    policyDigest: string;
    reservations: readonly AssetUsageReservation[];
    receipt: import("./metamask-native-fee-evidence.js").MetaMaskNativeFeeReceiptVerdict;
    proof: {
        kind: "metamask_native_actual_fee";
        operationId: string;
        quoteHash: string;
        receiptHash: string;
        actualFee: string;
        reservedFee: string;
    };
}>;
/** Existing normal journal only; no caller quote, policy or approval is admitted. */
export declare function readMetaMaskNativeReservation(stateRoot: string, id: string): Promise<{
    operationId: string;
    quote: MetaMaskNativeFeeQuote;
    registry: import("./asset-policy-registry.js").AssetPolicyRegistry;
}>;
export declare function assertMetaMaskNativeFailedBeforeEffect(stateRoot: string, id: string): Promise<void>;
/** Existing-only durable guard also protects a hold whose public marker was removed. */
export declare function assertMetaMaskNativeGenericCapacityRelease(stateRoot: string, value: AssetUsageReservation): Promise<void>;
export {};
