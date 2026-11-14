import { type Address } from "viem";
import { type MetaMaskNativeDeadlineInput, type MetaMaskNativeDiagnostic } from "./metamask-native-diagnostic.js";
import type { Hex } from "./model.js";
import { type MetaMaskMfaNotice } from "./metamask-process-output.js";
import { type MetaMaskNativeRequestBinding } from "./metamask-native-request-server-read.js";
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
/** A verified AWAITING_MFA notice (or request status) for the very request stored, with the SHA-256 of the vendor output. */
export interface MetaMaskNativeMfaEvidence extends MetaMaskMfaNotice {
    readonly evidenceHash: string;
}
export type MetaMaskNativeSubmission = ({
    readonly disposition: "acknowledged";
    readonly transactionHash: Hex;
    readonly requestId?: never;
} | {
    readonly disposition: "pending";
    readonly requestId: string;
    readonly transactionHash?: never;
    readonly mfa?: MetaMaskNativeMfaEvidence;
} | {
    readonly disposition: "unknown";
    readonly reason: string;
    readonly transactionHash?: Hex;
    readonly requestId?: string;
    readonly mfa?: MetaMaskNativeMfaEvidence;
}) & {
    readonly diagnostic?: MetaMaskNativeDiagnostic;
};
/**
 * Which vendor-read invariant a native transfer failed, with the
 * owner's next step. Every one still refuses before any operation exists; the step is advice, never run by APN. A step
 * written `mm …` is the pinned vendor client, which `runnable` turns into a command that runs as typed.
 */
export type MetaMaskNativeRefusal = "metamask_native_chain_unsupported" | "metamask_vendor_read_failed" | "metamask_session_required" | "metamask_session_project_changed" | "metamask_guard_mode_required" | "metamask_wallet_mismatch" | "metamask_guard_policy_missing";
/** Normal vendor CLI reads only; no policy mutation or remote rolling-usage prediction. */
export declare function readMetaMaskNativeVendorPolicy(chainId: MetaMaskNativeFeeChainId, payer: Address, recipient: Address, deadline?: MetaMaskNativeDeadlineInput, profile?: string): Promise<MetaMaskNativeVendorPolicy>;
/** A failure before the vendor child process was spawned: nothing was handed to the vendor. */
export declare class MetaMaskNativeHandoffNotStarted extends Error {
    readonly causeError: unknown;
    constructor(causeError: unknown);
}
/** Owner alone persists the one-effect handoff marker before this statically bound call. */
export declare function submitOwnedMetaMaskNative(scope: MetaMaskNativeOwnedScope, context: MetaMaskNativeOwnedContext): Promise<MetaMaskNativeSubmission>;
/** Transient read evidence only. No field grants financial authority or changes a held journal. */
export interface MetaMaskNativeReadObservation {
    readonly stage: "not_requested" | "input" | "before_guard" | "watch" | "server_read" | "after_guard" | "complete";
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
    /** Present only when the watch answered `metamask_request_not_in_local_state` and APN read the request from MetaMask's server. */
    readonly server_read?: MetaMaskNativeServerReadObservation;
}
/**
 * APN's own read of the request from MetaMask's server by its stored id (metamask-native-request-server-read.ts).
 * `verified`: the answer named this request, kind transaction, the transfer's sender and chain; its status and hash are
 * recorded above exactly as a watch's would be. `not_found`: the server answered 404, which proves nothing. `refused`:
 * nothing usable was read; `reason` is a closed reason (`metamask_session_project_changed` for another signed-in
 * project, an `mm_gasless_*` reason of the helper otherwise) and `check` the answer check that refused, when one did.
 */
export interface MetaMaskNativeServerReadObservation {
    readonly outcome: "verified" | "not_found" | "refused";
    /** The SHA-256 of the server's answer bytes, for a verified answer only. */
    readonly response_hash: string | null;
    readonly reason: string | null;
    readonly check: string | null;
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
    readonly mfa?: MetaMaskNativeMfaEvidence;
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
 * policy is read around it. When the watch answers that mm's own local request list no longer holds the request (a
 * new `mm login` starts that list empty) and the owner supplies the transfer's sender and chain, the request is read
 * once from MetaMask's server instead, inside the same project bracket; that read never sends, signs or approves.
 */
export declare function readMetaMaskNativeRequest(requestId: string, vendorProjectHash: string, binding?: MetaMaskNativeRequestBinding): Promise<MetaMaskNativeRequestObservation>;
export {};
