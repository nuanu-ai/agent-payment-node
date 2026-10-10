import { newBridgeOperation, transitionBridge } from "../../src/lifi/transitions.js";
import { newBridgeEffect } from "../../src/lifi/operation-model.js";
import assert from "node:assert/strict";
import test from "node:test";
import { readFile, writeFile, rm, chmod } from "node:fs/promises";
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


import { createApnCore } from "../../src/runtime-factory.js";
import { bindArgv } from "../../src/command-binder.js";
import { ApnCore } from "../../src/core.js";
import { TtyBridgeApproval } from "../../src/lifi/tty.js";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
function normalResumeApproval(root: string, operationId: string) {
  return createApnCore(bindArgv(["operation", "resume", "--operation", operationId, "--rpc-url", "https://example.com"]),
    { stateRoot: root }).context.bridge!.approval;
}
test("normal factory installs bridge TTY only for approval-capable resume, never status or observe-only", async t => {
  const temp = await temporaryState(); t.after(temp.cleanup); const id = "a".repeat(64);
  assert(normalResumeApproval(temp.root, id) instanceof TtyBridgeApproval);
  for (const args of [["operation", "resume", "--operation", id, "--rpc-url", "https://example.com", "--observe-only", "true"],
    ["operation", "status", "--operation", id]]) {
    assert.equal(createApnCore(bindArgv(args), { stateRoot: temp.root }).context.bridge!.approval, undefined);
  }
});
async function partialWbtc(root: string) {
  const result = await preparedWbtc(root, new Date());
  result.f.source.failObserve = true;
  assert((await result.f.core.execute({ command: "bridge.approve", operationId: result.op.operationId })).ok);
  result.f.source.failObserve = false; result.f.source.safeApproval = false;
  assert((await result.f.core.execute({ command: "operation.resume", operationId: result.op.operationId })).ok);
  const current = (await result.f.core.bridges.records.findOperation(result.op.operationId))!;
  assert.equal(result.f.source.submissions.length, 1); assert.equal(current.effects[1]!.phase, "unsealed");
  assert.equal(current.effects[0]!.phase, "included_success");
  return result;
}
test("normal non-TTY WBTC continuation refuses before remaining SIGN or SEND", async t => {
  const temp = await temporaryState(); t.after(temp.cleanup); const { op, f } = await partialWbtc(temp.root);
  const approval = normalResumeApproval(temp.root, op.operationId); assert(approval);
  const core = new ApnCore({ state: f.state, clock: { now: () => new Date(f.now) }, bridge: { ...f.dependencies, approval } });
  const result = await core.execute({ command: "operation.resume", operationId: op.operationId });
  assert.equal(result.ok, false); assert.equal(result.error?.code, "APN_NATIVE_REJECTED");
  assert.equal(result.error?.details?.nativeCode, "APN_TTY_UNAVAILABLE");
  assert.equal(f.source.submissions.length, 1);
  assert.equal((await core.bridges.records.findOperation(op.operationId))!.effects[1]!.phase, "unsealed");
});
test("normal genuine TTY WBTC second resume prompts fresh consent; attempted effects remain observer-only", async t => {
  const title = "normal genuine TTY WBTC second resume prompts fresh consent; attempted effects remain observer-only";
  if (process.env.APN_WBTC_RESUME_TEST_PTY_CHILD !== "1") { await runResumePty(title); return; }
  assert.equal(process.stdin.isTTY, true); assert.equal(process.stderr.isTTY, true);
  process.stdout.write(`PTY_CASE_ENTERED:${title}\n`);
  const temp = await temporaryState(); t.after(temp.cleanup); const { op, f } = await partialWbtc(temp.root);
  const approval = normalResumeApproval(temp.root, op.operationId); assert(approval);
  const core = new ApnCore({ state: f.state, clock: { now: () => new Date(f.now) }, bridge: { ...f.dependencies, approval } });
  const result = await core.execute({ command: "operation.resume", operationId: op.operationId });
  assert.equal(result.ok, true, JSON.stringify(result.error)); assert.equal(f.source.submissions.length, 2);
  const current = (await core.bridges.records.findOperation(op.operationId))!;
  assert.deepEqual(current.effects.map(e => e.submissionAttempts), [1, 1]);
  const before = f.wrapping.loads;
  f.now.setTime(Date.parse(current.intent.expiresAt) + 1);
  approval.confirm = async () => { throw Error("Attempted effects must not prompt or authorize again"); };
  const observed = await core.execute({ command: "operation.resume", operationId: op.operationId });
  assert.equal(observed.ok, true, JSON.stringify(observed.error)); assert.equal(f.source.submissions.length, 2);
  assert.equal(f.wrapping.loads, before);
});
async function runResumePty(title: string): Promise<void> {
  const python = String.raw`import os,pty,select,subprocess,sys,re,time
master,slave=pty.openpty()
def session():
 os.setsid()
 import fcntl,termios
 fcntl.ioctl(slave,termios.TIOCSCTTY,0)
env=dict(os.environ);env.pop('NODE_TEST_CONTEXT',None);env['APN_WBTC_RESUME_TEST_PTY_CHILD']='1'
child=subprocess.Popen([sys.argv[1],'--test','--test-isolation=none','--test-concurrency=1','--test-name-pattern','^'+sys.argv[3]+'$',sys.argv[2]],stdin=slave,stdout=slave,stderr=slave,env=env,preexec_fn=session)
os.close(slave);output=b'';pending=b'';prompts=0;deadline=time.time()+90
while time.time()<deadline:
 ready,_,_=select.select([master],[],[],.1)
 if ready:
  try:chunk=os.read(master,65536)
  except OSError:break
  if not chunk:break
  output+=chunk;pending+=chunk
  while True:
   match=re.search(rb'Type ([^\r\n]+) and press Enter to confirm\.',pending)
   if not match:break
   prompts+=1;os.write(master,match.group(1)+b'\n');pending=pending[match.end():]
 if child.poll() is not None and not ready:break
else:child.kill()
os.close(master);child.wait();sys.stdout.buffer.write(output);sys.exit(child.returncode if child.returncode else (0 if prompts==1 else 1))
`;
  await new Promise<void>((resolve, reject) => {
    const child = spawn("python3", ["-c", python, process.execPath, fileURLToPath(import.meta.url), title], { stdio: ["ignore", "pipe", "pipe"] });
    let output = ""; child.stdout.on("data", b => { output += String(b); }); child.stderr.on("data", b => { output += String(b); });
    child.on("error", reject); child.on("exit", code => {
      if (code === 0 && output.includes(`PTY_CASE_ENTERED:${title}`)) { process.stdout.write("Verified one genuine WBTC continuation TEST-key TTY consent\n"); resolve(); }
      else reject(new Error(`Genuine WBTC resume PTY failed (${code}): ${output}`));
    });
  });
}

