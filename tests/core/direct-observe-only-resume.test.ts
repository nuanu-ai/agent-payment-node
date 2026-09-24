import assert from "node:assert/strict";
import test from "node:test";
import { runCli } from "../../src/cli.js";
import { bindArgv } from "../../src/command-binder.js";
import { EVM_REQUEST, EvmTestRpc, evmCore, ensureDirectWallet } from "./evm-helpers.js";
import { temporaryState } from "./helpers.js";

const OPERATION = "a".repeat(64);

async function pending(t: test.TestContext) {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const rpc = new EvmTestRpc(); rpc.receiptEnabled = false;
  const setup = evmCore(temporary.root, rpc);
  const wallet = await ensureDirectWallet(setup);
  rpc.sender = wallet.address;
  const prepared = await setup.core.transfer.prepare({ ...EVM_REQUEST, idempotencyKey: "observe-only-direct-0001" }) as { operation_id: string };
  const approved = await setup.core.transfer.approve(prepared.operation_id) as { state: string };
  assert.equal(approved.state, "submitted_pending");
  assert.equal(rpc.broadcastCount, 1);
  return { ...setup, operationId: prepared.operation_id, temporary };
}

test("observation-only resume terminalizes a verified receipt without custody or another send", async (t) => {
  const s = await pending(t);
  s.rpc.receiptEnabled = true;
  const beforeLoads = s.wrapping.loads;
  const result = await s.core.execute({ command: "operation.resume", operationId: s.operationId, observeOnly: true });
  assert.equal(result.ok, true, result.error?.message);
  assert.equal((result.operation as { state: string }).state, "completed");
  assert.equal(s.rpc.broadcastCount, 1);
  assert.equal(s.wrapping.loads, beforeLoads);
});

test("observation-only resume returns on null, receipt RPC error, and missing evidence without custody or another send", async (t) => {
  for (const scenario of ["null", "error", "evidence"] as const) {
    const s = await pending(t);
    const beforeLoads = s.wrapping.loads;
    if (scenario === "error") Object.assign(s.rpc.evm, { receipt: async () => { throw new Error("receipt unavailable"); } });
    if (scenario === "evidence") { s.rpc.receiptEnabled = true; s.rpc.transactionVerified = false; }
    const result = await s.core.execute({ command: "operation.resume", operationId: s.operationId, observeOnly: true });
    assert.equal(result.ok, true, `${scenario}: ${result.error?.message}`);
    assert.equal((result.operation as { state: string }).state, scenario === "evidence" ? "unknown_finality" : "submitted_pending");
    assert.equal(s.rpc.broadcastCount, 1, scenario);
    assert.equal(s.wrapping.loads, beforeLoads, scenario);
  }
});

test("ordinary resume keeps its existing resubmission behavior", async (t) => {
  const s = await pending(t);
  const result = await s.core.execute({ command: "operation.resume", operationId: s.operationId });
  assert.equal(result.ok, true, result.error?.message);
  assert.equal(s.rpc.broadcastCount, 2);
});

test("observation-only recovery keeps unknown finality unresolved without replay and refuses unsigned operations", async (t) => {
  const s = await pending(t);
  s.rpc.receiptEnabled = true;
  s.rpc.transactionVerified = false;
  const first = await s.core.execute({ command: "operation.resume", operationId: s.operationId, observeOnly: true });
  assert.equal((first.operation as { state: string }).state, "unknown_finality");
  s.rpc.receiptEnabled = false;
  const second = await s.core.execute({ command: "operation.resume", operationId: s.operationId, observeOnly: true });
  assert.equal((second.operation as { state: string }).state, "unknown_finality");
  assert.equal(s.rpc.broadcastCount, 1);

  const other = await temporaryState(); t.after(other.cleanup);
  const fresh = evmCore(other.root);
  const wallet = await ensureDirectWallet(fresh);
  fresh.rpc.sender = wallet.address;
  const unsigned = await fresh.core.transfer.prepare({ ...EVM_REQUEST, idempotencyKey: "observe-only-direct-0002" }) as { operation_id: string };
  const refused = await fresh.core.execute({ command: "operation.resume", operationId: unsigned.operation_id, observeOnly: true });
  assert.equal(refused.error?.code, "APN_INVALID_INPUT");
  assert.equal(s.rpc.broadcastCount, 1);
});

test("CLI projects explicit observe-only true and rejects invalid values before effects", async (t) => {
  const s = await pending(t);
  const args = ["operation", "resume", "--operation", s.operationId, "--rpc-url", "https://rpc.example", "--observe-only", "true"];
  assert.equal(bindArgv(args).request.command, "operation.resume");
  assert.equal((bindArgv(args).request as { observeOnly?: true }).observeOnly, true);
  const beforeLoads = s.wrapping.loads;
  const observed = await runCli(args, {}, { stateRoot: s.temporary.root, rpc: s.rpc, wrappingSecret: s.wrapping });
  assert.equal(observed.ok, true, observed.error?.message);
  assert.equal((observed.operation as { state: string }).state, "submitted_pending");
  assert.equal(s.rpc.broadcastCount, 1);
  assert.equal(s.wrapping.loads, beforeLoads);
  const rejected = await runCli([...args.slice(0, -1), "false"], {}, { stateRoot: s.temporary.root, rpc: s.rpc, wrappingSecret: s.wrapping });
  assert.equal(rejected.error?.code, "APN_INVALID_INPUT");
  assert.equal(s.rpc.broadcastCount, 1);
  assert.equal((await s.core.execute({ command: "operation.resume", operationId: OPERATION, observeOnly: true })).error?.code, "APN_OPERATION_NOT_FOUND");
});
