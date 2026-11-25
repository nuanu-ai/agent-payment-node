import { ApnError } from "../../errors.js";
import type { Hex } from "../../model.js";
import type { MetaMaskNativeRequestBinding, MetaMaskNativeServerRequestAnswer } from "../../metamask-native-request-server-read.js";
import { listProviderRequestReferences, providerRequestReferenceHash, type ProviderRequestReferenceBinding,
  type ProviderRequestReferenceDiscardPort, type ProviderRequestReferencePort, type ProviderRequestReferenceRecord,
  type ProviderRequestReferenceScope } from "../../provider-request-reference-store.js";
import type { SecureStateStore } from "../../secure-state-store.js";
import { mmDispatchIntent } from "../dispatch.js";
import type { MetaMaskGaslessOperationRecord } from "../operation-model.js";

/**
 * The MetaMask request ids of an operation's delegation disables (`apn gasless transfer revoke`). The disable records
 * nothing in its operation: the chain is the record. From 0.5.109 APN names each request id itself, seals it before the
 * request is sent (provider-request-reference-store.ts, lane `metamask-revocation`, one record per request, never
 * replaced) and removes that seal again only when the helper provably stopped before any network call. `operation
 * resume` reads MetaMask's job status of each sealed request by its id. Releases up to 0.5.108 kept no id, so the
 * requests they sent cannot be read again.
 */
const PROVIDER = "metamask-agent-wallet";
/**
 * The most sealed disable requests one resume reads: the newest ones, by when each was sealed. Each read is its own
 * helper run. Every older request is still reported, with `revocation_request_read_limit`, and is not opened. Revoke
 * itself has no limit.
 */
export const MM_REVOCATION_REQUEST_READ_LIMIT = 16;

type Operation = Pick<MetaMaskGaslessOperationRecord, "profileHash" | "operationId">;
/** The custody revoke needs: seal before the send, and remove the seal of a request that never left the machine. */
export type MetaMaskRevocationReferencesPort = ProviderRequestReferencePort & ProviderRequestReferenceDiscardPort;

/** The hash that names a disable request in output (`requestIdHash`, `request_id_hash`) in place of its id. */
export function metaMaskRevocationRequestIdHash(requestId: string): string {
  return providerRequestReferenceHash(PROVIDER, requestId);
}

function reference(op: Operation, requestIdHash: string): ProviderRequestReferenceBinding {
  return { lane: "metamask-revocation", providerId: PROVIDER, profileHash: op.profileHash, operationId: op.operationId, referenceHash: requestIdHash };
}
const scope = (op: Operation): ProviderRequestReferenceScope => ({ lane: "metamask-revocation", profileHash: op.profileHash, operationId: op.operationId });

/**
 * Seals `requestId` for `op` and returns the hash that names it; the caller holds the operation lock and sends the
 * request only after this returns. A seal that fails keeps its own code, reason and steps, and says nothing was sent.
 */
export async function sealMetaMaskRevocationRequest(references: ProviderRequestReferencePort, op: Operation, requestId: string): Promise<string> {
  const requestIdHash = metaMaskRevocationRequestIdHash(requestId);
  try { await references.seal(reference(op, requestIdHash), requestId); }
  catch (error) {
    if (!(error instanceof ApnError)) throw error;
    throw new ApnError(error.code, `${error.message} The disable was not sent.`, error.details);
  }
  return requestIdHash;
}

/**
 * Removes the seal of a request whose helper provably stopped before any network call: MetaMask never received it, so
 * there is nothing to read again. Under the same locks as its seal, by its exact binding. Returns the closed reason when
 * the seal could not be removed (it then stays, and resume reports MetaMask's 404 for it); it never throws.
 */
export async function discardMetaMaskRevocationRequest(references: ProviderRequestReferenceDiscardPort, op: Operation,
  requestIdHash: string): Promise<string | undefined> {
  try { await references.discard(reference(op, requestIdHash)); return undefined; }
  catch (error) { return closedReason(error, "provider_request_reference_discard_failed"); }
}

