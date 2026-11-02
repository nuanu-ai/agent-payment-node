import type { OutputEnvelope } from "./commands.js";
import type { OperationRegistry } from "./operation-index/registry.js";
/**
 * At the command boundary, where the blocker's record can be read: a refusal whose next action is the blocker's
 * `apn operation status` also names, after it, the family's own command that advances the blocker's observation where
 * that status only reads the record (a dispatched local direct transfer: resume). Its `--rpc-url` is the refused
 * invocation's own, filled only when the blocking claim is an account on that invocation's network; a command that would
 * keep any placeholder is not named, since every next action runs as typed. A refusal with its own next actions, an
 * unreadable blocker and an APN refusal of the lookup keep the envelope as it is.
 */
export declare function withBlockerGuidance(envelope: OutputEnvelope, root: string, registry: OperationRegistry, rpcUrl: string | undefined): Promise<OutputEnvelope>;
