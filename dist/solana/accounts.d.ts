import { type SolanaRpcPort } from "./rpc.js";
export interface SolanaAccountInfo {
    readonly owner: string;
    readonly lamports: bigint;
    readonly data: Buffer;
    readonly executable: boolean;
}
export declare function associatedUsdc(owner: string): Promise<string>;
/** The classic SPL associated token account of one owner for one pinned mint. */
export declare function associatedToken(owner: string, mint: string): Promise<string>;
export declare function readAccounts(rpc: SolanaRpcPort, addresses: readonly string[]): Promise<{
    readonly slot: bigint;
    readonly accounts: readonly (SolanaAccountInfo | null)[];
}>;
export declare function accountRead(addresses: readonly string[]): {
    method: "getMultipleAccounts";
    params: readonly [readonly string[], {
        readonly encoding: "base64";
        readonly commitment: "confirmed";
    }];
};
/** Decodes one base64 `getMultipleAccounts` result that must carry exactly `count` entries. */
export declare function multipleAccounts(value: unknown, count: number): {
    readonly slot: bigint;
    readonly accounts: readonly (SolanaAccountInfo | null)[];
};
export declare function requireNativeAccount(account: SolanaAccountInfo | null): bigint;
export declare function requireUsdcMint(account: SolanaAccountInfo | null): void;
/** A pinned mint must be an initialized classic SPL mint with exactly the pinned decimals. */
export declare function requireTokenMint(account: SolanaAccountInfo | null, decimals: number): void;
export declare function usdcAmount(account: SolanaAccountInfo | null, owner: string): bigint;
/** An absent associated token account holds zero; a present one must be an initialized classic SPL account of this owner and mint. */
export declare function tokenAccountAmount(account: SolanaAccountInfo | null, owner: string, mint: string): bigint;
export declare function requireSolanaFunds(nativeBalance: bigint, tokenBalance: bigint, amount: bigint, feeAndRent: bigint, native: boolean): void;
