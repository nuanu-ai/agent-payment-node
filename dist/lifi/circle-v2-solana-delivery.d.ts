import { SecureStateStore } from "../secure-state-store.js";
import { type SolanaRpcPort } from "../solana/rpc.js";
import type { CircleSourceProof } from "./circle-v2-source-proof.js";
import type { NonEvmSourceJournal } from "./non-evm-source-journal.js";
import { BridgeHttps } from "./https.js";
export declare const CIRCLE_SOLANA_DELIVERY_SCHEMA = "apn.circle-v2-solana-delivery.v1";
/** Circle's CCTP V2 message transmitter on Solana mainnet; a received message's nonce account is its PDA ["used_nonce", nonce]. */
export declare const CIRCLE_SOLANA_MESSAGE_TRANSMITTER = "CCTPV2Sm4AdWt5296sk4P66VBZ7bEhcARwFaaS9YPbeC";
export interface CircleSolanaDelivery {
    readonly schemaVersion: typeof CIRCLE_SOLANA_DELIVERY_SCHEMA;
    readonly operationId: string;
    readonly profileHash: string;
    readonly sourceTransactionHash: string;
    readonly eventNonce: string;
    readonly recipientOwner: string;
    readonly recipientAta: string;
    readonly burnAtomic: string;
    readonly feeExecutedAtomic: string;
    readonly mintedAtomic: string;
    readonly solanaSignature: string;
    readonly slotAtomic: string;
    readonly observedAt: string;
    readonly integrityHash: string;
}
/** The two public reads of the destination: Circle's issuer API and a Solana mainnet RPC. */
export interface CircleSolanaDeliveryReader {
    /** `GET https://iris-api.circle.com/v2/messages/6?transactionHash=<hash>`; `body` is the parsed JSON of a 200 answer. */
    issuerMessages(sourceTransactionHash: string): Promise<{
        readonly status: number;
        readonly body: unknown;
    }>;
    /** Only an explicitly configured `APN_SOLANA_RPC_URL`; null without it (no default Solana endpoint proves a delivery). */
    readonly solana: SolanaRpcPort | null;
}
export declare const CIRCLE_SOLANA_RPC_ACTION = "Set APN_SOLANA_RPC_URL to a Solana mainnet HTTPS endpoint, then rerun the same command.";
/** Production reader: the pinned Circle origin over the bridge HTTPS transport, and the explicitly configured Solana RPC. */
export declare function circleSolanaDeliveryReader(solana: SolanaRpcPort | null, https?: Pick<BridgeHttps, "request">): CircleSolanaDeliveryReader;
export type CircleSolanaDeliveryState = "delivered" | "awaiting_issuer_message" | "awaiting_attestation" | "awaiting_forward" | "awaiting_solana_rpc" | "awaiting_solana_finality";
export interface CircleSolanaDeliveryView {
    readonly state: CircleSolanaDeliveryState;
    /** Circle's reported forwarding state while it has not named a finalized Solana transaction; null once delivered. */
    readonly forwardState: string | null;
    readonly proof: CircleSolanaDelivery | null;
    readonly waitingFor: string | null;
    /** True only when this call read the chain and recorded the proof. */
    readonly recorded: boolean;
}
/** `non-evm-source-journals/<profileHash>/<operationId>.solana-delivery.json`: create-only, never a record name. */
export declare class CircleSolanaDeliveryStore extends SecureStateStore {
    private path;
    load(journal: NonEvmSourceJournal): Promise<CircleSolanaDelivery | null>;
    /** Publishes the proof once; a concurrent observer's file wins and is returned after the same validation. */
    create(journal: NonEvmSourceJournal, delivery: CircleSolanaDelivery): Promise<CircleSolanaDelivery>;
}
/**
 * The delivery of a burn whose finalized receipt succeeded. A recorded proof is returned without any read; otherwise one
 * issuer read and, once Circle names a forwarding transaction, the Solana genesis and that transaction at `finalized`.
 */
export declare function circleSolanaDelivery(root: string, journal: NonEvmSourceJournal, source: CircleSourceProof, reader: CircleSolanaDeliveryReader | undefined, now: () => number): Promise<CircleSolanaDeliveryView>;
