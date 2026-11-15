import type { Address, Hex } from "./model.js";
import type { MetaMaskApprovalWindow } from "./metamask-gasless/client/server-transaction.js";
import type { MetaMaskServerRequestQuery, MetaMaskServerRequestRead } from "./metamask-gasless/client/server-request.js";
/** The operation's own sender and chain, from its authentic journal: the server's answer must name both. */
export interface MetaMaskNativeRequestBinding {
    readonly sender: Address;
    readonly chainId: number;
}
/**
 * MetaMask's server answer for one native transfer request, read by its stored id. `verified`: it named this request,
 * kind transaction, the operation's sender and chain, with this job status token and, for AWAITING_MFA, the owner's
 * approval window (`mfa`: its exact `expiresAt` and the session's `authMethod`). `not_found`: the server answered 404
 * for this id in this project. `refused`: APN read nothing it could use; `reason` says why (a closed reason, never
 * provider text) and `check` names the answer check that refused, when one did. Only `verified` says anything about the
 * request, and that is the provider's word, never chain evidence.
 */
export type MetaMaskNativeServerRequestAnswer = {
    readonly outcome: "verified";
    readonly status: string;
    readonly transactionHash: Hex | null;
    readonly mfa: MetaMaskApprovalWindow | null;
    readonly responseHash: string;
} | {
    readonly outcome: "not_found";
} | {
    readonly outcome: "refused";
    readonly reason: string;
    readonly check: string | null;
};
export interface MetaMaskNativeServerRequestPort {
    readServerRequest(query: MetaMaskServerRequestQuery): Promise<MetaMaskServerRequestRead>;
}
/**
 * The read runs in the sandboxed MetaMask helper the gasless lane uses (its network policy admits this one GET only),
 * from mm's own signed-in session, and only when that session's project hashes to `projectHash`: another project
 * refuses with `metamask_session_project_changed` before anything is read. A stored id that is not a canonical v4 UUID
 * (the form mm's requests have) refuses with `provider_request_binding_invalid`, so no other path can be read.
 */
export declare function readMetaMaskNativeServerRequest(requestId: string, projectHash: string, binding: MetaMaskNativeRequestBinding, client?: MetaMaskNativeServerRequestPort): Promise<MetaMaskNativeServerRequestAnswer>;
