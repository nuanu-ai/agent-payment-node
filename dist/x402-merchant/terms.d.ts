import type { MerchantAssetPin } from "./asset-pins.js";
import type { MerchantOperation } from "./model.js";
import type { FrozenMerchantChallenge } from "./protocol.js";
import { MERCHANT_CHAIN } from "./pins.js";
/**
 * The exact payment one merchant operation makes. The payer is always the operation's own custody wallet; the payee
 * and amount are the challenge row frozen at prepare; the asset is the pin that row named.
 */
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
    readonly asset: MerchantAssetPin;
    /** Version 1 (x402engine Bitcoin-price lane): legacy mechanism, URL and delivery schema. */
    readonly legacy: boolean;
    /** The operation's fee context is v1 (pinned GasPriceOracle, zero operator fee); new operations use v2. */
    readonly feePins: boolean;
}
/** Terms of a new operation: payer custody(profile), `--url`, and the single challenge row naming a pinned asset. */
export declare function merchantPrepareTerms(payer: string, url: string, frozen: FrozenMerchantChallenge, asset: MerchantAssetPin): MerchantTerms;
/** Terms of a stored operation, from its own recorded custody, URL, asset and frozen row (version 1: the frozen legacy table). */
export declare function merchantTerms(o: Pick<MerchantOperation, "schemaVersion" | "custody" | "frozen" | "url" | "asset" | "feeContext">): MerchantTerms;
