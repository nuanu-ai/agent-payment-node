/** Reconciles token reservations against durable operation/effect markers before another local EVM lane chooses a nonce. */
export declare function occupiedUniswapTokenNonces(root: string, account: string): Promise<readonly bigint[]>;
export declare function uniswapTokenNonceOwned(root: string, account: string, nonce: string): Promise<boolean>;
