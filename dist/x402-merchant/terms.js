import { MERCHANT_AMOUNT, MERCHANT_CHAIN, MERCHANT_MECHANISM, MERCHANT_PAYEE, MERCHANT_TOKEN, MERCHANT_URL } from "./pins.js";
/** Terms of a new operation for the payer custody(profile) resolved at prepare. */
export function merchantPrepareTerms(payer) {
    return { payer, url: MERCHANT_URL, chain: MERCHANT_CHAIN, token: MERCHANT_TOKEN, payee: MERCHANT_PAYEE, amount: MERCHANT_AMOUNT, mechanism: MERCHANT_MECHANISM };
}
/** Terms of a stored operation, from its own recorded custody. */
export function merchantTerms(o) {
    return merchantPrepareTerms(o.custody.walletAddress);
}
//# sourceMappingURL=terms.js.map