import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test, { type TestContext } from "node:test";
import { canonicalJson, sha256 } from "../../src/canonical.js";
import { ApnCore } from "../../src/core.js";
import type { EvmRpcCall } from "../../src/evm-ports.js";
import { BridgeRpc } from "../../src/lifi/rpc.js";
import { lifiFixture } from "./lifi-helpers.js";
import { temporaryState } from "./helpers.js";
import { findStored } from "./stored-operations.js";

// A native fill is proved by its call trace. The recipient (the profile owner) may send its own transaction in the
// same block, so the balance across the block only corroborates the fill: short or negative, it never fails the proof.
const raw = await readFile(resolve("tests/core/lifi-fixtures/linea-native-fill-rpc-20260920.json"), "utf8");
assert.equal(sha256(raw), "ecc7d70307afd5d529965c5f37139df5380958408b28524b9e089917b1900b04");
const capture = JSON.parse(raw) as any;
const amount = BigInt(capture.expected.amountAtomic);

function capturedRpc(mutate: (method: string, params: readonly any[], result: any) => unknown): EvmRpcCall {
  const values = new Map(capture.requests.map((row: any) => [canonicalJson([row.request.method, row.request.params]), row.response.result]));
  return async (method, params) => {
    const key = canonicalJson([method, params]); assert.equal(values.has(key), true, key);
    return mutate(method, params as readonly any[], structuredClone(values.get(key)));
  };
}
const observeCaptured = (mutate: (method: string, params: readonly any[], result: any) => unknown) =>
  new BridgeRpc(59144, capture.rpcOrigin, capturedRpc(mutate)).observe(capture.transactionHash, undefined, capture.expected);

test("a same-block spend by the recipient leaves the captured Linea fill traced, with its balance delta kept signed", async () => {
  // Captured: 0 before the block, exactly the fill after it. The owner's own spend makes the delta short, or negative.
  for (const before of [1_000n, amount + 1_000n]) {
    const observed = await observeCaptured((method, params, result) => method === "eth_getBalance" &&
      params[1].blockHash !== capture.receiptBlock.hash ? `0x${before.toString(16)}` : result);
    assert.equal(observed!.receipt.nativeBalance?.deltaAtomic, (amount - before).toString());
    assert.equal(observed!.receipt.nativeTransfer?.valueAtomic, capture.expected.amountAtomic);
    assert.equal(observed!.receipt.nativeTransfer?.to, capture.expected.recipient);
  }
});

test("a delivery CALL that succeeded under a reverted parent frame does not prove a Linea fill", async () => {
  // Captured tree: relayer CALL -> SpokePool proxy DELEGATECALL -> [..., CALL of the fill to the recipient].
  const delivery = (trace: any) => trace.calls[0].calls[2];
  const control = await observeCaptured((method, _params, result: any) => {
    if (method === "debug_traceTransaction") assert.equal(delivery(result).to.toLowerCase(), capture.expected.recipient.toLowerCase());
    return result;
  });
  assert.equal(control!.receipt.nativeTransfer?.valueAtomic, capture.expected.amountAtomic);
  for (const reverted of [(trace: any) => trace.calls[0], (trace: any) => trace, delivery]) {
    await assert.rejects(observeCaptured((method, _params, result) => {
      if (method === "debug_traceTransaction") reverted(result).error = "execution reverted";
      return result;
    }), /native_destination_transfer/u);
  }
});

type Fixture = Awaited<ReturnType<typeof lifiFixture>>;
/** The owner's own transaction later in the fill's block spends part of the credit, or more than all of it. */
function spendInFillBlock(s: Fixture, spend: "short" | "negative"): void {
  const original = s.destination.observe.bind(s.destination);
  s.destination.observe = async (...args) => {
    const observed = await original(...args);
    const balance = observed?.receipt.nativeBalance;
    if (observed === null || args[1] !== undefined || balance === undefined || balance === null) return observed;
    const before = BigInt(balance.beforeBalanceAtomic);
    const after = spend === "short" ? BigInt(balance.afterBalanceAtomic) - 1n : before - 60n;
    return { ...observed, receipt: { ...observed.receipt, nativeBalance: { ...balance,
      afterBalanceAtomic: after.toString(), deltaAtomic: (after - before).toString() } } };
  };
}
async function settle(t: TestContext, pair: "eth-linea" | "eth-monad" | "eth-bnb", spend: "short" | "negative",
  outcome: "completed_native" | "recovered_weth" = "completed_native") {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const s = await lifiFixture(temporary.root, pair);
  s.provider.statusValue = "completed_observed"; s.destination.destinationCompositeOutcome = outcome;
  spendInFillBlock(s, spend);
  const { id } = await s.prepare("across", `${pair}-same-block-${spend}-${outcome}`);
  const result = await s.core.execute({ command: "bridge.approve", operationId: id });
  assert.equal(result.ok, true, result.error?.message);
  const record = (await findStored(s.core.bridges.records, id))!;
  // The saved record validates on a fresh start and a resume changes nothing and sends nothing.
  const restarted = new ApnCore({ state: s.state, bridge: s.dependencies, clock: { now: () => new Date(s.now) } });
  const status = await restarted.execute({ command: "operation.status", operationId: id });
  assert.equal(status.ok, true, status.error?.message); assert.equal((status.operation as any).terminal, true);
  await restarted.execute({ command: "operation.resume", operationId: id });
  assert.equal((await findStored(restarted.bridges.records, id))!.state, record.state);
  assert.equal(s.source.submissions.length, 1);
  return record;
}

for (const pair of ["eth-linea", "eth-monad"] as const) {
  test(`${pair}: a same-block spend by the owner completes the traced native fill instead of wedging the profile`, async (t) => {
    const short = await settle(t, pair, "short");
    assert.equal(short.state, "completed", JSON.stringify(short.failure));
    assert.equal(short.destinationProof?.nativeTransfer?.valueAtomic, short.destinationProof?.amountAtomic);
    assert.equal(short.destinationProof?.nativeBalance?.deltaAtomic, (BigInt(short.destinationProof!.amountAtomic) - 1n).toString());
    const negative = await settle(t, pair, "negative");
    assert.equal(negative.state, "completed", JSON.stringify(negative.failure));
    assert.equal(negative.destinationProof?.nativeTransfer?.to, negative.intent.owner.address);
    // The durable proof holds unsigned corroboration only: a negative delta is recorded as none.
    assert.equal(negative.destinationProof?.nativeBalance, null);
  });
}

test("BNB composite: a same-block spend by the owner ends with the trace's outcome, never protocol_mismatch", async (t) => {
  const short = await settle(t, "eth-bnb", "short");
  assert.equal(short.state, "completed", JSON.stringify(short.failure));
  assert.equal(short.destinationProof?.compositeTrace?.outcome, "completed_native");
  assert.equal(short.destinationProof?.nativeBalance?.deltaAtomic, (BigInt(short.destinationProof!.amountAtomic) - 1n).toString());
  const negative = await settle(t, "eth-bnb", "negative");
  assert.equal(negative.state, "completed", JSON.stringify(negative.failure));
  assert.equal(negative.destinationProof?.compositeTrace?.outcome, "completed_native");
  assert.equal(negative.destinationProof?.nativeBalance, null);
  const recovered = await settle(t, "eth-bnb", "negative", "recovered_weth");
  assert.equal(recovered.state, "destination_failed"); assert.equal(recovered.failure?.reason, "recovered_weth");
  assert.equal(recovered.destinationProof?.nativeBalance, null);
});
