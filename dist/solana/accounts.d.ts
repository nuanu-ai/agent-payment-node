import { type SolanaRpcPort } from "./rpc.js";
export interface SolanaAccountInfo {
    readonly owner: string;
    readonly lamports: bigint;
    readonly data: Buffer;
    readonly executable: boolean;
}
export declare function associatedUsdc(owner: string): Promise<string>;
export declare function readAccounts(rpc: SolanaRpcPort, addresses: readonly string[]): Promise<{
    readonly slot: bigint;
    readonly accounts: readonly (SolanaAccountInfo | null)[];
}>;
export declare function requireNativeAccount(account: SolanaAccountInfo | null): bigint;
export declare function requireUsdcMint(account: SolanaAccountInfo | null): void;
export declare function usdcAmount(account: SolanaAccountInfo | null, owner: string): bigint;
export declare function requireSolanaFunds(nativeBalance: bigint, tokenBalance: bigint, amount: bigint, feeAndRent: bigint, native: boolean): void;
