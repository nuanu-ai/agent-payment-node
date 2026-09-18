import { type UsdtGasPrice, type UsdtGaslessGas, type UsdtTokenQuote, type UsdtTransferPlan, type UsdtTransferRequest } from "./model.js";
/** `pimlico_getTokenQuotes` result for exactly the pinned token: one quote, pinned paymaster and storage layout. */
export declare function validateUsdtTokenQuote(result: unknown): UsdtTokenQuote;
/** `pimlico_getUserOperationGasPrice`: the fast tier is offered; the slow tier is the floor the bundler will accept. */
export declare function validateUsdtGasPrice(result: unknown): {
    readonly fast: UsdtGasPrice;
    readonly slow: UsdtGasPrice;
};
/**
 * Worst-case token charge: every gas limit plus the paymaster's postOp overhead, at the offered max fee per gas and the
 * given exchange rate, rounded up. The paymaster computes `(actualGasCost + postOpGas * feePerGas) * rate / 1e18`, and
 * the actual gas cost can never exceed the sum of the limits at the max fee.
 */
export declare function usdtFeeBound(gas: UsdtGaslessGas, maxFeePerGas: bigint, postOpGas: bigint, exchangeRate: bigint): bigint;
/**
 * Prepare: F = min(max fee, gross - min received) is the whole fee budget and the exact allowance the batch grants, and
 * N = gross - F is the recipient's credit. A quote whose worst case exceeds F refuses; nothing is widened to fit it.
 */
export declare function planUsdtTransfer(request: UsdtTransferRequest, quote: UsdtTokenQuote, price: UsdtGasPrice): UsdtTransferPlan;
