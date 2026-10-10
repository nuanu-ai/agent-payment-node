import assert from "node:assert/strict";
import test from "node:test";
import { hashObject } from "../../src/canonical.js";
import { AllowlistPolicyStore } from "../../src/allowlist-policy-store.js";
import { AssetUsageLedger } from "../../src/asset-usage-ledger.js";
import { GaslessFirstSendAuthority, type GaslessFirstSendProof } from "../../src/gasless/first-send-authority.js";
import { GaslessSealedFirstSendExecution } from "../../src/gasless/first-send-execution.js";
import { gaslessAtTransition, transitionGasless } from "../../src/gasless/transitions.js";
import { gaslessFailure } from "../../src/gasless/validation.js";
import { TtyGaslessApproval } from "../../src/gasless/tty.js";
import { gaslessFixture } from "./gasless-helpers.js";
import { temporaryState } from "./helpers.js";
import { bundledGaslessFixture } from "./gasless-fixtures/bundler-transport.js";

async function sealed(root: string) {
  const s = await gaslessFixture(root, 1, { now: new Date("2026-09-18T02:00:00.000Z"), delegation: "expected" });
  const { id } = await s.prepare("fresh-sealed-first-send");
  const snapshot = s.rpc.snapshot.bind(s.rpc);
  s.rpc.snapshot = async (...args) => {
    if ((await s.record(id)).userOperation.phase === "sealed")
      gaslessFailure("APN_RPC_BUDGET_EXCEEDED", "gasless_RPC_request_budget");
    return await snapshot(...args);
  };
  assert.equal((await s.core.execute({ command: "gasless.transfer.approve", operationId: id })).ok, true);
  s.rpc.snapshot = snapshot;
  const before = await s.record(id);
  assert.equal(before.state, "unknown_finality"); assert.equal(before.userOperation.phase, "sealed");
  const material = await s.custody.load(before, "user_operation");
  s.now.setTime(Date.parse(before.intent.expiresAt) + 1);
  s.custody.seal = async () => { throw new Error("No new signatures permitted"); };
  s.rpc.calls = []; s.approval.calls = [];
  return { s, id, before, material };
}

const request = (id: string) => ({ command: "gasless.transfer.approve-sealed" as const, operationId: id });

test("fresh sealed approval sends identical existing bytes once, preserving original frame/history and cap", async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const { s, id, before, material } = await sealed(temporary.root);
  const result = await s.core.execute(request(id));
  assert.equal(result.ok, true, result.error?.message);
  const after = await s.record(id), consent = after.firstSendApprovals![0]!;
  assert.equal(after.state, "submitted_pending"); assert.equal(s.rpc.sends.length, 1);
  assert.deepEqual(s.rpc.sends[0], material);
  assert.deepEqual(after.intent, before.intent); assert.deepEqual(after.approval, before.approval);
  assert.deepEqual(after.bootstrap, before.bootstrap); assert.equal(after.fingerprint, before.fingerprint);
  assert.deepEqual(after.transitions.slice(0, before.transitions.length), before.transitions);
  assert.deepEqual(gaslessAtTransition(after, before.transitions.length - 1), before);
  assert.equal(before.firstSendApprovals, undefined);
  assert.equal(after.userOperation.signingAttempts, 1); assert.equal(after.userOperation.disclosureAttempts, 0);
  assert.equal(after.userOperation.submissionAttempts, 1);
  assert.equal(after.userOperation.materialHash, before.userOperation.materialHash);
  assert.equal(after.userOperation.userOperationHash, before.userOperation.userOperationHash);
  assert.ok(after.userOperation.submittedAt! > before.intent.expiresAt);
  assert.equal(Date.parse(consent.expiresAt) - Date.parse(consent.issuedAt), 120000);
  assert.equal(consent.operationId, id); assert.equal(consent.operationFingerprint, before.fingerprint);
  assert.equal(consent.userOperationHash, before.userOperation.userOperationHash);
  assert.equal(s.approval.calls.length, 1);
  assert.match(s.approval.calls[0]!.exactPhrase, /^[a-f0-9]{8}$/u);
  assert.equal(s.rpc.calls.filter(c => c === "snapshot").length, 2);
  assert.equal(s.rpc.calls.filter(c => c.includes("estimate")).length, 0);
  const usage = new AssetUsageLedger(temporary.root), identity = { account: s.account.address, chain: "eip155:1",
    asset: { kind: "token" as const, identifier: before.intent.token } };
  assert.equal((await usage.usage(identity, s.now)).amountAtomic, before.intent.request.grossAtomic);
  assert.equal((result.operation as any).first_send_approvals[0].approvalDigest, consent.approvalDigest);
  assert.equal((await s.core.execute(request(id))).ok, false);
  assert.equal((await s.core.execute({ command: "operation.resume", operationId: id })).ok, true);
  assert.equal((await s.record(id)).state, "completed"); assert.equal(s.rpc.sends.length, 1);
});

