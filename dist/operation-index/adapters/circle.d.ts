import { type CircleKnownOperation } from "../../circle-v2-evm/funding-operation.js";
import { type MoneyConflictDomain } from "../../operation-conflict-domain.js";
import { type OperationFamilyAdapter } from "../adapter.js";
export declare function circleDomains(record: CircleKnownOperation): readonly MoneyConflictDomain[];
/** Circle v2 routes and v1 routes (finish-only), one file per operation; both signing profiles hold the route. */
export declare const circleAdapter: OperationFamilyAdapter<CircleKnownOperation>;
