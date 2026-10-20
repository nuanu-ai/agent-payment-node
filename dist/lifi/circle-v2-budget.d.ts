/** The command a caller reruns with other limits: source submission or the separate approval. */
export type CircleV2Command = "apn circle source submit" | "apn circle approval prepare";
export interface CircleV2GasLimits {
    readonly maxGasLimitAtomic: string;
    readonly maxFeePerGasWei: string;
    readonly maxPriorityFeePerGasWei: string;
    readonly maxNativeDebitWei: string;
}
/** Circle's quoted fee must stay below the principal and within the caller's --max-source-fee-atomic. */
export declare function circleV2FeeWithinBudget(reason: string, quotedFeeAtomic: bigint, amountAtomic: bigint, maxSourceFeeAtomic: bigint): void;
/** The payer's Base USDC must cover the debit the transaction makes (the principal plus Circle's fee, or the approval cap). */
export declare function circleV2UsdcCovers(reason: string, command: CircleV2Command, what: string, requiredAtomic: bigint, balanceAtomic: bigint): void;
/** Base gas, fee per gas and tip within APN's bridge ceiling and the caller's limits. Call after the shape checks. */
export declare function circleV2GasWithinBudget(reasonPrefix: string, command: CircleV2Command, gasAtomic: bigint, maxFeePerGasWei: bigint, maxPriorityFeePerGasWei: bigint, limits: CircleV2GasLimits): void;
/** The most Base ETH the transaction may debit, within the caller's --max-native-debit-wei and the payer's balance. */
export declare function circleV2NativeWithinBudget(reasonPrefix: string, command: CircleV2Command, nativeDebitWei: bigint, nativeBalanceWei: bigint, maxNativeDebitWei: string): void;
