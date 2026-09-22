/** Read-only view: every durable token reservation excludes the nonce from other local EVM lanes. */
export declare function occupiedUniswapTokenNonces(root: string, account: string): Promise<readonly bigint[]>;
export declare function uniswapTokenNonceOwned(root: string, account: string, nonce: string): Promise<boolean>;
