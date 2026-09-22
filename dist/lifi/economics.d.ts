import type { FeeEstimate } from "../ports.js";
import type { BridgeAccountSnapshot, BridgeEnvelope, BridgeFeeCeiling, BridgeMaterialization, DecodedBridgeCall } from "./model.js";
import type { BridgeOperationRecord } from "./operation-model.js";
import type { BridgeRpcPort } from "./ports.js";
/**
 * Raises one quoted EIP-1559 price pair to the maximum the owner approves. The returned prices are what the
 * envelope freezes, what custody signs, what bounds the debit on chain and what the approval screen shows; the
 * quoted pair is kept beside them so the disclosure can state both the quote and the stated headroom.
 */
export declare function bridgeApprovedPrices(fees: Pick<FeeEstimate, "maxFeePerGasAtomic" | "maxPriorityFeePerGasAtomic">): {
    readonly maxFeePerGasAtomic: string;
    readonly maxPriorityFeePerGasAtomic: string;
    readonly feeCeiling: BridgeFeeCeiling;
};
/**
 * Whether this intent needs a separate approval effect. A native principal never does: its allowance is the constant
 * zero, its approval cap is zero and the principal is the bridge transaction's value. A token needs one from zero.
 */
export declare function bridgeApprovalRequired(request: BridgeMaterialization["request"], allowanceAtomic: string): boolean;
export declare const BRIDGE_DEPLOYMENT_PROOF_VERIFIER: "apn.bridge.deployment-proof.base-stargate-ecotone.v1";
export declare function bridgeApprovalPolicyHash(materialization: Pick<BridgeMaterialization, "tool" | "request">): string;
/** The part of a native debit that is the principal itself: excluded from the fee cap, included in the funding check. */
export declare function bridgeNativePrincipalWei(request: BridgeMaterialization["request"]): bigint;
export declare function freezeBridgeEnvelopes(m: BridgeMaterialization, account: BridgeAccountSnapshot, rpc: BridgeRpcPort): Promise<readonly BridgeEnvelope[]>;
export declare function bridgeExpiry(m: BridgeMaterialization, decoded: DecodedBridgeCall, account: BridgeAccountSnapshot, preparedAt: string, now: number): string;
export declare function assertBridgeRemaining(op: BridgeOperationRecord, now: number): void;
export declare function guardBridgeEffect(op: BridgeOperationRecord, role: "approval" | "bridge", source: BridgeRpcPort, destination: BridgeRpcPort, now: () => number): Promise<void>;
