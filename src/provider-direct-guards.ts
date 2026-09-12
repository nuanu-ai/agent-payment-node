import { ApnError } from "./errors.js";
import type { OperationRecord, ProviderDirectBinding } from "./model.js";
import type { ProviderProfileRepositoryPort } from "./provider-ports.js";
import type { ProviderProfileRecord } from "./provider-profile.js";
import type { RuntimeContext } from "./runtime.js";

export function requiredProviderBinding(operation: OperationRecord): ProviderDirectBinding {
  if (operation.providerDirect === undefined) throw new ApnError("APN_OPERATION_BLOCKED", "Operation is not provider-atomic.");
  return operation.providerDirect;
}

export async function requiredProviderDirectProfile(context: RuntimeContext, profileHash: string): Promise<ProviderProfileRecord> {
  const profile = await (context.requireProfileRepository() as ProviderProfileRepositoryPort).load(profileHash);
  if (profile === null || profile.drift.state !== "bound" || profile.capability_snapshot.direct.available !== true || !(
    (profile.capability_snapshot.direct.mode === "provider_atomic_send" &&
      profile.capability_snapshot.direct.execution_owner === "provider" &&
      profile.capability_snapshot.direct.retry_owner === "apn_outer_no_replay_journal") ||
    (profile.capability_snapshot.direct.mode === "delegated_session_transaction" &&
      profile.capability_snapshot.direct.execution_owner === "apn" &&
      profile.capability_snapshot.direct.retry_owner === "apn_operation_state")
  )) throw new ApnError("APN_PROFILE_DRIFT", "The provider profile is not bound for direct payment effects.");
  return profile;
}
