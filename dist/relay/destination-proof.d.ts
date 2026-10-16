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
    readonly logs?: readonly Readonly<{
        address: string;
        topics: readonly string[];
        data: string;
    }>[];
}
export interface RelayBnbBlock {
    readonly number: bigint;
    readonly hash: string;
}
/** Destination reads of one proof. Every credit is proven from the receipt of the candidate transaction at a safe or
 * finalized checkpoint (P1): its direct native value, the pinned Relay router's SolverNativeTransfer event, or the
 * pinned token's Transfer event. No trace, historical balance or code-hash read is needed. */
export interface RelayBnbProofPorts {
    chainId(): Promise<number>;
    transaction(hash: string): Promise<RelayBnbTransaction | null>;
    receipt(hash: string): Promise<RelayBnbReceipt | null>;
    block(number: bigint): Promise<RelayBnbBlock | null>;
    /** A consensus safe or finalized checkpoint; null when the RPC cannot supply one. */
    finalityCheckpoint(): Promise<RelayBnbBlock | null>;
    /** Polygon milestone consensus finality: every Polygon destination proof uses it, whatever the source chain. */
    polygonFinalizedCheckpoint?(): Promise<RelayBnbBlock | null>;
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
    readonly sourceDepositHash: string | null;
    readonly destinationTransactionHash: string;
    readonly destinationBlockNumber: string;
    readonly destinationBlockHash: string;
    readonly finalityKind?: "polygon_milestone_finalized";
    readonly finalityBlockNumber: string;
    readonly finalityBlockHash: string;
    readonly recipient: string;
    readonly minimumOutputWei: string;
    readonly creditedWei: string;
    readonly method: "direct_native_transaction" | "relay_router_event" | "pinned_erc20_transfer_event";
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
/** Relay router V3 (relay-periphery cc6808ba97f7, deployments/v3/addresses.json): one immutable, non-proxy CREATE2
 * deployment at the same address on Base, BNB, Polygon, Monad and MegaETH. Its SolverNativeTransfer(to, amount) is
 * emitted only by a frame that completed the native transfer, so the receipt event proves the credit (P5: address pin,
 * no code-hash pin). */
export declare const RELAY_ROUTER_V3 = "0xb92fe925dc43a0ecde6c8b1a2709c170ec4fff4f";
/** Physical POSTs of one candidate proof: chain, transaction, receipt and finality head; then the inclusion block and,
 * for a depth checkpoint, the checkpoint block (P4). */
export declare const RELAY_DESTINATION_PROOF_POSTS = 2;
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
/** Base credit observation has no source journal or order-causal proof. */
export declare function proveRelayBaseDestination(operation: RelayUnsignedOperation, candidateHashes: readonly string[], ports: RelayBnbProofPorts): Promise<RelayBnbProofResult>;
/** A provider candidate is only a discovery hint; even a real native credit is not causal proof. */
export declare function proveRelayNativeDestination(operation: RelayUnsignedOperation, sourceHash: string, candidateHashes: readonly string[], ports: RelayBnbProofPorts): Promise<RelayBnbProofResult>;
