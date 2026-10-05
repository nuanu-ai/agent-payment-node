import type { UsdtAnyBoundOperation } from "./bound-operation.js";
import type { UsdtTransferPlan } from "./model.js";
import type { UsdtV2Plan } from "./economics-v2.js";
export declare function restoreUsdtPlan(bound: UsdtAnyBoundOperation): UsdtTransferPlan | UsdtV2Plan;
