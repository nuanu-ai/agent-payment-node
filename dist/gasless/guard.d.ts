import type { StateStore } from "../state.js";
import type { GaslessOperationRecord } from "./operation-model.js";
import type { GaslessRpcPort } from "./ports.js";
export declare function assertGaslessRemaining(op: GaslessOperationRecord, now: number): void;
export declare function guardGaslessOperation(state: StateStore, rpc: GaslessRpcPort, op: GaslessOperationRecord, now: () => number): Promise<void>;
/** Only reason tokens produced by this module family may enter the durable journal. */
export declare function gaslessReason(error: unknown, fallback: string): string;
