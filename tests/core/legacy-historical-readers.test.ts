import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { canonicalJson } from "../../src/canonical.js";
import { cleanup85OperationEnvelope } from "../../src/legacy/cleanup85-native-records.js";
import { OperationService } from "../../src/operation-service.js";
import type { OperationRecord } from "../../src/model.js";
import { runCli } from "../../src/cli.js";
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

test("the terminal 4ee24e45 retirement written by 0.5.44 answers status, observe and receipt through the CLI, with no runtime, RPC or key", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  await installLegacyCase(join("tests", "fixtures", "legacy-corpus", "60-v0544-circle-cleanup85-retirement-terminal"), temporary.root);
  let entries = 0;
  const wrappingSecret = { load: async () => { entries++; throw new Error("no key"); }, create: async () => { entries++; throw new Error("no key"); } };
  const circleFundingEvm = new Proxy({}, { get: () => async () => { entries++; throw new Error("no runtime"); } }) as never;
  const id = "4ee24e4501478193bd84aa89463eb673d539db23cbb7cdbf56f8fe197d792a33", options = { stateRoot: temporary.root, wrappingSecret, circleFundingEvm };
  const status = await runCli(["circle", "evm", "status", "--operation", id], {}, options);
  assert.equal(status.ok, true, JSON.stringify(status));
  const operation = status.operation as { state: string; terminal: boolean };
  assert.equal(operation.state, "nonce_retired"); assert.equal(operation.terminal, true); assert.equal("cleanup85_recovery" in operation, false);
  const observed = await runCli(["circle", "evm", "observe", "--operation", id], {}, options);
  assert.equal(observed.ok, true, JSON.stringify(observed)); assert.equal((observed.operation as { state: string }).state, "nonce_retired");
  const receipt = await runCli(["receipt", "get", "--operation", id], {}, options);
  assert.equal(receipt.ok, true, JSON.stringify(receipt)); assert.equal((receipt.receipt as { state: string }).state, "nonce_retired");
  for (const action of ["approve-mint", "cleanup", "refresh-attestation"]) {
    const refused = await runCli(["circle", "evm", action, "--operation", id], {}, options);
    assert.equal(refused.ok, false, action); assert.equal(refused.error?.code, "APN_OPERATION_BLOCKED", action);
  }
  assert.equal(entries, 0);
});
