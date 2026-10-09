import { ChainAccountStore } from "../../chain-account-store.js";
import { JupiterV1ExecutionBindingStore } from "./v1-effects.js";
import { SavedJupiterV1MaterialStore } from "./v1-material.js";
export declare function historicalAuthenticationRefused(): never;
/** Existing store readers may initialize. These private adapters refuse creation or mutation. */
export declare function existingHistoricalRoot(root: string): Promise<void>;
export declare class HistoricalMaterialReader extends SavedJupiterV1MaterialStore {
    protected ensureDirectory(path: string): Promise<void>;
    protected writeJson(): Promise<void>;
}
export declare class HistoricalBindingReader extends JupiterV1ExecutionBindingStore {
    protected ensureDirectory(path: string): Promise<void>;
    protected writeJson(): Promise<void>;
}
export declare class HistoricalCustodyReader extends ChainAccountStore {
    protected ensureDirectory(path: string): Promise<void>;
    protected writeJson(): Promise<void>;
}