/** The signed-in `mm` session's project as the plain SHA-256 of its id, or the closed reason there is none. */
export type MetaMaskRevocationSessionProject = { readonly projectHash: string } | { readonly reason: string };
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
 * MetaMask's failure code and description of a disable request's job, as provider-failure.ts keeps them: `code` a closed
 * token and `description` short plain prose, each `null` when MetaMask gave none or gave it in another form, which the
 * `*_withheld` flag then says.
 */
export interface MetaMaskRevocationRequestFailure {
  readonly code: string | null;
  readonly code_withheld: boolean;
  readonly description: string | null;
  readonly description_withheld: boolean;
}

/**
 * One sealed disable request as resume reports it. `verified`: MetaMask's server named this request, kind transaction,
 * the server wallet and the chain, with its job `status`, `transaction_hash` when it has one, for AWAITING_MFA the
 * owner's approval window (`mfa`) and, when the job names one, MetaMask's own failure code and description (`failure`,
 * for example `POLICY_EVALUATOR_FAILED` on a FAILED job). `not_found`: the server answered 404 for this id in the signed-in session's project,
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
  readonly mfa: { readonly expires_at: string | null; readonly auth_method: string | null } | null;
  readonly failure: MetaMaskRevocationRequestFailure | null;
  readonly response_hash: string | null;
  readonly reason: string | null;
  readonly check: string | null;
}

type OpenedRequest = { readonly kind: "opened"; readonly hash: string; readonly requestId: string } |
  { readonly kind: "reported"; readonly read: MetaMaskRevocationRequestRead };
/** What resume took under the operation lock: each sealed request opened or already reported, and how to read the rest. */
export interface MetaMaskRevocationRequestsOpened {
  readonly requests: readonly OpenedRequest[];
  /** Present when at least one id was opened: the reader and the operation's own server wallet and chain. */
  readonly reading?: { readonly reader: MetaMaskRevocationReadPort; readonly binding: MetaMaskNativeRequestBinding };
}

/**
 * Under the operation lock, after resume's chain reads: lists the operation's sealed disable requests, newest first (the
 * listing's order, which output keeps), and opens the id of each up to the read limit. Nothing is sealed: `undefined`,
 * and resume adds no field. A listing that fails, or a reader that is not wired while requests are sealed, is one
 * `refused` entry with no hash; it never fails the resume. An id that cannot be opened is its own `refused` entry; an
 * older request past the read limit is reported and not opened. Nothing here reads MetaMask.
 */
export async function openMetaMaskRevocationRequests(state: Pick<SecureStateStore, "recordEntries" | "root">,
  dependencies: MetaMaskRevocationReadDependencies | undefined, op: MetaMaskGaslessOperationRecord): Promise<MetaMaskRevocationRequestsOpened | undefined> {
  let records: readonly ProviderRequestReferenceRecord[];
  try { records = await listProviderRequestReferences(state, scope(op)); }
  catch (error) { return { requests: [{ kind: "reported", read: refused(null, closedReason(error, "provider_request_reference_listing_unreadable"), null) }] }; }
  if (records.length === 0) return undefined;
  if (dependencies === undefined) return { requests: [{ kind: "reported", read: refused(null, "revocation_request_reader_unavailable", null) }] };
  const requests: OpenedRequest[] = [];
  for (const [index, { referenceHash: hash }] of records.entries()) {
    if (index >= MM_REVOCATION_REQUEST_READ_LIMIT) { requests.push({ kind: "reported", read: refused(hash, "revocation_request_read_limit", null) }); continue; }
    try { requests.push({ kind: "opened", hash, requestId: await dependencies.references.open(reference(op, hash)) }); }
    catch (error) { requests.push({ kind: "reported", read: refused(hash, closedReason(error, "provider_request_reference_unreadable"), null) }); }
  }
  if (!requests.some(request => request.kind === "opened")) return { requests };
  const dispatched = mmDispatchIntent(op);
  return { requests, reading: { reader: dependencies.reader, binding: { sender: dispatched.binding.address, chainId: dispatched.request.chainId } } };
}

