import type { OperationAbandonApprovalPort } from "../operation-abandon-approval.js";
import type { ClockPort } from "../ports.js";
import { type SwapOperationRecord } from "./model.js";
export interface SwapAbandonContext {
    readonly state: {
        readonly root: string;
    };
    readonly clock: ClockPort;
    requireOperationAbandonApproval(): OperationAbandonApprovalPort;
}
/**
 * Owner exit (R4) for a swap marked for sending whose outcome no chain proof can settle: no transaction lifetime, router
 * deadline or expiration was recorded that `expired_unlanded` could use. It refuses while any chain proof is possible,
 * while the quote window is still open, and for families with their own recovery. After exact TTY consent the operation
 * becomes abandoned_unknown and its input stays charged as spent. It never signs, sends or releases the hold.
 */
export declare function abandonSwapOperation(context: SwapAbandonContext, operationId: string): Promise<SwapOperationRecord>;
