import { type CircleOperationV1, type CircleEnvelope } from "./operation-model.js";
/** One retained Sei operation only; this does not admit new routes or nonce retries. */
export declare const SEALED_BURN_OPERATION = "4ee24e4501478193bd84aa89463eb673d539db23cbb7cdbf56f8fe197d792a33";
export declare const SEALED_BURN_HASH = "0x8d3f33d87653d0413aab7faee5b7884f0fc42a5e1dc7d08ba5cb75c72cc3d541";
export declare const SEALED_BURN_MATERIAL = "88158eafdfa699730e0d5e800ab974d7fad9a87db88772ce67591cceca7f165a";
export declare function isSealedBurnRetirement(op: CircleOperationV1): boolean;
export declare function assertSealedBurnRetirement(op: CircleOperationV1): void;
export declare function sealedBurnBinding(op: CircleOperationV1): string;
export declare function sealedBurnReplacement(op: CircleOperationV1, quoted: CircleEnvelope, minimumTip: bigint): CircleEnvelope;
export declare function assertSealedBurnReplacement(op: CircleOperationV1, e: CircleEnvelope): void;
