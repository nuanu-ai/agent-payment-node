import assert from "node:assert/strict";
import type { TronMethod } from "../../src/tron/rpc.js";
import type { TronTransaction } from "../../src/tron/transaction.js";
import { tronFixture } from "./tron-helpers.js";

const [mode, root, operationId] = process.argv.slice(2);
assert.ok(root);

async function send(message: unknown): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    process.send?.(message, (error: Error | null) => error ? reject(error) : resolve());
  });
}

async function firstProcess(): Promise<void> {
  const fixture = await tronFixture(root!);
  const id = await fixture.prepare("usdt", "tron-real-process-interruption-0001");
  await send({ kind: "prepared", operationId: id });
  const original = fixture.rpc.call.bind(fixture.rpc);
  fixture.rpc.call = async (method: TronMethod, body: Readonly<Record<string, unknown>>) => {
    const result = await original(method, body);
    if (method === "wallet/broadcasttransaction") {
      await send({ kind: "broadcast_received", transaction: fixture.rpc.submissions[0],
        broadcastCalls: fixture.rpc.calls.filter((call) => call === "wallet/broadcasttransaction").length });
      await new Promise<never>(() => { setInterval(() => undefined, 60_000); });
    }
    return result;
  };
  await fixture.core.execute({ command: "transfer.approve", operationId: id });
  throw new Error("The held broadcast unexpectedly returned.");
}

async function resumedProcess(): Promise<void> {
  assert.ok(operationId);
  const transaction = await new Promise<TronTransaction>((resolve) => {
    process.once("message", (message: unknown) => {
      assert.ok(message && typeof message === "object" && "transaction" in message);
      resolve((message as { transaction: TronTransaction }).transaction);
    });
  });
  const fixture = await tronFixture(root!, { admit: false });
  const record = await fixture.core.rails.records.findOperation(operationId!);
  assert.ok(record);
  fixture.rpc.prepared = record.prepared;
  fixture.rpc.submissions.push(transaction);
  fixture.now.setTime(fixture.rpc.initialTime + 60_000);
  const result = await fixture.core.execute({ command: "operation.resume", operationId: operationId! });
  const receipt = await fixture.core.execute({ command: "receipt.get", operationId: operationId! });
  await send({ kind: "resumed", result, receipt,
    broadcastCalls: fixture.rpc.calls.filter((method) => method === "wallet/broadcasttransaction").length });
}

try {
  if (mode === "first") await firstProcess();
  else if (mode === "resume") await resumedProcess();
  else throw new Error("Unknown interruption worker mode.");
} catch (error) {
  await send({ kind: "error", message: error instanceof Error ? error.message : String(error) });
  process.exitCode = 1;
}
