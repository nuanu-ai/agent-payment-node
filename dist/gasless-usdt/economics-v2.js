import { exactKeys, isPlainRecord } from "../canonical.js";
import { gaslessAddress } from "../gasless/validation.js";
import { decodeUsdtPaymasterData } from "./paymaster-data.js";
import { usdtEffectiveFeeCap, usdtFeeBound } from "./quote.js";
import { USDT_EXCHANGE_RATE_MAX, USDT_GASLESS, USDT_GASLESS_GAS, USDT_POST_OP_GAS_MAX, usdtFailure } from "./model.js";
/** Freeze owner amounts, initial gas and prices without using an informational quote as admission. */
export function draftUsdtV2(request, quote, price) {
    const { grossAtomic: gross, maxFeeAtomic: maximum, minReceivedAtomic: minimum } = request;
    if (gross <= 0n || minimum <= 0n || minimum > gross || maximum < 0n || request.sender === request.recipient) {
        usdtFailure("APN_INVALID_INPUT", "gasless_amount_bounds");
    }
    const feeCapAtomic = usdtEffectiveFeeCap(request);
    if (feeCapAtomic === 0n)
        usdtFailure("APN_FEE_BUDGET_EXCEEDED", "gasless_usdt_fee_budget_zero");
    return { request, feeCapAtomic, netAtomic: gross - feeCapAtomic, gas: USDT_GASLESS_GAS, price, quote,
        quotedFeeAtomic: usdtFeeBound(USDT_GASLESS_GAS, price.maxFeePerGas, quote.postOpGas, quote.exchangeRate) };
}
/** Signed bytes alone determine economics; no tentative equality check or frozen gas repricing. */
export function signedUsdtV2(result, draft, nowSeconds) {
    if (!isPlainRecord(result) || !exactKeys(result, ["paymaster", "paymasterData"]) ||
        gaslessAddress(result.paymaster) !== USDT_GASLESS.paymaster)
        usdtFailure("APN_PROVIDER_PROTOCOL", "gasless_usdt_paymaster_identity");
    const paymaster = decodeUsdtPaymasterData(result.paymasterData);
    if (paymaster.token !== USDT_GASLESS.token || paymaster.treasury !== USDT_GASLESS.treasury ||
        paymaster.exchangeRate === 0n || paymaster.exchangeRate > USDT_EXCHANGE_RATE_MAX ||
        paymaster.postOpGas === 0n || paymaster.postOpGas > USDT_POST_OP_GAS_MAX ||
        paymaster.paymasterValidationGasLimit === 0n || paymaster.paymasterValidationGasLimit > draft.gas.paymasterVerificationGasLimit) {
        usdtFailure("APN_PROVIDER_PROTOCOL", "gasless_usdt_signed_terms");
    }
    if (paymaster.validAfter > nowSeconds || paymaster.validUntil < nowSeconds + 60n || paymaster.validUntil > nowSeconds + 3600n) {
        usdtFailure("APN_PROVIDER_PROTOCOL", "gasless_usdt_paymaster_validity");
    }
    const quotedFeeAtomic = usdtFeeBound(draft.gas, draft.price.maxFeePerGas, paymaster.postOpGas, paymaster.exchangeRate);
    if (quotedFeeAtomic > draft.feeCapAtomic)
        usdtFailure("APN_FEE_BUDGET_EXCEEDED", "gasless_usdt_signed_rate_above_max_fee");
    return { plan: { ...draft, quotedFeeAtomic, quote: { paymaster: USDT_GASLESS.paymaster, token: USDT_GASLESS.token,
                postOpGas: paymaster.postOpGas, exchangeRate: paymaster.exchangeRate } }, paymaster };
}
//# sourceMappingURL=economics-v2.js.map