import { type OperationRecord } from "../../model.js";
import { type MoneyConflictDomain } from "../../operation-conflict-domain.js";
import { type OperationFamilyAdapter } from "../adapter.js";
import { type OperationClaim } from "../types.js";
/**
 * The family's own outcome list for its kind (local or provider): the same list each validator ties the record's
 * `terminal` flag to. The Base USDC local record (no `evm` binding) has no such check on read, so its state decides.
 */
export declare function directTerminal(record: Pick<OperationRecord, "state" | "providerDirect">): boolean;
export declare function directDomains(record: OperationRecord): readonly MoneyConflictDomain[];
/** A provider-direct operation also holds its provider account and payer, which span profiles. */
export declare function salvageProvider(providerId: unknown, accountBindingHash: unknown, payer: unknown): readonly OperationClaim[];
export declare const directAdapter: OperationFamilyAdapter<OperationRecord>;
