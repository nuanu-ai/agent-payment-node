import { BridgeHttps } from "./lifi/https.js";
/**
 * The public reads that prove, at the FINALIZED tag, that nothing more of an operation can land on its signing account
 * (R4): the chain id, the account's finalized nonce, and lookups of the operation's own transactions by hash. No state
 * is read at an old block (P1), so any keyless public endpoint answers them.
 */
export type FinalizedReadMethod = "eth_chainId" | "eth_getTransactionCount" | "eth_getTransactionByHash" | "eth_getTransactionReceipt" | "eth_getBlockByNumber";
export interface FinalizedChainRead {
    call(method: FinalizedReadMethod, params: readonly unknown[]): Promise<unknown>;
}
export declare function finalizedQuantity(value: unknown): bigint;
/** A keyless public HTTPS JSON-RPC endpoint, one exact result envelope per call, through the shared bounded transport. */
export declare function publicFinalizedRead(url: string, label: string, https?: Pick<BridgeHttps, "request">): FinalizedChainRead;
/** The finalized-tag reader of each chain an R4 proof may need, by chain id. */
export type FinalizedReader = (chainId: number) => FinalizedChainRead;
/** The public RPC setting each family already reads for that chain. */
export declare const FINALIZED_RPC_ENV: Readonly<Record<number, string>>;
/** The production reader: the chain's own APN_<CHAIN>_RPC_URL, read keyless; a missing setting is named in the refusal. */
export declare function environmentFinalizedReader(environment: Readonly<Record<string, string | undefined>>): FinalizedReader;
export declare function assertFinalizedChain(rpc: FinalizedChainRead, chainId: number): Promise<void>;
export type OwnTransactionSeen = "not_found" | "included";
/** What a record says a nonce closure must prove: its signing chain and account, the highest nonce it froze, its own hashes. */
export interface NonceClosureFacts {
    readonly chainId: number;
    readonly account: string;
    readonly highestNonce: bigint;
    readonly ownHashes: readonly string[];
}
export type NonceClosureCheck = {
    readonly closed: true;
    readonly finalizedNonce: bigint;
    readonly ownTransactions: readonly {
        readonly transactionHash: string;
        readonly seen: OwnTransactionSeen;
    }[];
} | {
    readonly closed: false;
    readonly waitingFor: string;
};
/**
 * Closed when, at the finalized block of its signing chain, the signer's nonce is past every nonce the record froze (so
 * none of its envelopes can ever be included again) and none of its own transaction hashes is pending. Hashes are read
 * only once the nonce is past.
 */
export declare function checkNonceClosure(facts: NonceClosureFacts, rpc: FinalizedChainRead): Promise<NonceClosureCheck>;
/** One signed effect: its chain, signer, nonce and transaction hash. */
export interface SignedEffectFacts {
    readonly chainId: number;
    readonly account: string;
    readonly nonce: bigint;
    readonly transactionHash: string;
}
export type NeverLandsCheck = {
    readonly neverLands: true;
    readonly finalizedNonce: bigint;
} | {
    readonly neverLands: false;
    readonly waitingFor: string;
};
/**
 * R4 exit 2 for one signed effect: at the finalized tag the signer's nonce is past the effect's nonce (so the nonce is
 * spent by a finalized transaction) and the node knows neither the effect's transaction nor a receipt for it, so that
 * transaction was not the one and can never be included. The nonce is read first, then the hash.
 */
export declare function checkNeverLands(effect: SignedEffectFacts, rpc: FinalizedChainRead): Promise<NeverLandsCheck>;
