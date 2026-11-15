import type { Address, Hex } from "./model.js";
import type { MetaMaskApprovalWindow } from "./metamask-gasless/client/server-transaction.js";
import { ApnError } from "./errors.js";
import { MetaMaskGaslessProviderClient } from "./metamask-gasless/client/process.js";
import type { MetaMaskServerRequestQuery, MetaMaskServerRequestRead } from "./metamask-gasless/client/server-request.js";

/** The operation's own sender and chain, from its authentic journal: the server's answer must name both. */
export interface MetaMaskNativeRequestBinding { readonly sender: Address; readonly chainId: number }

/**
 * MetaMask's server answer for one native transfer request, read by its stored id. `verified`: it named this request,
 * kind transaction, the operation's sender and chain, with this job status token and, for AWAITING_MFA, the owner's
 * approval window (`mfa`: its exact `expiresAt` and the session's `authMethod`). `not_found`: the server answered 404
 * for this id in this project. `refused`: APN read nothing it could use; `reason` says why (a closed reason, never
 * provider text) and `check` names the answer check that refused, when one did. Only `verified` says anything about the
 * request, and that is the provider's word, never chain evidence.
 */
export type MetaMaskNativeServerRequestAnswer =
  | { readonly outcome: "verified"; readonly status: string; readonly transactionHash: Hex | null; readonly mfa: MetaMaskApprovalWindow | null;
      readonly responseHash: string }
  | { readonly outcome: "not_found" }
  | { readonly outcome: "refused"; readonly reason: string; readonly check: string | null };

export interface MetaMaskNativeServerRequestPort { readServerRequest(query: MetaMaskServerRequestQuery): Promise<MetaMaskServerRequestRead> }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const REASON = /^[a-z][a-z0-9_]{0,63}$/u, CHECK = /^[a-z][a-z0-9_]{0,31}$/u;

/**
 * The read runs in the sandboxed MetaMask helper the gasless lane uses (its network policy admits this one GET only),
 * from mm's own signed-in session, and only when that session's project hashes to `projectHash`: another project
 * refuses with `metamask_session_project_changed` before anything is read. A stored id that is not a canonical v4 UUID
 * (the form mm's requests have) refuses with `provider_request_binding_invalid`, so no other path can be read.
 */
export async function readMetaMaskNativeServerRequest(requestId: string, projectHash: string, binding: MetaMaskNativeRequestBinding,
  client: MetaMaskNativeServerRequestPort = new MetaMaskGaslessProviderClient()): Promise<MetaMaskNativeServerRequestAnswer> {
  if (!UUID.test(requestId) || !/^[a-f0-9]{64}$/u.test(projectHash) || !/^0x[0-9a-fA-F]{40}$/u.test(binding.sender) ||
    !Number.isSafeInteger(binding.chainId) || binding.chainId < 1) return { outcome: "refused", reason: "provider_request_binding_invalid", check: null };
  let read: MetaMaskServerRequestRead;
  try { read = await client.readServerRequest({ requestId, projectHash, sender: binding.sender.toLowerCase() as `0x${string}`, chainId: binding.chainId }); }
  catch (error) {
    const details = error instanceof ApnError ? error.details : undefined, named = details?.reason, refused = details?.observeCheck;
    const reason = typeof named === "string" && REASON.test(named) ? named : "metamask_server_read_unclassified";
    const check = typeof refused === "string" && CHECK.test(refused) ? refused : null;
    return { outcome: "refused", reason: reason === "mm_gasless_binding_changed" ? "metamask_session_project_changed" : reason, check };
  }
  if (read.requestId !== requestId) return { outcome: "refused", reason: "provider_request_identity_conflict", check: null };
  return read.found ? { outcome: "verified", status: read.status, transactionHash: read.txHash, mfa: read.mfa, responseHash: read.responseHash }
    : { outcome: "not_found" };
}
