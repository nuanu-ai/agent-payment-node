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
export type EvmAmbiguousSendOutcome = "own_transaction_known" | "never_lands" | "resend_identical" | "other_transaction_pending";
/**
 * R4 for possibly-broadcast bytes that no receipt proves yet. The nonces are read first, then the hash, so a transaction
 * included between the reads is seen as known rather than mistaken for another one:
 * - the node knows the transaction or a receipt: observe only;
 * - the safe nonce is past the signed nonce and the hash is unknown: another transaction took it, the bytes never land;
 * - the latest nonce has not passed the signed nonce and the hash is unknown: the identical bytes may be sent again
 *   (same hash, same nonce: at most one inclusion);
 * - otherwise another transaction holds the nonce below safe depth: wait.
 */
export declare function evmAmbiguousSendOutcome(read: (method: "eth_getTransactionCount" | "eth_getTransactionByHash" | "eth_getTransactionReceipt", params: readonly unknown[]) => Promise<unknown>, input: Readonly<{
    account: string;
    nonce: bigint;
    transactionHash: string;
}>): Promise<EvmAmbiguousSendOutcome>;
