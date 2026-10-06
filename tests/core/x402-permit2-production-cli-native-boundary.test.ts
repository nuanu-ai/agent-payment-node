import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { runCli } from "../../src/cli.js";
import { LocalWalletNative } from "../../src/local-wallet-native.js";
import { Permit2ApprovalRiskCoordinator } from "../../src/x402-permit2/production-approval-risk.js";
import { TtyPermit2ForegroundApproval } from "../../src/x402-permit2/production-approval.js";
import { cliWire, permit2CliFixture } from "./x402-permit2-production-cli-fixture.js";

class DerivedNative extends LocalWalletNative {}
const argv = (f: Awaited<ReturnType<typeof permit2CliFixture>>) => ["x402", "permit2", "approve", "--profile", "owner", "--url", f.url, "--rpc-url", f.input.rpcUrl, "--idempotency-key", f.key];
test("registered ordinary native subclass rejects before unsigned HTTP, RPC, UI, custody or operation creation", async t => {
  const f = await permit2CliFixture(t), wire = cliWire(t, f); let ui = 0;
  t.mock.method(TtyPermit2ForegroundApproval.prototype, "approve", async () => { ui++; throw new Error("No subclass approval"); });
  const native = new DerivedNative(f.state, f.wrapping);
  const result = await runCli(argv(f), {}, { stateRoot: f.root, native, clock: { now: f.now } });
  assert.equal(result.ok, false); assert.equal(await f.records.findOperation(f.id), null);
  assert.deepEqual([wire.calls.length, wire.paid.length, ui, f.keys(), f.signatures()], [0, 0, 0, 0, 0]);
});
test("coordinator independently rejects registered ordinary native subclass before any approval or effect", async t => {
  const f = await permit2CliFixture(t, true, false); let ui = 0;
  const bytes = await readFile(`${f.root}/permit2-production/${f.record.operationId}.json`, "utf8");
  assert.throws(() => new Permit2ApprovalRiskCoordinator(f.root, f.input.rpcUrl, new DerivedNative(f.state, f.wrapping), f.preparation, f.now,
    { approve: async () => { ui++; } }));
  assert.deepEqual([ui, f.keys(), f.signatures(), f.batches.length], [0, 0, 0, 0]);
  assert.equal(await readFile(`${f.root}/permit2-production/${f.record.operationId}.json`, "utf8"), bytes);
});
for (const method of ["signPermit2Production", "beginPermit2ProductionRequest", "submitPermit2Production"] as const)
  test(`paid CLI ignores own ${method} replacement and genuine primitives sign and send exactly once`, async t => {
    const f = await permit2CliFixture(t), wire = cliWire(t, f); let replacement = 0, ui = 0;
    // Synthetic consent fixture only; no actual human TTY receipt is asserted.
    t.mock.method(TtyPermit2ForegroundApproval.prototype, "approve", async () => { ui++; assert.equal(f.keys(), 0); });
    Object.defineProperty(f.native, method, { configurable: true, value: async () => { replacement++; throw new Error("Caller native override must not execute"); } });
    const result = await runCli(argv(f), {}, { stateRoot: f.root, native: f.native, clock: { now: f.now } });
    assert.equal(result.ok, true); assert.equal(replacement, 0); assert.equal(ui, 1);
    assert.equal(f.signatures(), 2); assert.ok(f.keys() > 0); assert.equal(wire.paid.length, 1);
    const saved = (await f.records.findOperation(f.id))!;
    assert.equal(saved.state, "request_pending"); assert.equal(saved.exposureJournal!.request!.attempt, 1);
    const text = JSON.stringify(result); for (const privateValue of ["paymentSignatureHeader", "signingOrigin", "requestGrant", "private-paid-body", "private=hidden"]) assert.ok(!text.includes(privateValue));
  });
