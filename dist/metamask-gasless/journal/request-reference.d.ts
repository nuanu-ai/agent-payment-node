import type { WrappingSecretPort } from "../../macos-keychain.js";
import { type MetaMaskGaslessDispatched } from "../dispatch.js";
import type { MetaMaskGaslessProviderIntent } from "../model.js";
import type { MetaMaskGaslessOperationRecord } from "../operation-model.js";
import type { MetaMaskGaslessRequestBinding, MetaMaskGaslessRequestReferencePort } from "../ports.js";
/** One sealed record per operation, `<directory>/<profile hash>/<operation id>.json`, beside its plaintext journal. */
export declare const MM_REQUEST_REFERENCE_DIRECTORY = "metamask-gasless-request-references";
/**
 * The provider request id of a MetaMask gasless transfer (MetaMask's id for its relay job, which the owner's MFA approval
 * waits on), sealed under the login-Keychain wrapping secret with the custody envelope every APN store uses. A journal
 * written by a release after 0.5.106 keeps only the id's hash; the id itself is sealed here once, at prepare, before that
 * journal is written, and is opened only to send the request and to read its job (resume, and the observation an
 * abandonment runs first). Status, receipts and the delegation disable never open it.
 */
export declare class EncryptedMetaMaskGaslessRequestReferenceStore implements MetaMaskGaslessRequestReferencePort {
    private readonly wrappingSecret;
    private readonly files;
    constructor(state: {
        readonly root: string;
    }, wrappingSecret: WrappingSecretPort);
    ready(): Promise<void>;
    /**
     * The caller holds the operation's lock and no journal exists for it yet, so a record found here is only what an
     * interrupted earlier prepare of the same operation left; it is replaced, and its id was never sent or saved anywhere.
     */
    seal(bindingInput: MetaMaskGaslessRequestBinding, requestIdInput: string): Promise<void>;
    open(bindingInput: MetaMaskGaslessRequestBinding): Promise<string>;
}
/** The provider request id of `op`: kept in its intent by an earlier release, or opened from its seal. */
export declare function mmRequestId(references: MetaMaskGaslessRequestReferencePort, op: Pick<MetaMaskGaslessOperationRecord, "profileHash" | "operationId" | "intent">): Promise<string>;
/** The dispatched intent as the provider helper is handed it: the request id in place of its hash, never both. */
export declare function mmProviderIntent(op: MetaMaskGaslessDispatched, requestId: string): MetaMaskGaslessProviderIntent;
