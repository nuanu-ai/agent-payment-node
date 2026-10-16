import { type Hex } from "viem";
import type { RelayUnsignedOperation } from "../relay-unsigned-operation.js";
import { SecureStateStore } from "../secure-state-store.js";
/** `abandoned_unsent`: sealed bytes never sent whose nonce another transaction consumed at safe depth; they can never land. */
export type RelayNativeSourcePhase = "pending" | "signing_started" | "sealed" | "submitting" | "confirmed" | "failed" | "failed_before_effect" | "abandoned_unsent";
export interface RelayNativeSourceJournal {
    readonly schemaVersion: "apn.relay-native-source-journal.v1";
    readonly profileHash: string;
    readonly operationId: string;
    readonly operationIntegrityHash: string;
    readonly quoteDigest: string;
    readonly requestId: string;
    readonly depositEnvelopeHash: string;
    readonly phase: RelayNativeSourcePhase;
    readonly marker: string | null;
    readonly markedAt: string | null;
    readonly transactionHash: string | null;
    readonly observedAt: string | null;
    readonly integrityHash: string;
}
/** Provider locator stays in the durable owner journal, never in CLI or MCP output. */
export declare function publicRelayNativeSourceJournal(journal: RelayNativeSourceJournal): {
    schemaVersion: "apn.relay-native-source-journal.v1";
    profileHash: string;
    operationId: string;
    operationIntegrityHash: string;
    quoteDigest: string;
    depositEnvelopeHash: string;
    phase: RelayNativeSourcePhase;
    marker: string | null;
    markedAt: string | null;
    transactionHash: string | null;
    observedAt: string | null;
    integrityHash: string;
};
export declare class RelayNativeSourceJournalRepository extends SecureStateStore {
    private path;
    load(op: RelayUnsignedOperation): Promise<RelayNativeSourceJournal | null>;
    hasEffectClaim(op: RelayUnsignedOperation): Promise<boolean>;
    claimSigning(op: RelayUnsignedOperation, nonce: bigint): Promise<void>;
    /** Independent create-only fence survives restoration of an older mutable journal. */
    claimBroadcast(op: RelayUnsignedOperation, raw: Hex): Promise<void>;
    advance(op: RelayUnsignedOperation, expected: string | null, phase: RelayNativeSourcePhase, hash?: string | null, now?: Date): Promise<RelayNativeSourceJournal>;
}
/** Persist the single dispatch marker before the send. Replays only return the marker. */
export declare function dispatchRelayNativeDepositOnce(op: RelayUnsignedOperation, journal: RelayNativeSourceJournal, store: RelayNativeSourceJournalRepository, send: (raw: Hex) => Promise<string>, raw: Hex, now: Date): Promise<RelayNativeSourceJournal>;
