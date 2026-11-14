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
export declare function publicWallet(wallet: WalletRecord, status: string): Readonly<Record<string, unknown>>;
/** The command that creates a local wallet for this profile, or completes one whose key is sealed (see incompleteWallet). */
export declare function completeWalletCommand(profile: string): string;
/** No local wallet: wallet ensure for the profile asked about, never the default profile. */
export declare function absentWallet(profile: string): Readonly<Record<string, unknown>>;
/**
 * A key sealed in `wallets/<profile>.json` with no public `wallet.json`: a `wallet ensure` or `wallet import` stopped
 * between the two writes. `wallet ensure` for the profile completes it from that sealed key alone and creates no other.
 * The address is not shown here: status decrypts nothing, so it is first proven by that completion.
 */
export declare function incompleteWallet(profile: string): Readonly<Record<string, unknown>>;
export declare function validateBalance(snapshot: BalanceSnapshot, address: Address): void;
export declare function publicProvenance(snapshot: BalanceSnapshot): unknown;
export {};