test("ordinary expired resume cannot use stored valid fresh approval metadata as dispatch authority", async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const { s, id, before } = await sealed(temporary.root);
  const authority = new GaslessFirstSendAuthority(s.state.root, {}, () => s.now.getTime());
  const proof = await authority.approve(before, s.approval); assert.ok(proof);
  const withMetadata = transitionGasless(before, { firstSendApprovals: [authority.metadata(proof)] }, s.now.toISOString());
  await s.core.gasless.records.persist(withMetadata); authority.revoke(proof);
  const response = await s.core.execute({ command: "operation.resume", operationId: id });
  assert.equal(response.ok, true, response.error?.message);
  const after = await s.record(id);
  assert.equal(after.state, "unknown_finality"); assert.equal(after.userOperation.submissionAttempts, 0);
  assert.equal(s.rpc.sends.length, 0); assert.deepEqual(after.firstSendApprovals, withMetadata.firstSendApprovals);
  assert.ok(s.rpc.calls.includes("observe"));
});

test("private fresh proof rejects forgery, other root/controller instance and reuse; metadata is append-only", async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const { s, before } = await sealed(temporary.root);
  const authority = new GaslessFirstSendAuthority(s.state.root, {}, () => s.now.getTime());
  const other = new GaslessFirstSendAuthority(s.state.root, {}, () => s.now.getTime());
  const proof = await authority.approve(before, s.approval); assert.ok(proof);
  const consent = authority.metadata(proof), op = transitionGasless(before, { firstSendApprovals: [consent] }, s.now.toISOString());
  assert.throws(() => authority.assert({ kind: "gasless-first-send-proof" } as GaslessFirstSendProof, op));
  assert.throws(() => other.assert(proof, op));
  assert.throws(() => new GaslessFirstSendAuthority("other-root", {}, () => s.now.getTime()).assert(proof, op));
  assert.throws(() => authority.assert(proof, { ...op, operationId: hashObject("other") }));
  authority.claim(proof, op); assert.throws(() => authority.claim(proof, op));
  assert.throws(() => transitionGasless(op, { firstSendApprovals: [] }, s.now.toISOString()));
  const changed = { ...consent, userOperationMaterialHash: hashObject("forged") };
  assert.throws(() => transitionGasless(before, { firstSendApprovals: [changed] }, s.now.toISOString()));
  authority.revoke(proof); assert.throws(() => authority.metadata(proof));
});

