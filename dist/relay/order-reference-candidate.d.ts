import { validateRelayArbitrumUsdcEthereumUsdcQuote, type RelayArbitrumQuoteIntent } from "./arbitrum-usdc-ethereum-quote.js";
import type { RelayArbitrumSourceProof } from "./arbitrum-source-finality.js";
import type { RelayEthereumUsdcCreditResult } from "./ethereum-usdc-credit-proof.js";
type Quote = Awaited<ReturnType<typeof validateRelayArbitrumUsdcEthereumUsdcQuote>>;
export interface RelayOrderReferenceLog {
    readonly address: string;
    readonly topics: readonly string[];
    readonly data: string;
    readonly transactionHash: string;
    readonly blockNumber: bigint;
    readonly blockHash: string;
    readonly removed: boolean;
    readonly logIndex: bigint;
}
export interface RelayOrderReferenceReceipt {
    readonly transactionHash: string;
    readonly status: "success" | "reverted";
    readonly blockNumber: bigint;
    readonly blockHash: string;
    readonly logs: readonly RelayOrderReferenceLog[];
}
export interface RelayOrderReferenceDestinationTransaction {
    readonly hash: string;
    readonly chainId: number;
    readonly blockNumber: bigint;
    readonly blockHash: string;
    readonly input: string;
}
export interface RelayOrderReferenceDestinationBlock {
    readonly number: bigint;
    readonly hash: string;
    readonly timestampSeconds: bigint;
}
export interface RelayOrderReferenceEvidence {
    readonly rawQuote: unknown;
    readonly quoteIntent: RelayArbitrumQuoteIntent;
    readonly quote: Quote;
    readonly sourceProof: RelayArbitrumSourceProof;
    readonly sourceReceipt: RelayOrderReferenceReceipt;
    readonly destinationCredit: RelayEthereumUsdcCreditResult;
    readonly destinationReceipt: RelayOrderReferenceReceipt;
    readonly destinationTransaction: RelayOrderReferenceDestinationTransaction;
    readonly destinationBlock: RelayOrderReferenceDestinationBlock;
}
export type RelayOrderReferenceResult = Readonly<{
    status: "candidate_consistent" | "candidate_mismatch";
    relayOrderFulfillmentProven: false;
    cryptographicCausalityProven: false;
    paidAcceptance: false;
    reason: string | null;
    candidate: null | Readonly<{
        orderId: string;
        quoteDigest: string;
        sourceTransactionHash: string;
        sourceBlockHash: string;
        sourceDepositLogIndex: string;
        destinationTransactionHash: string;
        destinationBlockHash: string;
        destinationTransferLogIndex: string;
        creditedAtomic: string;
        destinationTimestampSeconds: string;
        candidateClass: "caller_supplied_order_reference_and_recipient_credit";
    }>;
}>;
/** Useful for detecting inconsistent candidates; caller-supplied records can be forged together. */
export declare function inspectRelayOrderReferenceCandidate(e: RelayOrderReferenceEvidence): Promise<RelayOrderReferenceResult>;
export {};
