import type { Cleanup85CancellationRequest } from "../circle-cleanup85-cancellation-contract.js";
import type { Cleanup85CancellationProof } from "../circle-cleanup85-cancellation-contract.js";
import type { StateStore } from "../state.js";
import { type CircleOperationV1 } from "./operation-model.js";
import { type Cleanup85RecoveryIntent } from "./cleanup85-recovery-store.js";
import { type Cleanup86Intent } from "./cleanup86-store.js";
import type { Cleanup86Custody } from "./cleanup86-custody.js";
import type { CircleRpc } from "./rpc.js";
import type { CircleUsage } from "./usage.js";
import type { CircleRepository } from "./repository.js";
/** No private material read, TTY or financial start. B proof/accounting must be independently
 * verified under reacquired owner locks before this final observer is invoked. */
export declare function observeCleanup86(state: StateStore, op: CircleOperationV1, recovery: Cleanup85RecoveryIntent, intent: Cleanup86Intent, cancellation: Cleanup85CancellationProof, custody: Cleanup86Custody, source: CircleRpc, usage: CircleUsage, repo: CircleRepository, now: () => number, accounting: (state: StateStore, request: Cleanup85CancellationRequest, proof: Cleanup85CancellationProof) => Promise<void>): Promise<CircleOperationV1>;