for (const boundary of ["preflight", "after_consent"] as const) {
  for (const fault of ["nonce", "delegation", "fee", "policy", "reorg"] as const) {
    test(`${boundary} ${fault} drift refuses the first sealed send`, async t => {
      const temporary = await temporaryState(); t.after(temporary.cleanup);
      const { s, id, before } = await sealed(temporary.root);
      const change = async () => {
        if (fault === "nonce") s.rpc.current = { ...s.rpc.current, permitNonceAtomic: "8" };
        else if (fault === "delegation") s.rpc.current = { ...s.rpc.current, delegation: "empty" };
        else if (fault === "fee") s.rpc.current = { ...s.rpc.current, baseFeePerGas: "99999999999" };
        else if (fault === "reorg") s.rpc.snapshot = async () => gaslessFailure("APN_RPC_PROTOCOL", "gasless_block_reorg");
        else {
          if (boundary === "after_consent") {
            // Real policy writes serialize on the held profile lock. Inject the fresh
            // policy gate's refusal to exercise the post-consent stop boundary.
            s.core.gasless.policy.assertSealedFirstSend = async () => gaslessFailure("APN_ALLOWLIST_REFUSED", "gasless_allowlist_changed");
            return;
          }
          const store = new AllowlistPolicyStore(temporary.root), head = (await store.read(s.profile)).entries.at(-1)!;
          await store.appendDecision(s.profile, head.entryDigest, { status: "revoked", revision: head.revision,
            stagedRecordDigest: head.stagedRecordDigest, policyDigest: head.policyDigest,
            approvalFingerprint: hashObject("revoke"), decidedAt: s.now.toISOString() });
        }
      };
      if (boundary === "preflight") await change();
      else s.approval.confirm = async input => { s.approval.calls.push(input); await change(); return true; };
      const response = await s.core.execute(request(id));
      assert.equal(response.ok, boundary !== "preflight", response.error?.message);
      assert.equal(s.approval.calls.length, boundary === "preflight" ? 0 : 1);
      const after = await s.record(id);
      assert.equal(after.userOperation.submissionAttempts, 0); assert.equal(s.rpc.sends.length, 0);
      assert.equal(after.userOperation.materialHash, before.userOperation.materialHash);
      assert.equal(after.userOperation.signingAttempts, 1); assert.equal(after.bootstrap.disclosureAttempts, 1);
    });
  }
}

for (const stage of ["tty", "post_guard", "queued_send"] as const) {
  test(`authority expiry during ${stage} never permits a send`, async t => {
    const temporary = await temporaryState(); t.after(temporary.cleanup);
    const { s, id, before } = await sealed(temporary.root);
    if (stage === "tty") s.approval.confirm = async () => { s.now.setTime(s.now.getTime() + 120000); return true; };
    else if (stage === "post_guard") {
      const snapshot = s.rpc.snapshot.bind(s.rpc); let snapshots = 0;
      s.rpc.snapshot = async (...args) => { const result = await snapshot(...args);
        if (++snapshots === 2) s.now.setTime(s.now.getTime() + 120000); return result; };
    } else s.rpc.send = async (_intent, _material, beforeSend) => {
      s.now.setTime(s.now.getTime() + 120000); beforeSend!(); throw new Error("unexpected actual send");
    };
    const result = await s.core.execute(request(id));
    assert.equal(result.ok, stage !== "tty", result.error?.message);
    const after = await s.record(id);
    assert.equal(after.state, "unknown_finality"); assert.equal(s.rpc.sends.length, 0);
    assert.equal(after.userOperation.submissionAttempts, stage === "queued_send" ? 1 : 0);
    assert.equal(after.userOperation.materialHash, before.userOperation.materialHash);
    assert.equal((await s.core.execute({ command: "operation.resume", operationId: id })).ok, true);
    assert.equal(s.rpc.sends.length, 0);
    if (stage === "queued_send") assert.equal((await s.core.execute(request(id))).ok, false);
  });
}

test("lost send response preserves permanent fence and only observes the original hash", async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const { s, id, before, material } = await sealed(temporary.root);
  s.rpc.timeout = true; s.rpc.result = "missing";
  assert.equal((await s.core.execute(request(id))).ok, true);
  const after = await s.record(id);
  assert.equal(after.state, "unknown_finality"); assert.equal(after.userOperation.submissionAttempts, 1);
  assert.deepEqual(s.rpc.sends[0], material);
  assert.equal(after.userOperation.userOperationHash, before.userOperation.userOperationHash);
  assert.equal((await s.core.execute(request(id))).ok, false);
  assert.equal((await s.core.execute({ command: "operation.resume", operationId: id })).ok, true);
  assert.equal(s.rpc.sends.length, 1);
});

