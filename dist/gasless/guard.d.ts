import type { StateStore } from "../state.js";
import type { GaslessFees } from "./model.js";
import type { GaslessOperationRecord } from "./operation-model.js";
import type { GaslessRpcPort } from "./ports.js";
export declare function assertGaslessRemaining(op: GaslessOperationRecord, now: number): void;
/**
 * Returns the fees the next step uses. Until its UserOperation is signed, a v4 operation is priced from fresh bundler
 * quotes within the owner's fee cap; signed fees, and every earlier intent's frozen fees, must cover the current slow tier.
 */
export declare function guardGaslessOperation(state: StateStore, rpc: GaslessRpcPort, op: GaslessOperationRecord, now: () => number, signed?: GaslessFees): Promise<GaslessFees>;
/** Only reason tokens produced by this module family may enter the durable journal. */
export declare function gaslessReason(error: unknown, fallback: string): string;
