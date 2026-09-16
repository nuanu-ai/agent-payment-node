import type { StoredMoneyOperation } from "./operation-service.js";
/** Two money operations conflict only when they can race for one account on one network. */
export interface MoneyConflictDomain {
    readonly family: "evm" | "solana" | "tron";
    readonly network: string;
    readonly account: string;
}
export declare function evmConflictDomain(chainId: number | string, account: string): MoneyConflictDomain;
export declare function railConflictDomain(rail: "solana" | "tron", account: string): MoneyConflictDomain;
/** LI.FI's own identifier for Solana mainnet. It is not an EVM chain id and never names one. */
export declare const SOLANA_BRIDGE_CHAIN_ID = "1151111081099710";
/**
 * A bridge claims the lock of the chain it signs on. Every EVM source keeps the EVM domain it has
 * always taken; a Solana source takes the same `solana:<genesis>:<address>` key a direct Solana
 * transfer takes, so the two collide on one account and never collide across families.
 */
export declare function bridgeConflictDomain(chainId: number | string, account: string): MoneyConflictDomain;
export declare function conflictDomainKey(domain: MoneyConflictDomain): string;
/** Null marks a record whose network or account cannot be read; the caller then blocks the whole profile. */
export declare function storedOperationDomains(operation: StoredMoneyOperation): readonly MoneyConflictDomain[] | null;
