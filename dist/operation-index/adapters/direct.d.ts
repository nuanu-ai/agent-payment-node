import type { OperationRecord } from "../../model.js";
import { type MoneyConflictDomain } from "../../operation-conflict-domain.js";
import { type OperationFamilyAdapter } from "../adapter.js";
import { type OperationClaim } from "../types.js";
export declare function directDomains(record: OperationRecord): readonly MoneyConflictDomain[];
/** A provider-direct operation also holds its provider account and payer, which span profiles. */
export declare function salvageProvider(providerId: unknown, accountBindingHash: unknown, payer: unknown): readonly OperationClaim[];
export declare const directAdapter: OperationFamilyAdapter<OperationRecord>;
