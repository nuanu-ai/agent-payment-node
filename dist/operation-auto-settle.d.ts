import type { BoundCommand } from "./command-binder.js";
import type { CommandRequest, OutputEnvelope } from "./commands.js";
import { type OperationRegistry } from "./operation-index/registry.js";
import type { RuntimeContext } from "./runtime.js";
/**
 * The blocker's own runtime: built as its family's commands build theirs, with a new RPC object (never the refused
 * command's). It reuses the refused command's `--rpc-url`, explicitly: a port that reads over it first proves the
 * endpoint serves the blocker's chain, in a request naming nothing of the blocker.
 */
export type BlockerRuntime = (operationId: string, command: CommandRequest["command"]) => RuntimeContext;
/**
 * The command boundary (CLI and MCP), outside every family lock and the index lock: a prepare refused because an earlier
 * operation of the same account is unresolved settles that blocker once, through its family's own observation, and runs
 * again once when the observation proves it terminal; that run's own envelope (a success, or a refusal naming what
 * blocks now) carries the closed blocker in `closed_blockers`. When nothing was closed (no settle port, a blocker the index
 * does not confirm, nothing proven, an APN refusal of the settle) the first refusal is the answer; a settle that ran but
 * proved nothing names why in its `blocker_observation` detail, and an APN refusal of it in `blocker_error_code`,
 * `blocker_error_message` and (when it has one) `blocker_error_reason`. Any other failure of the lookup or the settle
 * is classified as the boundary classifies it (APN_INTERNAL, its class in `blocker_error_class`, never its own text),
 * and the first refusal is still the answer. Only when the settle ran over the invocation's own RPC and proved nothing
 * (its chain check passed) does the refusal also name the blocker's observing command with that RPC.
 */
export declare function settleBlockerAndRetry(bound: BoundCommand, root: string, run: () => Promise<OutputEnvelope>, runtime: BlockerRuntime, registry?: OperationRegistry): Promise<OutputEnvelope>;
