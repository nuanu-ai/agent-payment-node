import assert from "node:assert/strict";
import test from "node:test";
import { ApnCore } from "../../src/core.js";
import { MetaMaskGaslessRpc } from "../../src/metamask-gasless/chain/rpc.js";
import { validateMetaMaskGaslessOperation } from "../../src/metamask-gasless/journal/validation.js";
import { advanceMetaMaskGaslessOperation } from "../../src/metamask-gasless/journal/transitions.js";
import { mmFailure } from "../../src/metamask-gasless/reasons.js";
import { mmRegistry } from "../../src/metamask-gasless/registry.js";
import { OperationService } from "../../src/operation-service.js";
import { temporaryState } from "./helpers.js";
import { mmFixture, mmWriteOperationFile } from "./metamask-gasless-helpers.js";
import { block, DISABLED_SELECTOR, FakeRpcTransport, intent, now, RPC_URL, type Json } from "./metamask-gasless-rpc-fake.js";
import { fillLegacyHistory } from "./metamask-gasless-journal-fixtures/factory.js";

const initial = (value: ReturnType<typeof intent>) => ({ startBlock: value.initialSnapshot.safeBlock, nextBlockAtomic: "100",
  previousEndBlock: null });
const managerReads = (transport: FakeRpcTransport) => transport.calls.filter(call =>
  (call.method === "eth_call" && String((call.params[0] as Json).data).startsWith(DISABLED_SELECTOR)) ||
  (call.method === "eth_getCode" && call.params[0] === mmRegistry(8453).row.protocol.manager.address));

test("a delegation its delegator disabled before any redemption is proved unusable at one finality block", async () => {
  const value = intent(block(8453, 100n)), pinned = { blockHash: block(8453, 2500n).hash, requireCanonical: true };
  const transport = new FakeRpcTransport(8453, { finality: 2500n, head: 2501n,
    disabled: (at, hash) => at === 2500n && hash === value.delegationHash.toLowerCase() });
  const observed = await new MetaMaskGaslessRpc({ chainId: 8453, rpcUrl: RPC_URL, clock: now, transport }).observe(value, initial(value), null);
  assert.equal(observed.observation.phase, "disabled"); assert.equal(observed.observation.reason, "mm_gasless_delegation_disabled");
  assert.deepEqual(observed.observation.finalityBlock, block(8453, 2500n));
  assert.equal(observed.observation.transactionBlock, null); assert.equal(observed.observation.candidateTxHash, null);
  assert.match(observed.observation.evidenceHash ?? "", /^[a-f0-9]{64}$/u); assert.equal(observed.settlement, null);
  assert.equal(observed.cursor.nextBlockAtomic, "2501");
  // The flag and the manager's code are read at the counter's own finality block, pinned by hash; no log query.
  const reads = managerReads(transport);
  assert.equal(reads.length, 2); for (const read of reads) assert.deepEqual(read.params.at(-1), pinned);
  assert.equal(transport.calls.some(call => call.method === "eth_getLogs"), false);
});

test("a live, a redeemed or an unpinned manager never yields the disabled proof", async (t) => {
  const value = intent(block(8453, 100n));
  await t.test("not disabled", async () => {
    const transport = new FakeRpcTransport(8453, { finality: 2500n, head: 2501n });
    const observed = await new MetaMaskGaslessRpc({ chainId: 8453, rpcUrl: RPC_URL, clock: now, transport }).observe(value, initial(value), null);
    assert.equal(observed.observation.phase, "pending"); assert.equal(managerReads(transport).length, 2);
  });
  await t.test("count of one: the redemption is searched, the flag is not read", async () => {
    const transport = new FakeRpcTransport(8453, { finality: 2500n, head: 2501n, counter: () => 1n, disabled: () => true });
    const observed = await new MetaMaskGaslessRpc({ chainId: 8453, rpcUrl: RPC_URL, clock: now, transport }).observe(value, initial(value), null);
    assert.notEqual(observed.observation.phase, "disabled"); assert.equal(managerReads(transport).length, 0);
  });
  await t.test("manager code differs from its pin", async () => {
    const transport = new FakeRpcTransport(8453, { finality: 2500n, head: 2501n, disabled: () => true, corruptProtocol: true });
    const observed = await new MetaMaskGaslessRpc({ chainId: 8453, rpcUrl: RPC_URL, clock: now, transport }).observe(value, initial(value), null);
    assert.equal(observed.observation.phase, "invalid"); assert.equal(observed.observation.reason, "mm_gasless_evidence_invalid");
  });
});

