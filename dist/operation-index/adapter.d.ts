import type { CommandOutcome, CommandRequest } from "../commands.js";
import { type MoneyConflictDomain } from "../operation-conflict-domain.js";
import type { RuntimeContext } from "../runtime.js";
import type { OperationClaim, OperationFamily, WantedClaims } from "./types.js";
/** One record directory: `<directory>/<id>.json`, or `<directory>/<profileHash>/<id>.json` when per profile. */
export interface OperationStore {
    readonly directory: string;
    readonly perProfile: boolean;
}
export declare const RECORD_NAME: RegExp;
export declare const STATE_HASH: RegExp;
export interface RecordIdentity {
    readonly profileHash: string;
    readonly operationId: string;
    readonly idempotencyHash: string | null;
    readonly requestHash: string | null;
}
/** What an unreadable record's raw JSON still names, each value only when canonical. */
export interface SalvagedRecord {
    readonly profileHashes: readonly string[];
    readonly idempotencyHash: string | null;
    /** Null when the accounts cannot be read; the index then quarantines the named profiles (or the family). */
    readonly claims: readonly OperationClaim[] | null;
}
export type OperationResumeOptions = Omit<Extract<CommandRequest, {
    readonly command: "operation.resume";
}>, "command" | "operationId">;
export interface OperationFamilyAdapter<R = unknown> {
    readonly family: OperationFamily;
    /** Read by reconcile only (names, never bytes, unless a name has no entry yet). */
    readonly stores: readonly OperationStore[];
    /** The family's own widen-only reader at this exact path; lock-free; null when absent; throws when invalid. */
    load(root: string, recordPath: string): Promise<R | null>;
    identity(record: R): RecordIdentity;
    /** Account, provider and extra profile claims held while non-terminal; null when its accounts cannot be read. */
    claims(record: R): readonly OperationClaim[] | null;
    terminal(record: R, root: string): boolean | Promise<boolean>;
    /** The record's own state, reported as `blockingState`. */
    state(record: R): string;
    /** True when this held claim does not block that admission (family coexistence, see WantedTag). */
    admits?(record: R, wanted: WantedClaims, held: OperationClaim): boolean;
    salvage(raw: unknown): SalvagedRecord;
    /** Extra claims an unreadable record with unknown accounts holds besides its profile quarantine. */
    readonly unknownClaims?: readonly OperationClaim[];
    /** The public projection `OperationService.status` returns. */
    view(record: R, root: string): Promise<unknown>;
    status?(ctx: RuntimeContext, record: R): Promise<CommandOutcome>;
    receipt?(ctx: RuntimeContext, record: R): Promise<CommandOutcome>;
    resume?(ctx: RuntimeContext, record: R, options: OperationResumeOptions): Promise<CommandOutcome>;
    abandon?(ctx: RuntimeContext, record: R): Promise<unknown>;
    readonly commands?: {
        readonly status: string;
        readonly resume?: string;
        readonly exit?: string;
    };
}
/** `<directory>[/<profileHash>]/<operationId>.json`, split back into its parts; null for any other shape. */
export declare function parseRecordPath(recordPath: string): {
    readonly directory: string;
    readonly profileHash: string | null;
    readonly operationId: string;
} | null;
export declare function requiredRecordPath(recordPath: string, store: OperationStore): {
    readonly directory: string;
    readonly profileHash: string | null;
    readonly operationId: string;
};
export declare function domainClaims(domains: readonly MoneyConflictDomain[]): readonly OperationClaim[];
/** Unreadable account fields yield null, exactly as `storedOperationDomains` reported them. */
export declare function readableClaims(claims: () => readonly OperationClaim[]): readonly OperationClaim[] | null;
export declare function field(value: unknown, ...path: readonly string[]): unknown;
/** Salvage accepts only a lowercase or correctly checksummed EVM address. */
export declare function salvageEvm(chainId: unknown, account: unknown, shared?: boolean): OperationClaim;
export declare function salvageRail(rail: unknown, account: unknown): OperationClaim;
export declare function salvageBridge(chainId: unknown, account: unknown): OperationClaim;
export declare function salvageHash(value: unknown): string;
/** Identity fields plus the family's account extraction; any doubtful account field makes the claims unknown. */
export declare function salvageRecord(raw: unknown, extract: (raw: unknown) => readonly OperationClaim[], profileFields?: readonly string[]): SalvagedRecord;
/** Every covered record carries these identity fields under the same names. */
export declare function standardIdentity(record: {
    readonly profileHash: string;
    readonly operationId: string;
    readonly idempotencyHash: string;
    readonly requestHash: string;
}): RecordIdentity;
