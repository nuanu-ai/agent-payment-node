import type { MerchantOperation } from "./model.js";
import { MERCHANT_AMOUNT, MERCHANT_CHAIN, MERCHANT_MECHANISM, MERCHANT_PAYEE, MERCHANT_TOKEN, MERCHANT_URL } from "./pins.js";

/** The exact payment one merchant operation makes. The payer is always the operation's own custody wallet. */
export interface MerchantTerms {
  readonly payer: string;
  readonly url: string;
  readonly chain: typeof MERCHANT_CHAIN;
  readonly token: string;
  readonly payee: string;
  readonly amount: string;
  readonly mechanism: Readonly<{ provider: string; reference: string }>;
}

/** Terms of a new operation for the payer custody(profile) resolved at prepare. */
export function merchantPrepareTerms(payer: string): MerchantTerms {
  return { payer, url: MERCHANT_URL, chain: MERCHANT_CHAIN, token: MERCHANT_TOKEN, payee: MERCHANT_PAYEE, amount: MERCHANT_AMOUNT, mechanism: MERCHANT_MECHANISM };
}

/** Terms of a stored operation, from its own recorded custody. */
export function merchantTerms(o: Pick<MerchantOperation, "custody">): MerchantTerms {
  return merchantPrepareTerms(o.custody.walletAddress);
}
