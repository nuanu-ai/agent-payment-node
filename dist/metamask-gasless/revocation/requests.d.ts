import type { Hex } from "../../model.js";
import type { MetaMaskNativeRequestBinding, MetaMaskNativeServerRequestAnswer } from "../../metamask-native-request-server-read.js";
import { type ProviderRequestReferenceDiscardPort, type ProviderRequestReferencePort } from "../../provider-request-reference-store.js";
import type { SecureStateStore } from "../../secure-state-store.js";
import type { MetaMaskGaslessOperationRecord } from "../operation-model.js";
/**
 * The most sealed disable requests one resume reads: the newest ones, by when each was sealed. Each read is its own
 * helper run. Every older request is still reported, with `revocation_request_read_limit`, and is not opened. Revoke
 * itself has no limit.
 */
export declare const MM_REVOCATION_REQUEST_READ_LIMIT = 16;
type Operation = Pick<MetaMaskGaslessOperationRecord, "profileHash" | "operationId">;
/** The custody revoke needs: seal before the send, and remove the seal of a request that never left the machine. */
export type MetaMaskRevocationReferencesPort = ProviderRequestReferencePort & ProviderRequestReferenceDiscardPort;
/** The hash that names a disable request in output (`requestIdHash`, `request_id_hash`) in place of its id. */
export declare function metaMaskRevocationRequestIdHash(requestId: string): string;
/**
 * Seals `requestId` for `op` and returns the hash that names it; the caller holds the operation lock and sends the
 * request only after this returns. A seal that fails keeps its own code, reason and steps, and says nothing was sent.
 */
export declare function sealMetaMaskRevocationRequest(references: ProviderRequestReferencePort, op: Operation, requestId: string): Promise<string>;
/**
 * Removes the seal of a request whose helper provably stopped before any network call: MetaMask never received it, so
 * there is nothing to read again. Under the same locks as its seal, by its exact binding. Returns the closed reason when
 * the seal could not be removed (it then stays, and resume reports MetaMask's 404 for it); it never throws.
 */
export declare function discardMetaMaskRevocationRequest(references: ProviderRequestReferenceDiscardPort, op: Operation, requestIdHash: string): Promise<string | undefined>;
/** The signed-in `mm` session's project as the plain SHA-256 of its id, or the closed reason there is none. */
export type MetaMaskRevocationSessionProject = {
    readonly projectHash: string;
} | {
    readonly reason: string;
};
/** How resume reads a disable request again: the `mm` session's project, then MetaMask's server answer for the id. */
export interface MetaMaskRevocationReadPort {
    /** `mm auth status` (a read); never throws for a session it cannot use. */
    sessionProject(): Promise<MetaMaskRevocationSessionProject>;
    /** MetaMask's server answer for one request by its id, in that project (metamask-native-request-server-read.ts). */
    read(requestId: string, projectHash: string, binding: MetaMaskNativeRequestBinding): Promise<MetaMaskNativeServerRequestAnswer>;
}
export interface MetaMaskRevocationReadDependencies {
    readonly references: ProviderRequestReferencePort;
    readonly reader: MetaMaskRevocationReadPort;
}
/**
 * One sealed disable request as resume reports it. `verified`: MetaMask's server named this request, kind transaction,
 * the server wallet and the chain, with its job `status`, `transaction_hash` when it has one and, for AWAITING_MFA, the
 * owner's approval window (`mfa`). `not_found`: the server answered 404 for this id in the signed-in session's project,
 * which proves nothing about the request. `refused`: nothing usable was read; `reason` is a closed reason and `check` the
 * answer check that refused. `request_id_hash` is `null` only on the one entry that says the operation's sealed requests
 * could not be listed or read at all. Every field is MetaMask's word, never chain evidence, and nothing of it is written
 * to the operation.
 */
export interface MetaMaskRevocationRequestRead {
    readonly request_id_hash: string | null;
    readonly outcome: "verified" | "not_found" | "refused";
    readonly status: string | null;
    readonly transaction_hash: Hex | null;
    readonly mfa: {
        readonly expires_at: string | null;
        readonly auth_method: string | null;
    } | null;
    readonly response_hash: string | null;
    readonly reason: string | null;
    readonly check: string | null;
}
type OpenedRequest = {
    readonly kind: "opened";
    readonly hash: string;
    readonly requestId: string;
} | {
    readonly kind: "reported";
    readonly read: MetaMaskRevocationRequestRead;
};
/** What resume took under the operation lock: each sealed request opened or already reported, and how to read the rest. */
export interface MetaMaskRevocationRequestsOpened {
    readonly requests: readonly OpenedRequest[];
    /** Present when at least one id was opened: the reader and the operation's own server wallet and chain. */
    readonly reading?: {
        readonly reader: MetaMaskRevocationReadPort;
        readonly binding: MetaMaskNativeRequestBinding;
    };
}
/**
 * Under the operation lock, after resume's chain reads: lists the operation's sealed disable requests, newest first (the
 * listing's order, which output keeps), and opens the id of each up to the read limit. Nothing is sealed: `undefined`,
 * and resume adds no field. A listing that fails, or a reader that is not wired while requests are sealed, is one
 * `refused` entry with no hash; it never fails the resume. An id that cannot be opened is its own `refused` entry; an
 * older request past the read limit is reported and not opened. Nothing here reads MetaMask.
 */
export declare function openMetaMaskRevocationRequests(state: Pick<SecureStateStore, "recordEntries" | "root">, dependencies: MetaMaskRevocationReadDependencies | undefined, op: MetaMaskGaslessOperationRecord): Promise<MetaMaskRevocationRequestsOpened | undefined>;
/** Runs MetaMask's reads under the provider-session lock, as every other read of the MetaMask session does. */
export type MetaMaskRevocationProviderSession = (work: () => Promise<readonly MetaMaskRevocationRequestRead[]>) => Promise<readonly MetaMaskRevocationRequestRead[]>;
/**
 * After the operation lock is released, under the provider-session lock: the session's project once, then MetaMask's
 * answer for each opened id through the sandboxed helper, in the listing's order. They write nothing, and the seals they
 * read are create-only. A failure of one request is that entry's own `refused` reason; without a session project every
 * opened request carries that reason and none is read. A provider-session lock that cannot be taken (another command
 * holds the MetaMask session) gives every opened request that lock's reason, and none is read.
 */
export declare function readMetaMaskRevocationRequests(opened: MetaMaskRevocationRequestsOpened, providerSession: MetaMaskRevocationProviderSession): Promise<readonly MetaMaskRevocationRequestRead[]>;
export {};
