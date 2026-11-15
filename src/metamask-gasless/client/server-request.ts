import { isPlainRecord } from "../../canonical.js";
import type { Hex } from "../../model.js";
import { mmFail } from "../reasons.js";
import { mmCanonicalAddress, mmExact, mmHash, mmHex, mmUuid } from "../validation.js";
import { jobTx, type MetaMaskJobTx } from "./job-tx.js";
import { approvalWindow, assertApprovalWindow, type MetaMaskApprovalWindow } from "./server-transaction.js";
import { submitToken, type SubmitCheck } from "./submit-diagnostic.js";

/**
 * One read-only status read of a MetaMask server-wallet TRANSACTION request, straight from MetaMask's server by its exact
 * id (the SDK's `getJobStatus`, the call the gasless observation makes), independent of the request list `mm` keeps
 * locally. The helper reads it only when the signed-in session's project hashes (plain SHA-256 of the project id, as the
 * native lane stores it) to `projectHash`; another project refuses before any read. `sender` and `chainId` are the
 * operation's own: the answer must name both.
 */
export interface MetaMaskServerRequestQuery {
  readonly requestId: string;
  readonly projectHash: string;
  readonly sender: `0x${string}`;
  readonly chainId: number;
}
/**
 * What the server answered, as bound fields only. `found`: the answer named this request, kind transaction, the sender
 * and the chain; `status` is its job status token and `responseHash` the SHA-256 of the answer's bytes. `mfa`, for
 * AWAITING_MFA only, is the owner's approval window: the job's `approval.expiresAt` in its exact form and the session's
 * `authMethod` (server-transaction.ts `approvalWindow`). Not found: the server answered 404 for this id in this project,
 * which proves nothing about the request. No other approval detail, link, signature or metadata leaves the helper.
 */
export type MetaMaskServerRequestRead =
  | { readonly requestId: string; readonly found: true; readonly status: string; readonly txHash: Hex | null;
      readonly mfa: MetaMaskApprovalWindow | null; readonly responseHash: string }
  | { readonly requestId: string; readonly found: false; readonly status: null; readonly txHash: null; readonly mfa: null;
      readonly responseHash: null };

const REASON = "mm_gasless_provider_unavailable";

export function serverRequestQuery(value: unknown): MetaMaskServerRequestQuery {
  const q = mmExact(value, ["requestId", "projectHash", "sender", "chainId"], "mm_gasless_input");
  // A canonical v4 UUID only: the id is written into the read's URL path, so no other spelling can name another resource.
  mmUuid(q.requestId, "mm_gasless_input"); mmHash(q.projectHash, "mm_gasless_input"); mmCanonicalAddress(q.sender, "mm_gasless_input");
  if (!Number.isSafeInteger(q.chainId) || Number(q.chainId) < 1) mmFail("mm_gasless_input");
  return q as unknown as MetaMaskServerRequestQuery;
}

/** The helper's answer as the parent accepts it: exactly these fields, for exactly the asked request. */
export function serverRequestRead(value: unknown, query: MetaMaskServerRequestQuery): MetaMaskServerRequestRead {
  const r = mmExact(value, ["requestId", "found", "status", "txHash", "mfa", "responseHash"], REASON);
  if (r.requestId !== query.requestId || typeof r.found !== "boolean") mmFail(REASON);
  if (r.found ? submitToken(r.status) === null || (r.txHash !== null && mmHex(r.txHash, 32, REASON) !== r.txHash) || mmHash(r.responseHash, REASON) !== r.responseHash
    : r.status !== null || r.txHash !== null || r.mfa !== null || r.responseHash !== null) mmFail(REASON);
  if (r.found) assertApprovalWindow(r.mfa, r.status as string, REASON);
  return r as unknown as MetaMaskServerRequestRead;
}

/** Which answer check refused, with the job status token and the `tx` facts, for the read's closed diagnostic. */
export interface ServerRequestProgress { check: SubmitCheck | undefined; providerStatus: string | null; tx: MetaMaskJobTx | undefined }

/**
 * The SDK's answer, checked as the gasless observation checks its own (client/service.ts): this request id, kind
 * transaction, a status token, `tx.from` the operation's sender and `tx.chainId` its chain (a number), and a hash, when
 * there is one, of 32 lowercase bytes. An absent or null hash is no hash, as `mm` itself reads one. Any other answer refuses.
 */
export function serverRequestAnswer(value: unknown, query: MetaMaskServerRequestQuery, responseHash: string | undefined,
  sessionAuthMethod: unknown, seen: ServerRequestProgress): MetaMaskServerRequestRead {
  const refuse = (check: SubmitCheck): never => { seen.check = check; return mmFail(REASON); };
  if (!isPlainRecord(value) || responseHash === undefined) return refuse("response_body");
  if (value.requestId !== query.requestId) return refuse("response_request_id");
  if (value.kind !== "transaction") return refuse("response_kind");
  const status = submitToken(value.status);
  if (status === null) { seen.providerStatus = null; return refuse("response_status"); }
  if (!isPlainRecord(value.tx) || String(value.tx.from).toLowerCase() !== query.sender || value.tx.chainId !== query.chainId) {
    seen.tx = jobTx(value.tx, { binding: { address: query.sender }, request: { chainId: query.chainId } }); seen.providerStatus = status;
    return refuse("response_tx");
  }
  if (value.txHash !== undefined && value.txHash !== null) seen.check = "response_hash";
  const txHash = value.txHash === undefined || value.txHash === null ? null : mmHex(value.txHash, 32, REASON);
  seen.check = undefined;
  return { requestId: query.requestId, found: true, status, txHash, mfa: approvalWindow(status, value.approval, sessionAuthMethod), responseHash };
}

export function serverRequestNotFound(query: MetaMaskServerRequestQuery): MetaMaskServerRequestRead {
  return { requestId: query.requestId, found: false, status: null, txHash: null, mfa: null, responseHash: null };
}
