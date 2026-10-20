import { type SolanaRpcPort } from "../solana/rpc.js";
import { type X402SolanaMessageTerms } from "./message.js";
export interface X402SolanaAccounts {
    readonly sourceTokenAccount: string;
    readonly destinationTokenAccount: string;
    readonly balanceAtomic: string;
}
/** The payer's and payee's classic associated token accounts for this mint. */
export declare function x402SolanaTokenAccounts(payer: string, payee: string, mint: string): Promise<{
    sourceTokenAccount: string;
    destinationTokenAccount: string;
}>;
/**
 * The mint, both token accounts and the genesis in one request: the mint must be an initialized classic SPL mint with the
 * owner's row decimals (a Token-2022 mint is refused by name), the payer's account must hold the price, and the payee's
 * account must already exist (APN never creates it; the facilitator would refuse a payment that pays rent).
 */
export declare function readX402SolanaAccounts(rpc: SolanaRpcPort, input: {
    readonly payer: string;
    readonly payee: string;
    readonly mint: string;
    readonly decimals: number;
    readonly amountAtomic: string;
}): Promise<X402SolanaAccounts>;
export interface X402SolanaBinding {
    readonly blockhash: string;
    readonly lastValidBlockHeight: string;
    /** The context slot of the blockhash read: the payment can only land in a later slot. */
    readonly floorSlot: string;
    readonly observedBlockHeight: string;
    readonly messageBase64: string;
    readonly messageHash: string;
    readonly unsignedPayload: string;
    readonly simulationSlot: string;
    readonly unitsConsumed: string;
}
/**
 * The send guard, after the owner's decision and before anything is signed: a fresh blockhash with its height (checked
 * against each other), the accounts again, the exact message, and a simulation of exactly those bytes.
 */
export declare function bindX402SolanaLifetime(rpc: SolanaRpcPort, terms: X402SolanaMessageTerms & {
    readonly payee: string;
}): Promise<X402SolanaBinding>;
