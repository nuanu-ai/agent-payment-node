import assert from "node:assert/strict";
import test from "node:test";
import { bindArgv, bindMcpInput } from "../../src/command-binder.js";
import { projectMcpTools } from "../../src/mcp-projection.js";
import { hashObject } from "../../src/canonical.js";
import { mmPolicyHash } from "../../src/metamask-gasless/economics.js";
import { mmRequestHash } from "../../src/metamask-gasless/operation-model.js";
import { helperRequest, MM_HELPER_VERSION } from "../../src/metamask-gasless/client/protocol.js";
import { mmDispatchIntent } from "../../src/metamask-gasless/dispatch.js";
import { mmRequest } from "../../src/metamask-gasless/validation.js";
import { mmRegistry } from "../../src/metamask-gasless/registry.js";
import { validateMetaMaskGaslessOperation } from "../../src/metamask-gasless/journal/validation.js";
import { temporaryState } from "./helpers.js";
import { mmFixture, MM_TEST_RECIPIENT } from "./metamask-gasless-helpers.js";
import { gaslessFixture } from "./gasless-helpers.js";
const request = { chainId: 42161 as const, recipient: MM_TEST_RECIPIENT, grossAtomic: "25000", maxFeeAtomic: "24000",
  minReceivedAtomic: "1000", fixedNet: { netAtomic: "1000", maxGrossAtomic: "25000" } };
const tool = projectMcpTools().find(t => t.name === "apn_gasless_transfer_prepare")!;
const fields = { profile: "mm-fixture", chain: "42161", to: MM_TEST_RECIPIENT, net_amount_atomic: "1000",
  max_gross_atomic: "25000", max_fee_atomic: "24000", idempotency_key: "fixed-net-001" };
