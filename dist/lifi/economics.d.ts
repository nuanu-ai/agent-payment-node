import type { FeeEstimate } from "../ports.js";
import type { BridgeAccountSnapshot, BridgeEnvelope, BridgeFeeCeiling, BridgeMaterialization, DecodedBridgeCall } from "./model.js";
import { ApnError } from "../errors.js";
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
export declare const BRIDGE_DEPLOYMENT_PROOF_POLICY_CUTOVER: "2026-09-22T05:47:00.000Z";
export declare function legacyBridgeApprovalPolicyHash(materialization: Pick<BridgeMaterialization, "request">): string;
export declare function bridgeApprovalPolicyHash(materialization: Pick<BridgeMaterialization, "tool" | "request">): string;
export declare function bridgeApprovalPolicyBinding(materialization: Pick<BridgeMaterialization, "tool" | "request">, policyHash: string, preparedAt: string): "deployment-proof-v1" | "full-refresh" | null;
/** The part of a native debit that is the principal itself: excluded from the fee cap, included in the funding check. */
export declare function bridgeNativePrincipalWei(request: BridgeMaterialization["request"]): bigint;
export declare function freezeBridgeEnvelopes(m: BridgeMaterialization, account: BridgeAccountSnapshot, rpc: BridgeRpcPort): Promise<readonly BridgeEnvelope[]>;
export declare function bridgeExpiry(m: BridgeMaterialization, decoded: DecodedBridgeCall, account: BridgeAccountSnapshot, preparedAt: string, now: number): string;
export declare function assertBridgeRemaining(op: BridgeOperationRecord, now: number): void;
/** A transport failure or an HTTP 408/5xx answer after its bounded retry: the endpoint was unavailable, not refusing. */
export declare function bridgeTransientRpcFailure(error: unknown): error is ApnError;
/**
 * The full pre-sign guard of one unsent effect. The source deployment check (deployment-check.ts) is read in the same POST
 * as the account at the head the transaction executes against; it verifies the reviewed pins directly, so the identity
 * frozen at prepare is a record, not a comparand (an upgraded APN that re-pins a lane checks its own pins). The destination
 * reads only where delivery depends on third-party routing. `deploymentCheck` is false only for a re-check in the same
 * invocation after a full guard passed with no consent wait between (P2); nonce, allowance, balance, simulation and fees
 * are read fresh every time.
 */
export declare function guardBridgeEffect(op: BridgeOperationRecord, role: "approval" | "bridge", source: BridgeRpcPort, destination: BridgeRpcPort, now: () => number, deploymentCheck?: boolean): Promise<void>;
