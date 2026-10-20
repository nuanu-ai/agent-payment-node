import { type ActiveAssetPolicy } from "../allowlist-active-policy.js";
import { type AssetAtomicCaps, type AssetPolicyAdmission, type AssetPolicyRow } from "../asset-policy-registry.js";
import { type AssetUsageIdentity, type AssetUsageReservation } from "../asset-usage-ledger.js";
import type { X402SolanaRecord, X402SolanaTerms } from "./model.js";
/** The owner's admission of one mint for Solana x402: the active allowlist row, its x402 caps and the exact mechanism pin. */
export interface X402SolanaOwnerRow {
    readonly active: ActiveAssetPolicy;
    readonly row: AssetPolicyRow;
    readonly caps: AssetAtomicCaps;
}
export declare function x402SolanaOwnerRow(root: string, profile: string, payer: string, mint: string, now: Date): Promise<X402SolanaOwnerRow>;
/** The exact admission of one amount today (per-payment and daily caps against the shared usage of this account and mint). */
export declare function evaluateX402Solana(owner: X402SolanaOwnerRow, amountAtomic: string, dailyUsageAtomic: string, now: Date): AssetPolicyAdmission;
export declare function payeeAdmitted(owner: X402SolanaOwnerRow, payee: string, now: Date): boolean;
export declare function x402SolanaUsageIdentity(terms: Pick<X402SolanaTerms, "payer" | "mint">): AssetUsageIdentity;
export declare function x402SolanaUsageKey(operationId: string): string;
/** The usage hold follows the journal forward and never backward; each command repairs a lagging ledger. */
export declare function followX402SolanaUsage(root: string, record: X402SolanaRecord, now: Date): Promise<AssetUsageReservation | null>;
