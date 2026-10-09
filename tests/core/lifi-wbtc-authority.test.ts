import { newBridgeOperation } from "../../src/lifi/transitions.js";
import { newBridgeEffect } from "../../src/lifi/operation-model.js";
import assert from "node:assert/strict";
import test from "node:test";
import { readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { BridgeAllowlistGate, validateBridgeAllowlistBinding } from "../../src/lifi/allowlist.js";
import { BridgeEffectClaims, assertBridgePhysicalGrant, withBridgeEffectAuthority } from "../../src/lifi/effect-authority.js";
import { BridgeRpc } from "../../src/lifi/rpc-adapter.js";
import { bridgeRpcFactory } from "../../src/lifi/rpc-transport.js";
import { AllowlistPolicyStore, allowlistDecisionFingerprint, allowlistProfileHash } from "../../src/allowlist-policy.js";
import { canonicalJson, hashObject } from "../../src/canonical.js";
import { temporaryState } from "./helpers.js";
import { preparedWbtc } from "./lifi-wbtc-authority-helpers.js";
import { revokeDirectPolicy } from "./direct-allowlist-helpers.js";

for (const advance of ["foreground", "wallet", "policy"] as const) test(`WBTC ${advance} authority expires before signing; no source send`, async t => {
  const temp = await temporaryState(); t.after(temp.cleanup);
  const { op, f } = await preparedWbtc(temp.root, new Date("2026-10-09T03:44:00Z"), advance === "policy" ? "2026-10-09T03:44:30.000Z" : undefined);
  if (advance === "foreground") {
    const persist = f.core.bridges.records.persist.bind(f.core.bridges.records);
    f.core.bridges.records.persist = async next => { await persist(next); if (next.state === "execution_pending") f.now.setTime(f.now.getTime() + 60_001); };
  } else {
    const load = f.wrapping.load.bind(f.wrapping);
    f.wrapping.load = async () => { f.now.setTime(f.now.getTime() + (advance === "policy" ? 30_001 : 60_001)); return await load(); };
  }
  const result = await f.core.execute({ command: "bridge.approve", operationId: op.operationId });
  assert.equal(result.ok, false); assert.equal(f.source.submissions.length, 0);
  const latest = (await f.core.bridges.records.findOperation(op.operationId))!;
  assert(latest.effects.every(e => e.transactionHash === null));
});

test("same-revision revoke/reactivate changes activation; legacy absent binding stays byte-stable", async t => {
  const temp = await temporaryState(); t.after(temp.cleanup);
  const { op, f } = await preparedWbtc(temp.root, new Date("2026-10-09T03:44:00Z"));
  const old = op.intent.allowlist!, { activationDigest, ...legacy } = old;
  assert(activationDigest); assert.equal(hashObject(validateBridgeAllowlistBinding(legacy)), hashObject(legacy));
  await revokeDirectPolicy(temp.root, f.profile, f.now);
  const store = new AllowlistPolicyStore(temp.root), state = await store.read(f.profile), record = state.records.at(-1)!;
  const head = state.entries.at(-1)!.entryDigest;
  const approvalFingerprint = allowlistDecisionFingerprint({ action: "activate", profileHash: allowlistProfileHash(f.profile),
    revision: record.revision, stagedRecordDigest: record.recordDigest, policyDigest: record.registry.policyDigest, headEntryDigest: head });
  await store.appendDecision(f.profile, head, { status: "active", revision: record.revision, stagedRecordDigest: record.recordDigest,
    policyDigest: record.registry.policyDigest, registry: record.registry, approvalFingerprint, decidedAt: f.now.toISOString() });
  await assert.rejects(new BridgeAllowlistGate({ state: f.state, clock: { now: () => f.now } }).confirm(f.profile,
    op.intent.materialization.request, "across", old), /changed/);
  assert.equal(f.source.submissions.length, 0);
});

test("queued physical send rejects disposed grant and exact raw substitution", async t => {
  const temp = await temporaryState(); t.after(temp.cleanup);
  const { op, f } = await preparedWbtc(temp.root, new Date("2026-10-09T03:44:00Z"));
  f.source.failObserve = true;
  assert((await f.core.execute({ command: "bridge.approve", operationId: op.operationId })).ok);
  const current = (await f.core.bridges.records.findOperation(op.operationId))!, material = (await f.custody.load(current, "approval"))!;
  let now = f.now.getTime(), posts = 0;
  const factory = bridgeRpcFactory({ APN_ETHEREUM_RPC_URL: "https://rpc.example" }, { transport: {
    request: async (_url, _method, body, _max, _code, beforeSend) => {
      now += 60_001; await beforeSend?.(); posts++; return { status: 200, body: JSON.stringify({ jsonrpc: "2.0", id: JSON.parse(body!).id, result: material.transactionHash }) };
    },
  } });
  let escaped: (() => Promise<void>) | undefined;
  await withBridgeEffectAuthority(current, () => now, async () => true, async () => {}, async () => undefined, async authority => {
    const guard = authority.send(current, material); escaped = guard;
    assert.throws(() => assertBridgePhysicalGrant(guard, "0x00"));
    await assert.rejects(factory(1).send(material.rawTransaction, guard), /expired/);
  });
  assert.equal(posts, 0); await assert.rejects(escaped!(), /expired/);
});

test("permanent SIGN/SEND claims survive valid journal restoration and usage removal", async t => {
  const temp = await temporaryState(); t.after(temp.cleanup);
  const { op, f } = await preparedWbtc(temp.root, new Date("2026-10-09T03:44:00Z"));
  const path = join(temp.root, "bridge-operations", op.profileHash, `${op.operationId}.json`), saved = await readFile(path);
  f.source.failObserve = true;
  assert((await f.core.execute({ command: "bridge.approve", operationId: op.operationId })).ok);
  const current = (await f.core.bridges.records.findOperation(op.operationId))!, material = (await f.custody.load(current, "approval"))!;
  await writeFile(path, saved); await rm(join(temp.root, "asset-usage"), { recursive: true, force: true });
  const claims = new BridgeEffectClaims(temp.root);
  await assert.rejects(claims.claim(op, "approval", "sign"));
  await assert.rejects(claims.claim(op, "approval", "send", material));
  assert.equal(f.source.submissions.length, 1);
});

for (const stage of ["DNS", "TLS", "queue"] as const) test(`normal WBTC async BridgeHttps ${stage} expiry withholds request.end`, async t => {
  const { default: https } = await import("node:https");
  const { EventEmitter } = await import("node:events");
  const { syncBuiltinESMExports } = await import("node:module");
  const { setImmediate: tick } = await import("node:timers/promises");
  const { BridgeHttps } = await import("../../src/lifi/https.js");
  const temp = await temporaryState(); t.after(temp.cleanup);
  const { op, f } = await preparedWbtc(temp.root, new Date("2026-10-09T03:44:00Z"));
  f.source.failObserve = true; assert((await f.core.execute({ command: "bridge.approve", operationId: op.operationId })).ok);
  const current = (await f.core.bridges.records.findOperation(op.operationId))!, material = (await f.custody.load(current, "approval"))!;
  const requests: Array<{ ends: number; tls(): void; respond(): void }> = [];
  t.mock.method(https, "request", ((_url: unknown, _options: unknown, callback: (response: unknown) => void) => {
    const req = new EventEmitter() as any, socket = new EventEmitter() as any; socket.remoteAddress = "8.8.8.8";
    const row = { ends: 0, tls() { req.emit("socket", socket); socket.emit("secureConnect"); }, respond() {
      const response = new EventEmitter() as any; response.statusCode = 200; response.headers = {};
      callback(response); response.emit("data", Buffer.from("{}")); response.emit("end"); } };
    req.end = () => { row.ends++; }; req.destroy = () => { queueMicrotask(() => req.emit("error", Error("synthetic"))); };
    requests.push(row); return req;
  }) as any);
  syncBuiltinESMExports(); t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  const until = async (predicate: () => boolean) => { for (let i = 0; i < 1000 && !predicate(); i++) await tick(); assert(predicate()); };
  let now = f.now.getTime(); const approved = now;
  const transport = new BridgeHttps(async () => { if (stage === "DNS") now += 60_001; return [{ address: "8.8.8.8", family: 4 }]; });
  await withBridgeEffectAuthority(current, () => now, async () => true, async () => {}, async () => undefined, async authority => {
    const guard = authority.send(current, material);
    if (stage === "DNS") { await assert.rejects(transport.request("https://rpc.example", "POST", "{}", 1024, "APN_RPC_CONFIG", guard)); assert.equal(requests.length, 0); return; }
    let first: Promise<unknown> | undefined, second: Promise<unknown> | undefined;
    if (stage === "queue") {
      first = transport.request("https://rpc.example", "GET", null, 1024, "APN_RPC_CONFIG");
      second = transport.request("https://rpc.example", "GET", null, 1024, "APN_RPC_CONFIG");
      await until(() => requests.length === 2);
    }
    const pending = transport.request("https://rpc.example", "POST", "{}", 1024, "APN_RPC_CONFIG", guard), refused = assert.rejects(pending);
    if (stage === "TLS") { await until(() => requests.length === 1); now += 60_001; requests[0]!.tls(); }
    else { now += 60_001; requests[0]!.respond(); requests[1]!.respond(); await Promise.all([first, second]); }
    await refused;
    assert.equal(requests.length, stage === "TLS" ? 1 : 2); if (stage === "TLS") assert.equal(requests[0]!.ends, 0);
  });
});


test("fresh WBTC prepare uses exact retained 1000 allowance with one bridge effect", async t => {
  const temp = await temporaryState(); t.after(temp.cleanup);
  const { op, f } = await preparedWbtc(temp.root, new Date("2026-10-09T03:44:00Z"), undefined, "1000");
  assert.deepEqual(op.effects.map(e => e.role), ["bridge"]);
  const result = await f.core.execute({ command: "bridge.approve", operationId: op.operationId });
  assert.equal(result.ok, true, JSON.stringify(result.error)); assert.equal(f.source.submissions.length, 1);
  assert.equal(op.intent.sourceAccount.allowanceAtomic, "1000");
});

test("old WBTC absent activation remains readable and never requests signing consent", async t => {
  const temp = await temporaryState(); t.after(temp.cleanup);
  const { op, f } = await preparedWbtc(temp.root, new Date("2026-10-09T03:44:00Z"));
  const { activationDigest, ...allowlist } = op.intent.allowlist!; assert(activationDigest);
  const legacy = newBridgeOperation({ profileHash: op.profileHash, operationId: op.operationId, idempotencyHash: op.idempotencyHash,
    requestHash: op.requestHash, intent: { ...op.intent, allowlist }, effects: op.effects.map(e => newBridgeEffect(e.envelope)) });
  await writeFile(join(temp.root, "bridge-operations", op.profileHash, `${op.operationId}.json`), `${canonicalJson(legacy)}\n`);
  await rm(join(temp.root, "bridge-receipts", op.profileHash, `${op.operationId}.json`));
  const before = hashObject(legacy), result = await f.core.execute({ command: "bridge.approve", operationId: op.operationId });
  assert.equal(result.ok, false); assert.equal(result.error?.details?.reason, "bridge_activation_binding_missing"); assert.equal(f.approval.calls.length, 0); assert.equal(f.source.submissions.length, 0);
  assert.equal(hashObject((await f.core.bridges.records.findOperation(op.operationId))!), before);
});

test("true policy lock defers concurrent revocation until WBTC effects finish", async t => {
  const temp = await temporaryState(); t.after(temp.cleanup);
  const { op, f } = await preparedWbtc(temp.root, new Date("2026-10-09T03:44:00Z"));
  let revocation: Promise<void> | undefined, completed = false;
  f.approval.confirm = async () => {
    revocation = revokeDirectPolicy(temp.root, f.profile, f.now).then(() => { completed = true; });
    await new Promise<void>(resolve => setTimeout(resolve, 30));
    assert.equal(completed, false); return true;
  };
  const result = await f.core.execute({ command: "bridge.approve", operationId: op.operationId });
  assert.equal(result.ok, true, JSON.stringify(result.error)); assert.equal(f.source.submissions.length, 2);
  await revocation; assert.equal(completed, true);
  assert.equal((await new AllowlistPolicyStore(temp.root).read(f.profile)).entries.at(-1)!.status, "revoked");
});