for (const phase of ["safe", "included", "signing_started"] as const)
test(`expired guarded WBTC ${phase} continuation uses only canonical terminal or observer path`, async t => {
  const temp = await temporaryState(); t.after(temp.cleanup); const { op, f } = await partialWbtc(temp.root);
  f.source.safeApproval = phase !== "included";
  if (phase === "signing_started") {
    const current = (await f.core.bridges.records.findOperation(op.operationId))!;
    await f.core.bridges.records.persist(transitionBridge(current, { effects: current.effects.map(e =>
      e.role === "bridge" ? { ...e, phase: "signing_started" as const } : e) }, f.now.toISOString()));
  }
  f.now.setTime(Date.parse(op.intent.expiresAt) + 1);
  const { approval, ...withoutApproval } = f.dependencies;
  const core = new ApnCore({ state: f.state, clock: { now: () => new Date(f.now) }, bridge: withoutApproval });
  const before = f.wrapping.loads;
  const result = await core.execute({ command: "operation.resume", operationId: op.operationId });
  assert.equal(result.ok, true, JSON.stringify(result.error)); assert.equal(f.source.submissions.length, 1);
  assert.equal(f.wrapping.loads, before);
  const current = (await core.bridges.records.findOperation(op.operationId))!;
  assert.equal(current.intent.expiresAt, op.intent.expiresAt);
  assert.equal(current.effects[1]!.submissionAttempts, 0);
  if (phase === "safe") {
    assert.equal(current.state, "failed_after_approval"); assert.equal(current.terminal, true);
    assert.equal(current.effects[0]!.phase, "safe_success"); assert.equal(current.effects[1]!.phase, "unsealed");
    assert.match(current.failure!.reason, /^unsent_apn_reprepare_required$/u);
    assert.equal(current.failure!.residualAllowance!.amountAtomic, "1000");
    assert(BigInt(current.effects[0]!.safeProof!.actualTotalFeeWei) > 0n);
    const lease = current.usageLease!;
    const settled = await new AssetUsageLedger(temp.root).load(lease, lease.reservationId);
    assert.equal(settled!.state, "failed_confirmed_revert");
    assert.equal((await new AssetUsageLedger(temp.root).usage(lease, new Date(f.now))).amountAtomic, "0");
  } else {
    assert.equal(current.terminal, false);
    assert.equal(current.effects[1]!.phase, phase === "signing_started" ? "signing_started" : "unsealed");
    const lease = current.usageLease!;
    assert.notEqual((await new AssetUsageLedger(temp.root).load(lease, lease.reservationId))!.state, "failed_confirmed_revert");
  }
});

import { AssetUsageLedger } from "../../src/asset-usage-ledger.js";

