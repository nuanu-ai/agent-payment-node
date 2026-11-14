export interface ParsedMetaMaskProcessOutput {
    readonly envelope: Record<string, unknown> | null;
    readonly notices: readonly Record<string, unknown>[];
}
export type MetaMaskPendingNotice = {
    readonly disposition: "none";
} | {
    readonly disposition: "pending";
    readonly recoveryToken: string;
    readonly providerState: "AWAITING_MFA";
} | {
    readonly disposition: "invalid";
    readonly reason: "provider_response_malformed" | "provider_recovery_identity_mismatch";
};
/**
 * MetaMask Agent Wallet 6.1.5 writes either one ordinary JSON envelope or a
 * newline-delimited stream. Once a command emits a notice, subsequent success
 * is `{ "_summary": ... }` on stdout and failure is `{ "_error": ... }` on
 * stderr. APN captures stdout only, so a notice-only stream is meaningful
 * durable pending evidence rather than malformed JSON.
 */
export declare function parseMetaMaskProcessOutput(bytes: Buffer): ParsedMetaMaskProcessOutput | null;
export declare function classifyMetaMaskPendingNotices(notices: readonly Record<string, unknown>[], expectedRecoveryToken?: string): MetaMaskPendingNotice;
/** What a verified AWAITING_MFA notice tells about the owner's approval: when it lapses and how the owner confirms it. */
export interface MetaMaskMfaNotice {
    readonly expiresAt: string | null;
    readonly authMethod: string | null;
}
/**
 * The owner-facing fields of the last notice of a stream `classifyMetaMaskPendingNotices` found pending. 6.1.5 writes
 * `{kind, pollingId, expiresAt?, authMethod, message}`; a field that is absent or not in its exact form is null, never
 * guessed. The provider's free-text message (which may carry a link) is not kept.
 */
export declare function metaMaskMfaNotice(notices: readonly Record<string, unknown>[]): MetaMaskMfaNotice;
/**
 * Where `mm wallet requests watch <id>` (pinned 6.1.5) did not find the request, by the REQUEST_NOT_FOUND answer it
 * writes to stderr (stdout stays empty). `local_state`: its WalletRequestsWatchCommand looks the id up in mm's own local
 * request list (`pendingJobs` in ~/.metamask/wallets.json) before it asks MetaMask, and that list does not hold it; a new
 * `mm login` starts the list empty, so the request itself may still exist. `server`: mm found it locally, but MetaMask's
 * server answered not found while mm polled it. `unattributed`: any other REQUEST_NOT_FOUND. None of them is proof of
 * anything about the request: it may still be pending, signed, broadcast or closed.
 */
export type MetaMaskRequestNotFound = "local_state" | "server" | "unattributed";
/**
 * The miss in mm's parsed stderr answer (`{"ok":false,"error":{…}}`, or `{"_error":{…}}` after a notice) for the watched
 * id, by 6.1.5's exact wording: the local miss names the id itself ("No pending wallet request found for polling id
 * <id>.") beside its fixed hint; a server miss carries its own fixed hint. Undefined for any other answer.
 */
export declare function metaMaskRequestNotFound(answer: unknown, requestId: string): MetaMaskRequestNotFound | undefined;
/** The reasons a `requests watch` miss is recorded under; each says where the request was not found, never what it did. */
export type MetaMaskWatchMissReason = "metamask_request_not_in_local_state" | "metamask_request_not_found_on_server" | "provider_request_not_found";
/**
 * The reason for a watch that wrote nothing to stdout because it answered REQUEST_NOT_FOUND on stderr (the runner's
 * `requestNotFound`); undefined for every other watch, which keeps its own classification.
 */
export declare function metaMaskWatchMissReason(result: {
    readonly stdout: Buffer;
    readonly requestNotFound?: MetaMaskRequestNotFound;
}): MetaMaskWatchMissReason | undefined;
