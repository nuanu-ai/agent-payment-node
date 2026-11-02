import type { OperationRecord } from "./model.js";
import type { RuntimeContext } from "./runtime.js";
import { type TransferServiceObservation } from "./transfer-service-observe.js";
/** The dispatched local states whose transaction may still be in flight: the only ones the blocker settle observes. */
export declare const SETTLED_DIRECT_STATES: readonly OperationRecord["state"][];
/**
 * The blocker settle of a local direct transfer (operation-auto-settle.ts): one receipt read and, without a receipt, the
 * shared never-lands rule, under the locks its observation takes (profile, operation). Unlike resume it never dispatches
 * or re-sends, never reads custody, never moves `signed_not_submitted` and never releases a reservation itself; each
 * transition it writes follows the usage ledger as every observation's does. Its RPC is the refused command's own
 * `--rpc-url`, reused explicitly: a standalone chain-id read (the RPC's own chain assertion) must name the transfer's
 * chain before its hash is sent, so an endpoint of another chain learns nothing of it (APN_CHAIN_MISMATCH); without an
 * RPC the settle is refused by its RPC requirement (APN_RPC_CONFIG). Either refusal writes nothing.
 */
export declare function settleDispatchedDirect(context: RuntimeContext, observation: Pick<TransferServiceObservation, "requiredOperation" | "observeReceipt" | "settleUnlanded">, operationIdInput: string): Promise<OperationRecord>;
