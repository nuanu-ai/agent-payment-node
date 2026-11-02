import { canonicalJson } from "./canonical.js";
import type { OutputEnvelope } from "./commands.js";
import { STATE_HASH } from "./operation-index/adapter.js";
import { OperationIndex } from "./operation-index/index.js";
import type { OperationRegistry } from "./operation-index/registry.js";
import { blockedNextActions } from "./output.js";
import { SecureStateStore } from "./secure-state-store.js";

/**
 * At the command boundary, where the blocker's family can be read: a refusal whose next action is the blocker's
 * `apn operation status` names the family's own observing command instead when that status only reads the record (for
 * example a local direct transfer, which `apn operation resume` observes). A refusal with its own next actions, an
 * unreadable blocker and any failed lookup keep the envelope as it is.
 */
export async function withBlockerGuidance(envelope: OutputEnvelope, root: string, registry: OperationRegistry): Promise<OutputEnvelope> {
  const details = envelope.error?.details, blocker = details?.blockingOperationId;
  if (envelope.error?.code !== "APN_OPERATION_BLOCKED" || typeof blocker !== "string" || !STATE_HASH.test(blocker) ||
    details?.blockingReason !== undefined || canonicalJson(envelope.next_actions) !== canonicalJson(blockedNextActions(blocker, false))) return envelope;
  try {
    const index = new OperationIndex(new SecureStateStore(root), registry), entry = await index.find(blocker);
    const observe = entry === null ? undefined : index.adapter(entry)?.observeCommand;
    return observe === undefined ? envelope : { ...envelope, next_actions: blockedNextActions(blocker, false, observe) };
  } catch { return envelope; }
}
