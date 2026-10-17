import { type MoneyConflictDomain } from "../../operation-conflict-domain.js";
import { type MerchantOperation } from "../../x402-merchant/model.js";
import { type OperationFamilyAdapter } from "../adapter.js";
export declare function merchantDomains(record: MerchantOperation): readonly MoneyConflictDomain[];
export declare const merchantAdapter: OperationFamilyAdapter<MerchantOperation>;
