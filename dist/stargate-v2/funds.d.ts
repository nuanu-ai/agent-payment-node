type FundsReason = "max_native_debit_exceeded" | "insufficient_native_balance";
/** The known parts of a native debit; `gas` is absent when the refusal comes before eth_estimateGas. */
/** `opStackFees`: the OP-stack L1 data and operator fee upper bounds inside `required` (Optimism token lane only). */
interface FundsParts {
    readonly required: bigint;
    readonly limit: bigint;
    readonly principal?: bigint;
    readonly messagingFee?: bigint;
    readonly gas?: bigint;
    readonly opStackFees?: bigint;
}
/**
 * A native debit the owner's cap or the wallet's ETH cannot cover, refused by name with its numbers and no provider text.
 * Callers check a known value before eth_estimateGas: a node answers an unfunded value with an error envelope (for
 * example -32003 OutOfFunds) that would otherwise read as an RPC configuration failure.
 */
export declare function stargateFundsRefusal(reason: FundsReason, parts: FundsParts): never;
export {};
