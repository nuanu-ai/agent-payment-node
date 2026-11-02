import { canonicalJson } from "./canonical.js";
import type { OutputEnvelope } from "./commands.js";
import { STATE_HASH } from "./operation-index/adapter.js";
import { OperationIndex } from "./operation-index/index.js";
import type { OperationRegistry } from "./operation-index/registry.js";
import { blockedNextActions } from "./output.js";
import { SecureStateStore } from "./secure-state-store.js";
import { withInvocationRpc } from "./transfer-policy.js";

const PLACEHOLDER = /<[a-z][a-z0-9-]*>/u;

/**
 * At the command boundary, where the blocker's record can be read: a refusal whose next action is the blocker's
 * `apn operation status` also names, after it, the family's own command that advances the blocker's observation where
 * that status only reads the record (a dispatched local direct transfer: resume). Its `--rpc-url` is filled only with
 * `provenRpcUrl`: the invocation's RPC once the blocker's own settle ran over it, passed its chain check and proved
 * nothing (operation-auto-settle.ts); otherwise the command would keep a placeholder and is not named, since every next
 * action runs as typed. This is a hint only: a refusal with its own next actions, an unreadable blocker and any failure
 * of the lookup keep the envelope as it is.
 */
export async function withBlockerGuidance(envelope: OutputEnvelope, root: string, registry: OperationRegistry,
  provenRpcUrl: string | undefined): Promise<OutputEnvelope> {
  const details = envelope.error?.details, blocker = details?.blockingOperationId;
  if (envelope.error?.code !== "APN_OPERATION_BLOCKED" || typeof blocker !== "string" || !STATE_HASH.test(blocker) ||
    details?.blockingReason !== undefined || canonicalJson(envelope.next_actions) !== canonicalJson(blockedNextActions(blocker, false))) return envelope;
  let template: string | undefined;
  try {
    const index = new OperationIndex(new SecureStateStore(root), registry), entry = await index.find(blocker);
    const adapter = entry === null ? undefined : index.adapter(entry);
    if (entry === null || adapter?.observeCommand === undefined) return envelope;
    const record = await index.loadRecord(entry);
    template = record === null ? undefined : adapter.observeCommand(record);
  } catch { return envelope; }
  if (template === undefined) return envelope;
  const named = template.replaceAll("<operation-id>", blocker);
  const [command] = (withInvocationRpc({ next_actions: [named] }, provenRpcUrl) as { next_actions: string[] }).next_actions;
  return command === undefined || PLACEHOLDER.test(command) ? envelope : { ...envelope, next_actions: [...envelope.next_actions, command] };
}
