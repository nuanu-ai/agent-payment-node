import { SecureStateStore } from "../secure-state-store.js";
import { type SolanaReadMethod } from "../solana/rpc.js";
import type { CircleSourceProof } from "./circle-v2-source-proof.js";
import { BridgeHttps } from "./https.js";
import type { NonEvmSourceJournal } from "./non-evm-source-journal.js";
export declare const CIRCLE_SOLANA_DELIVERY_SCHEMA = "apn.circle-v2-solana-delivery.v1";
/** Circle's CCTP V2 message transmitter on Solana mainnet; a received message's nonce account is its PDA ["used_nonce", nonce]. */
export declare const CIRCLE_SOLANA_MESSAGE_TRANSMITTER = "CCTPV2Sm4AdWt5296sk4P66VBZ7bEhcARwFaaS9YPbeC";
export declare const CIRCLE_SOLANA_RPC_ACTION = "Set APN_SOLANA_RPC_URL to a Solana mainnet HTTPS endpoint, then rerun the same command.";
export interface CircleSolanaDelivery {
    readonly schemaVersion: typeof CIRCLE_SOLANA_DELIVERY_SCHEMA;
    readonly operationId: string;
    readonly profileHash: string;
    readonly sourceTransactionHash: string;
    readonly eventNonce: string;
    readonly messageSha256: string;
    readonly recipientOwner: string;
    readonly recipientAta: string;
    readonly burnAtomic: string;
    readonly maxFeeAtomic: string;
    readonly feeExecutedAtomic: string;
    readonly mintedAtomic: string;
    readonly solanaSignature: string;
    readonly slotAtomic: string;
    readonly observedAt: string;
    readonly integrityHash: string;
}
/** Solana reads only: no method that sends can be called through it. */
export interface SolanaReadPort {
    readonly originHash: string;
    call(method: SolanaReadMethod, params: readonly unknown[]): Promise<unknown>;
}
/** The two public reads of the destination: Circle's issuer API and a Solana mainnet RPC. */
export interface CircleSolanaDeliveryReader {
    /** `GET https://iris-api.circle.com/v2/messages/6?transactionHash=<hash>`; `body` is the parsed JSON of a 200 answer. */
    issuerMessages(sourceTransactionHash: string): Promise<{
        readonly status: number;
        readonly body: unknown;
    }>;
    /** Only an explicitly configured `APN_SOLANA_RPC_URL`; null without it (no default Solana endpoint proves a delivery). */
    readonly solana: SolanaReadPort | null;
}
/** Production reader: the pinned Circle origin over the bridge HTTPS transport, and the explicitly configured Solana RPC. */
export declare function circleSolanaDeliveryReader(solana: SolanaReadPort | null, https?: Pick<BridgeHttps, "request">): CircleSolanaDeliveryReader;
export type CircleSolanaDeliveryState = "delivered" | "awaiting_issuer_message" | "awaiting_attestation" | "awaiting_forward" | "forward_failed" | "awaiting_solana_rpc" | "awaiting_solana_finality" | "unread";
export interface CircleSolanaDeliveryView {
    readonly state: CircleSolanaDeliveryState;
    /** Circle's reported forwarding state while no receipt is recorded; null once delivered or when unknown. */
    readonly forwardState: string | null;
    readonly proof: CircleSolanaDelivery | null;
    readonly waitingFor: string | null;
    /** Actions of the delivery itself, before the status command (`unread`: the failed read's own next actions). */
    readonly nextActions: readonly string[];
    readonly unreadReason?: string;
    /** True only when this call read the chain and recorded the proof. */
    readonly recorded: boolean;
}
/** `non-evm-source-journals/<profileHash>/<operationId>.solana-delivery.json` and one claim per message nonce. */
export declare class CircleSolanaDeliveryStore extends SecureStateStore {
    private path;
    load(journal: NonEvmSourceJournal): Promise<CircleSolanaDelivery | null>;
    /** The message's one operation: a create-only claim; a message another operation claimed proves nothing here. */
    claim(journal: NonEvmSourceJournal, nonce: string, signature: string): Promise<void>;
    /** Publishes the proof once; a concurrent observer's file wins and is returned after the same validation. */
    create(journal: NonEvmSourceJournal, delivery: CircleSolanaDelivery): Promise<CircleSolanaDelivery>;
}
/**
 * The delivery of a burn whose finalized receipt succeeded. A recorded proof is returned without any read; otherwise one
 * issuer read and, once the message is attested, Solana reads at `finalized`. A failed read becomes `unread` with its reason.
 */
export declare function circleSolanaDelivery(root: string, journal: NonEvmSourceJournal, source: CircleSourceProof, reader: CircleSolanaDeliveryReader | undefined, now: () => number): Promise<CircleSolanaDeliveryView>;
