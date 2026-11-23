/** Read-only view: every durable token reservation excludes the nonce from other local EVM lanes. */
export declare function occupiedUniswapTokenNonces(root: string, account: string): Promise<readonly bigint[]>;
export declare function uniswapTokenNonceOwned(root: string, account: string, nonce: string): Promise<boolean>;
/** The BNB Smart Chain token lane's reservations, which exclude their nonces from other local chain-56 lanes. */
export declare function occupiedBnbUniswapTokenNonces(root: string, account: string): Promise<readonly bigint[]>;
export declare function bnbUniswapTokenNonceOwned(root: string, account: string, nonce: string): Promise<boolean>;
