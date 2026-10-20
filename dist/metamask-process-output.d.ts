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
