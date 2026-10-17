import { type MoneyConflictDomain } from "../../operation-conflict-domain.js";
import { type RailOperationRecord } from "../../rail-operation-model.js";
import { type OperationFamilyAdapter } from "../adapter.js";
export declare function railDomains(record: RailOperationRecord): readonly MoneyConflictDomain[];
export declare const railAdapter: OperationFamilyAdapter<RailOperationRecord>;
