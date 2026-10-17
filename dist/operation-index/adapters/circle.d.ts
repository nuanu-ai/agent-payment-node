import { type CircleKnownOperation } from "../../circle-v2-evm/funding-operation.js";
import { type MoneyConflictDomain } from "../../operation-conflict-domain.js";
import { type OperationFamilyAdapter } from "../adapter.js";
export declare function circleDomains(record: CircleKnownOperation): readonly MoneyConflictDomain[];
/** The outcome list of the record's own version, which its validator ties the record's `terminal` flag to. */
export declare const circleTerminal: (record: Pick<CircleKnownOperation, "schemaVersion" | "state">) => boolean;
/**
 * Circle v2 routes and v1 routes, one file per operation; both signing profiles hold the route. A v1 route is read-only
 * (its commands refuse it except status), so a non-terminal one holds its accounts and both profiles until it is closed.
 */
export declare const circleAdapter: OperationFamilyAdapter<CircleKnownOperation>;
