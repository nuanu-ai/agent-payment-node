import { type TtyTransferApprovalOptions } from "../../tty-approval.js";
import type { GuardedSwapService } from "../../swap/service.js";
export interface OrcaStableConsentPort {
    confirm(lines: readonly string[], code: string, deadline: string): Promise<void>;
}
export declare class TtyOrcaStableConsent implements OrcaStableConsentPort {
    private readonly options;
    constructor(options?: TtyTransferApprovalOptions);
    confirm(lines: readonly string[], code: string, deadline: string): Promise<void>;
}
/** Owner authorizes only the strict local proof of no send and matching principal release. */
export declare function confirmOrcaStableNoSendRecovery(service: GuardedSwapService, operationId: string, consent: OrcaStableConsentPort, clock: () => Date): Promise<void>;
