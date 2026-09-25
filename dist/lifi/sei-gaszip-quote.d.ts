import type { Address } from "../model.js";
export declare const SEI_GASZIP_LOCAL_MAX_AGE_MS = 60000;
export declare const SEI_GASZIP_SOURCE_CHAIN_ID = 1;
export declare const SEI_GASZIP_BUYER: Address;
export interface SeiGasZipQuoteInspection {
    readonly kind: "sei_gaszip_quote_inspection";
    readonly signable: false;
    readonly execution_blocked: true;
    readonly reason: "source_destination_contract_observer_recovery_and_policy_unreviewed";
    readonly providerExpiry: null;
    readonly fetchedAt: string;
    readonly localExpiresAt: string;
    readonly quoteDigest: string;
    readonly transactionRequestDigest: string;
    readonly quoteId: string;
    readonly transactionId: string;
    readonly tool: "gasZipBridge";
    readonly fromChainId: 1;
    readonly toChainId: 1329;
    readonly fromToken: Address;
    readonly toToken: Address;
    readonly owner: Address;
    readonly recipient: Address;
    readonly sourceAmountAtomic: string;
    readonly bridgeAmountAtomic: string;
    readonly quotedOutputAtomic: string;
    readonly minimumOutputAtomic: string;
    readonly feeAtomic: string;
    readonly transactionTarget: Address;
    readonly transactionValueAtomic: string;
    readonly transactionDataDigest: string;
}
/** Accept one already fetched provider response. `fetchedAtMs` must come from the caller's trusted fetch clock. */
export declare function inspectSeiGasZipQuote(value: unknown, fetchedAtMs: number): SeiGasZipQuoteInspection;
/** Reparse and compare the entire quote at the original capture time. Always returns a blocked inspection. */
export declare function revalidateSeiGasZipQuote(saved: SeiGasZipQuoteInspection, value: unknown, nowMs: number): SeiGasZipQuoteInspection;
