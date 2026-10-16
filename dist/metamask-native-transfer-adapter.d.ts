import { type Address } from "viem";
import { type MetaMaskNativeDeadlineInput, type MetaMaskNativeDiagnostic } from "./metamask-native-diagnostic.js";
import type { Hex } from "./model.js";
import { type MetaMaskNativeFeeChainId } from "./metamask-native-fee-evidence.js";
import { type MetaMaskNativeOwnedScope, type MetaMaskNativeOwnedContext } from "./metamask-native-transfer-owner.js";
/** What the vendor CLI reported for the selected wallet; `vendorPolicyHash` pins the policy bytes between prepare and send. */
export interface MetaMaskNativeVendorPolicy {
    readonly selectedAddress: Address;
    readonly vendorProjectHash: string;
    readonly vendorPolicyHash: string;
    readonly tradingMode: "guard";
    readonly outflowLimitsUsd: Readonly<Record<string, string>>;
    readonly observedAt: string;
}
export type MetaMaskNativeSubmission = ({
    readonly disposition: "acknowledged";
    readonly transactionHash: Hex;
    readonly requestId?: never;
} | {
    readonly disposition: "pending";
    readonly requestId: string;
    readonly transactionHash?: never;
} | {
    readonly disposition: "unknown";
    readonly reason: string;
    readonly transactionHash?: Hex;
    readonly requestId?: string;
}) & {
    readonly diagnostic?: MetaMaskNativeDiagnostic;
};
/** Normal vendor CLI reads only; no policy mutation or remote rolling-usage prediction. */
export declare function readMetaMaskNativeVendorPolicy(chainId: MetaMaskNativeFeeChainId, payer: Address, recipient: Address, deadline?: MetaMaskNativeDeadlineInput): Promise<MetaMaskNativeVendorPolicy>;
/** A failure before the vendor child process was spawned: nothing was handed to the vendor. */
export declare class MetaMaskNativeHandoffNotStarted extends Error {
    readonly causeError: unknown;
    constructor(causeError: unknown);
}
/** Owner alone persists the one-effect handoff marker before this statically bound call. */
export declare function submitOwnedMetaMaskNative(scope: MetaMaskNativeOwnedScope, context: MetaMaskNativeOwnedContext): Promise<MetaMaskNativeSubmission>;
/** Transient read evidence only. No field grants financial authority or changes a held journal. */
export interface MetaMaskNativeReadObservation {
    readonly stage: "not_requested" | "input" | "before_guard" | "watch" | "after_guard" | "complete";
    /** Request reads bracket the watch with the session project only (`project_before`, `project_after`); other steps are kept for old outputs. */
    readonly guard_step: "project_before" | "address_before" | "trading_mode" | "vendor_policy" | "address_after" | "project_after" | null;
    readonly request_id: string | null;
    readonly watch_returned: boolean;
    readonly before_guard_verified: boolean;
    readonly after_guard_verified: boolean;
    readonly request_identity_verified: boolean;
    readonly provider_status: "EVALUATING" | "AWAITING_MFA" | "SIGNING" | "BROADCASTING" | "CONFIRMED" | "FAILED" | "EXPIRED" | "DENIED" | "APPROVED" | "SIGNED" | "CANCELLED" | "unrecognized" | null;
    readonly transaction_hash: Hex | null;
    readonly chain_id: MetaMaskNativeFeeChainId | null;
    readonly response_hash: string | null;
    readonly reason: string | null;
    readonly error_code: "APN_OPERATION_BLOCKED" | "APN_PROVIDER_PROTOCOL" | "APN_PROVIDER_UNAVAILABLE" | "APN_STATE_CORRUPT" | "unavailable" | null;
    readonly diagnostic: MetaMaskNativeDiagnostic | null;
}
type RequestHint = {
    readonly disposition: "acknowledged";
    readonly requestId: string;
    readonly transactionHash: Hex;
    readonly chainId?: MetaMaskNativeFeeChainId;
} | {
    readonly disposition: "pending";
    readonly requestId: string;
    readonly chainId?: MetaMaskNativeFeeChainId;
    readonly transactionHash?: never;
} | {
    readonly disposition: "unknown";
    readonly reason: string;
    readonly requestId?: string;
    readonly transactionHash?: Hex;
    readonly chainId?: MetaMaskNativeFeeChainId;
};
export type MetaMaskNativeRequestObservation = RequestHint & {
    readonly readObservation?: MetaMaskNativeReadObservation;
};
/**
 * Normal status READ only (three vendor processes): the session project before, the watch, the project after. The owner
 * supplies the request id and project hash from its authentic journal; a service hint is never chain evidence, so no
 * policy is read around it.
 */
export declare function readMetaMaskNativeRequest(requestId: string, vendorProjectHash: string): Promise<MetaMaskNativeRequestObservation>;
export {};
