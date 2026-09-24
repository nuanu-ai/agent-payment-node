import assert from "node:assert/strict";
import { fork, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { RailOperationRepository } from "../../src/rail-operation-repository.js";
import type { TronTransaction } from "../../src/tron/transaction.js";
import { temporaryState } from "./helpers.js";

type WorkerMessage =
  | { kind: "prepared"; operationId: string }
  | { kind: "broadcast_received"; transaction: TronTransaction; broadcastCalls: number }
  | { kind: "resumed"; result: { ok: boolean; operation?: { state: string; transaction_id: string } };
      receipt: { ok: boolean; receipt?: { state: string; transaction_id: string; receipt_hash: string; operation_binding_hash: string } };
      broadcastCalls: number }
  | { kind: "error"; message: string };

const workerPath = fileURLToPath(new URL("./tron-interruption-worker.js", import.meta.url));

function worker(mode: "first" | "resume", root: string, operationId?: string): ChildProcess {
  return fork(workerPath, [mode, root, ...(operationId === undefined ? [] : [operationId])], {
    stdio: ["ignore", "ignore", "pipe", "ipc"], serialization: "advanced",
  });
}

async function nextMessage(child: ChildProcess): Promise<WorkerMessage> {
  return await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => finish(new Error("TRON interruption worker timed out.")), 10_000);
    const message = (value: WorkerMessage) => finish(value.kind === "error" ? new Error(value.message) : null, value);
    const exit = (code: number | null, signal: NodeJS.Signals | null) => finish(new Error(`TRON interruption worker exited ${code ?? signal} before reporting.`));
    const error = (reason: Error) => finish(reason);
    function finish(reason: Error | null, value?: WorkerMessage): void {
      clearTimeout(timeout); child.off("message", message); child.off("exit", exit); child.off("error", error);
      if (reason !== null) reject(reason); else resolve(value!);
    }
    child.once("message", message); child.once("exit", exit); child.once("error", error);
  });
}

test("TRON real SIGKILL after received broadcast restarts as observation only", { timeout: 30_000 }, async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const first = worker("first", temporary.root);
  t.after(() => { if (first.exitCode === null && first.signalCode === null) first.kill("SIGKILL"); });
  const prepared = await nextMessage(first); assert.equal(prepared.kind, "prepared");
  if (prepared.kind !== "prepared") return;
  const received = await nextMessage(first); assert.equal(received.kind, "broadcast_received");
  if (received.kind !== "broadcast_received") return;
  assert.equal(received.broadcastCalls, 1);
  const transaction = received.transaction;
  const repository = new RailOperationRepository(temporary.root);
  const before = await repository.findOperation(prepared.operationId);
  assert.ok(before);
  assert.equal(before.state, "submitting");
  assert.equal(before.reason, "submission_intent_persisted");
  assert.equal(before.transactionId, transaction.txID);
  assert.ok(before.rawPayloadHash);
  const intent = before.transitions.at(-1)!;
  assert.equal(intent.state, "submitting");
  assert.match(intent.transitionHash, /^[a-f0-9]{64}$/);

  const killed = once(first, "exit");
  assert.equal(first.kill("SIGKILL"), true);
  const [code, signal] = await killed;
  assert.equal(code, null);
  assert.equal(signal, "SIGKILL");
  assert.equal(first.signalCode, "SIGKILL");

  const resumed = worker("resume", temporary.root, prepared.operationId);
  t.after(() => { if (resumed.exitCode === null && resumed.signalCode === null) resumed.kill("SIGKILL"); });
  const answer = nextMessage(resumed);
  resumed.send({ transaction });
  const observation = await answer;
  assert.equal(observation.kind, "resumed");
  if (observation.kind !== "resumed") return;
  assert.equal(observation.result.ok, true);
  assert.equal(observation.result.operation?.state, "completed");
  assert.equal(observation.result.operation?.transaction_id, transaction.txID);
  assert.equal(observation.broadcastCalls, 0);
  assert.equal(observation.receipt.ok, true);
  assert.equal(observation.receipt.receipt?.state, "completed");
  assert.equal(observation.receipt.receipt?.transaction_id, transaction.txID);
  assert.match(observation.receipt.receipt?.receipt_hash ?? "", /^[a-f0-9]{64}$/);
  const [resumeCode, resumeSignal] = await once(resumed, "exit");
  assert.equal(resumeCode, 0); assert.equal(resumeSignal, null);

  const after = await repository.findOperation(prepared.operationId);
  assert.ok(after);
  assert.deepEqual(after.transitions.slice(0, before.transitions.length), before.transitions);
  assert.deepEqual(after.transitions.slice(-2).map((entry) => entry.state), ["unknown_finality", "completed"]);
  assert.equal(after.transactionId, transaction.txID);
  assert.equal(observation.receipt.receipt?.operation_binding_hash, after.integrityHash);
});
