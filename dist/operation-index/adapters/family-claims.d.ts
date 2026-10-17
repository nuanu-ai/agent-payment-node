import { type MoneyConflictDomain } from "../../operation-conflict-domain.js";
import { type SalvagedRecord } from "../adapter.js";
import { type OperationClaim } from "../types.js";
/**
 * An effect its family never started cannot start once this long has passed after the family's own signing deadline
 * (every family below refuses to sign past that deadline). It is the bound of the admission lease, so a process that
 * stalls between its deadline check and its effect marker is covered as long as an orphaned admission would be.
 */
export declare const UNSTARTED_DEADLINE_MARGIN_MS: number;
/** True once `deadline` (ISO time or epoch milliseconds) plus the margin has passed; an unreadable deadline never passes. */
export declare function pastUnstartedDeadline(deadline: string | number, now?: number): boolean;
/** A CAIP-2 chain (`eip155:<id>`, `solana:<genesis>`, `tron:<genesis>`) and its signing account as a conflict domain. */
export declare function chainDomain(chain: string, account: string): MoneyConflictDomain;
export declare const domainClaim: (domain: MoneyConflictDomain) => OperationClaim;
export declare const evmClaim: (chainId: number | string, account: string) => OperationClaim;
/** Salvage of a CAIP-2 chain and account, canonical values only. */
export declare function salvageChain(chain: unknown, account: unknown): OperationClaim;
/** The profile claim under the state store's own profile hash, for records that name the profile itself. */
export declare const namedProfileClaim: (profile: string) => OperationClaim;
export declare const namedProfileHash: (profile: string) => string;
/** Salvage for records that name their profile rather than a profile hash: the name counts only when canonical. */
export declare function salvageNamedRecord(raw: unknown, extract: (raw: unknown) => readonly OperationClaim[], ...profilePath: readonly string[]): SalvagedRecord;
