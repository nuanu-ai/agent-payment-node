import { createHash } from "node:crypto";

export type ApprovalAction = "transfer" | "policy" | "asset-admission" | "abandon" | "gasless" | "bridge";

/**
 * Six hexadecimal characters bound to one action and one exact fingerprint.
 * The code is printed beside the full fingerprint: it binds the confirmation to this screen, it is not a secret.
 */
export function approvalCode(action: ApprovalAction, ...binding: readonly string[]): string {
  return createHash("sha256").update(["apn.approval-code.v1", action, ...binding].join("\n"), "utf8").digest("hex").slice(0, 6);
}
