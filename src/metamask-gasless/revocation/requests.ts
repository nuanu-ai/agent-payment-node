import { ApnError } from "../../errors.js";
import type { Hex } from "../../model.js";
import type { MetaMaskNativeRequestBinding, MetaMaskNativeServerRequestAnswer } from "../../metamask-native-request-server-read.js";
import { listProviderRequestReferences, providerRequestReferenceHash, type ProviderRequestReferenceBinding,
  type ProviderRequestReferencePort, type ProviderRequestReferenceScope } from "../../provider-request-reference-store.js";
import type { SecureStateStore } from "../../secure-state-store.js";
import { mmDispatchIntent } from "../dispatch.js";
import type { MetaMaskGaslessOperationRecord } from "../operation-model.js";

/**
 * The MetaMask request ids of an operation's delegation disables (`apn gasless transfer revoke`). The disable records
 * nothing in its operation: the chain is the record. From 0.5.109 APN names each request id itself, seals it before the
 * request is sent (provider-request-reference-store.ts, lane `metamask-revocation`, one record per request, never
 * replaced), and `operation resume` reads MetaMask's job status of each sealed request by its id. Releases up to 0.5.108
 * kept no id, so the requests they sent cannot be read again.
 */
const PROVIDER = "metamask-agent-wallet";
/**
 * The most disable requests one operation keeps. Revoke refuses another once the operation holds this many, before any
 * chain read or consent, so a listing that holds more is not one APN wrote and is refused. Resume reads each request
 * with its own helper run.
 */
export const MM_REVOCATION_REQUEST_LIMIT = 16;

type Operation = Pick<MetaMaskGaslessOperationRecord, "profileHash" | "operationId">;

/** The hash that names a disable request in output (`requestIdHash`, `request_id_hash`) in place of its id. */
export function metaMaskRevocationRequestIdHash(requestId: string): string {
  return providerRequestReferenceHash(PROVIDER, requestId);
}

function reference(op: Operation, requestIdHash: string): ProviderRequestReferenceBinding {
  return { lane: "metamask-revocation", providerId: PROVIDER, profileHash: op.profileHash, operationId: op.operationId, referenceHash: requestIdHash };
}
const scope = (op: Operation): ProviderRequestReferenceScope => ({ lane: "metamask-revocation", profileHash: op.profileHash, operationId: op.operationId });

/**
 * The hashes of the disable requests sealed for `op`, in hash order, from a listing of the state root (nothing is
 * opened). A listing APN never wrote refuses precisely: an entry with another name or type (the store's own refusal), or
 * more requests than the limit.
 */
export async function metaMaskRevocationRequestHashes(state: Pick<SecureStateStore, "recordEntries">, op: Operation): Promise<readonly string[]> {
  const hashes = await listProviderRequestReferences(state, scope(op));
  if (hashes.length > MM_REVOCATION_REQUEST_LIMIT) {
    throw new ApnError("APN_STATE_CORRUPT", `This operation holds ${hashes.length} sealed disable requests; APN seals at most ` +
      `${MM_REVOCATION_REQUEST_LIMIT}, so this is not state it wrote.`,
    { reason: "mm_revoke_request_limit_exceeded", operationId: op.operationId, nextActions: [`apn operation status --operation ${op.operationId}`] });
  }
  return hashes;
}

/** Revoke's check before any chain read or consent: the operation still has room for one more sealed request. */
export async function assertMetaMaskRevocationRequestRoom(state: Pick<SecureStateStore, "recordEntries">, op: Operation): Promise<void> {
  if ((await metaMaskRevocationRequestHashes(state, op)).length < MM_REVOCATION_REQUEST_LIMIT) return;
  throw new ApnError("APN_OPERATION_BLOCKED", `This operation already holds ${MM_REVOCATION_REQUEST_LIMIT} disable requests, the most ` +
    "APN keeps for one operation; nothing was sent. Resume reads the chain and MetaMask's status of each of them.",
  { reason: "mm_revoke_request_limit", operationId: op.operationId, nextActions: [`apn operation resume --operation ${op.operationId}`] });
}

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
 * One sealed disable request as resume reports it. `verified`: MetaMask's server named this request, kind transaction,
 * the server wallet and the chain, with its job `status`, `transaction_hash` when it has one and, for AWAITING_MFA, the
 * owner's approval window (`mfa`). `not_found`: the server answered 404 for this id in the signed-in session's project,
 * which proves nothing about the request. `refused`: nothing usable was read; `reason` is a closed reason (the sealed id
 * could not be opened, the session has no project, or the read refused) and `check` the answer check that refused.
 * Every field is MetaMask's word, never chain evidence, and nothing of it is written to the operation.
 */
