import { ApnError } from "../errors.js";
import { SecureStateStore } from "../secure-state-store.js";
import { canonicalProfile } from "../wallet-policy.js";
import { validatePermit2ExecutionIntent, type Permit2ExecutionIntent } from "./execution-intent.js";

/** Read-only reader: no initialization, directory creation, locks, repair, or sync. */
class ExistingPermit2IntentReader extends SecureStateStore {
  async read(operationId: string): Promise<Permit2ExecutionIntent | null> {
    if (!/^[a-f0-9]{64}$/u.test(operationId)) throw new ApnError("APN_INVALID_INPUT", "Invalid Permit2 operation ID.");
    const value = await this.readJson(`permit2-intents/${operationId}.json`);
    return value === null ? null : validatePermit2ExecutionIntent(value, operationId);
  }
}

export async function readPermit2IntentStatus(root: string, requestedProfile: string, operationId: string) {
  const profile = canonicalProfile(requestedProfile);
  const reader = new ExistingPermit2IntentReader(root);
  const intent = await reader.read(operationId);
  if (intent === null) return { operationId, profile, state: "not_found" as const,
    capability: "execution_blocked" as const, blockerCodes: ["permit2_intent_not_found"] };
  if (intent.profileHash !== reader.profileHash(profile)) {
    throw new ApnError("APN_OPERATION_BLOCKED", "Permit2 intent does not belong to the requested profile.",
      { reason: "x402_permit2_profile_mismatch" });
  }
  return { operationId: intent.operationId, profile, chain: intent.chain, token: intent.token,
    owner: intent.owner, recipient: intent.recipient, state: "execution_blocked" as const,
    capability: intent.capability, blockerCodes: ["permit2_execution_not_exposed", "permit2_reservation_intended_only"] };
}
