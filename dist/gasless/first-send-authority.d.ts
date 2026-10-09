import { type GaslessFirstSendApproval } from "./first-send-model.js";
export type { GaslessFirstSendApproval } from "./first-send-model.js";
import type { GaslessMutable, GaslessOperationRecord } from "./operation-model.js";
import type { GaslessApprovalPort } from "./ports.js";
/** Only this exact first final effect can acquire fresh local consent. */
export declare function assertSealedFirstSend(op: GaslessOperationRecord | (Pick<GaslessOperationRecord, "intent"> & GaslessMutable)): void;
export declare function validateFirstSendApprovals(op: GaslessOperationRecord, s: GaslessMutable, at: string): void;
export declare function assertLateFirstSend(op: GaslessOperationRecord, s: GaslessMutable, submittedAt: string): void;
export interface GaslessFirstSendProof {
    readonly kind: "gasless-first-send-proof";
}
/** Receipt metadata is evidence only. A fresh, private proof belongs to one root/controller instance. */
export declare class GaslessFirstSendAuthority {
    #private;
    constructor(root: string, controller: object, now: () => number);
    approve(op: GaslessOperationRecord, port: GaslessApprovalPort): Promise<GaslessFirstSendProof | null>;
    metadata(proof: GaslessFirstSendProof): GaslessFirstSendApproval;
    assert(proof: GaslessFirstSendProof, op: GaslessOperationRecord, claimed?: boolean): void;
    claim(proof: GaslessFirstSendProof, op: GaslessOperationRecord): void;
    revoke(proof: GaslessFirstSendProof): void;
    private checked;
}
