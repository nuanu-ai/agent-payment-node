import { type MoneyConflictDomain } from "../../operation-conflict-domain.js";
import { type Permit2ProductionRecord } from "../../x402-permit2/production-repository.js";
import { type OperationFamilyAdapter } from "../adapter.js";
export declare function permit2Domains(record: Permit2ProductionRecord): readonly MoneyConflictDomain[];
export declare const permit2Adapter: OperationFamilyAdapter<Permit2ProductionRecord>;
