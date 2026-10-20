import type { ChainAccount, ChainWalletStoragePort } from "../direct-rail-ports.js";
import { type X402SolanaMessageTerms } from "./message.js";
import type { X402SolanaRecord, X402SolanaTerms } from "./model.js";
export declare function x402SolanaMessageTerms(terms: X402SolanaTerms): X402SolanaMessageTerms;
/** The profile's own local Solana account, which must still be the frozen payer. */
export declare function x402SolanaAccount(accounts: ChainWalletStoragePort, profile: string, payer?: string): Promise<ChainAccount>;
/**
 * The payer's only signature: the message rebuilt from the frozen terms and the bound lifetime must be byte-equal to the
 * one the send guard simulated, and the result must carry exactly that message, a verified payer signature and an empty
 * fee payer slot. Ed25519 is deterministic, so signing the same message again yields the same bytes.
 */
export declare function signX402Solana(accounts: ChainWalletStoragePort, record: X402SolanaRecord): Promise<{
    rawPayload: import("@solana/kit").Base64EncodedWireTransaction;
    rawPayloadHash: string;
    payerSignature: string;
}>;
