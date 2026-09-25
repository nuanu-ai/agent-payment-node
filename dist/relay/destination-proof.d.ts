import { type RelayUnsignedOperation } from "../relay-unsigned-operation.js";
import { type RelayDepositObservation } from "./deposit-effect.js";
export interface RelayBnbTransaction {
    readonly hash: string;
    readonly chainId: number;
    readonly to: string | null;
    readonly valueWei: bigint;
    readonly blockNumber: bigint | null;
    readonly blockHash: string | null;
}
export interface RelayBnbReceipt {
    readonly transactionHash: string;
    readonly status: "success" | "reverted";
    readonly blockNumber: bigint;
    readonly blockHash: string;
}
export interface RelayBnbBlock {
    readonly number: bigint;
    readonly hash: string;
}
/**
 * The adapter must derive effective transfers from an exhaustive transaction trace,
 * excluding reverted child calls. A partial or provider-enriched transfer list is
 * not a reliable trace. A missing trace leaves contract payouts unproven.
 */
export interface RelayBnbNativeTrace {
    readonly transactionHash: string;
    readonly blockHash: string;
    readonly complete: true;
    readonly revertedCallsExcluded: true;
    readonly transfers: readonly Readonly<{
        from: string;
        to: string;
        valueWei: bigint;
    }>[];
}
export interface RelayBnbProofPorts {
    chainId(): Promise<number>;
    transaction(hash: string): Promise<RelayBnbTransaction | null>;
    receipt(hash: string): Promise<RelayBnbReceipt | null>;
    block(number: bigint): Promise<RelayBnbBlock | null>;
    /** A consensus safe or finalized checkpoint; null when the RPC cannot supply one. */
    finalityCheckpoint(): Promise<RelayBnbBlock | null>;
    /** null when trace support or exhaustive success semantics are unavailable. */
    nativeTrace(hash: string): Promise<RelayBnbNativeTrace | null>;
}
export interface RelaySourceDepositProof {
    readonly transactionHash: string;
    readonly observation: RelayDepositObservation;
}
/** On-chain credit evidence. The candidate hash does not bind the transfer to this Relay order. */
export interface RelayBnbRecipientCreditEvidence {
    readonly operationId: string;
    readonly operationIntegrityHash: string;
    readonly quoteDigest: string;
    readonly orderId: string;
    readonly sourceDepositHash: string;
    readonly destinationTransactionHash: string;
    readonly destinationBlockNumber: string;
    readonly destinationBlockHash: string;
    readonly finalityBlockNumber: string;
    readonly finalityBlockHash: string;
    readonly recipient: string;
    readonly minimumOutputWei: string;
    readonly creditedWei: string;
    readonly method: "direct_native_transaction" | "receipt_bound_native_trace";
}
export type RelayBnbProofResult = Readonly<{
    /** A candidate hash can be an unrelated transfer, even when its recipient credit is real. */
    relayOrderFulfillmentProven: false;
    paidAcceptance: false;
}> & (Readonly<{
    status: "recipient_credit_proven";
    proof: RelayBnbRecipientCreditEvidence;
}> | Readonly<{
    status: "pending" | "unproven" | "mismatch";
    reason: string;
}>);
/**
 * Provider transaction hashes are discovery hints only. A valid credit can be an
 * unrelated payment to the same recipient; this function never proves Relay order
 * fulfillment or authorizes paid acceptance. It makes no sends or retries.
 */
export declare function proveRelayBnbDestination(input: Readonly<{
    operation: RelayUnsignedOperation;
    sourceDeposit: RelaySourceDepositProof;
    candidateHashes: readonly string[];
}>, ports: RelayBnbProofPorts): Promise<RelayBnbProofResult>;
