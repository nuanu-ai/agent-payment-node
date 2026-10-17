import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { canonicalJson } from "../../src/canonical.js";
import { cleanup85OperationEnvelope } from "../../src/legacy/cleanup85-native-records.js";
import { OperationService } from "../../src/operation-service.js";
import type { OperationRecord } from "../../src/model.js";
import { CircleEvmService } from "../../src/circle-v2-evm/runtime.js";
import { StateStore } from "../../src/state.js";
import { evmCore } from "./evm-helpers.js";
import { temporaryState } from "./helpers.js";
import { installLegacyCase } from "./legacy-corpus-readers.js";

/**
 * Phase 4a deleted the controller that prepared, signed and settled the owner's cleanup85 native cancellation. The
 * operation record it wrote is an ordinary direct transfer carrying `evm.cleanup85Cancellation`; it must keep loading
 * through the generic direct readers (binding and envelope validated by src/legacy), project its status, and refuse
 * every writer without touching RPC, custody or the consent screen.
 */
const FIXTURE = join("tests", "fixtures", "legacy-historical", "cleanup85-native-cancellation-operation.json");

test("the authentic cleanup85 native cancellation record loads, projects and stays read-only", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const record = (JSON.parse(await readFile(FIXTURE, "utf8")) as { operation: OperationRecord }).operation;
  const setup = evmCore(temporary.root);
  await setup.state.initialize();
  await mkdir(join(temporary.root, "operations", record.profileHash), { recursive: true, mode: 0o700 });
  const path = join(temporary.root, "operations", record.profileHash, `${record.operationId}.json`);
  await writeFile(path, canonicalJson(record), { mode: 0o600 });
  const bytes = await readFile(path);

  const loaded = await setup.state.findOperation(record.operationId);
  assert.ok(loaded); assert.equal(loaded.integrityHash, record.integrityHash);
  assert.notEqual(loaded.evm?.cleanup85Cancellation, undefined);
  const envelope = cleanup85OperationEnvelope(loaded);
  assert.equal(envelope.nonceAtomic, "85"); assert.equal(envelope.valueAtomic, "1"); assert.equal(envelope.to, record.recipient);
  assert.equal((await new OperationService(setup.state).required(record.operationId)).kind, "direct_transfer");
  assert.notEqual(await new OperationService(setup.state).status(record.operationId), undefined);

  for (const command of ["transfer.approve", "operation.resume"] as const) {
    const refused = await setup.core.execute({ command, operationId: record.operationId } as never);
    assert.equal(refused.ok, false, command); assert.equal(refused.error?.code, "APN_OPERATION_BLOCKED", command);
    assert.match(refused.error?.message ?? "", /read-only/u, command);
  }
  assert.equal(setup.approval.intents.length, 0); assert.equal(setup.rpc.broadcastCount, 0);
  assert.deepEqual(await readFile(path), bytes);
});

test("the terminal 4ee24e45 retirement written by 0.5.44 answers status and observe from disk, with no RPC or key", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  await installLegacyCase(join("tests", "fixtures", "legacy-corpus", "60-v0544-circle-cleanup85-retirement-terminal"), temporary.root);
  let entries = 0;
  const trap = { load: async () => { entries++; throw new Error("no key"); }, create: async () => { entries++; throw new Error("no key"); } };
  const https = { request: async () => { entries++; throw new Error("no RPC"); } };
  const service = new CircleEvmService(new StateStore(temporary.root), trap, {}, () => Date.parse("2026-10-17T00:00:00.000Z"), {}, https);
  const id = "4ee24e4501478193bd84aa89463eb673d539db23cbb7cdbf56f8fe197d792a33";
  const status = await service.status(id) as { state: string; terminal: boolean };
  assert.equal(status.state, "nonce_retired"); assert.equal(status.terminal, true); assert.equal("cleanup85_recovery" in status, false);
  const observed = await service.observe(id);
  assert.equal(observed.state, "nonce_retired"); assert.equal(observed.nonceRetirement?.cleanup85Recovery?.mode, "observed_original");
  assert.equal(entries, 0);
});
