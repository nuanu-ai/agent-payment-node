import type { Hex } from "../../model.js";
import { type MetaMaskJobTx } from "./job-tx.js";
import { type MetaMaskProviderFailure } from "./provider-failure.js";
import { type MetaMaskApprovalWindow } from "./server-transaction.js";
import { type SubmitCheck } from "./submit-diagnostic.js";
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
 * `authMethod` (server-transaction.ts `approvalWindow`). `failure` is the job's `failureCode` and `failureDescription`
 * as provider-failure.ts reduces them, or `null` when it names neither. Not found: the server answered 404 for this id in
 * this project, which proves nothing about the request. No other approval detail, link, signature or metadata leaves
 * the helper.
 */
export type MetaMaskServerRequestRead = {
    readonly requestId: string;
    readonly found: true;
    readonly status: string;
    readonly txHash: Hex | null;
    readonly mfa: MetaMaskApprovalWindow | null;
    readonly failure: MetaMaskProviderFailure | null;
    readonly responseHash: string;
} | {
    readonly requestId: string;
    readonly found: false;
    readonly status: null;
    readonly txHash: null;
    readonly mfa: null;
    readonly failure: null;
    readonly responseHash: null;
};
export declare function serverRequestQuery(value: unknown): MetaMaskServerRequestQuery;
/** The helper's answer as the parent accepts it: exactly these fields, for exactly the asked request. */
export declare function serverRequestRead(value: unknown, query: MetaMaskServerRequestQuery): MetaMaskServerRequestRead;
/** Which answer check refused, with the job status token and the `tx` facts, for the read's closed diagnostic. */
export interface ServerRequestProgress {
    check: SubmitCheck | undefined;
    providerStatus: string | null;
    tx: MetaMaskJobTx | undefined;
}
/**
 * The SDK's answer, checked as the gasless observation checks its own (client/service.ts): this request id, kind
 * transaction, a status token, `tx.from` the operation's sender and `tx.chainId` its chain (a number), and a hash, when
 * there is one, of 32 lowercase bytes. An absent or null hash is no hash, as `mm` itself reads one. Any other answer refuses.
 */
export declare function serverRequestAnswer(value: unknown, query: MetaMaskServerRequestQuery, responseHash: string | undefined, sessionAuthMethod: unknown, seen: ServerRequestProgress): MetaMaskServerRequestRead;
export declare function serverRequestNotFound(query: MetaMaskServerRequestQuery): MetaMaskServerRequestRead;
