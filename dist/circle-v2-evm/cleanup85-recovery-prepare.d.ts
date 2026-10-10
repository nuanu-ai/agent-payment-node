import type { Cleanup85CancellationRequest } from "../circle-cleanup85-cancellation-contract.js";
import type { StateStore } from "../state.js";
import { type CircleRpc } from "./rpc.js";
/** Normal preparation only. It publishes a finite immutable admission frame, never financial authority. */
export declare function prepareCleanup85Recovery(state: StateStore, source: CircleRpc, destination: CircleRpc, id: string, now: () => number): Promise<Cleanup85CancellationRequest>;
