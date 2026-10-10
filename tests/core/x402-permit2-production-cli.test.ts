import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { runCli, parseArgv } from "../../src/cli.js";
import { canonicalJson } from "../../src/canonical.js";
import { ApnError } from "../../src/errors.js";
import { COMMANDS } from "../../src/command-catalog.js";
import { MCP_TOOLS } from "../../src/mcp-projection.js";
import { ApnCore } from "../../src/core.js";
import { StateStore } from "../../src/state.js";
import { temporaryState } from "./helpers.js";
import { Permit2ApprovalRiskCoordinator } from "../../src/x402-permit2/production-approval-risk.js";
import { TtyPermit2ForegroundApproval, type Permit2ApprovalDisplay } from "../../src/x402-permit2/production-approval.js";
import { Permit2ProductionResults } from "../../src/x402-permit2/production-results.js";
import { Permit2ProductionPreparation } from "../../src/x402-permit2/production-prepare.js";
import { checkPermit2Challenge } from "../../src/x402-permit2/checked-challenge.js";
import { inspectPermit2Offer } from "../../src/x402-permit2/inspection.js";
import { permit2PublicRpc } from "../../src/x402-permit2/preflight.js";
import { productionUsageIdentity } from "../../src/x402-permit2/production-repository.js";
import { protocolSecond } from "./x402-permit2-production-protocol-fixture.js";
import { permit2CliFixture, cliWire } from "./x402-permit2-production-cli-fixture.js";

