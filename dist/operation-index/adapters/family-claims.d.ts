import { type MoneyConflictDomain } from "../../operation-conflict-domain.js";
import { type SalvagedRecord } from "../adapter.js";
import { type OperationClaim } from "../types.js";
export { pastUnstartedDeadline, UNSTARTED_DEADLINE_MARGIN_MS } from "../../unstarted-deadline.js";
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
