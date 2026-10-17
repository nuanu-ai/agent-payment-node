import { type GaszipFundingRecord } from "../../lifi/gaszip-direct-journal.js";
import { type MoneyConflictDomain } from "../../operation-conflict-domain.js";
import { type OperationFamilyAdapter } from "../adapter.js";
/** Sei funding pays on Base and lands on Sei, so it holds the owner on both chains; Mega funding holds Base. */
export declare const seiGaszipDomains: (record: GaszipFundingRecord) => readonly MoneyConflictDomain[];
export declare const megaGaszipDomains: (record: GaszipFundingRecord) => readonly MoneyConflictDomain[];
export declare const seiGaszipAdapter: OperationFamilyAdapter<GaszipFundingRecord>;
export declare const megaGaszipAdapter: OperationFamilyAdapter<GaszipFundingRecord>;
