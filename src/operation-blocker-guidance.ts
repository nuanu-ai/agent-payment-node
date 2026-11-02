import { canonicalJson } from "./canonical.js";
import type { OutputEnvelope } from "./commands.js";
import { ApnError } from "./errors.js";
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
 * that status only reads the record (a dispatched local direct transfer: resume). Its `--rpc-url` is the refused
 * invocation's own, filled only when the blocking claim is an account on that invocation's network; a command that would
 * keep any placeholder is not named, since every next action runs as typed. A refusal with its own next actions, an
 * unreadable blocker and an APN refusal of the lookup keep the envelope as it is.
 */
export async function withBlockerGuidance(envelope: OutputEnvelope, root: string, registry: OperationRegistry,
  rpcUrl: string | undefined): Promise<OutputEnvelope> {
  const details = envelope.error?.details, blocker = details?.blockingOperationId;
  if (envelope.error?.code !== "APN_OPERATION_BLOCKED" || typeof blocker !== "string" || !STATE_HASH.test(blocker) ||
    details?.blockingReason !== undefined || canonicalJson(envelope.next_actions) !== canonicalJson(blockedNextActions(blocker, false))) return envelope;
  let template: string | undefined;
  try {
    const index = new OperationIndex(new SecureStateStore(root), registry), entry = await index.find(blocker);
    const adapter = entry === null ? undefined : index.adapter(entry), record = entry === null || adapter === undefined ? null : await index.loadRecord(entry);
    template = record === null ? undefined : adapter?.observeCommand?.(record);
  } catch (error) { if (error instanceof ApnError) return envelope; throw error; }
  if (template === undefined) return envelope;
  const named = template.replaceAll("<operation-id>", blocker);
  const [command] = (typeof details?.blockingNetwork === "string" ? withInvocationRpc({ next_actions: [named] }, rpcUrl) as { next_actions: string[] }
    : { next_actions: [named] }).next_actions;
  return command === undefined || PLACEHOLDER.test(command) ? envelope : { ...envelope, next_actions: [...envelope.next_actions, command] };
}
