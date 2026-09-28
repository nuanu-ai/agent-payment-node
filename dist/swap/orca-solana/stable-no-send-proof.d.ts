import type { ChainAccount } from "../../direct-rail-ports.js";
import { SecureStateStore } from "../../secure-state-store.js";
import type { SwapOperationRecord } from "../model.js";
import type { OrcaStableMaterial } from "./stable-material.js";
import type { OrcaStableExecutionBinding } from "./stable-execution-journal.js";
declare const VERSION: "apn.orca-stable-no-send-proof.v1";
export interface OrcaStableNoSendProof {
    readonly schemaVersion: typeof VERSION;
    readonly operationId: string;
    readonly ownerProfileHash: string;
    readonly quoteHash: string;
    readonly markerHash: string;
    readonly markerOperationIntegrityHash: string;
    readonly materialDigest: string;
    readonly bindingHash: string | null;
    readonly custodyAccountIdentityHash: string;
    readonly reservationId: string;
    readonly reservedLeaseIntegrityHash: string;
    readonly proofHash: string;
}
/** The hash identifies the exact marker, material, custody identity and reserved principal lease. */
export declare function orcaStableNoSendProof(operation: SwapOperationRecord, material: OrcaStableMaterial, binding: OrcaStableExecutionBinding | null, account: ChainAccount): OrcaStableNoSendProof;
export declare class OrcaStableNoSendProofStore extends SecureStateStore {
    private initialized;
    save(expected: OrcaStableNoSendProof): Promise<OrcaStableNoSendProof>;
    load(operation: SwapOperationRecord): Promise<OrcaStableNoSendProof | null>;
    private path;
    private ready;
}
export declare function validateOrcaStableNoSendProof(value: unknown): OrcaStableNoSendProof;
export {};
