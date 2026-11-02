import type { BoundCommand } from "./command-binder.js";
import type { ClosedBlocker, CommandRequest, OutputEnvelope } from "./commands.js";
import { ApnError, asApnError } from "./errors.js";
import { STATE_HASH, type OperationFamilyAdapter } from "./operation-index/adapter.js";
import { OperationIndex } from "./operation-index/index.js";
import { operationRegistry, type OperationRegistry } from "./operation-index/registry.js";
import type { OperationIndexEntry } from "./operation-index/types.js";
import { withBlockerGuidance } from "./operation-blocker-guidance.js";
import type { RuntimeContext } from "./runtime.js";
import { SecureStateStore } from "./secure-state-store.js";

/**
 * The commands that admit a new money operation and are retried once after their blocker settles. Each is safe to run
 * twice: a refused admission writes nothing (OperationIndex.admit, assertAvailable), everything such a command does before
 * its admission only reads or closes expired unsent records (idempotent), and it replays by its own identity (idempotency
 * key, slot or intent digest). Signing, sending and consent all come after the admission, so a refused first run asked
 * and sent nothing.
 */
const PREPARE_COMMANDS: ReadonlySet<CommandRequest["command"]> = new Set<CommandRequest["command"]>([
  "transfer.prepare", "x402.fetch.prepare", "bridge.prepare", "circle.approval.prepare",
  "wallet.allowance.revoke", "x402.permit2.allowance.set", "x402.permit2.allowance.revoke",
]);

/**
 * The blocker's own runtime: built as its family's commands build theirs, with a new RPC object (never the refused
 * command's). It reuses the refused command's `--rpc-url`, explicitly: a port that reads over it first proves the
 * endpoint serves the blocker's chain, in a request naming nothing of the blocker.
 */
export type BlockerRuntime = (operationId: string, command: CommandRequest["command"]) => RuntimeContext;
type SettlingAdapter = OperationFamilyAdapter & Required<Pick<OperationFamilyAdapter, "settleIfNeverLands">>;
interface Blocker { readonly index: OperationIndex; readonly entry: OperationIndexEntry; readonly adapter: SettlingAdapter; readonly record: unknown }
type Unavailable = { readonly observation: "unavailable"; readonly error: ApnError };
type Settled = { readonly closed: ClosedBlocker } | { readonly observation: "not_proven" } | Unavailable;

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
export async function settleBlockerAndRetry(bound: BoundCommand, root: string, run: () => Promise<OutputEnvelope>, runtime: BlockerRuntime,
  registry: OperationRegistry = operationRegistry()): Promise<OutputEnvelope> {
  const first = await withBlockerGuidance(await run(), root, registry, undefined);
  if (!PREPARE_COMMANDS.has(bound.request.command) || first.error?.code !== "APN_OPERATION_BLOCKED") return first;
  const { blockingOperationId, blockingState } = first.error.details ?? {};
  if (typeof blockingOperationId !== "string" || !STATE_HASH.test(blockingOperationId) || typeof blockingState !== "string") return first;
  const blocker = await confirmed(root, registry, blockingOperationId, blockingState);
  if (blocker === null) return first;
  const settled = "observation" in blocker ? blocker : await settle(blocker, root, runtime);
  if ("observation" in settled) {
    const observed = { ...first, error: { ...first.error, details: { ...first.error.details, blocker_observation: settled.observation, ...blockerError(settled) } } };
    return settled.observation === "not_proven" ? await withBlockerGuidance(observed, root, registry, bound.rpcUrl) : observed;
  }
  // The retry answers for itself, a refusal naming what blocks now included; the closed blocker is reported either way.
  return { ...await withBlockerGuidance(await run(), root, registry, undefined), closed_blockers: [settled.closed] };
}

/**
 * The blocker as the index confirms it: active, in the refused state, of a family with a settle port; null otherwise
 * (an APN refusal of the lookup included). A fault of the lookup itself is reported as the settle's.
 */
async function confirmed(root: string, registry: OperationRegistry, operationId: string, blockingState: string): Promise<Blocker | Unavailable | null> {
  try {
    const index = new OperationIndex(new SecureStateStore(root), registry), entry = await index.find(operationId);
    const adapter = entry === null ? undefined : index.adapter(entry);
    if (entry?.state !== "active" || !settles(adapter)) return null;
    const record = await index.loadRecord(entry);
    return record !== null && adapter.state(record) === blockingState ? { index, entry, adapter, record } : null;
  } catch (error) { return error instanceof ApnError ? null : { observation: "unavailable", error: asApnError(error) }; }
}

/** One settle; the port's word is checked against the record it wrote, read again through the family's own reader. */
async function settle({ index, entry, adapter, record }: Blocker, root: string, runtime: BlockerRuntime): Promise<Settled> {
  try {
    // The family's own runtime command, as operationRuntimeCommand reads it; a family that names none runs in the settle command's.
    const command = await adapter.runtimeCommand?.(record) ?? "operation.settle";
    let proof: string | null;
    // A port that persisted a terminal transition and then failed is still followed by the index.
    try { proof = await adapter.settleIfNeverLands(runtime(entry.operationId, command), record); }
    finally { await index.refresh(entry.operationId); }
    if (proof === null) return { observation: "not_proven" };
    const after = await index.loadRecord(entry);
    if (after === null || !await adapter.terminal(after, root)) return { observation: "not_proven" };
    return { closed: { operation_id: entry.operationId, family: entry.family, state: adapter.state(after), proof } };
  } catch (error) { return { observation: "unavailable", error: asApnError(error) }; }
}

/** The settle's refusal as its own code and wording say it, or a fault as the boundary classifies it (never its text or stack). */
function blockerError(settled: Settled): Readonly<Record<string, string>> {
  if (!("error" in settled)) return {};
  const { code, message, details } = settled.error;
  return { blocker_error_code: code, blocker_error_message: message, ...(typeof details?.reason === "string" ? { blocker_error_reason: details.reason } : {}),
    ...(typeof details?.internal_class === "string" ? { blocker_error_class: details.internal_class } : {}) };
}

const settles = (adapter: OperationFamilyAdapter | undefined): adapter is SettlingAdapter => adapter?.settleIfNeverLands !== undefined;
