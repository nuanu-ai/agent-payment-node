import type { RuntimeContext } from "./runtime.js";
import { canonicalProfile } from "./wallet-policy.js";
import { mmFail } from "./metamask-gasless/reasons.js";

export async function gaslessProvider(context: RuntimeContext, input: string): Promise<"local" | "metamask-agent-wallet" | "metamask-smart-account" | "coinbase-agentic-wallet"> {
  const profile = canonicalProfile(input);
  const stored = await context.state.loadProviderProfile(context.state.profileHash(profile));
  if (stored === null || stored.provider_id === "local") return "local";
  if (stored.provider_id === "metamask-agent-wallet") return "metamask-agent-wallet";
  if (stored.provider_id === "metamask-smart-account") return "metamask-smart-account";
  if (stored.provider_id === "coinbase-agentic-wallet") return "coinbase-agentic-wallet";
  return mmFail("mm_gasless_capability_unavailable");
}
