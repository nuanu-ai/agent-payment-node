import { SecureStateStore } from "./secure-state-store.js";
import type { OperationRecord } from "./model.js";
import type { Cleanup85RecoveryIntent } from "./circle-v2-evm/cleanup85-recovery-store.js";
import type { StateStore } from "./state.js";
export declare const CLEANUP85_UNSIGNED_ORIGINAL = "4b5fc09e077b6c171083edb6c89ce31b5f8e881e1db4f279a866548aade0aef1";
export declare const CLEANUP85_UNSIGNED_FINGERPRINT = "9fc2d56c8a231489251178dade7a47f4d6807f3ddd454080d1b2e9119b81bcf5";
export interface Cleanup85UnsignedRetirementProof {
    readonly version: "apn.cleanup85-expired-unsigned-retirement.v1";
    readonly original: OperationRecord;
    readonly slot: unknown;
    readonly prepared: unknown;
    readonly readmission: Cleanup85RecoveryIntent;
    readonly retiredAt: string;
    readonly proofHash: string;
}
export declare function cleanup85UnsignedTerminal(p: Cleanup85UnsignedRetirementProof): OperationRecord;
export declare class Cleanup85UnsignedRetirementStore extends SecureStateStore {
    private path;
    load(): Promise<Cleanup85UnsignedRetirementProof | null>;
    validate(v: unknown): Cleanup85UnsignedRetirementProof;
    publish(p: Cleanup85UnsignedRetirementProof): Promise<void>;
    prepared(o: OperationRecord): Promise<unknown>;
    assertAbsence(state: StateStore, o: OperationRecord): Promise<void>;
    verifyRetained(state: StateStore, p: Cleanup85UnsignedRetirementProof, allowOriginal?: boolean): Promise<OperationRecord>;
}
