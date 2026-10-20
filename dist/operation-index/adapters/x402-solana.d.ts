import { type X402SolanaRecord } from "../../x402-solana/model.js";
import { type OperationFamilyAdapter } from "../adapter.js";
/**
 * Solana x402 payments hold the payer's Solana account until their own outcome: a finalized settlement or on-chain
 * failure, the chain's proof that the transaction can no longer land, an unexposed payment's end, or the owner's abandon.
 */
export declare const x402SolanaAdapter: OperationFamilyAdapter<X402SolanaRecord>;
