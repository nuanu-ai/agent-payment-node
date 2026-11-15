import type { WrappingSecretPort } from "./macos-keychain.js";
/**
 * One sealed record per operation, `<directory>/<profile hash>/<operation id>.json`, in its lane's own directory: the
 * MetaMask native transfers and the provider direct transfers (`apn pay transfer`). Both count for the wrapping-secret
 * guard (SEALED_DIRECTORIES in wrapping-secret-custody.ts).
 */
export declare const PROVIDER_REQUEST_REFERENCE_DIRECTORIES: {
    readonly "metamask-native": "metamask-native-request-references";
    readonly "provider-direct": "provider-direct-request-references";
};
export type ProviderRequestReferenceLane = keyof typeof PROVIDER_REQUEST_REFERENCE_DIRECTORIES;
/**
 * The hash that names a provider request in journals and output in place of its id. It is the value
 * `provider_request_reference_hash` has always shown for a direct transfer, so a record that keeps the id and a record
 * that seals it project the same hash.
 */
export declare function providerRequestReferenceHash(providerId: string, reference: string): string;
/** The operation a sealed provider request id belongs to, and the hash its journal keeps in place of the id. */
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
    /** Seals the id once, before the journal names its hash; the caller holds the operation lock. */
    seal(binding: ProviderRequestReferenceBinding, reference: string): Promise<void>;
    /** The sealed id, or a precise refusal: a missing, damaged or foreign record, another secret, or a refused Keychain. */
    open(binding: ProviderRequestReferenceBinding): Promise<string>;
}
/**
 * The provider request ids of MetaMask native and provider direct transfers, sealed under the login-Keychain wrapping
 * secret with the custody envelope every APN store uses. A journal written by a release after 0.5.106 keeps only the
 * id's hash; the id is sealed here once, before the journal names its hash: right after the provider named it, or, for
 * a MetaMask native transfer from 0.5.108 on, when APN names it itself, before the request is sent. It is opened only
 * to read that request again (observe and resume). Status, receipts and abandonment never open it.
 */
export declare class EncryptedProviderRequestReferenceStore implements ProviderRequestReferencePort {
    private readonly wrappingSecret;
    private readonly files;
    constructor(state: {
        readonly root: string;
    }, wrappingSecret: WrappingSecretPort);
    ready(): Promise<void>;
    /**
     * The journal does not name this operation's hash yet, so a record found here is only what an interrupted earlier
     * seal of the same operation left; it is replaced.
     */
    seal(bindingInput: ProviderRequestReferenceBinding, reference: string): Promise<void>;
    open(bindingInput: ProviderRequestReferenceBinding): Promise<string>;
}
