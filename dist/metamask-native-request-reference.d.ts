import { type MetaMaskNativeMfaTask, type MetaMaskNativeOperation, type patchMetaMaskNativeOperation } from "./metamask-native-journal.js";
import type { MetaMaskNativeMfaEvidence, MetaMaskNativeReadObservation, MetaMaskNativeSubmission } from "./metamask-native-transfer-adapter.js";
import type { ProviderRequestReferencePort } from "./provider-request-reference-store.js";
/**
 * The MetaMask request id of a native transfer (the request the owner's MFA approval waits on). A record 0.5.106 or
 * earlier wrote keeps the id itself and is read, observed and projected as it always was. A later release seals the id
 * the hand-off returns under the Keychain wrapping secret (provider-request-reference-store.ts) and keeps only its hash
 * (`providerRequestIdHash`); the id is opened only to read that request again, and output shows only the hash.
 */
type StoredRequest = Pick<MetaMaskNativeOperation, "operationId" | "context" | "providerRequestId" | "providerRequestIdHash">;
/** Seals the request id the hand-off returned for `op` and returns the hash its journal keeps in its place. */
export declare function sealMetaMaskNativeRequest(references: ProviderRequestReferencePort, op: Pick<MetaMaskNativeOperation, "operationId" | "context">, requestId: string): Promise<string>;
/** What the journal keeps of a request id the hand-off returned: the hash of its seal, or that it could not be sealed. */
export type MetaMaskNativeKeptRequest = {
    readonly requestIdHash: string;
} | {
    readonly unsealed: true;
};
/**
 * Seals the request id the hand-off returned. This runs after the hand-off, so nothing may stop its outcome from being
 * recorded: a seal that fails (the wrapping secret was read before consent, so only a write can fail) drops the id,
 * which is never kept in plaintext, and the journal says why it keeps no request.
 */
export declare function keepMetaMaskNativeRequest(references: ProviderRequestReferencePort, op: Pick<MetaMaskNativeOperation, "operationId" | "context">, requestId: string): Promise<MetaMaskNativeKeptRequest>;
/**
 * The journal fields the hand-off's result writes: its state, transaction hash and diagnostic as returned, the hash of a
 * sealed request id with the owner's MFA task, or `providerRequestReason` for a request id that could not be sealed.
 */
export declare function metaMaskNativeHandoffFields(result: MetaMaskNativeSubmission, kept: MetaMaskNativeKeptRequest | undefined): Parameters<typeof patchMetaMaskNativeOperation>[1];
/**
 * The stored request id of `op`: kept in the record, or opened from its seal. A seal that cannot be opened (missing,
 * damaged, another transfer's, another secret, a refused Keychain) throws its own precise refusal before any read.
 */
export declare function openMetaMaskNativeRequest(references: ProviderRequestReferencePort | undefined, op: StoredRequest): Promise<string>;
/** The owner's MFA task for the stored request, naming it as the record does: by the id, or by the hash of a sealed id. */
export declare function metaMaskNativeRequestTask(op: Pick<MetaMaskNativeOperation, "providerRequestId" | "providerRequestIdHash">, evidence: MetaMaskNativeMfaEvidence, source: MetaMaskNativeMfaTask["source"]): MetaMaskNativeMfaTask;
/** A read observation as output shows it: `request_id_hash`, the record's own hash, in place of a sealed id. */
export type MetaMaskNativePublicReadObservation = MetaMaskNativeReadObservation | (Omit<MetaMaskNativeReadObservation, "request_id"> & {
    readonly request_id_hash: string;
});
export declare function publicMetaMaskNativeReadObservation(observation: MetaMaskNativeReadObservation, op: Pick<MetaMaskNativeOperation, "providerRequestIdHash">): MetaMaskNativePublicReadObservation;
export {};
