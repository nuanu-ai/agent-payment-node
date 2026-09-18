import { type UsdtPaymasterPayload, type UsdtTransferPlan } from "./model.js";
/** Exact decode of `paymasterData`; any other length, mode or flag refuses. */
export declare function decodeUsdtPaymasterData(value: unknown): UsdtPaymasterPayload;
/**
 * `pm_getPaymasterData` result for the planned operation. The signed rate is re-priced against the plan: its worst case
 * must still fit F, the owner's fee budget, which is also the only allowance the batch grants.
 */
export declare function validateUsdtPaymasterData(result: unknown, plan: UsdtTransferPlan, nowSeconds: bigint): UsdtPaymasterPayload;
