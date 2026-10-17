import { type FinalizedReader } from "../evm-finalized-proof.js";
import { SecureStateStore } from "../secure-state-store.js";
import type { NonEvmSourceJournal } from "./non-evm-source-journal.js";
export declare const CIRCLE_SOURCE_PROOF_SCHEMA = "apn.circle-v2-source-proof.v1";
/** The Base receipt of a CCTP V2 source burn, read once at the finalized tag (no archive state). */
export interface CircleSourceProof {
    readonly schemaVersion: typeof CIRCLE_SOURCE_PROOF_SCHEMA;
    readonly operationId: string;
    readonly profileHash: string;
    readonly chainId: 8453;
    readonly payer: string;
    readonly to: string;
    readonly transactionHash: string;
    readonly nonceAtomic: string;
    readonly status: "success" | "reverted";
    readonly blockNumberAtomic: string;
    readonly blockHash: string;
    readonly blockTag: "finalized";
    readonly finalizedBlockNumberAtomic: string;
    readonly observedAt: string;
    readonly integrityHash: string;
}
/**
 * `non-evm-source-journals/<profileHash>/<operationId>.source-proof.json` beside the journal (never a record name, so the
 * operation index walk skips it). Create-only and bound to the journal's own burn (hash, nonce, payer, target): the
 * journal is never rewritten, and the index re-derives the operation as terminal from it after `rm -r operation-index`.
 */
export declare class CircleSourceProofStore extends SecureStateStore {
    private path;
    load(journal: NonEvmSourceJournal): Promise<CircleSourceProof | null>;
    /** Publishes the proof once; a concurrent observer's file wins and is returned after the same validation. */
    create(journal: NonEvmSourceJournal, proof: CircleSourceProof): Promise<CircleSourceProof>;
}
/** The payer's claim ends with the signing window, or earlier once the burn's finalized receipt is recorded (read only then). */
export declare function circleSourceTerminal(root: string, journal: NonEvmSourceJournal): boolean | Promise<boolean>;
export interface CircleSourceStatus {
    readonly schemaVersion: "apn.circle-v2-source-status.v1";
    readonly operationId: string;
    readonly phase: string;
    readonly outcome: CircleSourceProof["status"] | null;
    readonly sourceProof: CircleSourceProof | null;
    readonly waitingFor: string | null;
    readonly journal: NonEvmSourceJournal;
    readonly proofClass: string;
    readonly nextActions: readonly string[];
}
/**
 * `operation status` of a Circle CCTP V2 Base source burn: the saved journal and, when its burn transaction is known,
 * that transaction's receipt at the finalized tag (chain id, receipt, finalized head; no archive read). A receipt in a
 * finalized block is recorded once as the operation's proof; otherwise nothing is written and the status says why.
 */
export declare function circleSourceStatus(root: string, journal: NonEvmSourceJournal, read: FinalizedReader | undefined, now: () => number): Promise<CircleSourceStatus>;
