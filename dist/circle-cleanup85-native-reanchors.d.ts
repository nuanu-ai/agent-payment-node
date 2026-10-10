import type { CircleRpc } from "./circle-v2-evm/rpc.js";
import type { verifiedCleanup85RecoveryAdmission } from "./circle-v2-evm/cleanup85-recovery-admission.js";
/** Fresh canonical headers retain the genuine opaque admission's83/84/finality and code-pin snapshots.
 * They grant no authority; the controller keeps the owner/parent/custody/policy locks and finite TTL. */
export declare function reanchorCleanup85Recovery(source: CircleRpc, destination: CircleRpc, v: ReturnType<typeof verifiedCleanup85RecoveryAdmission>): Promise<void>;
