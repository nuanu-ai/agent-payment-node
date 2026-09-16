import { type CircleV2PreflightTransport } from "./circle-v2-preflight.js";
import type { CircleV2PreflightedDraft } from "./circle-v2-draft.js";
export interface CircleV2BaseState {
    readonly chainId: 8453;
    readonly payer: string;
    readonly draftBlockHash: string;
    readonly blockNumber: string;
    readonly blockHash: string;
    readonly latestNonceAtomic: string;
    readonly pendingNonceAtomic: string;
    readonly usdcBalanceAtomic: string;
    readonly usdcAllowanceAtomic: string;
    readonly nativeBalanceWei: string;
    readonly gasLimitAtomic: string;
    readonly maxFeePerGasWei: string;
    readonly maxPriorityFeePerGasWei: string;
    readonly l1DataFeeUpperWei: string;
    readonly operatorFeeUpperWei: string;
}
/** The implementation must only read Base state and pin token reads and gas estimate to the fresh preflight block. */
export type CircleV2BaseStateReader = (query: Readonly<{
    payer: string;
    token: string;
    spender: string;
    to: string;
    data: string;
    valueAtomic: string;
    draftBlockNumber: string;
    freshBlockNumber: string;
    freshBlockHash: string;
}>) => Promise<CircleV2BaseState>;
export interface CircleV2SourcePreparationLimits {
    /** Explicitly frozen maximum token approval for this source intent. */
    readonly maxAllowanceAtomic: string;
    readonly maxGasLimitAtomic: string;
    readonly maxFeePerGasWei: string;
    readonly maxPriorityFeePerGasWei: string;
    readonly maxNativeDebitWei: string;
    readonly ttlMs: number;
}
export interface CircleV2SourcePreparation {
    readonly kind: "circle_v2_base_source_preparation";
    readonly executionAdmitted: false;
    readonly quoteAuthenticityVerified: false;
    readonly baseStateSourceVerified: false;
    readonly blockers: readonly string[];
    readonly draftIntegrityDigest: string;
    readonly quoteHash: string;
    readonly quote: {
        readonly signedQuote: string;
        readonly feeToken: string;
        readonly feeTotalAtomic: string;
        readonly expiry: unknown;
    };
    readonly recipient: {
        readonly wallet: string;
        readonly ata: string;
        readonly setup: "existing_ata" | "create_ata";
    };
    readonly principalAtomic: string;
    readonly requiredUsdcDebitAtomic: string;
    readonly maxAllowanceAtomic: string;
    readonly sourceRefundAddress: string;
    readonly sourceBlock: {
        readonly number: string;
        readonly hash: string;
    };
    readonly transaction: {
        readonly type: "eip1559";
        readonly chainId: 8453;
        readonly from: string;
        readonly to: string;
        readonly data: string;
        readonly valueAtomic: "0";
        readonly nonceAtomic: string;
        readonly gasLimitAtomic: string;
        readonly maxFeePerGasWei: string;
        readonly maxPriorityFeePerGasWei: string;
    };
    readonly maximumNativeDebitWei: string;
    readonly l1DataFeeUpperWei: string;
    readonly operatorFeeUpperWei: string;
    readonly preparedAt: string;
    readonly expiresAt: string;
    readonly preparationDigest: string;
}
export declare function prepareCircleV2BaseSourceReadOnly(draft: CircleV2PreflightedDraft, transport: CircleV2PreflightTransport, readBase: CircleV2BaseStateReader, limits: CircleV2SourcePreparationLimits, now?: () => number): Promise<CircleV2SourcePreparation>;
