import { type FinalizedBatchRead } from "../evm-finalized-proof.js";
import { type CircleEffect, type CircleEnvelope } from "./operation-model.js";
/** What a possibly-broadcast approval or burn may become: proven never to land, under observation, or still undecided. */
export type CircleSentOutcome = "never_lands" | "own_transaction_known" | "not_proven";
/**
 * What a possibly-broadcast mint or cleanup may become: proven never to land; under observation; the identical sealed
 * bytes may go again (the node holds neither, and the latest nonce has not passed them); or wait (the nonce moved on
 * without a proof that another transaction took it).
 */
export type CircleAmbiguousOutcome = "own_transaction_known" | "never_lands" | "resend_identical" | "other_transaction_pending";
/** The family's one-node finalized reader: the chain the effect is signed on, and one JSON-RPC batch per call. */
export interface CircleFinalizedRead {
    readonly chainId: number;
    readonly finalizedBatch: FinalizedBatchRead;
}
/** A possibly-broadcast approval or burn (submission fence crossed, no receipt proof). */
export declare function circleSentOutcome(rpc: CircleFinalizedRead, effect: CircleEffect): Promise<CircleSentOutcome>;
/**
 * A possibly-broadcast mint or cleanup. Below the finalized nonce, a hash the node holds neither as a transaction nor a
 * receipt may be re-sent as the identical bytes only while the latest nonce has not passed them (same hash and nonce:
 * at most one inclusion); the latest nonce is read after the lookups, so an inclusion between them reads as moved on.
 */
export declare function circleAmbiguousOutcome(rpc: CircleFinalizedRead, effect: CircleEffect): Promise<CircleAmbiguousOutcome>;
/** The era an envelope records: the latest block its RPC returned while freezing it, before anything was signed. */
export declare function circleEnvelopeEra(block: Readonly<Record<string, unknown>>): NonNullable<CircleEnvelope["eraBlock"]>;
