import type { MerchantOperation } from "./model.js";
import { MERCHANT_CHAIN } from "./pins.js";
/** The exact payment one merchant operation makes. The payer is always the operation's own custody wallet. */
export interface MerchantTerms {
    readonly payer: string;
    readonly url: string;
    readonly chain: typeof MERCHANT_CHAIN;
    readonly token: string;
    readonly payee: string;
    readonly amount: string;
    readonly mechanism: Readonly<{
        provider: string;
        reference: string;
    }>;
}
/** Terms of a new operation for the payer custody(profile) resolved at prepare. */
export declare function merchantPrepareTerms(payer: string): MerchantTerms;
/** Terms of a stored operation, from its own recorded custody. */
export declare function merchantTerms(o: Pick<MerchantOperation, "custody">): MerchantTerms;
