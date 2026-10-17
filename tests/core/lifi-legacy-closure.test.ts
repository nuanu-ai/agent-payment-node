import assert from "node:assert/strict";
import { readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { keccak256 } from "viem";
import { canonicalJson } from "../../src/canonical.js";
import { bindArgv } from "../../src/command-binder.js";
import { ApnError } from "../../src/errors.js";
import { environmentFinalizedReader, type FinalizedReader } from "../../src/evm-finalized-proof.js";
import { OperationIndex } from "../../src/operation-index/index.js";
import { OperationService } from "../../src/operation-service.js";
import { createApnCore } from "../../src/runtime-factory.js";
import { StateStore } from "../../src/state.js";
import { temporaryState } from "./helpers.js";
import { lifiFixture } from "./lifi-helpers.js";
import { installLegacyFixture } from "./lifi-legacy-support.js";
import { mockChain } from "./stargate-legacy-support.js";
import { findStored } from "./stored-operations.js";

/**
 * R4 exit of a frozen (pre-allowlist) LI.FI journal the live code never resumes: at the finalized block of its source
 * chain the owner's nonce is past every envelope nonce it froze and none of its own transactions is pending, so nothing
 * of it can ever land. The closure is written once beside the journal (journal and ledger untouched), and the operation
 * index re-derives the journal as terminal from it, also after a rebuild. Otherwise it stays open and says why.
 */
type Fixture = Awaited<ReturnType<typeof lifiFixture>>;
const sidecar = (root: string, profileHash: string, id: string) => join(root, "bridge-operations", profileHash, `${id}.legacy-closure.json`);
const exists = async (path: string) => await stat(path).then(() => true, () => false);

/** A Base→Arbitrum send accepted by the node but never seen again, frozen into the legacy shape: open, one own hash. */
async function frozenUnknown(root: string): Promise<{ s: Fixture; id: string; hash: string; nonce: bigint; path: string; profileHash: string }> {
  const s = await lifiFixture(root, "base-arb"); s.source.allowance = s.request.amountAtomic;
  const prepared = await s.prepare("stargateV2", "legacy-closure-unknown");
  const send = s.source.send.bind(s.source);
  s.source.send = async (raw) => { await send(raw); s.source.missingHashes.add(keccak256(raw)); throw new Error("synthetic timeout after acceptance"); };
  await s.core.execute({ command: "bridge.approve", operationId: prepared.id });
  const current = (await findStored(s.core.bridges.records, prepared.id))!;
  assert.equal(current.state, "unknown_finality");
  const fixture = await installLegacyFixture(root, current), effect = current.effects.find(item => item.transactionHash !== null)!;
  return { s, id: prepared.id, hash: effect.transactionHash!, nonce: BigInt(effect.envelope.economics.nonceAtomic),
    path: fixture.operationPath, profileHash: current.profileHash };
}
function cli(root: string, s: Fixture, read: FinalizedReader) {
  return async (argv: readonly string[]) => await createApnCore(bindArgv([...argv]), { stateRoot: root, wrappingSecret: s.wrapping as never,
    clock: { now: () => new Date(s.now) }, bridge: s.dependencies, finalizedRead: read }).execute(bindArgv([...argv]).request);
}
const owner = (s: Fixture) => s.source.op!.intent.owner.address;

test("nonce not past: the frozen journal stays open, says what it waits for, writes nothing and keeps its account", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const { s, id, hash, nonce, path, profileHash } = await frozenUnknown(temporary.root), before = await readFile(path, "utf8");
  const chain = mockChain(8453, nonce), run = cli(temporary.root, s, () => chain.rpc);
  const open = await run(["operation", "status", "--operation", id]);
  assert.equal(open.ok, true, JSON.stringify(open.error));
  const view = open.operation as { state: string; legacy_closure: { terminal: boolean; waiting_for: string; closure: unknown } };
  assert.deepEqual([view.state, view.legacy_closure.terminal, view.legacy_closure.closure, open.proof_class, open.next_actions],
    ["unknown_finality", false, null, "chain_verified_public_read", [`apn operation status --operation ${id}`]]);
  assert.match(view.legacy_closure.waiting_for, new RegExp(`finalized nonce of 0x[0-9a-fA-F]{40} on chain 8453 to pass ${nonce} \\(it is ${nonce}\\)`, "u"));
  assert.deepEqual(chain.calls, ["eth_chainId", "eth_getTransactionCount"], "no hash is read while the nonce is not past");
  assert.equal(await exists(sidecar(temporary.root, profileHash, id)), false);
  assert.equal(await readFile(path, "utf8"), before);
  await assert.rejects(new OperationService(new StateStore(temporary.root)).assertEvmAccountAvailable(profileHash, 8453, owner(s)),
    { code: "APN_OPERATION_BLOCKED", details: { blockingOperationId: id, blockingState: "unknown_finality", blockingNetwork: "evm:8453",
      blockingAccount: owner(s).toLowerCase() } });
  // A pending own transaction keeps it open even past the nonce; operation resume runs the same check.
  const waiting = await cli(temporary.root, s, () => mockChain(8453, nonce + 1n, { [hash.toLowerCase()]: { hash, blockNumber: null } }).rpc)(
    ["operation", "resume", "--operation", id]);
  assert.equal(waiting.ok, true, JSON.stringify(waiting.error));
  assert.equal((waiting.operation as { legacy_closure: { waiting_for: string } }).legacy_closure.waiting_for, `own transaction ${hash} to leave the pending pool`);
  assert.equal(await exists(sidecar(temporary.root, profileHash, id)), false);
});

