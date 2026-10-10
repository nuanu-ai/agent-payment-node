import { decodeUsdtPaymasterData } from "./paymaster-data.js";
import { type UsdtTokenQuote, type UsdtTransferPlan, type UsdtTransferRequest, type UsdtGasPrice } from "./model.js";
export type UsdtV2Plan = Omit<UsdtTransferPlan, "quote"> & {
    /** Authoritative signed token terms; USD estimate lives only in informational facts. */
    readonly quote: Omit<UsdtTokenQuote, "exchangeRateNativeToUsd">;
};
/** Freeze owner amounts, initial gas and prices without using an informational quote as admission. */
export declare function draftUsdtV2(request: UsdtTransferRequest, quote: UsdtTokenQuote, price: UsdtGasPrice): UsdtTransferPlan;
/** Signed bytes alone determine economics; no tentative equality check or frozen gas repricing. */
export declare function signedUsdtV2(result: unknown, draft: Pick<UsdtTransferPlan, "request" | "gas" | "price" | "feeCapAtomic" | "netAtomic">, nowSeconds: bigint): {
    readonly plan: UsdtV2Plan;
    readonly paymaster: ReturnType<typeof decodeUsdtPaymasterData>;
};
