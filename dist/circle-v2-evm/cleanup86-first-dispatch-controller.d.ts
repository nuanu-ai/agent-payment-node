import type { Cleanup86Material } from "./cleanup86-custody.js";
import { Cleanup86FirstDispatchJournal } from "./cleanup86-first-dispatch-journal.js";
import type { Cleanup86FirstDispatchGrant, Cleanup86FirstDispatchBinding } from "./cleanup86-first-dispatch-authority.js";
import { type VerifiedCleanup86FirstDispatchPurpose, type Cleanup86FirstDispatchPurpose } from "./cleanup86-first-dispatch-purpose.js";
export declare function assertCleanup86FirstDispatchGrant(grant: Cleanup86FirstDispatchGrant, binding: Cleanup86FirstDispatchBinding, stage: string): void;
export declare function assertCleanup86FirstDispatchJournalBinding(grant: Cleanup86FirstDispatchGrant, binding: Cleanup86FirstDispatchBinding, journal: Cleanup86FirstDispatchJournal): void;
export interface Cleanup86FirstDispatchPorts {
    confirm(purpose: Cleanup86FirstDispatchPurpose, deadline: string): Promise<void>;
    restore(grant: Cleanup86FirstDispatchGrant): Promise<Cleanup86Material>;
    preflight(grant: Cleanup86FirstDispatchGrant): Promise<void>;
    send(material: Cleanup86Material, grant: Cleanup86FirstDispatchGrant): Promise<`0x${string}`>;
}
/** Exact first dispatch only. Never seal/sign, change original journals, or retry a SEND. */
export declare function executeCleanup86FirstDispatch(journal: Cleanup86FirstDispatchJournal, certificate: VerifiedCleanup86FirstDispatchPurpose, binding: Cleanup86FirstDispatchBinding, ports: Cleanup86FirstDispatchPorts): Promise<void>;
