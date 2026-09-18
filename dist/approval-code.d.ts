export type ApprovalAction = "transfer" | "policy" | "asset-admission" | "abandon" | "gasless" | "bridge" | "allowlist-activate" | "allowlist-revoke";
/**
 * Six hexadecimal characters bound to one action and one exact fingerprint.
 * The code is printed beside the full fingerprint: it binds the confirmation to this screen, it is not a secret.
 */
export declare function approvalCode(action: ApprovalAction, ...binding: readonly string[]): string;
