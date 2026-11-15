import { type MetaMaskNativeMfaTask, type MetaMaskNativeOperation, type patchMetaMaskNativeOperation } from "./metamask-native-journal.js";
import type { MetaMaskNativeMfaEvidence, MetaMaskNativeReadObservation, MetaMaskNativeSubmission } from "./metamask-native-transfer-adapter.js";
import type { ProviderRequestReferencePort } from "./provider-request-reference-store.js";
/**
 * The MetaMask request id of a native transfer (the request the owner's MFA approval waits on). A record 0.5.106 or
 * earlier wrote keeps the id itself and is read, observed and projected as it always was. 0.5.107 sealed the id the
 * hand-off returned; 0.5.108 and later name the id themselves and seal it before the hand-off. Both seal it under the
 * Keychain wrapping secret (provider-request-reference-store.ts) and keep only its hash (`providerRequestIdHash`); the
 * id is opened only to send the request once and to read it again, and output shows only the hash.
 */
type StoredRequest = Pick<MetaMaskNativeOperation, "operationId" | "context" | "providerRequestId" | "providerRequestIdHash">;
/** Seals APN's request id for `op` and returns the hash its effect marker keeps in its place; the caller holds the lock. */
export declare function sealMetaMaskNativeRequest(references: ProviderRequestReferencePort, op: Pick<MetaMaskNativeOperation, "operationId" | "context">, requestId: string): Promise<string>;
/**
 * The journal fields the hand-off's result writes: its state, transaction hash and diagnostic as returned, and the
 * owner's MFA task named by `requestIdHash`, the hash the effect marker already keeps (it stays as written).
 */
export declare function metaMaskNativeHandoffFields(result: MetaMaskNativeSubmission, requestIdHash: string): Parameters<typeof patchMetaMaskNativeOperation>[1];
/**
 * The stored request id of `op`: kept in the record, or opened from its seal. A seal that cannot be opened (missing,
 * damaged, another transfer's, another secret, a refused Keychain) throws its own precise refusal before any read.
 */
export declare function openMetaMaskNativeRequest(references: ProviderRequestReferencePort | undefined, op: StoredRequest): Promise<string>;
/** The owner's MFA task for the stored request, naming it as the record does: by the id, or by the hash of a sealed id. */
export declare function metaMaskNativeRequestTask(op: Pick<MetaMaskNativeOperation, "providerRequestId" | "providerRequestIdHash">, evidence: MetaMaskNativeMfaEvidence, source: MetaMaskNativeMfaTask["source"]): MetaMaskNativeMfaTask;
/**
 * The approval window a read of a request APN sent itself records. A server answer that names no `approval.expiresAt`
 * keeps the non-null `expiresAt` the task already holds for the same request (the same `requestIdHash`), from the send or
 * an earlier read, rather than erasing it: the window of one request does not move. The kept expiry keeps the
 * `evidenceHash` of the answer that named it, since the new answer's hash does not cover it; the auth method is the
 * read's own. A record 0.5.107 or earlier wrote takes the read's evidence as it always did.
 */
export declare function metaMaskNativeReadEvidence(op: Pick<MetaMaskNativeOperation, "handoffPath" | "providerRequestIdHash" | "mfaTask">, evidence: MetaMaskNativeMfaEvidence): MetaMaskNativeMfaEvidence;
/** A read observation as output shows it: `request_id_hash`, the record's own hash, in place of a sealed id. */
export type MetaMaskNativePublicReadObservation = MetaMaskNativeReadObservation | (Omit<MetaMaskNativeReadObservation, "request_id"> & {
    readonly request_id_hash: string;
});
export declare function publicMetaMaskNativeReadObservation(observation: MetaMaskNativeReadObservation, op: Pick<MetaMaskNativeOperation, "providerRequestIdHash">): MetaMaskNativePublicReadObservation;
export {};
