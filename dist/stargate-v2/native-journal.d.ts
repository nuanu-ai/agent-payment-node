import type { Address } from "../model.js";
import { StateStore } from "../state.js";
import type { StargateNativeJournal, StargateNativeOperation } from "./native-execution.js";
export declare class FileStargateNativeJournal implements StargateNativeJournal {
    private readonly root;
    private readonly locks;
    constructor(root: string, locks?: Pick<StateStore, "initialize" | "withLocks">);
    private path;
    withLock<T>(id: string, work: () => Promise<T>): Promise<T>;
    withOwnerChainLock<T>(owner: Address, chainId: number, work: () => Promise<T>): Promise<T>;
    load(id: string): Promise<StargateNativeOperation | null>;
    save(nextInput: StargateNativeOperation): Promise<void>;
}
