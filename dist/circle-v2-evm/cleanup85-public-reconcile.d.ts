import { verifyCleanup85Settlement } from "./cleanup85-settlement-authority.js";
import type { StateStore } from "../state.js";
import { CircleRepository } from "./repository.js";
import type { CircleUsage } from "./usage.js";
import { Cleanup85RecoveryStore } from "./cleanup85-recovery-store.js";
import { type CircleOperationV1 } from "./operation-model.js";
import { type CircleRpc } from "./rpc.js";
import type { CircleNonceRetirementProof } from "./nonce-retirement-proof.js";
/** Observation only: a canonical public receipt may establish an actual effect without inventing SEND.
 * Historical policy authority and original UNKNOWN effect remain unchanged; no current policy grant. */
export declare function reconcileOriginalCleanup85(state: StateStore, repo: CircleRepository, usage: CircleUsage, source: CircleRpc, destination: CircleRpc, input: CircleOperationV1, now: () => number): Promise<CircleOperationV1>;
/** A crash after any ledger row must resume with the exact published outcome digest.
 * Fresh full RPC verification occurs before this call; moving FINALIZED heads do not rewrite proof. */
export declare function freezeCleanup85RetirementProof(store: Cleanup85RecoveryStore, source: CircleRpc, op: CircleOperationV1, suffix: "observed-original-proof" | "cleanup86-finalized-proof", fresh: CircleNonceRetirementProof): Promise<CircleNonceRetirementProof>;
/** Historical replay performs canonical verification even when the journal is terminal.
 * Partial ledger repair reuses exact published proof and outcome digests, without new effects. */
export declare function replayFrozenCleanup85Retirement(state: StateStore, repo: CircleRepository, usage: CircleUsage, source: CircleRpc, op: CircleOperationV1, proof: CircleNonceRetirementProof, now: () => number, accounting?: Parameters<typeof verifyCleanup85Settlement>[4]): Promise<CircleOperationV1>;
