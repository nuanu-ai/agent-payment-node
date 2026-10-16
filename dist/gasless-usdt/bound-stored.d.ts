import type { UsdtAnyBoundOperation } from "./bound-operation.js";
/**
 * R2 reader for a saved bound operation: its own integrity hashes and the field layout of the schema it was written with,
 * never the current USDT_GASLESS constants. Status, resume, observation and the release of a hold keep working for every
 * record an earlier release wrote, even after a pin, address or bound changes. Anything that signs or sends re-runs the
 * full current validation (`validateUsdtAnyBoundOperation`) first.
 */
export declare function validateUsdtStoredBoundOperation(value: unknown): UsdtAnyBoundOperation;
