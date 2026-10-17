import { type MoneyConflictDomain } from "../../operation-conflict-domain.js";
import { type Permit2ProductionRecord } from "../../x402-permit2/production-repository.js";
import { type OperationFamilyAdapter } from "../adapter.js";
export declare function permit2Domains(record: Permit2ProductionRecord): readonly MoneyConflictDomain[];
/**
 * The family's own outcomes end the claim. An authorization never exposed is ended by the family itself past its
 * deadline: `x402 permit2 observe` runs the expiry release (released_unsubmitted, its usage hold freed).
 */
export declare const permit2Adapter: OperationFamilyAdapter<Permit2ProductionRecord>;
