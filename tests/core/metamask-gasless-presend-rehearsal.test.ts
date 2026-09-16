import assert from "node:assert/strict";
import test from "node:test";
import { MetaMaskGaslessProviderClient, type MetaMaskGaslessHelperRunner } from "../../src/metamask-gasless/client/index.js";
import type { HelperRequest } from "../../src/metamask-gasless/client/protocol.js";
import { MetaMaskGaslessOperationRepository } from "../../src/metamask-gasless/journal/repository.js";
import type { MetaMaskGaslessState } from "../../src/metamask-gasless/model.js";
import type { MetaMaskGaslessOperationRecord } from "../../src/metamask-gasless/operation-model.js";
import type { MetaMaskGaslessRepositoryPort } from "../../src/metamask-gasless/ports.js";
import { OperationService } from "../../src/operation-service.js";
import { mmFixture } from "./metamask-gasless-helpers.js";
import { temporaryState } from "./helpers.js";

/**
 * The MetaMask Agent gasless pre-send rehearsal. There is no custody port on this rail: MetaMask's server signs and
 * relays, and the only call that can move money is `provider.submit`, which runs after the durable dispatch marker.
 * The rehearsal therefore stops at the marker write, the last act before that POST is authorized, and asserts the
 * record is left approved but never dispatched. The owner spends longer on the 25-line screen than the observation
 * ceiling, which is exactly the window the rail must now survive.
 */
const ALLOWED: readonly MetaMaskGaslessState[] = ["awaiting_approval", "execution_pending"];
const OWNER_READING_MS = 150_000;

/** Gate 4, the stop: every state past `execution_pending` is refused, so no dispatch marker can become durable. */
class PresendRecords implements MetaMaskGaslessRepositoryPort {
  readonly refused: MetaMaskGaslessState[] = [];
  readonly persisted: MetaMaskGaslessState[] = [];
  constructor(private readonly inner: MetaMaskGaslessRepositoryPort) {}
  loadOperation(profileHash: string, operationId: string) { return this.inner.loadOperation(profileHash, operationId); }
  findOperation(operationId: string) { return this.inner.findOperation(operationId); }
  listOperations(profileHash: string) { return this.inner.listOperations(profileHash); }
  listAllOperations() { return this.inner.listAllOperations(); }
  repairReceipt(operation: MetaMaskGaslessOperationRecord) { return this.inner.repairReceipt(operation); }
  loadReceipt(profileHash: string, operationId: string) { return this.inner.loadReceipt(profileHash, operationId); }
  async writeOperation(operation: MetaMaskGaslessOperationRecord) {
    await this.gate(operation, async () => await this.inner.writeOperation(operation));
  }
  async persist(operation: MetaMaskGaslessOperationRecord) {
    await this.gate(operation, async () => await this.inner.persist(operation));
  }
  private async gate(operation: MetaMaskGaslessOperationRecord, act: () => Promise<void>): Promise<void> {
    if (!ALLOWED.includes(operation.state)) {
      this.refused.push(operation.state);
      throw new Error("rehearsal refuses the dispatch marker");
    }
    this.persisted.push(operation.state);
    await act();
  }
}

/** Gate 2: the relay-capable helper child never starts, so no UserOperation or signed delegation can exist. */
class PresendRunner implements MetaMaskGaslessHelperRunner {
  spawns = 0;
  readonly refused: HelperRequest["mode"][] = [];
  async run(request: HelperRequest): Promise<unknown> {
    if (request.mode === "submit" || request.mode === "observe") {
      this.refused.push(request.mode);
      throw new Error("rehearsal refuses a relay-capable helper mode");
    }
    this.spawns += 1;
    throw new Error("rehearsal spawns no helper child");
  }
}

test("the pre-send rehearsal stops at the dispatch marker after an owner slower than the observation ceiling", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const f = await mmFixture(temporary.root);
  const records = new PresendRecords(new MetaMaskGaslessOperationRepository(f.state.root));
  const core = f.makeCore(records);

  // Gates 1 and 3: the post-effect chain read and the two provider effect calls are refused, not merely unused.
  let effects = 0;
  f.rpc.observe = async () => { effects += 1; throw new Error("rehearsal refuses rpc.observe"); };
  f.provider.submit = async () => { effects += 1; throw new Error("rehearsal refuses provider.submit"); };
  f.provider.observe = async () => { effects += 1; throw new Error("rehearsal refuses provider.observe"); };

  const prepared = await core.execute({ command: "gasless.transfer.prepare", profile: f.profile,
    request: f.request, idempotencyKey: "mm-presend-rehearsal-0001" });
  assert.equal(prepared.ok, true, JSON.stringify(prepared.error));
  const id = (prepared.operation as { operation_id: string }).operation_id;
  const intent = (await f.record(id)).intent;

  // The owner reads the 25-line screen and types the exact code: longer than MM_OBSERVATION_MAX_AGE_MS, inside the TTL.
  f.approval.hook = () => f.advance(OWNER_READING_MS);
  const approved = await core.execute({ command: "gasless.transfer.approve", operationId: id });

  assert.equal(approved.ok, false, "the refused dispatch marker must surface as a failure, not a silent success");
  assert.deepEqual(records.refused, ["dispatch_pending"]);
  assert.deepEqual(records.persisted, ["awaiting_approval", "execution_pending"]);

  const stored = await f.record(id);
  assert.equal(stored.state, "execution_pending");
  assert.equal(stored.submissionAttempts, 0);
  assert.equal(stored.dispatchStartedAt, null);
  assert.equal(stored.providerObservation, null);
  assert.equal(stored.settlement, null);
  assert.equal(stored.failure, null);
  assert.notEqual(stored.approval, null);
  assert.equal(stored.approval?.fingerprint, stored.fingerprint);
  assert.equal(stored.approval?.expiresAt, intent.expiresAt);

  // Approval ran once, on the real screen summary, and every step before the marker used the real call path.
  assert.equal(f.approval.calls.length, 1);
  assert.equal(f.approval.calls[0]?.exactPhrase.length, 6);
  assert.equal(effects, 0);
  assert.equal(f.provider.submissions.length, 0);
  assert.deepEqual(f.provider.calls.filter(call => call === "submit" || call === "observe"), []);
  assert.ok(f.provider.calls.filter(call => call === "inspect").length >= 2);
  assert.ok(f.rpc.calls.filter(call => call === "snapshot").length >= 2);
  assert.deepEqual(f.rpc.calls.filter(call => call === "observe"), []);
  // Nothing was dispatched, so the operation still holds its account guard and the owner can re-prepare deliberately.
  assert.equal(stored.terminal, false);
  await assert.rejects(new OperationService(f.state).assertEvmAccountAvailable(stored.profileHash,
    f.request.chainId, intent.binding.address), { code: "APN_OPERATION_BLOCKED" });
});

test("the rehearsal helper gate refuses the relay-capable modes before any child process starts", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const f = await mmFixture(temporary.root);
  const { id } = await f.prepare("mm-presend-runner-0001");
  const intent = (await f.record(id)).intent;
  const runner = new PresendRunner();
  const client = new MetaMaskGaslessProviderClient({ environment: {}, clock: f.clock, runner });

  await assert.rejects(client.submit(intent), { code: "APN_OPERATION_BLOCKED",
    details: { reason: "mm_gasless_submit_unknown" } });
  await assert.rejects(client.observe(intent), { code: "APN_PROVIDER_UNAVAILABLE",
    details: { reason: "mm_gasless_provider_unavailable" } });
  assert.deepEqual(runner.refused, ["submit", "observe"]);
  assert.equal(runner.spawns, 0);
});
