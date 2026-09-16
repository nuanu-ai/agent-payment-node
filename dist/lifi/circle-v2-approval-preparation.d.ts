export interface CircleV2ApprovalState {
    readonly chainId: 8453;
    readonly payer: string;
    readonly token: string;
    readonly spender: string;
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
    /** Base execution plus L1 data and operator fee upper estimate from the same RPC adapter. */
    readonly totalNativeDebitWei: string;
}
/** Implementation must obtain allowance and balance at the same fresh Base block and estimate the supplied calldata. */
export type CircleV2ApprovalStateReader = (query: Readonly<{
    chainId: 8453;
    payer: string;
    token: string;
    spender: string;
    data: string;
}>) => Promise<CircleV2ApprovalState>;
export interface CircleV2ApprovalLimits {
    readonly maxGasLimitAtomic: string;
    readonly maxFeePerGasWei: string;
    readonly maxPriorityFeePerGasWei: string;
    readonly maxNativeDebitWei: string;
    readonly ttlMs: number;
}
export interface CircleV2ApprovalPreparation {
    readonly kind: "circle_v2_base_usdc_approval_preparation";
    readonly executionAdmitted: false;
    readonly baseStateSourceVerified: false;
    readonly quoteIndicativeOnly: true;
    readonly blockers: readonly string[];
    readonly token: string;
    readonly spender: string;
    readonly approvalCapAtomic: string;
    readonly observedAllowanceAtomic: string;
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
    readonly preparedAt: string;
    readonly expiresAt: string;
    readonly intentDigest: string;
}
export declare function prepareCircleV2BaseUsdcApprovalReadOnly(input: Readonly<{
    chainId: 8453;
    payer: string;
    token: string;
    spender: string;
    approvalCapAtomic: string;
}>, readBase: CircleV2ApprovalStateReader, limits: CircleV2ApprovalLimits, now?: () => number): Promise<CircleV2ApprovalPreparation>;
