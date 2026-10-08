import { SecureStateStore } from "../../secure-state-store.js";
import type { SwapOperationRecord } from "../model.js";
import { type JupiterV1DispatchResult } from "./v1-dispatch.js";
declare const SCHEMA: "apn.jupiter-v1-execution-failure.v1";
declare const PHASES: readonly ["binding_and_sign", "sender_preflight"];
type Phase = typeof PHASES[number];
export interface JupiterV1ExecutionFailure extends JupiterV1DispatchResult {
    readonly schemaVersion: typeof SCHEMA;
    readonly operationId: string;
    readonly markerHash: string;
    readonly phase: Phase;
    readonly currentBlockHeight: string | null;
    readonly lastValidBlockHeight: string;
    readonly observedAt: string;
    readonly recordHash: string;
}
/** Public diagnosis only. A marked operation stays observe-only even without a send claim. */
export declare class JupiterV1ExecutionFailureStore extends SecureStateStore {
    private initialized;
    save(op: SwapOperationRecord, phase: Phase, error: unknown, lastValidBlockHeight: string, currentBlockHeight: string | null, now: Date): Promise<void>;
    load(op: SwapOperationRecord): Promise<JupiterV1ExecutionFailure | null>;
    private validate;
    private path;
    private ready;
}
export {};