test("fresh local action cannot use a different material, reserve, or unavailable approval", async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const { s, id, before } = await sealed(temporary.root);
  const load = s.custody.load.bind(s.custody);
  s.custody.load = async (...args) => {
    const material = await load(...args);
    return material === null ? null : { ...material, materialHash: hashObject("wrong-material") };
  };
  assert.equal((await s.core.execute(request(id))).ok, false);
  assert.equal(s.approval.calls.length, 0); assert.equal(s.rpc.sends.length, 0);
  const usage = new AssetUsageLedger(temporary.root), a = before.intent.allowlist!;
  await usage.transition({ account: s.account.address, chain: a.chain,
    asset: { kind: "token", identifier: before.intent.token }, reservationId: a.reservationId,
    policyDigest: a.policyDigest, state: "finalized", now: s.now, outcomeDigest: before.integrityHash });
  await assert.rejects(s.core.gasless.policy.assertSealedFirstSend(before));
  assert.equal(s.rpc.sends.length, 0);
});

for (const queuedExpiry of [false, true]) test(`production sealed first-send uses bounded POSTs; queued expiry ${queuedExpiry}`, async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const s = await bundledGaslessFixture(temporary.root), { id } = await s.prepare();
  s.setLimit(100);
  const confirm = s.approval.confirm.bind(s.approval);
  s.approval.confirm = async input => { const accepted = await confirm(input); await s.rpc.assertChain(); return accepted; };
  assert.equal((await s.core.execute({ command: "gasless.transfer.approve", operationId: id })).ok, true);
  const before = await s.record(id);
  assert.equal(before.state, "unknown_finality"); assert.equal(before.userOperation.phase, "sealed");
  assert.equal(before.failure, "gasless_rpc_request_budget");
  s.approval.confirm = confirm;
  s.now.setTime(Date.parse(before.intent.expiresAt) + 1);
  s.custody.seal = async () => { throw new Error("No fresh signer"); };
  if (queuedExpiry) {
    const send = s.rpc.send.bind(s.rpc);
    s.rpc.send = async (...args) => { s.now.setTime(s.now.getTime() + 120000); return await send(...args); };
  }
  const start = s.calls.length;
  const result = await s.core.execute(request(id)); assert.equal(result.ok, true, result.error?.message);
  const after = await s.record(id), calls = s.calls.slice(start);
  assert.equal(calls.filter(c => c.method === "eth_sendUserOperation").length, queuedExpiry ? 0 : 1);
  assert.equal(calls.filter(c => c.method === "eth_estimateUserOperationGas").length, 0);
  assert.equal(calls.filter(c => c.methods.includes("eth_getBlockByNumber") && c.methods.includes("eth_chainId")).length, 2);
  assert.ok(calls.length <= 24); t.diagnostic(`sealed recovery physical POSTs: ${calls.length}`);
  assert.equal(after.userOperation.submissionAttempts, 1);
  assert.equal(after.state, queuedExpiry ? "unknown_finality" : "submitted_pending");
  assert.equal(after.userOperation.userOperationHash, before.userOperation.userOperationHash);
});

test("fresh TTY displays original expiry, exact atomic amounts and hash, and accepts only its eight-hex challenge", async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const { s, before } = await sealed(temporary.root);
  // Only the TTY adapter uses wall clock; make this synthetic consent window current.
  s.now.setTime(Date.now());
  const authority = new GaslessFirstSendAuthority(s.state.root, {}, () => s.now.getTime());
  let output = "", closes = 0;
  const tty = new TtyGaslessApproval({ isTerminal: () => true, openTerminal: async () => ({ fd: 42,
    write: async value => { output += value; },
    read: async function* () { const match = /Type ([a-f0-9]{8}) and press Enter/u.exec(output); assert.ok(match); yield Buffer.from(match[1] + "\n"); },
    close: async () => { closes++; } }) });
  const proof = await authority.approve(before, tty); assert.ok(proof);
  assert.match(output, /first submission of this already-signed operation/u);
  assert.ok(output.includes(`Original action deadline: ${before.intent.expiresAt}`));
  assert.ok(output.includes(`Atomic amounts: gross ${before.intent.request.grossAtomic}`));
  assert.ok(output.includes(`Original UserOperation hash: ${before.userOperation.userOperationHash}`));
  assert.equal(closes, 1); authority.revoke(proof);
});
