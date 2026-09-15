import type { StoredMoneyOperation } from "./operation-service.js";
/** Two money operations conflict only when they can race for one account on one network. */
export interface MoneyConflictDomain {
    readonly family: "evm" | "solana" | "tron";
    readonly network: string;
    readonly account: string;
}
export declare function evmConflictDomain(chainId: number | string, account: string): MoneyConflictDomain;
export declare function railConflictDomain(rail: "solana" | "tron", account: string): MoneyConflictDomain;
export declare function conflictDomainKey(domain: MoneyConflictDomain): string;
/** Null marks a record whose network or account cannot be read; the caller then blocks the whole profile. */
export declare function storedOperationDomains(operation: StoredMoneyOperation): readonly MoneyConflictDomain[] | null;
