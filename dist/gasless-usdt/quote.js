import { exactKeys, isPlainRecord } from "../canonical.js";
import { gaslessAddress } from "../gasless/validation.js";
import { USDT_EXCHANGE_RATE_MAX, USDT_GASLESS, USDT_GASLESS_GAS, USDT_POST_OP_GAS_MAX, usdtFailure, } from "./model.js";
const QUOTE_KEYS = ["paymaster", "token", "postOpGas", "exchangeRate", "exchangeRateNativeToUsd", "balanceSlot", "allowanceSlot"];
const WEI = 10n ** 18n;
/** `pimlico_getTokenQuotes` result for exactly the pinned token: one quote, pinned paymaster and storage layout. */
export function validateUsdtTokenQuote(result) {
    if (!isPlainRecord(result) || !exactKeys(result, ["quotes"]) || !Array.isArray(result.quotes) || result.quotes.length !== 1) {
        usdtFailure("APN_PROVIDER_PROTOCOL", "gasless_usdt_quote_shape");
    }
    const quote = result.quotes[0];
    if (!isPlainRecord(quote) || !exactKeys(quote, QUOTE_KEYS))
        usdtFailure("APN_PROVIDER_PROTOCOL", "gasless_usdt_quote_shape");
    if (gaslessAddress(quote.paymaster) !== USDT_GASLESS.paymaster)
        usdtFailure("APN_PROVIDER_PROTOCOL", "gasless_usdt_quote_paymaster");
    if (gaslessAddress(quote.token) !== USDT_GASLESS.token)
        usdtFailure("APN_PROVIDER_PROTOCOL", "gasless_usdt_quote_token");
    if (quantity(quote.balanceSlot) !== USDT_GASLESS.balanceSlot || quantity(quote.allowanceSlot) !== USDT_GASLESS.allowanceSlot) {
        usdtFailure("APN_PROVIDER_PROTOCOL", "gasless_usdt_quote_storage_layout");
    }
    const postOpGas = quantity(quote.postOpGas), exchangeRate = quantity(quote.exchangeRate);
    const exchangeRateNativeToUsd = quantity(quote.exchangeRateNativeToUsd);
    if (postOpGas === 0n || postOpGas > USDT_POST_OP_GAS_MAX)
        usdtFailure("APN_PROVIDER_PROTOCOL", "gasless_usdt_quote_post_op_gas");
    if (exchangeRate === 0n || exchangeRate > USDT_EXCHANGE_RATE_MAX || exchangeRateNativeToUsd === 0n ||
        exchangeRateNativeToUsd > USDT_EXCHANGE_RATE_MAX)
        usdtFailure("APN_PROVIDER_PROTOCOL", "gasless_usdt_quote_rate");
    return { paymaster: USDT_GASLESS.paymaster, token: USDT_GASLESS.token, postOpGas, exchangeRate, exchangeRateNativeToUsd };
}
/** `pimlico_getUserOperationGasPrice`: the fast tier is offered; the slow tier is the floor the bundler will accept. */
export function validateUsdtGasPrice(result) {
    if (!isPlainRecord(result) || !exactKeys(result, ["slow", "standard", "fast"]))
        usdtFailure("APN_PROVIDER_PROTOCOL", "gasless_usdt_price_shape");
    const tier = (value) => {
        if (!isPlainRecord(value) || !exactKeys(value, ["maxFeePerGas", "maxPriorityFeePerGas"])) {
            usdtFailure("APN_PROVIDER_PROTOCOL", "gasless_usdt_price_shape");
        }
        const maxFeePerGas = quantity(value.maxFeePerGas), maxPriorityFeePerGas = quantity(value.maxPriorityFeePerGas);
        if (maxFeePerGas === 0n || maxPriorityFeePerGas > maxFeePerGas)
            usdtFailure("APN_PROVIDER_PROTOCOL", "gasless_usdt_price_bounds");
        return { maxFeePerGas, maxPriorityFeePerGas };
    };
    tier(result.standard);
    const slow = tier(result.slow), fast = tier(result.fast);
    if (fast.maxFeePerGas < slow.maxFeePerGas || fast.maxPriorityFeePerGas < slow.maxPriorityFeePerGas) {
        usdtFailure("APN_PROVIDER_PROTOCOL", "gasless_usdt_price_tiers");
    }
    return { fast, slow };
}
/**
 * Worst-case token charge: every gas limit plus the paymaster's postOp overhead, at the offered max fee per gas and the
 * given exchange rate, rounded up. The paymaster computes `(actualGasCost + postOpGas * feePerGas) * rate / 1e18`, and
 * the actual gas cost can never exceed the sum of the limits at the max fee.
 */
export function usdtFeeBound(gas, maxFeePerGas, postOpGas, exchangeRate) {
    const units = gas.verificationGasLimit + gas.callGasLimit + gas.paymasterVerificationGasLimit + gas.paymasterPostOpGasLimit +
        gas.preVerificationGas + postOpGas;
    const product = units * maxFeePerGas * exchangeRate;
    return (product + WEI - 1n) / WEI;
}
/**
 * Prepare: F = min(max fee, gross - min received) is the whole fee budget and the exact allowance the batch grants, and
 * N = gross - F is the recipient's credit. A quote whose worst case exceeds F refuses; nothing is widened to fit it.
 */
export function planUsdtTransfer(request, quote, price) {
    const { grossAtomic: gross, maxFeeAtomic: maxFee, minReceivedAtomic: minimum } = request;
    if (gross <= 0n || minimum <= 0n || minimum > gross || maxFee < 0n)
        usdtFailure("APN_INVALID_INPUT", "gasless_amount_bounds");
    if (request.recipient === request.sender)
        usdtFailure("APN_INVALID_INPUT", "gasless_usdt_self_transfer");
    const feeCapAtomic = maxFee < gross - minimum ? maxFee : gross - minimum;
    if (feeCapAtomic === 0n) {
        usdtFailure("APN_FEE_BUDGET_EXCEEDED", "gasless_usdt_fee_budget_zero", "The sponsor charges its fee in USDT; --max-fee and --min-received must leave a positive fee budget.");
    }
    const quotedFeeAtomic = usdtFeeBound(USDT_GASLESS_GAS, price.maxFeePerGas, quote.postOpGas, quote.exchangeRate);
    if (quotedFeeAtomic > feeCapAtomic) {
        usdtFailure("APN_FEE_BUDGET_EXCEEDED", "gasless_usdt_quote_above_max_fee", `The current USDT fee quote (${quotedFeeAtomic} atomic) exceeds the fee budget (${feeCapAtomic} atomic).`);
    }
    return { request, feeCapAtomic, netAtomic: gross - feeCapAtomic, quotedFeeAtomic, quote, price, gas: USDT_GASLESS_GAS };
}
function quantity(value) {
    if (typeof value !== "string" || !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]{0,63})$/u.test(value)) {
        usdtFailure("APN_PROVIDER_PROTOCOL", "gasless_usdt_quantity");
    }
    return BigInt(value);
}
//# sourceMappingURL=quote.js.map