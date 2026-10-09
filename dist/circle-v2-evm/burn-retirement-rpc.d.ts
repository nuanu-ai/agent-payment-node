import { type CircleEffect, type CircleOperationV1 } from "./operation-model.js";
import { type CircleReceiptProof } from "./protocol.js";
import type { CircleRpc } from "./rpc.js";
export interface SealedBurnEvidence {
    readonly approvalProof: CircleReceiptProof;
    readonly usdcBalanceAtomic: string;
}
export declare function assertRetirementObservedEnvelope(effect: CircleEffect, input: unknown): void;
export declare function approvalReceiptIdentity(proof: CircleReceiptProof): string;
export declare function sealedBurnEvidence(source: CircleRpc, op: CircleOperationV1, allowance: (tag: string) => Promise<string>): Promise<SealedBurnEvidence>;
/** Pending nonce85 is allowed solely when the exact retained burn84 is publicly pending. */
export declare function assertBurnReplacementAccount(source: CircleRpc, op: CircleOperationV1, latest: string, pending: string): Promise<void>;
