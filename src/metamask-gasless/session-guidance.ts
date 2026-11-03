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

/** `mm logout` clears more than the session: said wherever a step names it. */
export const mmLogoutWarning = (mm: string) => `${mm} logout also deletes mm's local wallet list and the seed of any local ` +
  "(BYOK) wallet in that mm home, so back those up first.";

/**
 * Renewing the `mm` session is `mm`'s own step: `auth status` refreshes an expired token, and a new login with the
 * account that created the wallet keeps its project and address, so the profile needs no wallet connect and nothing
 * waits for the profile's unresolved operations. A failed token check is retried and then answered with a login (which
 * `mm` starts when its stored token cannot be read), never with a logout;
 * only a token MetaMask keeps refusing while `auth status` calls it active needs one, since `mm` starts a login only
 * once no active token is left. When the pinned client cannot be resolved the steps keep the bare `mm`, as the project
 * wallet refusals do.
 */
export async function mmSessionNextActions(address: string | undefined, then?: string): Promise<string[]> {
  let mm: string;
  try { mm = await metaMaskCommand(); } catch { mm = "mm"; }
  const account = address === undefined ? "the account that created this profile's server wallet" : `the account that created ${address}`;
  const select = address === undefined ? "" : ` (then ${mm} wallet select ${address} if that account holds more than one wallet)`;
  return [`${mm} auth status --json`,
    `If it answers "authenticated": false, sign in to MetaMask again with ${account}: ${mm} login${select}. The project and ` +
      "address stay the same, so this profile needs no wallet connect.",
    `If it fails with an error instead, run it again later, without logging out; if it keeps failing, ${mm} login as above.`,
    `If it answers "authenticated": true and the same refusal comes back, MetaMask refuses that token: ${mm} logout, then ` +
      `${mm} login as above. ${mmLogoutWarning(mm)}`,
    ...(then === undefined ? [] : [then])];
}

/** A prepare refused for the `mm` session: its cause and the renewal steps, never a wallet connect. */
export async function mmSessionGuidance(error: unknown, ownerAddress: () => Promise<string>): Promise<unknown> {
  const reason = error instanceof ApnError ? error.details?.reason : undefined;
  if (!(error instanceof ApnError) || error.code !== "APN_PROVIDER_SESSION_REQUIRED" || !mmSessionReason(reason)) return error;
  let address: string | undefined;
  try { address = await ownerAddress(); } catch { address = undefined; }
  return new ApnError(error.code, MESSAGES[reason], { ...error.details,
    nextActions: await mmSessionNextActions(address, "Then run the same prepare again: no operation was written.") });
}
