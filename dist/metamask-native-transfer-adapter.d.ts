import { type MetaMaskNativeDeadlineInput, type MetaMaskNativeDiagnostic } from "./metamask-native-diagnostic.js";
import type { Hex } from "./model.js";
import { type MetaMaskNativeFeeChainId } from "./metamask-native-fee-evidence.js";
import { type MetaMaskNativeOwnedScope, type MetaMaskNativeOwnedContext } from "./metamask-native-transfer-owner.js";
declare const PAYER = "0xf41170df51aab52aaa04fbc3ff325cf051644aca";
declare const POLICY_HASH = "e3e44343da17c1912c2da0ce5b58f9c804b53d3715b8a2756c0b035fd50d288a";
declare const OP_POLICY_HASH = "7e5d5899170740ccaa05fb45415c9ef5320815e446788719f3523eb0fd58ee37";
interface FixedMetaMaskNativePolicyBase {
    readonly selectedAddress: typeof PAYER;
    readonly vendorProjectHash: string;
    readonly tradingMode: "guard";
    readonly observedAt: string;
}
export type FixedMetaMaskNativePolicy = FixedMetaMaskNativePolicyBase & ({
    readonly vendorPolicyHash: typeof POLICY_HASH;
    readonly policyBytes: 866;
} | {
    readonly vendorPolicyHash: typeof OP_POLICY_HASH;
    readonly policyBytes: 945;
});
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
/** Normal pinned CLI GETs only. No YAML decoder, policy mutation or remote rolling-usage prediction. */
export declare function readFixedMetaMaskNativePolicy(chainId: MetaMaskNativeFeeChainId, deadline?: MetaMaskNativeDeadlineInput): Promise<FixedMetaMaskNativePolicy>;
/** Owner alone persists the one-effect handoff marker before this statically bound call. */
export declare function submitOwnedMetaMaskNative(scope: MetaMaskNativeOwnedScope, context: MetaMaskNativeOwnedContext): Promise<MetaMaskNativeSubmission>;
/** Transient read evidence only. No field grants financial authority or changes a held journal. */
export interface MetaMaskNativeReadObservation {
    readonly stage: "not_requested" | "input" | "before_guard" | "watch" | "after_guard" | "complete";
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
/** Normal status READ only. Owner supplies RID/project hash from its authentic journal; a service hint is not chain evidence. */
export declare function readFixedMetaMaskNativeRequest(requestId: string, vendorProjectHash: string): Promise<MetaMaskNativeRequestObservation>;
export {};
