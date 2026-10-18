export type EvmUnsentOutcomeRead = (method: "eth_getTransactionCount" | "eth_getTransactionByHash", params: readonly unknown[]) => Promise<unknown>;
export type EvmUnsentOutcome = "never_lands" | "nonce_not_consumed" | "own_transaction_known";
export declare function evmUnsentOutcome(read: EvmUnsentOutcomeRead, input: Readonly<{
    account: string;
    nonce: bigint;
    transactionHash: string;
}>): Promise<EvmUnsentOutcome>;
