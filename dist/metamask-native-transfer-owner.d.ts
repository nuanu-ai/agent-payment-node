import { type MetaMaskNativeDeadline, type MetaMaskNativeDiagnostic } from "./metamask-native-diagnostic.js";
import type { OperationAbandonIntent } from "./operation-abandon-approval.js";
import { type MetaMaskNativeReadObservation } from "./metamask-native-transfer-adapter.js";
import { type MetaMaskNativeOwnedContext } from "./metamask-native-journal.js";
export type { MetaMaskNativeOwnedContext } from "./metamask-native-journal.js";
/** Journal readers, also reachable here for callers that name the command module. */
export { readMetaMaskNativeSettlement, readMetaMaskNativeReservation, assertMetaMaskNativeFailedBeforeEffect, assertMetaMaskNativeGenericCapacityRelease, metaMaskNativeOperationExists } from "./metamask-native-journal.js";
/** One guarded USDC transfer from the profile's MetaMask Agent Wallet; every field is the caller's explicit input. */
export interface MetaMaskNativeTransferInput {
    readonly profile: string;
    readonly chainId: number;
    readonly recipient: string;
    readonly amountAtomic: string;
    readonly idempotencyKey: string;
}
declare const scopeBrand: unique symbol;
export interface MetaMaskNativeOwnedScope {
    readonly [scopeBrand]: true;
}
/** Claim is deliberately synchronous: no second SDK action can claim the same foreground consent. */
export declare function claimMetaMaskNativeOwnedScope(scope: MetaMaskNativeOwnedScope, context: MetaMaskNativeOwnedContext): void;
export declare function assertMetaMaskNativeOwnedScope(scope: MetaMaskNativeOwnedScope, context: MetaMaskNativeOwnedContext): MetaMaskNativeDeadline;
/** The last guard before the hand-off, never a caller supplied callback: local custody, the vendor Guard policy, funds and nonce. */
export declare function assertMetaMaskNativeOwnedContextCurrent(scope: MetaMaskNativeOwnedScope, context: MetaMaskNativeOwnedContext): Promise<void>;
/** One foreground command: admission, vendor Guard check, quote, consent, the single hand-off and its durable outcome. */
export declare function runMetaMaskNativeTransfer(stateRoot: string, input: MetaMaskNativeTransferInput): Promise<{
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
}>;
/**
 * Before a new transfer is admitted, every transfer of this account and chain that can never start is closed under its
 * own operation lock. Best effort: one that cannot be closed now no longer blocks (the family's own rule reads it as
 * resolved), and its next status closes it.
 */
export declare function closeExpiredNativeTransfersOf(stateRoot: string, chainId: number, payer: string): Promise<void>;
export declare function readMetaMaskNativeTransfer(stateRoot: string, idInput: string, observe?: boolean): Promise<{
    read_observation?: MetaMaskNativeReadObservation;
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
}>;
/**
 * Owner release (R4) of a native transfer whose outcome stayed unknown after its quote expired. It observes once,
 * never sends, keeps the stored transaction hash or request id, and leaves the held usage consumed. A transfer that
 * never reached its effect marker and whose consent has passed is closed as failed before effect instead (no consent).
 */
export declare function abandonMetaMaskNativeTransfer(stateRoot: string, idInput: string, approve: (intent: OperationAbandonIntent) => Promise<void>, now: () => Date): Promise<{
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
}>;