test("Sei 7ca4e73c shape: a provider-failed relay without a hash closes as revoked_unused once its delegation is disabled", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const f = await mmFixture(temporary.root, 1329), { id } = await f.prepare();
  f.rpc.phase = "pending"; f.rpc.candidate = null; f.provider.status = "failed"; f.provider.txHash = null;
  assert.equal((await f.core.execute({ command: "gasless.transfer.approve", operationId: id })).ok, true);
  const before = await f.record(id);
  assert.equal(before.state, "unknown_finality"); assert.equal(before.failure?.reason, "mm_gasless_provider_failed");
  const submissions = f.provider.submissions.length;
  f.rpc.phase = "disabled";
  const resumed = await f.core.execute({ command: "operation.resume", operationId: id });
  assert.equal(resumed.ok, true, JSON.stringify(resumed.error));
  const operation = resumed.operation as Json;
  assert.equal(operation.state, "revoked_unused"); assert.equal(operation.terminal, true);
  assert.equal(operation.reason, "mm_gasless_delegation_disabled"); assert.equal(operation.proof_class, "rpc_safe_correlated");
  assert.deepEqual(operation.permission.one_use_status, "disabled_unused"); assert.equal(operation.permission.guard_held, false);
  assert.equal(operation.transaction_hash, null); assert.equal(operation.transfer.actual_sender_debit_atomic, null);
  assert.deepEqual(resumed.next_actions, [`apn receipt get --operation ${id}`]);
  assert.equal(f.provider.submissions.length, submissions);
  const after = await f.record(id); validateMetaMaskGaslessOperation(after);
  assert.equal(after.observation?.phase, "disabled");
  // The hold on the server-wallet account is gone: the same account takes a new payment.
  await new OperationService(f.state).assertEvmAccountAvailable(after.profileHash, 1329, f.binding.address);
  const restarted = await f.restart().execute({ command: "receipt.get", operationId: id });
  assert.equal((restarted.receipt as Json).state, "revoked_unused");
});

test("Base 66630f06 shape: an abandoned relay is still observed, and only a chain proof replaces the abandonment", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const f = await mmFixture(temporary.root, 8453, "empty", { abandonApproval: { approve: async () => undefined } });
  const { id } = await f.prepare();
  f.rpc.phase = "pending"; f.rpc.candidate = null; f.provider.failSubmit = true;
  assert.equal((await f.core.execute({ command: "gasless.transfer.approve", operationId: id })).ok, true);
  f.advance(600_000);
  assert.equal((await f.core.execute({ command: "operation.abandon", operationId: id })).ok, true);
  const abandoned = await f.record(id); assert.equal(abandoned.state, "abandoned_unknown");
  // Nothing proved: reported once, never saved over the owner's acknowledgement.
  const pending = await f.core.execute({ command: "operation.resume", operationId: id });
  assert.equal(pending.ok, true); assert.equal((pending.operation as Json).state, "abandoned_unknown");
  assert.equal(((pending.operation as Json).transient_observation as Json).phase, "pending");
  assert.deepEqual(await f.record(id), abandoned);
  f.rpc.phase = "disabled";
  const proved = await f.core.execute({ command: "operation.resume", operationId: id });
  assert.equal((proved.operation as Json).state, "revoked_unused");
  const after = await f.record(id); assert.equal(after.transitions.length, abandoned.transitions.length + 1);
  assert.equal(after.transitions.at(-2)!.state, "abandoned_unknown");
  // Final: a later read never moves it again.
  f.rpc.phase = "success";
  assert.equal(((await f.core.execute({ command: "operation.resume", operationId: id })).operation as Json).state, "revoked_unused");
  assert.equal(f.provider.submissions.length, 1);
});

test("a redemption found after the owner's abandonment records the completed payment", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const f = await mmFixture(temporary.root, 8453, "empty", { abandonApproval: { approve: async () => undefined } });
  const { id } = await f.prepare();
  f.rpc.phase = "pending"; f.rpc.candidate = null; f.provider.failSubmit = true;
  assert.equal((await f.core.execute({ command: "gasless.transfer.approve", operationId: id })).ok, true);
  f.advance(600_000);
  assert.equal((await f.core.execute({ command: "operation.abandon", operationId: id })).ok, true);
  f.rpc.phase = "success"; f.rpc.candidate = `0x${"77".repeat(32)}`;
  const resumed = await f.core.execute({ command: "operation.resume", operationId: id });
  assert.equal((resumed.operation as Json).state, "completed", JSON.stringify(resumed));
  assert.equal(((resumed.operation as Json).transfer as Json).actual_delivered_atomic, (await f.record(id)).intent.quote.netAtomic);
});

test("only a proof may follow abandonment, and a full legacy journal reports it without a write", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const f = await mmFixture(temporary.root, 8453, "empty", { abandonApproval: { approve: async () => undefined } });
  const { id } = await f.prepare();
  f.rpc.phase = "pending"; f.rpc.candidate = null; f.provider.failSubmit = true;
  assert.equal((await f.core.execute({ command: "gasless.transfer.approve", operationId: id })).ok, true);
  await mmWriteOperationFile(temporary.root, fillLegacyHistory(await f.record(id), 96));
  f.advance(600_000); f.provider.failObserve = true;
  assert.equal((await f.core.execute({ command: "operation.abandon", operationId: id })).ok, true);
  const abandoned = await f.record(id);
  assert.equal(abandoned.state, "abandoned_unknown"); assert.equal(abandoned.transitions.length, 97);
  assert.throws(() => advanceMetaMaskGaslessOperation(abandoned, { state: "unknown_finality",
    failure: mmFailure("mm_gasless_pending") }, f.now.toISOString()), /could not advance safely/u);
  f.rpc.phase = "disabled";
  const capped = await new ApnCore({ state: f.state, clock: f.clock, metaMaskGasless: f.dependencies })
    .execute({ command: "operation.resume", operationId: id });
  assert.equal((capped.operation as Json).state, "abandoned_unknown");
  assert.equal(((capped.operation as Json).transient_warning as Json).reason, "mm_gasless_record_capacity");
  assert.deepEqual(await f.record(id), abandoned);
});