test("nonce past at the finalized block closes the journal once; the closure survives an index rebuild; the journal is unchanged", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const { s, id, hash, nonce, path, profileHash } = await frozenUnknown(temporary.root), before = await readFile(path, "utf8");
  const chain = mockChain(8453, nonce + 1n), run = cli(temporary.root, s, () => chain.rpc), state = new StateStore(temporary.root);
  const closed = await run(["operation", "status", "--operation", id]);
  assert.equal(closed.ok, true, JSON.stringify(closed.error));
  const view = closed.operation as { legacy_closure: { terminal: boolean; terminal_reason: string;
    closure: { chainId: number; highestEnvelopeNonceAtomic: string; finalizedNonceAtomic: string; ownTransactions: unknown } } };
  assert.deepEqual([view.legacy_closure.terminal, view.legacy_closure.terminal_reason, closed.proof_class, closed.next_actions],
    [true, "legacy_closed_nonce_consumed", "chain_verified_public_read", []]);
  assert.deepEqual([view.legacy_closure.closure.chainId, view.legacy_closure.closure.highestEnvelopeNonceAtomic, view.legacy_closure.closure.finalizedNonceAtomic,
    view.legacy_closure.closure.ownTransactions], [8453, nonce.toString(), (nonce + 1n).toString(), [{ transactionHash: hash, seen: "not_found" }]]);
  assert.deepEqual(chain.calls, ["eth_chainId", "eth_getTransactionCount", "eth_getTransactionByHash"]);
  assert.equal(await readFile(path, "utf8"), before, "the journal is never rewritten");
  await new OperationService(state).assertEvmAccountAvailable(profileHash, 8453, owner(s));
  assert.deepEqual([(await new OperationIndex(state).find(id))?.state, (await new OperationIndex(state).find(id))?.claims], ["terminal", []]);
  await rm(join(temporary.root, "operation-index"), { recursive: true, force: true });
  await new OperationIndex(state).reconcile();
  assert.equal((await new OperationIndex(state).find(id))?.state, "terminal", "rm -r operation-index keeps it closed");
  const again = await run(["operation", "resume", "--operation", id]);
  assert.deepEqual([(again.operation as typeof view).legacy_closure.terminal, again.proof_class, chain.calls.length], [true, "durable_public_state", 3]);
  // Nothing executes a frozen journal, before or after its closure.
  assert.equal((await run(["bridge", "approve", "--operation", id])).error?.code, "APN_OPERATION_BLOCKED");
  // A damaged closure makes the journal undecidable (blocking, unreadable), never silently terminal.
  await rm(join(temporary.root, "operation-index"), { recursive: true, force: true });
  await writeFile(sidecar(temporary.root, profileHash, id), `${canonicalJson({ ...view.legacy_closure.closure, finalizedNonceAtomic: nonce.toString() })}\n`, { mode: 0o600 });
  const blocked = await new OperationService(state).assertEvmAccountAvailable(profileHash, 8453, owner(s)).then(() => null, (error: unknown) => error);
  assert.ok(blocked instanceof ApnError && blocked.details?.blockingReason === "blocking_record_unreadable", String(blocked));
});

test("the closure reads the source chain's own RPC setting and an RPC of another chain closes nothing", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const { s, id, nonce, profileHash } = await frozenUnknown(temporary.root);
  const missing = await cli(temporary.root, s, environmentFinalizedReader({}))(["operation", "status", "--operation", id]);
  assert.equal(missing.error?.code, "APN_RPC_CONFIG");
  assert.deepEqual(missing.next_actions, ["Set APN_BASE_RPC_URL to a public HTTPS RPC endpoint of that chain, then rerun the same command."]);
  const other = await cli(temporary.root, s, () => mockChain(42161, nonce + 1n).rpc)(["operation", "status", "--operation", id]);
  assert.equal(other.error?.code, "APN_CHAIN_MISMATCH");
  assert.equal(await exists(sidecar(temporary.root, profileHash, id)), false);
});
