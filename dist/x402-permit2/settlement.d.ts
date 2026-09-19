import type { Address, Hex } from "../model.js";
import { type Permit2ListAsset } from "./registry.js";
export interface Permit2SettlementExpectation {
    readonly listAsset: Permit2ListAsset;
    readonly payer: Address;
    readonly payTo: Address;
    readonly amountAtomic: string;
    /** From the seller's PAYMENT-RESPONSE; a seller claim only until this receipt proves it. */
    readonly transactionHash: Hex;
    /** Whether the signed payload carried the EIP-2612 permit, which selects the proxy's settleWithPermit path. */
    readonly withPermit: boolean;
}
export interface Permit2SettlementProof {
    readonly transactionHash: Hex;
    readonly blockHash: Hex;
    readonly blockNumber: string;
    readonly transferLogIndex: string;
    readonly settledEvent: "Settled" | "SettledWithPermit";
}
/**
 * Independent settlement proof from a successful receipt on the admitted chain: exactly one pinned-token Transfer
 * from the payer to the payee for the exact amount, and exactly one matching proxy settlement event. HTTP success
 * or a facilitator claim alone never completes the payment.
 */
export declare function verifyPermit2SettlementReceipt(receipt: unknown, expected: Permit2SettlementExpectation): Permit2SettlementProof;
/** eth_call parameters that read the Permit2 unordered-nonce word for recovery; read-only. */
export declare function permit2NonceBitmapCall(owner: Address, nonce: string): {
    readonly to: Address;
    readonly data: Hex;
};
/** True when the frozen nonce is spent. A spent nonce without a matching receipt is ambiguous, never success. */
export declare function permit2NonceConsumed(bitmapWord: unknown, nonce: string): boolean;