test("fixed net CLI and MCP bind the same explicit exclusive mode", () => {
  const cli = bindArgv(["gasless", "transfer", "prepare", ...Object.entries(fields).flatMap(([k,v]) => [`--${k.replaceAll("_", "-")}`, v])]);
  assert.deepEqual(cli, bindMcpInput(tool.command, fields));
  assert.deepEqual((cli.request as any).request, request);
  assert.equal(tool.inputSchema.oneOf?.length, 2);
  for (const extra of [{ amount: "0.025" }, { min_received: "0.001" }, { max_fee: "0.024" }])
    assert.throws(() => bindMcpInput(tool.command, { ...fields, ...extra }));
  for (const field of ["net_amount_atomic", "max_gross_atomic", "max_fee_atomic"]) {
    const partial = { ...fields } as Record<string,string>; delete partial[field];
    assert.throws(() => bindMcpInput(tool.command, partial));
  }
  assert.throws(() => mmRequest({ ...request, fixedNet: { ...request.fixedNet, extra: "1" } }));
  assert.throws(() => mmRequest({ ...request, fixedNet: { ...request.fixedNet, maxGrossAtomic: "25001" } }));
});
test("moving fee quote keeps exact net and immutable preparation, settles actual debit and unused cap", async t => {
  const temp = await temporaryState(); t.after(temp.cleanup); const f = await mmFixture(temp.root, 42161);
  f.provider.fees = ["17443", "17479", "17432"]; f.rpc.state = { ...f.rpc.state, usdcBalanceAtomic: "40000" };
  const prepared = await f.core.execute({ command: "gasless.transfer.prepare", profile: f.profile, request, idempotencyKey: "fixed-net-001" });
  assert.equal(prepared.ok, true, JSON.stringify(prepared.error)); const id = (prepared.operation as any).operation_id;
  const before = await f.record(id); assert.equal(before.intent.preparedGrossAtomic, "18443");
  assert.equal(f.provider.quotes.length, 1); assert.equal(f.provider.submissions.length, 0);
  const result = await f.core.execute({ command: "gasless.transfer.approve", operationId: id });
  assert.equal(result.ok, true, JSON.stringify(result.error)); const after = await f.record(id);
  assert.equal(after.state, "completed"); assert.deepEqual(after.intent, before.intent); assert.equal(after.fingerprint, before.fingerprint);
  assert.equal(f.provider.quotes.length, 2); assert.ok(f.provider.quotes.every(q => q.netAtomic === "1000"));
  assert.equal(f.provider.submissions.length, 1); assert.equal(after.dispatch?.quote.feeAtomic, "17479");
  assert.equal(after.settlement?.debitAtomic, "18479"); assert.equal(after.settlement?.deliveredAtomic, "1000");
  assert.equal(after.settlement?.unusedGrossAtomic, "6521");
  const helper = helperRequest({ version: MM_HELPER_VERSION, mode: "submit", intent: mmDispatchIntent(after) });
  assert.equal(helper.mode, "submit");
  assert.equal((result.operation as any).fees.approved_sender_native_debit_wei, "0");
  assert.equal((result.operation as any).fees.proven_sender_native_debit_wei, "0");
  assert.equal((result.operation as any).transfer.maximum_gross_atomic, "25000");
  assert.equal((result.operation as any).transfer.gross_atomic, "18479");
  assert.equal(f.approval.calls[0]!.summary.maximum_gross_usdc, "0.025");
  await f.restart().execute({ command: "operation.resume", operationId: id }); assert.equal(f.provider.submissions.length, 1);
  const tampered = structuredClone(after); (tampered.intent.request.fixedNet as any).netAtomic = "999";
  assert.throws(() => validateMetaMaskGaslessOperation(tampered));
});
test("gross ceiling, fee ceiling and actual balance all fail before effects", async t => {
  for (const [name, fee, balance] of [["gross", "24001", "40000"], ["fee", "24000", "40000"], ["balance", "17443", "18442"]]) {
    const temp = await temporaryState(); t.after(temp.cleanup); const f = await mmFixture(temp.root, 42161);
    f.provider.fees = [fee!]; f.rpc.state = { ...f.rpc.state, usdcBalanceAtomic: balance! };
    const bounds = name === "fee" ? { ...request, maxFeeAtomic: "23999" } : request;
    const result = await f.core.execute({ command: "gasless.transfer.prepare", profile: f.profile, request: bounds, idempotencyKey: `fixed-net-${name}` });
    assert.equal(result.ok, false, name); assert.equal(f.provider.submissions.length, 0);
  }
});
test("fresh pricing above cap or fresh actual balance insufficiency cannot dispatch", async t => {
  for (const name of ["cap", "balance"]) {
    const temp = await temporaryState(); t.after(temp.cleanup); const f = await mmFixture(temp.root, 42161); f.provider.fees = ["17443"];
    const p = await f.core.execute({ command: "gasless.transfer.prepare", profile: f.profile, request, idempotencyKey: `fixed-net-${name}` });
    const id = (p.operation as any).operation_id; f.provider.fees = ["17443", name === "cap" ? "24001" : "17479"];
    if (name === "balance") f.rpc.state = { ...f.rpc.state, usdcBalanceAtomic: "18478" };
    await f.core.execute({ command: "gasless.transfer.approve", operationId: id });
    const op = await f.record(id); assert.equal(op.state, "failed_before_effect"); assert.equal(op.submissionAttempts, 0); assert.equal(f.provider.submissions.length, 0);
  }
});
test("local wallet refuses fixed net capability", async t => {
  const temp = await temporaryState(); t.after(temp.cleanup); const f = await gaslessFixture(temp.root);
  const result = await f.core.execute({ command: "gasless.transfer.prepare", profile: f.profile, request: { ...request, chainId: 8453 }, idempotencyKey: "fixed-local-001" });
  assert.equal(result.ok, false); assert.equal(result.error?.code, "APN_PROVIDER_CAPABILITY_UNAVAILABLE");
});
test("legacy absent mode preserves request and policy hash bytes", async t => {
  const temp = await temporaryState(); t.after(temp.cleanup); const f = await mmFixture(temp.root);
  const r = f.request, token = mmRegistry(r.chainId).row.token;
  assert.equal(mmRequestHash(f.state.profileHash(f.profile), { request: r, token }), hashObject({ kind: "metamask_gasless_transfer",
    profileHash: f.state.profileHash(f.profile), providerId: "metamask-agent-wallet", chainId: r.chainId, token,
    recipient: r.recipient, grossAtomic: r.grossAtomic, maxFeeAtomic: r.maxFeeAtomic, minReceivedAtomic: r.minReceivedAtomic }));
  assert.equal(mmPolicyHash(f.state.profileHash(f.profile), f.binding, r), hashObject({ purpose: "apn.metamask-gasless.policy.v1",
    profileHash: f.state.profileHash(f.profile), binding: f.binding, chainId: r.chainId, token,
    recipient: r.recipient, grossAtomic: r.grossAtomic, maxFeeAtomic: r.maxFeeAtomic, minReceivedAtomic: r.minReceivedAtomic }));
});

test("fixed-net provider failures and missing token fee fields cannot create a dispatch", async t => {
  for (const mode of ["throw", "missing-fee"]) {
    const temp = await temporaryState(); t.after(temp.cleanup); const f = await mmFixture(temp.root, 42161);
    const original = f.provider.quote.bind(f.provider);
    f.provider.quote = async input => {
      if (mode === "throw") throw new Error("synthetic_quote_unavailable");
      const q = await original(input); delete (q as any).feeAtomic; return q;
    };
    const result = await f.core.execute({ command: "gasless.transfer.prepare", profile: f.profile, request, idempotencyKey: `fixed-${mode}` });
    assert.equal(result.ok, false); assert.equal(f.provider.submissions.length, 0);
  }
});
test("a falling fee uses fresh actual debit even when current balance is below the prepared estimate", async t => {
  const temp = await temporaryState(); t.after(temp.cleanup); const f = await mmFixture(temp.root, 42161);
  f.provider.fees = ["17479", "17432"];
  const prepared = await f.core.execute({ command: "gasless.transfer.prepare", profile: f.profile, request, idempotencyKey: "fixed-falling-001" });
  const id = (prepared.operation as any).operation_id;
  f.rpc.state = { ...f.rpc.state, usdcBalanceAtomic: "18432" };
  const result = await f.core.execute({ command: "gasless.transfer.approve", operationId: id });
  assert.equal(result.ok, true, JSON.stringify(result.error)); const op = await f.record(id);
  assert.equal(op.state, "completed"); assert.equal(op.settlement?.debitAtomic, "18432"); assert.equal(f.provider.submissions.length, 1);
});
