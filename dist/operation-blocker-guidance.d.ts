import type { OutputEnvelope } from "./commands.js";
import type { OperationRegistry } from "./operation-index/registry.js";
/**
 * At the command boundary, where the blocker's record can be read: a refusal whose next action is the blocker's
 * `apn operation status` also names, after it, the family's own command that advances the blocker's observation where
 * that status only reads the record (a dispatched local direct transfer: resume). Its `--rpc-url` is filled only with
 * `provenRpcUrl`: the invocation's RPC once the blocker's own settle ran over it, passed its chain check and proved
 * nothing (operation-auto-settle.ts); otherwise the command would keep a placeholder and is not named, since every next
 * action runs as typed. This is a hint only: a refusal with its own next actions, an unreadable blocker and any failure
 * of the lookup keep the envelope as it is.
 */
export declare function withBlockerGuidance(envelope: OutputEnvelope, root: string, registry: OperationRegistry, provenRpcUrl: string | undefined): Promise<OutputEnvelope>;
