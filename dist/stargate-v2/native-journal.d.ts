import type { Address } from "../model.js";
import { StateStore } from "../state.js";
import type { StargateNativeJournal, StargateNativeOperation } from "./native-execution.js";
import type { StargateAdmission } from "./token-model.js";
export declare class FileStargateNativeJournal implements StargateNativeJournal {
    private readonly root;
    private readonly locks;
    constructor(root: string, locks?: Pick<StateStore, "initialize" | "withLocks">);
    private path;
    withLock<T>(id: string, work: () => Promise<T>): Promise<T>;
    /** The same per-account lock every other EVM writer holds, so no other family can race this nonce. */
    withOwnerLock<T>(owner: Address, work: () => Promise<T>): Promise<T>;
    admit<T>(operation: StargateAdmission, work: () => Promise<T>): Promise<T>;
    load(id: string): Promise<StargateNativeOperation | null>;
    save(nextInput: StargateNativeOperation): Promise<void>;
}
