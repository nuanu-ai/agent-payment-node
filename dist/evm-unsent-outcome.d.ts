export type EvmUnsentOutcomeRead = (method: "eth_getTransactionCount" | "eth_getTransactionByHash", params: readonly unknown[]) => Promise<unknown>;
export type EvmUnsentOutcome = "never_lands" | "nonce_not_consumed" | "own_transaction_known";
export declare function evmUnsentOutcome(read: EvmUnsentOutcomeRead, input: Readonly<{
    account: string;
    nonce: bigint;
    transactionHash: string;
}>): Promise<EvmUnsentOutcome>;
/**
 * The same proof for bytes that MAY have been broadcast (an ambiguous send): the nonce at the safe head is past the
 * signed nonce, and the node knows neither the transaction nor a receipt for its hash. Another transaction then took
 * that nonce, so these bytes can never land. A known transaction or receipt means observe only.
 */
export declare function evmSentOutcome(read: (method: "eth_getTransactionCount" | "eth_getTransactionByHash" | "eth_getTransactionReceipt", params: readonly unknown[]) => Promise<unknown>, input: Readonly<{
    account: string;
    nonce: bigint;
    transactionHash: string;
}>): Promise<EvmUnsentOutcome>;
