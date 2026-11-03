import { ApnError } from "../errors.js";
import { metaMaskCommand } from "../metamask-command.js";

const MESSAGES = {
  mm_gasless_session_expired: "The MetaMask CLI token in mm has expired; mm renews it with the session's refresh token on its " +
    "next authenticated command. Nothing was signed or sent.",
  mm_gasless_session_unavailable: "APN could not use the MetaMask session in mm: it is missing, unreadable or was refused. " +
    "Nothing was signed or sent.",
} as const;

export function mmSessionReason(reason: unknown): reason is keyof typeof MESSAGES {
  return reason === "mm_gasless_session_expired" || reason === "mm_gasless_session_unavailable";
}

/**
 * A prepare refused for the `mm` session. Renewing it is `mm`'s own step: `auth status` refreshes an expired token, and
 * a new login with the account that created the wallet keeps its project and address, so the profile needs no wallet
 * connect and nothing waits for the profile's unresolved operations. When the pinned client cannot be resolved the
 * steps keep the bare `mm`, as the project wallet refusals do.
 */
export async function mmSessionGuidance(error: unknown, ownerAddress: () => Promise<string>): Promise<unknown> {
  const reason = error instanceof ApnError ? error.details?.reason : undefined;
  if (!(error instanceof ApnError) || error.code !== "APN_PROVIDER_SESSION_REQUIRED" || !mmSessionReason(reason)) return error;
  let address: string;
  try { address = await ownerAddress(); } catch { return error; }
  let mm: string;
  try { mm = await metaMaskCommand(); } catch { mm = "mm"; }
  return new ApnError(error.code, MESSAGES[reason], { ...error.details, nextActions: [
    `${mm} auth status --json`,
    `If it answers "authenticated": false, sign in to MetaMask again with the account that created ${address}: ${mm} login ` +
      `(then ${mm} wallet select ${address} if that account holds more than one wallet). The project and address stay the ` +
      "same, so this profile needs no wallet connect.",
    "Then run the same prepare again: no operation was written.",
  ] });
}
