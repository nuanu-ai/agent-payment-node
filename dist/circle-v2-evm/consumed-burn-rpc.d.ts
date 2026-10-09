import { type Hex } from "viem";
import { type CircleOperationV1 } from "./operation-model.js";
import { type CircleReceiptProof, type CircleObservation } from "./protocol.js";
import type { CircleRpc } from "./rpc.js";
export declare const CONSUMER_HASH: Hex;
export declare const CONSUMER_BLOCK_HASH = "0xb61353469b1f3f5459c48755db96a0a38d451654449507afd9a8ba097b65681d";
export declare const CONSUMER_TO = "0x02EC4C5ec5d05c3c60495549e833cE318A230149";
export interface ConsumedBurnEvidence {
    readonly approvalProof: CircleReceiptProof;
    readonly consumerProof: CircleReceiptProof;
    readonly usdcBalanceAtomic: string;
}
/** This exact successful native transaction has no authorizations, calldata or logs. Its value/fee never enter Circle accounting. */
export declare function verifyConsumedNonce(input: CircleObservation): CircleReceiptProof;
export declare function assertConsumedBurnEvidence(value: ConsumedBurnEvidence, op: CircleOperationV1): void;
/** Historical allowance and principal at the exact approval block remain mandatory. An archive transport is required. */
export declare function consumedBurnEvidence(source: CircleRpc, op: CircleOperationV1, afterCleanup?: boolean): Promise<ConsumedBurnEvidence>;
