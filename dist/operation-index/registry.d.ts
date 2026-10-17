import type { OperationFamilyAdapter } from "./adapter.js";
import type { OperationFamily } from "./types.js";
export type OperationRegistry = ReadonlyMap<OperationFamily, OperationFamilyAdapter>;
/**
 * Every family the index covers, in the order the guard reports blockers (the order the former store scan used,
 * then the families phase 4b WP2 added).
 */
export declare function operationRegistry(): OperationRegistry;
