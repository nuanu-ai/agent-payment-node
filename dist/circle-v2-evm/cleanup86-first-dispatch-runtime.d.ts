import type { StateStore } from "../state.js";
import type { HeldCleanup85Scope } from "../circle-cleanup85-financial-scope.js";
import type { Cleanup85CancellationProof, Cleanup85CancellationRequest } from "../circle-cleanup85-cancellation-contract.js";
import type { TtyTransferApprovalOptions } from "../tty-approval.js";
import type { BridgeHttps } from "../lifi/https.js";
import { type CircleOperationV1 } from "./operation-model.js";
import { CircleRpc } from "./rpc.js";
import { type Cleanup85RecoveryIntent } from "./cleanup85-recovery-store.js";
import type { Cleanup86Intent } from "./cleanup86-store.js";
import type { Cleanup86Custody } from "./cleanup86-custody.js";
/** Normal explicit approve entry only: no quote, new intent, signing key or seal operation. */
export declare function firstDispatchCleanup86(state: StateStore, op: CircleOperationV1, recovery: Cleanup85RecoveryIntent, intent: Cleanup86Intent, proof: Cleanup85CancellationProof, source: CircleRpc, destination: CircleRpc, scope: HeldCleanup85Scope, now: () => number, tty: TtyTransferApprovalOptions, https: Pick<BridgeHttps, "request">, custody: Cleanup86Custody, accounting: (state: StateStore, request: Cleanup85CancellationRequest, proof: Cleanup85CancellationProof) => Promise<void>, archiveInterval: string): Promise<void>;