export interface MetaMaskRevocationRequestRead {
  readonly request_id_hash: string;
  readonly outcome: "verified" | "not_found" | "refused";
  readonly status: string | null;
  readonly transaction_hash: Hex | null;
  readonly mfa: { readonly expires_at: string | null; readonly auth_method: string | null } | null;
  readonly response_hash: string | null;
  readonly reason: string | null;
  readonly check: string | null;
}

/**
 * Reads each sealed disable request of `op` again, in hash order, after resume's own chain reads: the session's project
 * once, then for each request its sealed id and MetaMask's answer by that id through the sandboxed helper, bound to the
 * operation's server wallet and chain. A failure of one request is that entry's own `refused` reason; it never fails
 * the resume or another entry. Without a session project no id is opened.
 */
export async function readMetaMaskRevocationRequests(dependencies: MetaMaskRevocationReadDependencies,
  op: MetaMaskGaslessOperationRecord, hashes: readonly string[]): Promise<readonly MetaMaskRevocationRequestRead[]> {
  if (hashes.length === 0) return [];
  const dispatched = mmDispatchIntent(op), binding = { sender: dispatched.binding.address, chainId: dispatched.request.chainId };
  let project: MetaMaskRevocationSessionProject;
  try { project = await dependencies.reader.sessionProject(); }
  catch (error) { project = { reason: closedReason(error, "metamask_session_read_failed") }; }
  const reads: MetaMaskRevocationRequestRead[] = [];
  for (const hash of hashes) reads.push(await readOne(dependencies, op, hash, project, binding));
  return reads;
}

async function readOne(dependencies: MetaMaskRevocationReadDependencies, op: Operation, hash: string,
  project: MetaMaskRevocationSessionProject, binding: MetaMaskNativeRequestBinding): Promise<MetaMaskRevocationRequestRead> {
  if ("reason" in project) return refused(hash, project.reason, null);
  let requestId: string;
  try { requestId = await dependencies.references.open(reference(op, hash)); }
  catch (error) { return refused(hash, closedReason(error, "provider_request_reference_unreadable"), null); }
  let answer: MetaMaskNativeServerRequestAnswer;
  try { answer = await dependencies.reader.read(requestId, project.projectHash, binding); }
  catch (error) { return refused(hash, closedReason(error, "metamask_server_read_unclassified"), null); }
  if (answer.outcome === "refused") return refused(hash, answer.reason, answer.check);
  if (answer.outcome === "not_found") {
    return { request_id_hash: hash, outcome: "not_found", status: null, transaction_hash: null, mfa: null, response_hash: null, reason: null, check: null };
  }
  return { request_id_hash: hash, outcome: "verified", status: answer.status, transaction_hash: answer.transactionHash,
    mfa: answer.mfa === null ? null : { expires_at: answer.mfa.expiresAt, auth_method: answer.mfa.authMethod },
    response_hash: answer.responseHash, reason: null, check: null };
}

function refused(hash: string, reason: string, check: string | null): MetaMaskRevocationRequestRead {
  return { request_id_hash: hash, outcome: "refused", status: null, transaction_hash: null, mfa: null, response_hash: null, reason, check };
}

const REASON = /^[a-z][a-z0-9_]{0,63}$/u;
/** An APN refusal's own closed reason, else its error code; any other failure is `unclassified`. Never error text. */
function closedReason(error: unknown, unclassified: string): string {
  if (!(error instanceof ApnError)) return unclassified;
  const reason = error.details?.reason;
  return typeof reason === "string" && REASON.test(reason) ? reason : error.code.toLowerCase();
}
