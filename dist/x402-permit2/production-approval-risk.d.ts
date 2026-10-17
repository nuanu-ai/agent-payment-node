import type { NativePort } from "../ports.js";
import { type Permit2ProductionResult } from "./production-results.js";
import { type Permit2SigningContinuation } from "./production-journal.js";
import { Permit2ProductionPreparation } from "./production-prepare.js";
import { publicPermit2Production } from "./production-repository.js";
import { type Permit2ApprovalPurpose, type Permit2ForegroundApprovalPort } from "./production-approval.js";
/**
 * The paid Permit2 path in one process: foreground approval, the first exposure (ledger hold), one signature under the
 * saved record, one request marker and one HTTPS attempt. Each step re-checks the saved record; nothing private escapes.
 */
export declare class Permit2ApprovalRiskCoordinator {
    #private;
    constructor(root: string, endpoint: string, native: NativePort, preparation: Permit2ProductionPreparation, clock?: () => Date, approval?: Permit2ForegroundApprovalPort);
    /** Same-process paid enclosure. No continuation, signer material or HTTP observation escapes. */
    signAndSubmitOnce(id: string): Promise<Permit2ProductionResult>;
    run(operationId: string, purpose?: Permit2ApprovalPurpose): Promise<{
        readonly status: ReturnType<typeof publicPermit2Production>;
        readonly continuation: Permit2SigningContinuation | null;
    }>;
}
