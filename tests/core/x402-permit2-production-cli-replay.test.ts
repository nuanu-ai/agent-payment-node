import assert from "node:assert/strict";
import test from "node:test";
import { runCli } from "../../src/cli.js";
import { SecureStateStore } from "../../src/secure-state-store.js";
import { TtyPermit2ForegroundApproval } from "../../src/x402-permit2/production-approval.js";
import { permit2CliFixture, cliWire } from "./x402-permit2-production-cli-fixture.js";

for (const settled of [false, true]) test(`matching CLI ${settled ? "terminal" : "held"} replay performs zero actual durable writes before rejecting all effect dependencies`, async t => {
  const f = await permit2CliFixture(t), wire = cliWire(t, f, { hint: settled, settle: settled });
  t.mock.method(TtyPermit2ForegroundApproval.prototype, "approve", async () => {}); // Trusted synthetic consent only.
  const argv = ["x402", "permit2", "approve", "--profile", "owner", "--url", f.url, "--rpc-url", f.input.rpcUrl, "--idempotency-key", f.key];
  assert.equal((await runCli(argv, {}, { stateRoot: f.root, native: f.native, clock: { now: f.now } })).ok, true);
  assert.equal((await f.records.findOperation(f.id))!.state, settled ? "settled" : "request_pending");
  const before = [f.keys(), f.signatures(), wire.calls.length, wire.paid.length]; let writes = 0;
  const store = SecureStateStore.prototype;
  // Existing low-level I/O instrumentation: any ledger, pacing or operation write is an observable failure.
  t.mock.method(store as any, "writeJson", async () => { writes++; throw new Error("No replay durable write"); });
  t.mock.method(TtyPermit2ForegroundApproval.prototype, "approve", async () => { throw new Error("No replay consent"); });
  const result = await runCli(argv, {}, { stateRoot: f.root, native: { request: async () => { throw new Error("No replay native"); } },
    wrappingSecret: { load: async () => { throw new Error("No replay wrapping secret"); }, create: async () => { throw new Error("No replay secret creation"); } },
    http: { get: async () => { throw new Error("No replay HTTP"); } } });
  assert.equal(result.ok, true); assert.equal(writes, 0); assert.deepEqual([f.keys(), f.signatures(), wire.calls.length, wire.paid.length], before);
  assert.ok(!JSON.stringify(result).includes("private=hidden"));
});
