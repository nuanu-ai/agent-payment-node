import { type AssetUsageIdentity } from "../asset-usage-ledger.js";
import type { RelayUnsignedOperation } from "../relay-unsigned-operation.js";
import { type TtyTransferApprovalOptions } from "../tty-approval.js";
export interface RelayHold {
    readonly identity: AssetUsageIdentity;
    readonly reservationId: string;
}
export type RelayRetireSource = {
    readonly kind: "untouched";
    readonly hold: RelayHold;
    readonly journalIntegrityHash: string | null;
} | {
    readonly kind: "approval_only";
    readonly hold: RelayHold;
    readonly journalIntegrityHash: string;
};
export interface RelayAbandonSummary {
    readonly operationId: string;
    readonly sourceChainId: number;
    readonly sourceAccount: string;
    readonly token: string;
    readonly spender: string;
    readonly approvedAtomic: string;
    readonly journalIntegrityHash: string;
}
export interface RelayAbandonConsentPort {
    confirm(summary: RelayAbandonSummary): Promise<boolean>;
}
/** Token lanes only (Ethereum and Arbitrum). A signing marker, signed bytes, an unresolved send or a recorded
 * outcome is never retired here: those stay resumable, observable or are already terminal by proof. */
export declare function relayRetireSource(root: string, op: RelayUnsignedOperation): Promise<RelayRetireSource>;
/** Release the principal hold: nothing moved the principal. Unknown or foreign hold states refuse. */
export declare function releaseRelayHold(root: string, op: RelayUnsignedOperation, source: RelayRetireSource, at: Date): Promise<void>;
export declare function relayAbandonSummary(op: RelayUnsignedOperation, source: RelayRetireSource & {
    kind: "approval_only";
}): RelayAbandonSummary;
/** Fresh foreground consent to abandon a route after its approval: the deposit is never sent afterwards. */
export declare class TtyRelayAbandonConfirmation implements RelayAbandonConsentPort {
    private readonly options;
    constructor(options?: TtyTransferApprovalOptions);
    confirm(summary: RelayAbandonSummary): Promise<boolean>;
}
