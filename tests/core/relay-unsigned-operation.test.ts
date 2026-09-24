import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { OperationService } from "../../src/operation-service.js";
import { freezeRelayUnsignedOperation, RelayUnsignedOperationRepository } from "../../src/relay-unsigned-operation.js";
import { StateStore } from "../../src/state.js";
import { makeCore, temporaryState, TestNative, TestRpc } from "./helpers.js";

const ACCOUNT = "0x0B4Dd0C3dA001Fa146EEd3f80B01860BEF6B8a14";
const OTHER = "0xf41170df51aab52aaa04fbc3ff325cf051644aca";
const HASH = (digit: string) => digit.repeat(64);

function prepared(state: StateStore, idempotencyKey = "relay-unsigned-test-1") {
  return freezeRelayUnsignedOperation({
    schemaVersion: "apn.relay-unsigned-operation.v1", kind: "relay_unsigned", state: "prepared", terminal: false,
    profileHash: state.profileHash("relay-test"), operationId: state.operationId("relay-test", idempotencyKey),
    idempotencyHash: state.idempotencyHash(idempotencyKey), requestHash: HASH("1"),
    sourceChainId: 1, destinationChainId: 56, sourceAccount: ACCOUNT, recipient: OTHER,
    quoteDigest: HASH("2"), amountAtomic: "1000000000000000", minOutputAtomic: "100000000000000",
    createdAt: "2026-09-25T00:00:00.000Z", deadline: "2026-09-25T00:05:00.000Z",
  });
}

test("Relay unsigned registry survives reopen, holds the Ethereum sender, and refuses execution entry points", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const state = new StateStore(temporary.root);
  const service = new OperationService(state);
  const operation = prepared(state);
  assert.deepEqual(await service.persistRelayUnsigned(operation), operation);
  assert.deepEqual(await service.persistRelayUnsigned(operation), operation);

  const reopened = new OperationService(new StateStore(temporary.root));
  assert.deepEqual(await reopened.required(operation.operationId), { kind: "relay_unsigned", record: operation });
  const status = await reopened.status(operation.operationId) as Record<string, unknown>;
  assert.equal(status.state, "prepared"); assert.equal(status.sourceAccount, ACCOUNT);
  assert.equal(status.recipient, OTHER); assert.equal(status.quoteDigest, HASH("2"));
  assert.equal(status.amountAtomic, operation.amountAtomic); assert.equal(status.minOutputAtomic, operation.minOutputAtomic);
  assert.equal(status.deadline, operation.deadline); assert.equal(status.executionAdmitted, false);
  await assert.rejects(reopened.assertEvmAccountAvailable(operation.profileHash, 1, ACCOUNT), { code: "APN_OPERATION_BLOCKED" });
  await reopened.assertEvmAccountAvailable(operation.profileHash, 56, ACCOUNT);
  await assert.rejects(reopened.assertProfileAvailable(operation.profileHash), { code: "APN_OPERATION_BLOCKED" });
  await assert.rejects(reopened.resolvePrepare({ kind: "direct_transfer", profileHash: operation.profileHash,
    operationId: operation.operationId, idempotencyHash: operation.idempotencyHash, requestHash: operation.requestHash }),
  { code: "APN_IDEMPOTENCY_CONFLICT" });

  const rpc = new TestRpc();
  const core = makeCore({ root: temporary.root, native: new TestNative(), rpc });
  const statusResult = await core.execute({ command: "operation.status", operationId: operation.operationId });
  assert.equal(statusResult.ok, true); assert.equal((statusResult.operation as { state: string }).state, "prepared");
  for (const command of ["transfer.approve", "operation.resume", "receipt.get"] as const) {
    const result = await core.execute({ command, operationId: operation.operationId });
    assert.equal(result.ok, false, command);
    assert.equal(result.error?.code, command === "receipt.get" ? "APN_RECEIPT_NOT_FOUND" : "APN_OPERATION_BLOCKED");
  }
  assert.equal(rpc.submissions.length, 0);
});

test("Relay unsigned insertion rejects same-key direct collision, same sender conflict, and changed replay", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const state = new StateStore(temporary.root);
  const operation = prepared(state);
  const direct = { operationId: HASH("3"), idempotencyHash: operation.idempotencyHash, profileHash: operation.profileHash,
    requestHash: HASH("4"), state: "awaiting_approval", terminal: false, chainId: 1, walletAddress: ACCOUNT };
  const originalAll = state.listAllOperations.bind(state);
  state.listAllOperations = async () => [direct] as never;
  await assert.rejects(new OperationService(state).persistRelayUnsigned(operation), { code: "APN_IDEMPOTENCY_CONFLICT" });
  state.listAllOperations = originalAll;
  const originalProfile = state.listOperations.bind(state);
  state.listOperations = async () => [direct] as never;
  await assert.rejects(new OperationService(state).persistRelayUnsigned(operation), { code: "APN_OPERATION_BLOCKED" });
  state.listOperations = originalProfile;
  const service = new OperationService(state);
  await service.persistRelayUnsigned(operation);
  const { integrityHash: _integrityHash, ...unsigned } = operation;
  await assert.rejects(service.persistRelayUnsigned(freezeRelayUnsignedOperation({ ...unsigned,
    quoteDigest: HASH("5") })), { code: "APN_IDEMPOTENCY_CONFLICT" });
  await assert.rejects(service.persistRelayUnsigned(prepared(state, "relay-unsigned-test-2")), { code: "APN_OPERATION_BLOCKED" });
  assert.equal((await new RelayUnsignedOperationRepository(temporary.root).listAllOperations()).length, 1);
});

test("Relay unsigned journal rejects added execution material and tampering", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const state = new StateStore(temporary.root), service = new OperationService(state), operation = prepared(state);
  assert.throws(() => freezeRelayUnsignedOperation({ ...operation, signedTransaction: "0x1234" } as never), { code: "APN_STATE_CORRUPT" });
  await service.persistRelayUnsigned(operation);
  const path = join(temporary.root, "relay-unsigned-operations", operation.profileHash, `${operation.operationId}.json`);
  const saved = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  await writeFile(path, JSON.stringify({ ...saved, signedTransaction: "0x1234" }), { mode: 0o600 });
  await assert.rejects(new OperationService(new StateStore(temporary.root)).required(operation.operationId), { code: "APN_STATE_CORRUPT" });
});