/** Runs MetaMask's reads under the provider-session lock, as every other read of the MetaMask session does. */
export type MetaMaskRevocationProviderSession = (work: () => Promise<readonly MetaMaskRevocationRequestRead[]>) =>
  Promise<readonly MetaMaskRevocationRequestRead[]>;

/**
 * After the operation lock is released, under the provider-session lock: the session's project once, then MetaMask's
 * answer for each opened id through the sandboxed helper, in the listing's order. They write nothing, and the seals they
 * read are create-only. A failure of one request is that entry's own `refused` reason; without a session project every
 * opened request carries that reason and none is read. A provider-session lock that cannot be taken (another command
 * holds the MetaMask session) gives every opened request that lock's reason, and none is read.
 */
export async function readMetaMaskRevocationRequests(opened: MetaMaskRevocationRequestsOpened,
  providerSession: MetaMaskRevocationProviderSession): Promise<readonly MetaMaskRevocationRequestRead[]> {
  const reading = opened.reading;
  if (reading === undefined) return opened.requests.map(request => request.kind === "reported" ? request.read : internal());
  try { return await providerSession(async () => await readOpened(opened.requests, reading)); }
  catch (error) {
    const reason = closedReason(error, "metamask_provider_session_unavailable");
    return opened.requests.map(request => request.kind === "reported" ? request.read : refused(request.hash, reason, null));
  }
}

/** Never throws: the project read and each request read keep their own failure. */
async function readOpened(requests: readonly OpenedRequest[], reading: NonNullable<MetaMaskRevocationRequestsOpened["reading"]>):
  Promise<readonly MetaMaskRevocationRequestRead[]> {
  let project: MetaMaskRevocationSessionProject;
  try { project = await reading.reader.sessionProject(); }
  catch (error) { project = { reason: closedReason(error, "metamask_session_read_failed") }; }
  const reads: MetaMaskRevocationRequestRead[] = [];
  for (const request of requests) {
    reads.push(request.kind === "reported" ? request.read : await readOne(reading, request.hash, request.requestId, project));
  }
  return reads;
}

async function readOne(reading: NonNullable<MetaMaskRevocationRequestsOpened["reading"]>, hash: string, requestId: string,
  project: MetaMaskRevocationSessionProject): Promise<MetaMaskRevocationRequestRead> {
  if ("reason" in project) return refused(hash, project.reason, null);
  let answer: MetaMaskNativeServerRequestAnswer;
  try { answer = await reading.reader.read(requestId, project.projectHash, reading.binding); }
  catch (error) { return refused(hash, closedReason(error, "metamask_server_read_unclassified"), null); }
  if (answer.outcome === "refused") return refused(hash, answer.reason, answer.check);
  if (answer.outcome === "not_found") {
    return { request_id_hash: hash, outcome: "not_found", status: null, transaction_hash: null, mfa: null, failure: null, response_hash: null,
      reason: null, check: null };
  }
  const failure = answer.failure;
  return { request_id_hash: hash, outcome: "verified", status: answer.status, transaction_hash: answer.transactionHash,
    mfa: answer.mfa === null ? null : { expires_at: answer.mfa.expiresAt, auth_method: answer.mfa.authMethod },
    failure: failure === null ? null : { code: failure.code, code_withheld: failure.codeWithheld, description: failure.description,
      description_withheld: failure.descriptionWithheld },
    response_hash: answer.responseHash, reason: null, check: null };
}

function refused(hash: string | null, reason: string, check: string | null): MetaMaskRevocationRequestRead {
  return { request_id_hash: hash, outcome: "refused", status: null, transaction_hash: null, mfa: null, failure: null, response_hash: null, reason, check };
}

const REASON = /^[a-z][a-z0-9_]{0,63}$/u;
/** An APN refusal's own closed reason, else its error code; any other failure is `unclassified`. Never error text. */
function closedReason(error: unknown, unclassified: string): string {
  if (!(error instanceof ApnError)) return unclassified;
  const reason = error.details?.reason;
  return typeof reason === "string" && REASON.test(reason) ? reason : error.code.toLowerCase();
}

function internal(): never {
  throw new ApnError("APN_INTERNAL", "A sealed disable request was opened without a reader.");
}
