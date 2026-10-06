import type { NativePort } from "../ports.js";
import type { Permit2LocalCapability } from "./production-native-capability.js";
import { type Permit2ProductionRecord } from "./production-repository.js";
import type { Permit2ProductionJournal } from "./production-journal.js";
import { type Permit2ForegroundApprovalPort } from "./production-approval.js";
export interface Permit2ForegroundApprovalProof {
    readonly kind: "permit2-foreground-approval-proof";
}
interface Issued {
    readonly journal: Permit2ProductionJournal;
    readonly controller: object;
    readonly native: NativePort;
    readonly capability: Permit2LocalCapability;
    readonly nativeState: object;
    readonly root: string;
    readonly operationId: string;
    readonly materialHash: string;
    readonly displayHash: string;
    readonly fingerprint: string;
    readonly completedAt: number;
    readonly clock: () => Date;
    claimed: boolean;
}
export type Permit2ApprovalBinding = Readonly<Omit<Issued, "claimed">>;
/** Trusted wiring; the only UI-proof issuer performs actual owned disclosure and foreground approval. */
export declare class Permit2ForegroundApprovalAuthority {
    #private;
    constructor(journal: Permit2ProductionJournal, controller: object, native: NativePort, capability: Permit2LocalCapability, approval: Permit2ForegroundApprovalPort, clock: () => Date);
    approveOwned(id: string): Promise<Permit2ForegroundApprovalProof>;
}
/** Read-only recognition before fresh RPC. Atomic claiming still occurs only under the journal's first-write locks. */
export declare function assertCurrentPermit2ForegroundApproval(proof: Permit2ForegroundApprovalProof, journal: Permit2ProductionJournal, record: Permit2ProductionRecord): void;
/** Recognizes only an actual privately issued UI proof; there is no caller-authoritative time. */
export declare function claimPermit2ForegroundApproval(proof: Permit2ForegroundApprovalProof, journal: Permit2ProductionJournal, record: Permit2ProductionRecord): Permit2ApprovalBinding;
export declare function assertClaimedPermit2ForegroundApproval(proof: Permit2ForegroundApprovalProof, journal: Permit2ProductionJournal, record: Permit2ProductionRecord): void;
export declare function revokePermit2ForegroundApproval(proof: Permit2ForegroundApprovalProof): void;
export {};
