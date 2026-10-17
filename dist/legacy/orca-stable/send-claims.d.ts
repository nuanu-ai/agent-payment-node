import type { SwapOperationRecord } from "../../swap/model.js";
declare const SEND_CLAIM_VERSION: "apn.orca-stable-send-claim.v1";
export type OrcaStableSendClaim = {
    readonly schemaVersion: typeof SEND_CLAIM_VERSION;
    readonly operationId: string;
    readonly markerHash: string;
    readonly bindingHash: string;
    readonly accountIdentityHash: string;
    readonly signature: string;
    readonly rawPayloadHash: string;
    readonly claimedAt: string;
    readonly claimHash: string;
};
/** Recovery cannot release principal after a send right was consumed, even if custody is later unreadable. */
export declare function hasOrcaStableSendClaim(root: string, operation: SwapOperationRecord): Promise<boolean>;
export declare function loadOrcaStableSendClaim(root: string, operation: SwapOperationRecord): Promise<OrcaStableSendClaim | null>;
export {};
