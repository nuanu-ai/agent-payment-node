import { createHash } from "node:crypto";
/**
 * Six hexadecimal characters bound to one action and one exact fingerprint.
 * The code is printed beside the full fingerprint: it binds the confirmation to this screen, it is not a secret.
 */
export function approvalCode(action, ...binding) {
    return createHash("sha256").update(["apn.approval-code.v1", action, ...binding].join("\n"), "utf8").digest("hex").slice(0, 6);
}
//# sourceMappingURL=approval-code.js.map