type Fixture = Awaited<ReturnType<typeof permit2CliFixture>>;
const argv = (f: Fixture) => ["x402", "permit2", "approve", "--profile", "owner", "--url", f.url, "--rpc-url", f.input.rpcUrl, "--idempotency-key", f.key];
const options = (f: Fixture) => ({ stateRoot: f.root, native: f.native, wrappingSecret: f.wrapping, clock: { now: f.now } });
const observe = (f: Fixture, ...extra: string[]) => ["x402", "permit2", "observe", "--operation", f.record.operationId, "--rpc-url", f.input.rpcUrl, ...extra];
function safe(value: unknown) {
  const text = JSON.stringify(value);
  for (const privateValue of ["private-path", "private=hidden", "private-key", "private-paid-body", "paymentSignatureHeader", "signingOrigin", "requestGrant", "bodyBase64", "rawHeaderPairs", "continuation"])
    assert.ok(!text.includes(privateValue), "CLI envelope excludes private or authority material");
}
test("new paid enclosure ignores injected approval callback and default nonforeground TTY denies before keys, RPC or paid request", async t => {
  const f = await permit2CliFixture(t, true, false); let forged = 0;
  t.mock.method(Date, "now", () => f.now().getTime());
  const original = TtyPermit2ForegroundApproval.prototype.approve; let refusal: unknown;
  t.mock.method(TtyPermit2ForegroundApproval.prototype, "approve", async function(this: TtyPermit2ForegroundApproval, display: Permit2ApprovalDisplay) {
    try { await original.call(this, display); } catch (error) { refusal = error; throw error; }
  });
  assert.equal(process.stdin.isTTY, undefined);
  const result = await new Permit2ApprovalRiskCoordinator(f.root, f.input.rpcUrl, f.native, f.preparation, f.now,
    { approve: async () => { forged++; } }).signAndSubmitOnce(f.record.operationId);
  assert.equal(forged, 0); assert.equal(result.status?.state, "reserved"); assert.equal(f.keys(), 0); assert.equal(f.signatures(), 0); assert.equal(f.batches.length, 0); safe(result);
  assert.ok(refusal instanceof ApnError); assert.equal(refusal.details?.nativeCode, "APN_TTY_UNAVAILABLE");
});
for (const phase of ["risk", "signed", "request", "terminal"] as const) test(`coordinator independently reads matching ${phase} status without hold repair, native, RPC or UI`, async t => {
  const f = await permit2CliFixture(t, false, false), id = f.record.operationId;
  await f.journal.markSignatureRisk(id);
  if (phase !== "risk") await f.journal.storeSigned(id, f.signed);
  if (phase === "request") await f.journal.markRequestPending(id);
  if (phase === "terminal") { const checked = await f.observe("settlement"); assert.ok(checked.proof); await f.journal.finalize(id, checked.proof, "settlement"); }
  const before = [f.keys(), f.signatures(), f.batches.length], path = `${f.root}/permit2-production/${id}.json`, bytes = await readFile(path, "utf8");
  t.mock.method(f.preparation, "reserve", async () => { throw new Error("No replay reservation"); });
  t.mock.method(TtyPermit2ForegroundApproval.prototype, "approve", async () => { throw new Error("No replay UI"); });
  const result = await new Permit2ApprovalRiskCoordinator(f.root, f.input.rpcUrl, f.native, f.preparation, f.now).signAndSubmitOnce(id);
  assert.equal(result.code, phase === "terminal" ? "terminal" : "held"); safe(result);
  assert.deepEqual([f.keys(), f.signatures(), f.batches.length], before); assert.equal(await readFile(path, "utf8"), bytes);
});
for (const settlement of [false, true]) test(`actual runCli unpaid GET through encrypted native paid closure sends once and ${settlement ? "genuine observer proof settles" : "HTTP200 alone holds"}`, async t => {
  const f = await permit2CliFixture(t), wire = cliWire(t, f, { hint: settlement, settle: settlement }); let ui = 0;
  // Trusted synthetic consent fixture only; this does not establish actual human approval.
  t.mock.method(TtyPermit2ForegroundApproval.prototype, "approve", async (display: Permit2ApprovalDisplay) => {
    ui++; assert.equal(f.keys(), 0); assert.equal(display.purpose, "sign-and-submit-once"); assert.equal(display.amountAtomic, "10000");
  });
  const result = await runCli(argv(f), {}, options(f)); assert.equal(result.ok, true); safe(result);
  assert.equal(ui, 1); assert.equal(f.signatures(), 2); assert.ok(f.keys() > 0); assert.equal(wire.paid.length, 1);
  assert.equal(wire.calls.filter(c => c === "unsigned_GET").length, 1); assert.equal(wire.calls.filter(c => c === "supported_GET").length, 1);
  const saved = (await f.records.findOperation(f.id))!;
  assert.equal(saved.exposureJournal!.request!.attempt, 1); assert.equal(saved.material.checked.request.method, "GET"); assert.deepEqual(saved.material.checked.request.headers, {}); assert.equal(saved.material.checked.request.bodyBase64, null);
  assert.equal(saved.state, settlement ? "settled" : "request_pending");
  const before = [f.keys(), f.signatures(), wire.calls.length, wire.paid.length], bytes = await readFile(`${f.root}/permit2-production/${f.id}.json`, "utf8");
  const replay = await runCli(argv(f), {}, { ...options(f), native: { request: async () => { throw new Error("No native replay"); } } });
  assert.equal(replay.ok, true); safe(replay); assert.deepEqual([f.keys(), f.signatures(), wire.calls.length, wire.paid.length], before);
  assert.equal(await readFile(`${f.root}/permit2-production/${f.id}.json`, "utf8"), bytes);
  const conflict = await runCli(argv(f).map(v => v === f.url ? `${f.url}&different=1` : v), {}, options(f));
  assert.equal(conflict.error?.code, "APN_IDEMPOTENCY_CONFLICT"); assert.deepEqual([f.keys(), f.signatures(), wire.calls.length, wire.paid.length], before); safe(conflict);
});
test("new operation refuses nonlocal native before unsigned HTTP or keychain", async t => {
  const f = await permit2CliFixture(t), wire = cliWire(t, f);
  const result = await runCli(argv(f), {}, { ...options(f), native: { request: async () => { throw new Error("No native request"); } } });
  assert.equal(result.ok, false); assert.equal(wire.calls.length, 0); assert.equal(wire.paid.length, 0); assert.equal(f.keys(), 0); safe(result);
});
test("genuine native from another state root refuses before unsigned HTTP or keychain", async t => {
  const f = await permit2CliFixture(t), wire = cliWire(t, f), other = await temporaryState(); t.after(other.cleanup);
  const result = await runCli(argv(f), {}, { ...options(f), stateRoot: other.root });
  assert.equal(result.ok, false); assert.equal(wire.calls.length, 0); assert.equal(wire.paid.length, 0); assert.equal(f.keys(), 0); safe(result);
});
for (const fault of ["network", "asset"] as const) test(`unsupported ${fault} refuses before foreground/key/send`, async t => {
  const f = await permit2CliFixture(t), wire = cliWire(t, f, fault === "network" ? { network: "eip155:8453" } : { asset: "0x4444444444444444444444444444444444444444" });
  let ui = 0; t.mock.method(TtyPermit2ForegroundApproval.prototype, "approve", async () => { ui++; });
  const result = await runCli(argv(f), {}, options(f)); assert.equal(result.ok, false); assert.equal(ui, 0); assert.equal(f.keys(), 0); assert.equal(wire.paid.length, 0); safe(result);
});
for (const outcome of ["declined", "expired"] as const) test(`foreground ${outcome} leaves frozen reserved operation without keys or send`, async t => {
  const f = await permit2CliFixture(t), wire = cliWire(t, f);
  t.mock.method(TtyPermit2ForegroundApproval.prototype, "approve", async () => {
    if (outcome === "declined") throw new ApnError("APN_NATIVE_REJECTED", "Synthetic private decision"); f.advance(122);
  });
  const result = await runCli(argv(f), {}, options(f)); assert.equal(result.ok, true); safe(result);
  assert.equal((await f.records.findOperation(f.id))!.state, "reserved"); assert.equal(f.keys(), 0); assert.equal(f.signatures(), 0); assert.equal(wire.paid.length, 0);
});
for (const state of ["prepared", "reserved"] as const) test(`matching ${state} resumes frozen material with no new 402 or preparation`, async t => {
  const f = await permit2CliFixture(t), wire = cliWire(t, f), preparation = new Permit2ProductionPreparation(f.root, { rpc: permit2PublicRpc(f.input.rpcUrl, f.root), now: f.now });
  const checked = checkPermit2Challenge(f.record.material.checked.challenge, { schemaVersion: "apn.http-request.v1", url: f.url, method: "GET", headers: {}, bodyBase64: null });
  const selected = inspectPermit2Offer({ accepts: checked.challenge.accepts, payer: f.record.material.wallet.account });
  const saved = await preparation.prepare({ profile: "owner", idempotencyKey: f.key, checked, expected: { index: selected.index, requirement: selected.requirement, challengeHash: checked.challengeHash } });
  if (state === "reserved") await preparation.reserve(saved.operationId);
  const nonce = saved.material.nonce, supported = wire.calls.filter(c => c === "supported_GET").length;
  t.mock.method(TtyPermit2ForegroundApproval.prototype, "approve", async () => {});
  const result = await runCli(argv(f), {}, options(f)); assert.equal(result.ok, true); safe(result);
  assert.equal(wire.calls.includes("unsigned_GET"), false); assert.equal(wire.calls.filter(c => c === "supported_GET").length, supported);
  assert.equal((await f.records.findOperation(f.id))!.material.nonce, nonce); assert.equal(wire.paid.length, 1);
});
test("strict CLI flags, legacy status and MCP projection preserve CLI-only paid/observe boundary", async t => {
  const base = ["x402", "permit2", "approve", "--url", "https://seller.example/", "--rpc-url", "https://8.8.8.8/", "--idempotency-key", "explicit-key-001"];
  assert.equal(parseArgv(base).request.command, "x402.permit2.approve");
  for (const flags of [["--method", "POST"], ["--yes"], ["--headers-json", "{}"], ["--body-base64", "AA=="]]) assert.throws(() => parseArgv([...base, ...flags]));
  const read = ["x402", "permit2", "observe", "--operation", "a".repeat(64), "--rpc-url", "https://8.8.8.8/"];
  assert.throws(() => parseArgv([...read, "--transaction", `0x${"0".repeat(64)}`]));
  assert.throws(() => parseArgv([...read, "--transaction", `0x${"a".repeat(64)}`, "--expired-unused"]));
  assert.equal(parseArgv(["x402", "permit2", "status", "--profile", "owner", "--operation", "a".repeat(64)]).request.command, "x402.permit2.status");
  const manifest = COMMANDS.find(d => d.path.join(" ") === "x402 permit2 approve")!;
  assert.equal(manifest.effect.class, "payment_submit"); assert.equal(manifest.approval.class, "foreground_tty");
  assert.ok(!JSON.stringify(MCP_TOOLS).includes("permit2 approve")); assert.ok(!JSON.stringify(MCP_TOOLS).includes("permit2 observe"));
  // Core owns no paid enclosure; direct generic execution rejects before dispatch.
  const temp = await temporaryState(); t.after(temp.cleanup);
  const denied = await new ApnCore({ state: new StateStore(temp.root) }).execute(parseArgv(base).request); assert.equal(denied.error?.code, "APN_UNSUPPORTED_COMMAND");
});
test("observe CLI uses explicit readonly candidate despite bad hint and genuine proof alone finalizes without keys/UI/resource", async t => {
  const f = await permit2CliFixture(t, false, false); await f.journal.markSignatureRisk(f.record.operationId); await f.journal.storeSigned(f.record.operationId, f.signed); await f.journal.markRequestPending(f.record.operationId);
  const response = Buffer.from(canonicalJson({ success: true, transaction: `0x${"f".repeat(64)}`, network: "eip155:43114", payer: f.record.material.wallet.account.toLowerCase(), amount: "10000" })).toString("base64");
  await new Permit2ProductionResults(f.state, f.journal).recordHttp(f.record.operationId, { status: 200, rawHeaderPairs: [["payment-response", response]] });
  t.mock.method(TtyPermit2ForegroundApproval.prototype, "approve", async () => { throw new Error("No UI observation"); });
  const result = await runCli(observe(f, "--transaction", f.input.locator!), {}, options(f));
  assert.equal(result.ok, true); safe(result); assert.equal((await f.journal.findOperation(f.record.operationId))!.state, "settled");
  assert.equal(f.keys(), 0); assert.equal(f.signatures(), 0);
  const wrongProfile = await runCli(observe(f, "--profile", "other"), {}, options(f)); assert.equal(wrongProfile.ok, false); safe(wrongProfile);
});
test("observe expired-unused command needs actual finalized unused nonce and never grants, decrypts or sends", async t => {
  const f = await permit2CliFixture(t, false, false); await f.journal.markSignatureRisk(f.record.operationId); await f.journal.storeSigned(f.record.operationId, f.signed);
  (f.input as { mode: string }).mode = "expired_unused"; f.wire.finalized.timestamp = `0x${(protocolSecond + 121).toString(16)}`;
  const result = await runCli(observe(f, "--expired-unused"), {}, options(f)); assert.equal(result.ok, true); safe(result);
  assert.equal((await f.journal.findOperation(f.record.operationId))!.state, "expired_no_effect"); assert.equal(f.keys(), 0); assert.equal(f.signatures(), 0);
  assert.equal((await f.usage.usageWithReservation(productionUsageIdentity(f.record), f.record.usageReservationId, f.now())).reservation!.state, "released_unsubmitted");
});
