import type { WrappingSecretPort } from "./macos-keychain.js";
import { SecureStateStore } from "./secure-state-store.js";
/**
 * Each lane's own directory. The MetaMask native transfers and the provider direct transfers (`apn pay transfer`) keep one
 * sealed record per operation, `<directory>/<profile hash>/<operation id>.json`. The MetaMask gasless delegation disable
 * (`apn gasless transfer revoke`) sends a new request on every run, so its lane keeps one sealed record per request,
 * `<directory>/<profile hash>/<operation id>/<reference hash>.json`, never replaced, and removed (`discard`) only for a
 * request that provably never left the machine. Every lane counts for the wrapping-secret guard (wrapping-secret-custody.ts).
 */
export declare const PROVIDER_REQUEST_REFERENCE_DIRECTORIES: {
    readonly "metamask-native": "metamask-native-request-references";
    readonly "provider-direct": "provider-direct-request-references";
    readonly "metamask-revocation": "metamask-revocation-request-references";
};
export type ProviderRequestReferenceLane = keyof typeof PROVIDER_REQUEST_REFERENCE_DIRECTORIES;
/**
 * The hash that names a provider request in journals and output in place of its id. It is the value
 * `provider_request_reference_hash` has always shown for a direct transfer, so a record that keeps the id and a record
 * that seals it project the same hash.
 */
export declare function providerRequestReferenceHash(providerId: string, reference: string): string;
/** The operation a sealed provider request id belongs to, and the hash its journal or output keeps in place of the id. */
export interface ProviderRequestReferenceBinding {
    readonly lane: ProviderRequestReferenceLane;
    readonly providerId: string;
    readonly profileHash: string;
    readonly operationId: string;
    /** providerRequestReferenceHash(providerId, id). */
    readonly referenceHash: string;
}
/**
 * Custody of a provider's request id (the id of the request the owner's MFA approval waits on) for an operation whose
 * journal keeps only its hash.
 */
export interface ProviderRequestReferencePort {
    /**
     * Loads the wrapping secret, or creates the first one for a state root that holds nothing sealed, before an effect
     * whose request id is sealed after it. A refusal here is a refusal before any effect; the secret then stays in the
     * command's own Keychain copy, so the seal after the effect reads no Keychain again.
     */
    ready(): Promise<void>;
    /**
     * Seals the id once, before the journal names its hash (or, in a per-request lane, before the request is sent); the
     * caller holds the operation lock.
     */
    seal(binding: ProviderRequestReferenceBinding, reference: string): Promise<void>;
    /** The sealed id, or a precise refusal: a missing, damaged or foreign record, another secret, or a refused Keychain. */
    open(binding: ProviderRequestReferenceBinding): Promise<string>;
}
/**
 * A per-request lane only: removes the one record of a request that provably never left the machine, at the exact path
 * its binding names. Never a directory and never another record; an absent record is left absent. The caller holds the
 * operation lock under which it sealed that record.
 */
export interface ProviderRequestReferenceDiscardPort {
    discard(binding: ProviderRequestReferenceBinding): Promise<void>;
}
/**
 * The provider request ids of MetaMask native and provider direct transfers and of MetaMask gasless delegation disables,
 * sealed under the login-Keychain wrapping secret with the custody envelope every APN store uses. A journal written by a
 * release after 0.5.106 keeps only the id's hash; the id is sealed here once, before the journal names its hash: right
 * after the provider named it, or, for a MetaMask native transfer from 0.5.108 on, when APN names it itself, before the
 * request is sent. A delegation disable (0.5.109 on) records nothing in its operation; APN names its id and seals it here
 * before the request is sent, and its output names the hash. An id is opened only to read that request again (observe
 * and resume). Status, receipts and abandonment never open it.
 */
export declare class EncryptedProviderRequestReferenceStore implements ProviderRequestReferencePort, ProviderRequestReferenceDiscardPort {
    private readonly wrappingSecret;
    private readonly files;
    constructor(state: {
        readonly root: string;
    }, wrappingSecret: WrappingSecretPort);
    ready(): Promise<void>;
    /**
     * The journal does not name this operation's hash yet, so a record found here is only what an interrupted earlier
     * seal of the same operation left; it is replaced. A per-request lane never replaces a record: each request has a new
     * id, so a record already at its hash refuses (`APN_STATE_SECURITY`) and nothing is sealed.
     */
    seal(bindingInput: ProviderRequestReferenceBinding, reference: string): Promise<void>;
    open(bindingInput: ProviderRequestReferenceBinding): Promise<string>;
    discard(bindingInput: ProviderRequestReferenceBinding): Promise<void>;
}
/** One operation of a per-request lane, whose sealed requests `listProviderRequestReferences` reads. */
export interface ProviderRequestReferenceScope {
    readonly lane: ProviderRequestReferenceLane;
    readonly profileHash: string;
    readonly operationId: string;
}
/**
 * One sealed request of a per-request lane: its reference hash and its record file's modification time, which is when
 * its seal was written (a record is created once and never rewritten).
 */
export interface ProviderRequestReferenceRecord {
    readonly referenceHash: string;
    readonly writtenAtMs: number;
}
/**
 * The requests sealed for one operation in a per-request lane, newest first (by the record file's modification time,
 * then by hash). A directory listing of the state root the store writes to, with one `lstat` per record: no Keychain
 * read, nothing opened. An absent directory holds none; a directory that is not the owner's own refuses
 * (`APN_STATE_SECURITY`), as every state read does. Atomic-write stages and regular files whose name starts with a dot
 * (Finder's .DS_Store) are not records, as the wrapping-secret guard reads them. Every other entry must be a regular
 * file named `<64 hex>.json`, the only name the store writes; anything else (another name, a link, a directory, a
 * dot-named link or directory) refuses the whole listing with `APN_STATE_CORRUPT /
 * provider_request_reference_listing_invalid`, and is never skipped.
 */
export declare function listProviderRequestReferences(state: Pick<SecureStateStore, "recordEntries" | "root">, scopeInput: ProviderRequestReferenceScope): Promise<readonly ProviderRequestReferenceRecord[]>;
