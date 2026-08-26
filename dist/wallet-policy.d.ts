import type { Address, WalletRecord } from "./model.js";
import type { BalanceSnapshot } from "./ports.js";
type NativeWallet = {
    readonly found: true;
    readonly profile: string;
    readonly address: Address;
    readonly createdAt: string;
    readonly bindingHash: string;
} | {
    readonly found: false;
};
export declare function canonicalProfile(value: unknown): string;
export declare function canonicalAddress(value: unknown): Address;
export declare function parseWalletEnsure(value: unknown, profile: string): NativeWallet;
export declare function parseWalletDescribe(value: unknown, profile: string): NativeWallet;
export declare function assertWalletMatches(stored: WalletRecord, native: Extract<NativeWallet, {
    found: true;
}>): void;
export declare function publicWallet(wallet: WalletRecord, status: string): unknown;
export declare function validateBalance(snapshot: BalanceSnapshot, address: Address): void;
export declare function publicProvenance(snapshot: BalanceSnapshot): unknown;
export {};
