import type { NativePort } from "../ports.js";
import { type Permit2SigningContinuation } from "./production-journal.js";
import { Permit2ProductionPreparation } from "./production-prepare.js";
import { publicPermit2Production } from "./production-repository.js";
import { type Permit2ApprovalPurpose, type Permit2ForegroundApprovalPort } from "./production-approval.js";
/** No-key production wiring. Returned continuation is private provenance, not signing/HTTP authority. */
export declare class Permit2ApprovalRiskCoordinator {
    #private;
    constructor(root: string, endpoint: string, native: NativePort, preparation: Permit2ProductionPreparation, clock?: () => Date, approval?: Permit2ForegroundApprovalPort);
    run(operationId: string, purpose?: Permit2ApprovalPurpose): Promise<{
        readonly status: ReturnType<typeof publicPermit2Production>;
        readonly continuation: Permit2SigningContinuation | null;
    }>;
}
