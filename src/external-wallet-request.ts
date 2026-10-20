import type { CommandRequest } from "./commands.js";
import type { StateStore } from "./state.js";
import { canonicalProfile } from "./wallet-policy.js";

/**
 * Whether a failed request acted through an external wallet provider: a connect to one, or a profile bound to one. Only
 * then may its output suggest wallet-provider steps; a local-profile request and one that names no profile never get
 * them. The binding is read, never written; an unreadable one counts as not external (no advice beats the wrong one).
 */
export async function externalWalletRequest(state: StateStore, request: CommandRequest): Promise<boolean> {
  if (request.command === "wallet.connect") return request.providerId !== "local";
  const profile = (request as { readonly profile?: unknown }).profile;
  if (typeof profile !== "string") return false;
  try {
    const bound = await state.loadProviderProfile(state.profileHash(canonicalProfile(profile)));
    return bound !== null && bound.provider_id !== "local";
  } catch { return false; }
}
