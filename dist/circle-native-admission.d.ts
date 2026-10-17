import type { CircleKnownOperation } from "./circle-v2-evm/funding-operation.js";
/** A Circle route of this account whose source burn is FINALIZED with zero residual allowance: it never signs on its
 * source chain again (cleanup and nonce retirement need an unburned source), only the mint on its destination. */
export declare function circleSourceSettled(op: CircleKnownOperation, profileHash: string, account: string): boolean;
export declare function circleNativeSourceIdentity(op: CircleKnownOperation): string;