import { privateKeyToAccount } from "viem/accounts";
import { keccak256 } from "viem";
import { LIFI_SYNTHETIC_KEY } from "./lifi-helpers.js";
import { verifyBridgeSigned } from "../../src/lifi/transaction.js";
for (const boundary of ["sign", "send", "malformed", "lateSign"] as const)
test(`expired valid UNSEALED journal with permanent bridge ${boundary} claim keeps held usage`, async t => {
  const temp = await temporaryState(); t.after(temp.cleanup); const { op, f } = await partialWbtc(temp.root);
  const current = (await f.core.bridges.records.findOperation(op.operationId))!, claims = new BridgeEffectClaims(temp.root);
  if (boundary === "send") {
    const e = current.effects[1]!.envelope, economic = e.economics;
    const rawTransaction = await privateKeyToAccount(LIFI_SYNTHETIC_KEY).signTransaction({ type: "eip1559", chainId: e.chainId,
      nonce: Number(economic.nonceAtomic), gas: BigInt(economic.gasLimitAtomic), maxFeePerGas: BigInt(economic.maxFeePerGasAtomic),
      maxPriorityFeePerGas: BigInt(economic.maxPriorityFeePerGasAtomic), to: e.to, value: BigInt(e.valueAtomic), data: e.data });
    const transactionHash = keccak256(rawTransaction); await verifyBridgeSigned(rawTransaction, transactionHash, e);
    const body = { schemaVersion: "apn.bridge-effect.v1" as const, profileHash: current.profileHash, operationId: current.operationId,
      role: "bridge" as const, fingerprint: current.fingerprint, envelopeHash: e.envelopeHash, rawTransaction, transactionHash };
    await claims.claim(current, "bridge", "send", { ...body, materialHash: hashObject(body) });
  } else if (boundary === "lateSign") {
    const account = f.source.account.bind(f.source);
    f.source.account = async (...args) => {
      const result = await account(...args); await claims.claim(current, "bridge", "sign"); return result;
    };
  } else {
    await claims.claim(current, "bridge", "sign");
    if (boundary === "malformed") await writeFile(join(temp.root, "bridge-effect-claims", current.profileHash,
      `${current.operationId}-bridge-sign.json`), "null\n", { mode: 0o600 });
  }
  f.source.safeApproval = true; f.now.setTime(Date.parse(op.intent.expiresAt) + 1);
  const { approval, ...withoutApproval } = f.dependencies;
  const core = new ApnCore({ state: f.state, clock: { now: () => new Date(f.now) }, bridge: withoutApproval });
  const before = f.wrapping.loads, lease = current.usageLease!;
  const result = await core.execute({ command: "operation.resume", operationId: op.operationId });
  assert.equal(result.ok, false); assert.equal(result.error?.code, "APN_OPERATION_BLOCKED");
  assert.equal(result.error?.details?.reason, "bridge_expired_effect_claim_present");
  const latest = (await core.bridges.records.findOperation(op.operationId))!;
  assert.equal(latest.terminal, false); assert.equal(latest.effects[1]!.phase, "unsealed");
  assert.equal(f.source.submissions.length, 1); assert.equal(f.wrapping.loads, before);
  assert.notEqual((await new AssetUsageLedger(temp.root).load(lease, lease.reservationId))!.state, "failed_confirmed_revert");
  assert.equal((await new AssetUsageLedger(temp.root).usage(lease, new Date(f.now))).amountAtomic, "1000");
});

test("expired SAFE approval with unavailable residual allowance remains held UNKNOWN", async t => {
  const temp = await temporaryState(); t.after(temp.cleanup); const { op, f } = await partialWbtc(temp.root);
  f.source.safeApproval = true; f.source.failAccount = true; f.now.setTime(Date.parse(op.intent.expiresAt) + 1);
  const { approval, ...withoutApproval } = f.dependencies;
  const core = new ApnCore({ state: f.state, clock: { now: () => new Date(f.now) }, bridge: withoutApproval });
  const before = f.wrapping.loads, result = await core.execute({ command: "operation.resume", operationId: op.operationId });
  assert.equal(result.ok, true, JSON.stringify(result.error));
  const current = (await core.bridges.records.findOperation(op.operationId))!;
  assert.equal(current.state, "unknown_finality"); assert.equal(current.terminal, false);
  assert.equal(current.failure!.residualAllowance, null); assert.equal(current.effects[1]!.phase, "unsealed");
  const lease = current.usageLease!;
  assert.equal((await new AssetUsageLedger(temp.root).usage(lease, new Date(f.now))).amountAtomic, "1000");
  assert.equal(f.source.submissions.length, 1); assert.equal(f.wrapping.loads, before);
});

test("expired partial release rejects an unsafe permanent claim directory", async t => {
  const temp = await temporaryState(); t.after(temp.cleanup); const { op, f } = await partialWbtc(temp.root);
  const current = (await f.core.bridges.records.findOperation(op.operationId))!;
  await new BridgeEffectClaims(temp.root).claim(current, "bridge", "sign");
  await chmod(join(temp.root, "bridge-effect-claims", current.profileHash), 0o755);
  f.source.safeApproval = true; f.now.setTime(Date.parse(op.intent.expiresAt) + 1);
  const { approval, ...withoutApproval } = f.dependencies;
  const core = new ApnCore({ state: f.state, clock: { now: () => new Date(f.now) }, bridge: withoutApproval });
  const result = await core.execute({ command: "operation.resume", operationId: op.operationId });
  assert.equal(result.ok, false); assert.equal(result.error?.code, "APN_STATE_SECURITY");
  assert.equal((await core.bridges.records.findOperation(op.operationId))!.terminal, false);
  assert.equal((await new AssetUsageLedger(temp.root).usage(current.usageLease!, new Date(f.now))).amountAtomic, "1000");
  assert.equal(f.source.submissions.length, 1);
});
