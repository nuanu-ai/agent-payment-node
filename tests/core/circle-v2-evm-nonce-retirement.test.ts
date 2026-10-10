import { CircleRetirementAuthorityStore, assertCircleRetirementWindow } from "../../src/circle-v2-evm/nonce-retirement-authority.js";
import https from "node:https";
import { EventEmitter } from "node:events";
import { syncBuiltinESMExports } from "node:module";
import { setImmediate as nextTurn } from "node:timers/promises";
import { BridgeHttps } from "../../src/lifi/https.js";
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Hex } from "viem";
import { StateStore } from "../../src/state.js";
import { hashObject, canonicalJson } from "../../src/canonical.js";
import { seal as sealUsage, reservationIdFor, idempotency } from "../../src/asset-usage-ledger-record.js";
import { CircleRepository, validateCircleAdvance } from "../../src/circle-v2-evm/repository.js";
import { advanceCircle, circleEnvelope, sealCircle, validateCircle, type CircleOperationV1 } from "../../src/circle-v2-evm/operation-model.js";
import { cleanupCircle } from "../../src/circle-v2-evm/lifecycle.js";
import { CircleNonceRetirementStore } from "../../src/circle-v2-evm/nonce-retirement-store.js";
import { LocalCircleCustody } from "../../src/circle-v2-evm/custody.js";
import { retireCircleNonce, assertCircleNonceRetirementCase, type CircleNonceRetirementPorts } from "../../src/circle-v2-evm/nonce-retirement.js";
import { CIRCLE_SOURCE_OWNER, CIRCLE_SOURCE_TOKEN, CIRCLE_MESSENGER, circleRoute } from "../../src/circle-v2-evm/catalog.js";
import { encodeCircleApproval, encodeCircleBurn, type CircleReceiptProof } from "../../src/circle-v2-evm/protocol.js";
const at = Date.parse("2026-10-09T01:00:00.000Z"), tx = `0x${"11".repeat(32)}` as Hex, cleanupTx = `0x${"cc".repeat(32)}` as Hex;
function initial(root = join(tmpdir(), "circle-fixture"), chain: 143 | 1329 | 59144 = 143): CircleOperationV1 {
  const selected = circleRoute(chain);
  const state = new StateStore(root), profileHash = state.profileHash("evm-live-buyer"), destinationProfileHash = state.profileHash(selected.gasPayerProfile);
  const custody = (profileHash: string, walletAddress: typeof CIRCLE_SOURCE_OWNER) => ({ schemaVersion: "apn.evm-native-custody.v1" as const, profileHash, walletAddress, walletBindingHash: "a".repeat(64), walletCreatedAt: new Date(at).toISOString(), providerId: "local" as const, providerAccountBindingHash: "a".repeat(64), providerCapabilityHash: "b".repeat(64), providerRevision: 1 });
  const envelope = (role: "approval" | "burn") => circleEnvelope({ chainId: 42161, from: CIRCLE_SOURCE_OWNER, to: role === "approval" ? CIRCLE_SOURCE_TOKEN : CIRCLE_MESSENGER, data: role === "approval" ? encodeCircleApproval() : encodeCircleBurn(chain), valueAtomic: "0", nonceAtomic: role === "approval" ? "1" : "2", gasLimitAtomic: role === "approval" ? "65536" : "500000", maxFeePerGasAtomic: "20000000", maxPriorityFeePerGasAtomic: "0" });
  const effects = (["approval", "burn"] as const).map(role => ({ role, phase: "prepared" as const, envelope: envelope(role), transactionHash: null, materialHash: null, proof: null }));
  const body = sealCircle({ schemaVersion: "apn.circle-v2-evm-operation.v1", operationId: "1".repeat(64), profile: "evm-live-buyer", profileHash, destinationProfile: selected.gasPayerProfile, destinationProfileHash, idempotencyHash: "2".repeat(64), requestHash: "3".repeat(64), fingerprint: "4".repeat(64), destinationChain: chain,
    sourceCustody: custody(profileHash, CIRCLE_SOURCE_OWNER), destinationCustody: custody(destinationProfileHash, selected.gasPayer), policies: [{ profile: "evm-live-buyer", profileHash, policyDigest: "5".repeat(64), revision: 1 }, { profile: selected.gasPayerProfile, profileHash: destinationProfileHash, policyDigest: selected.gasPayerProfile === "evm-live-buyer" ? "5".repeat(64) : "6".repeat(64), revision: 1 }].filter((p, i, all) => all.findIndex(x => x.profileHash === p.profileHash) === i),
    preparedAt: new Date(at).toISOString(), expiresAt: new Date(at + 600_000).toISOString(), deploymentDigest: "7".repeat(64), feeQuoteAtomic: "6", state: "awaiting_source", terminal: false, effects, source: null, attestation: null, destination: null, residualAllowanceAtomic: "0", usage: [], usageFinalized: false, transitions: [] });
  return advanceCircle(body, {}, "prepared", at);
}
function usage(op: CircleOperationV1, target: "reserved" | "unknown_finality" | "finalized" = "reserved") {
  const route = circleRoute(op.destinationChain);
  return ["usdc", "approval-native", "burn-native", "cleanup-native", "mint-native"].map((key, i) => {
    const identity = { account: i === 4 ? route.gasPayer : CIRCLE_SOURCE_OWNER, chain: i === 4 ? `eip155:${op.destinationChain}` : "eip155:42161", asset: i === 0 ? { kind: "token" as const, identifier: CIRCLE_SOURCE_TOKEN } : { kind: "native" as const, identifier: null } }, idempotencyHash = idempotency(`${op.operationId}:${key}`);
    return sealUsage({ schemaVersion: "apn.asset-usage-reservation.v1", reservationId: reservationIdFor(identity, idempotencyHash), idempotencyHash, policyDigest: op.policies.find(p => p.profileHash === (i === 4 ? op.destinationProfileHash : op.profileHash))!.policyDigest, registryVersion: "circle-fixture", ...identity, rail: "bridge", amountAtomic: i === 0 ? "40100" : i === 4 ? route.destinationNativeCap : i === 3 ? "15000000000000" : "30000000000000", state: target,
      reservedAt: new Date(at).toISOString(), updatedAt: new Date(at).toISOString(), effectAt: target === "finalized" ? new Date(at).toISOString() : null, outcomeDigest: target === "finalized" ? "8".repeat(64) : null });
  });
}

function unknown(root: string) {
  let op = initial(root); op = advanceCircle(op, { usage: usage(op) }, "all_assets_reserved", at);
  op = advanceCircle(op, { effects: op.effects.map(e => e.role === "approval" ? { ...e, phase: "signing_started" } : e), state: "source_unknown" }, "approval_signing_fence", at);
  op = advanceCircle(op, { effects: op.effects.map(e => e.role === "approval" ? { ...e, phase: "sealed", transactionHash: tx, materialHash: "9".repeat(64) } : e) }, "approval_material_sealed", at);
  return advanceCircle(op, { effects: op.effects.map(e => e.role === "approval" ? { ...e, phase: "unknown" } : e) }, "approval_fenced_unknown_observe_only", at);
}
const cleanupEnvelope = (op: CircleOperationV1) => { const { envelopeHash: _hash, ...body } = op.effects[0]!.envelope; return circleEnvelope({ ...body, data: encodeCircleApproval(true) }); };
const proof = (tag: "included" | "finalized" = "finalized"): CircleReceiptProof => ({ transactionHash: cleanupTx, blockHash: `0x${"bb".repeat(32)}`, blockNumberAtomic: "10", finalityBlockHash: `0x${"bb".repeat(32)}`, finalityBlockNumberAtomic: "10", transactionHashBinding: "a".repeat(64), finalityTag: tag, receiptHash: "b".repeat(64), logsHash: "c".repeat(64), actualFeeAtomic: "100" });
async function fixture(overrides: Partial<CircleNonceRetirementPorts> = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "circle-retirement-"))), state = new StateStore(root), store = new CircleNonceRetirementStore(root);
  let op = unknown(root), now = at + 600001, signs = 0, sends = 0, releases = 0;
  const original = op;
  await new CircleRetirementAuthorityStore(root).capture(op, op.policies.map(p => ({ ...p, activationDigest: "e".repeat(64), revision: 35 })), new Date(now + 3600000).toISOString(), now);
  const ports: CircleNonceRetirementPorts = { now: () => now, save: async next => { validateCircleAdvance(op, next); op = next; },
    assertOwnerPolicyAndConflicts: async () => {}, authorizationDeadline: async () => null, approve: async () => {}, preflight: async () => {},
    seal: async (o, e, guard) => { guard(); await store.claim(o, "sign"); guard(); signs++; return { schemaVersion: "apn.circle-v2-evm-effect.v1", operationId: o.operationId, role: "cleanup", fingerprint: o.fingerprint, envelopeHash: e.envelope.envelopeHash, rawTransaction: "0x02", transactionHash: cleanupTx, materialHash: "c".repeat(64) }; },
    loadMaterial: async (o, e) => signs === 0 ? null : ({ schemaVersion: "apn.circle-v2-evm-effect.v1", operationId: o.operationId, role: "cleanup", fingerprint: o.fingerprint, envelopeHash: e.envelope.envelopeHash, rawTransaction: "0x02", transactionHash: cleanupTx, materialHash: "c".repeat(64) }),
    broadcast: async (_e, _raw, guard) => { guard(); await store.claim(op, "send"); guard(); sends++; return cleanupTx; },
    observeEffect: async (_o, e) => { assert.equal(e.role, "cleanup"); return proof(); }, observeSource: async () => null, observeDestination: async () => null, allowance: async () => "0", attestation: async () => null,
    mintEnvelope: async () => { throw Error("no mint"); }, cleanupEnvelope: async o => cleanupEnvelope(o),
    assertRetirementMaterial: async () => {}, prepareRetirement: async o => await store.intent(o) ?? store.start(o, cleanupEnvelope(o)),
    retirementClaimed: async o => store.hasClaim(o, "sign"), retirementProof: async (o, intent) => {
      await store.assertClaim(o, "sign"); await store.assertClaim(o, "send");
      const body = { intentHash: intent.intentHash, originalApprovalHash: tx, originalNonceAtomic: o.effects[0]!.envelope.nonceAtomic, finalizedNonceAtomic: "2", finalizedBlockHash: `0x${"bb".repeat(32)}`, finalizedBlockNumberAtomic: "10", cleanupTransactionHash: cleanupTx, actualCleanupFeeAtomic: "100" };
      return { ...body, proofHash: hashObject(body) };
    }, usage: async (o, target) => { if (target === "unknown_finality") return usage(o, "unknown_finality"); releases++; return usage(o).map((u, i) => { const { reservationDigest: _digest, ...body } = u; return sealUsage({ ...body, state: "failed_confirmed_revert", outcomeDigest: "f".repeat(64), consumedAtomic: i === 3 ? "100" : "0", updatedAt: new Date(now).toISOString(), effectAt: new Date(now).toISOString() }); }); }, ...overrides };
  return { root, state, store, ports, original, get: () => op, set: (o: CircleOperationV1) => { op = o; }, advanceTime: (n: number) => { now += n; }, counts: () => ({ signs, sends, releases }), dispose: () => rm(root, { recursive: true, force: true }) };
}
test("explicit nonce cleanup signs/sends one different approve0; finalized proof retires holds without changing original historical material", async () => {
  const f = await fixture(); try {
    const done = await retireCircleNonce(f.get(), f.ports); assert.equal(done.state, "nonce_retired"); assert.equal(done.terminal, true);
    assert.deepEqual(done.effects[0], f.original.effects[0]); assert.deepEqual(done.effects[1], f.original.effects[1]); assert.equal(done.expiresAt, f.original.expiresAt);
    assert.equal(done.effects[2]!.envelope.nonceAtomic, "1"); assert.equal(done.effects[2]!.envelope.data, encodeCircleApproval(true)); assert.equal(done.effects[2]!.proof!.actualFeeAtomic, "100");
    assert.deepEqual(done.transitions.slice(0, f.original.transitions.length), f.original.transitions); assert.deepEqual(f.counts(), { signs: 1, sends: 1, releases: 1 });
    await retireCircleNonce(done, f.ports); assert.deepEqual(f.counts(), { signs: 1, sends: 1, releases: 1 }); validateCircle(done);
  } finally { await f.dispose(); }
});
test("restored valid original journal cannot sign or send another cleanup; permanent original tombstone survives restoration", async () => {
  const f = await fixture(); try {
    await retireCircleNonce(f.get(), f.ports); f.set(f.original); const recovered = await retireCircleNonce(f.original, f.ports);
    assert.equal(recovered.state, "nonce_retired"); assert.deepEqual(f.counts(), { signs: 1, sends: 1, releases: 2 });
    await assert.rejects(f.store.assertOriginalEffectsAvailable(f.original.operationId), /permanently_retired/);
    await assert.rejects(f.store.claim(recovered, "sign"), /already_claimed/); await assert.rejects(f.store.claim(recovered, "send"), /already_claimed/);
  } finally { await f.dispose(); }
});
test("existing cleanup cannot use zero allowance to cancel an unknown sealed approval", async () => {
  const f = await fixture(); try { await assert.rejects(cleanupCircle(f.get(), { ...f.ports, observeEffect: async () => null }), /cleanup_requires/); assert.deepEqual(f.counts(), { signs: 0, sends: 0, releases: 0 }); } finally { await f.dispose(); }
});
for (const variant of ["burn_attempt", "unexpired", "wrong_chain", "wrong_nonce", "wrong_spender", "full_fee"] as const) test(`retirement rejects ${variant} before signature or dispatch`, async () => {
  const f = await fixture(); try {
    let o = f.get();
    if (variant === "burn_attempt") o = advanceCircle(o, { effects: o.effects.map(e => e.role === "burn" ? { ...e, phase: "signing_started" } : e) }, "burn_signing_fence", at);
    if (variant === "unexpired") await assert.rejects(async () => assertCircleNonceRetirementCase(o, at + 1), /exact_expired/);
    else if (["wrong_chain", "wrong_nonce", "wrong_spender", "full_fee"].includes(variant)) {
      const { envelopeHash: _hash, ...e } = cleanupEnvelope(o), changed = circleEnvelope({ ...e, ...(variant === "wrong_chain" ? { chainId: 1 } : variant === "wrong_nonce" ? { nonceAtomic: "2" } : variant === "wrong_spender" ? { data: encodeCircleApproval() } : { maxFeePerGasAtomic: "999999999999" }) });
      await assert.rejects(f.store.start(o, changed));
    } else await assert.rejects(retireCircleNonce(o, f.ports), /exact_expired/);
    assert.deepEqual(f.counts(), { signs: 0, sends: 0, releases: 0 });
  } finally { await f.dispose(); }
});
for (const failure of ["included", "missing_finalized_nonce_proof", "forged_nonce_proof", "old_approval_wins_race", "policy_change", "unrelated_conflict", "tty_expiry", "postsign_expiry", "lost_rpc"] as const) test(`retirement ${failure} retains holds and never resends`, async () => {
  const f = await fixture(); try {
    if (failure === "included") f.ports.observeEffect = async () => proof("included");
    if (failure === "missing_finalized_nonce_proof") f.ports.retirementProof = async () => null;
    if (failure === "forged_nonce_proof") { const fn = f.ports.retirementProof; f.ports.retirementProof = async (o, i) => { const p = (await fn(o, i))!; const { proofHash: _hash, ...body } = { ...p, finalizedNonceAtomic: "1" }; return { ...body, proofHash: hashObject(body) }; }; }
    if (failure === "old_approval_wins_race") f.ports.preflight = async () => { throw Error("nonce_or_native_balance_changed"); };
    if (failure === "policy_change" || failure === "unrelated_conflict") f.ports.assertOwnerPolicyAndConflicts = async () => { throw Error(failure); };
    if (failure === "tty_expiry") f.ports.approve = async () => f.advanceTime(60000);
    if (failure === "postsign_expiry") { const fn = f.ports.seal; f.ports.seal = async (o, e, g) => { const m = await fn(o, e, g); f.advanceTime(60000); return m; }; }
    if (failure === "lost_rpc") { const fn = f.ports.broadcast; f.ports.broadcast = async (e, raw, g) => { await fn(e, raw, g); throw Error("lost RPC"); }; f.ports.observeEffect = async () => null; }
    try { await retireCircleNonce(f.get(), f.ports); } catch {}
    assert.equal(f.get().terminal, false); assert.equal(f.counts().releases, 0);
    if (failure === "included" || failure === "missing_finalized_nonce_proof" || failure === "lost_rpc" || failure === "postsign_expiry") { const n = f.counts(); try { await retireCircleNonce(f.get(), f.ports); } catch {} assert.equal(f.counts().signs, n.signs); assert.equal(f.counts().sends, n.sends); }
    if (["old_approval_wins_race", "policy_change", "unrelated_conflict", "tty_expiry"].includes(failure)) assert.equal(f.counts().signs, 0);
  } finally { await f.dispose(); }
});
test("production custody rejects original restored signer and cleanup without durable sign claim before key access", async () => {
  const f = await fixture(); let keyLoads = 0; try {
    const intent = await f.store.start(f.original, cleanupEnvelope(f.original)); assert.equal(intent.cleanupEnvelope.nonceAtomic, "1");
    const custody = new LocalCircleCustody(f.state, { load: async () => { keyLoads++; return Buffer.alloc(32); }, create: async () => Buffer.alloc(32) });
    const approval = { ...f.original.effects[0]!, phase: "signing_started" as const };
    await assert.rejects(custody.seal(f.original, approval, () => {}), /permanently_retired/);
    const cleanup = { role: "cleanup" as const, phase: "signing_started" as const, envelope: intent.cleanupEnvelope, transactionHash: null, materialHash: null, proof: null };
    const o = advanceCircle(f.original, { effects: [...f.original.effects, cleanup] }, "cleanup_fixture", at);
    await assert.rejects(custody.seal(o, cleanup, () => {}), /private_exact_effect_guard/); assert.equal(keyLoads, 0);
  } finally { await f.dispose(); }
});

test("ordinary observation of an intent persisted before cancelled TTY cannot grant financial start", async () => {
  const f = await fixture(); let approvals = 0; try {
    await f.store.start(f.original, cleanupEnvelope(f.original)); f.ports.approve = async () => { approvals++; };
    const observed = await retireCircleNonce(f.original, f.ports, false);
    assert.deepEqual(observed, f.original); assert.equal(approvals, 0); assert.deepEqual(f.counts(), { signs: 0, sends: 0, releases: 0 });
  } finally { await f.dispose(); }
});

test("real private retirement guard expiring at TLS after durable SEND claim writes zero POST bytes and never retries", async t => {
  const f = await fixture(); const entries: Array<{ request: any; socket: any; bodies: unknown[] }> = [];
  t.mock.method(https, "request", () => {
    const request = new EventEmitter() as any, socket = new EventEmitter() as any; socket.remoteAddress = "8.8.8.8";
    const entry = { request, socket, bodies: [] as unknown[] }; request.end = (body: unknown) => entry.bodies.push(body); request.destroy = () => {}; entries.push(entry);
    queueMicrotask(() => { request.emit("socket", socket); socket.emit("connect"); }); return request;
  }); syncBuiltinESMExports();
  try {
    f.ports.observeEffect = async () => null;
    f.ports.broadcast = async (_e, raw, guard) => {
      await f.store.claim(f.get(), "send");
      const wire = new BridgeHttps(async () => [{ address: "8.8.8.8", family: 4 as const }]);
      const pending = wire.request("https://rpc.example/rpc", "POST", raw, 1024, "APN_RPC_CONFIG", guard);
      const result = assert.rejects(pending, /consent/); await nextTurn(); f.advanceTime(60000); entries[0]!.socket.emit("secureConnect"); await result; throw Error("expired TLS");
    };
    const result = await retireCircleNonce(f.get(), f.ports); assert.equal(result.effects[2]!.phase, "unknown"); assert.equal(entries.length, 1); assert.deepEqual(entries[0]!.bodies, []);
    assert.equal(await f.store.hasClaim(result, "send"), true); await retireCircleNonce(result, f.ports); assert.equal(entries.length, 1); assert.equal(f.counts().signs, 1); assert.equal(f.counts().releases, 0);
  } finally { t.mock.restoreAll(); syncBuiltinESMExports(); await f.dispose(); }
});
test("expiration between SIGN claim and custody signing produces zero signatures and no send", async () => {
  const f = await fixture(); try {
    f.ports.observeEffect = async () => null; f.ports.seal = async (o, _e, guard) => { await f.store.claim(o, "sign"); f.advanceTime(60000); guard(); throw Error("unreachable signer"); };
    const result = await retireCircleNonce(f.get(), f.ports); assert.equal(result.effects[2]!.phase, "unknown"); assert.deepEqual(f.counts(), { signs: 0, sends: 0, releases: 0 });
    await retireCircleNonce(result, f.ports); assert.deepEqual(f.counts(), { signs: 0, sends: 0, releases: 0 });
  } finally { await f.dispose(); }
});

test("fresh current authority is create-only, parent-bound and distinct from historical r33 policies", async () => {
  const f = await fixture(); try {
    const store = new CircleRetirementAuthorityStore(f.root), parent = JSON.stringify(f.original), frame = await store.load(f.original);
    assert.equal(frame!.policies[0]!.revision, 35); assert.equal(f.original.policies[0]!.revision, 1);
    const unchanged = await store.capture(f.original, frame!.policies.map(p => ({ ...p, revision: 36 })), null, at + 700000);
    assert.equal(unchanged.authorityHash, frame!.authorityHash); assert.equal(JSON.stringify(f.original), parent);
    await assert.rejects(store.load({ ...f.original, sourceCustody: { ...f.original.sourceCustody, walletBindingHash: "d".repeat(64) } }), /authority_binding/);
    await assert.rejects(store.load({ ...f.original, effects: f.original.effects.map(e => e.role === "approval" ? { ...e, envelope: circleEnvelope({ ...e.envelope, nonceAtomic: "80" }) } : e) }), /authority_binding/);
  } finally { await f.dispose(); }
});

test("retirement current policy window refuses expired or backwards-clock grants", async () => {
  const f = await fixture(); try {
    const frame = (await new CircleRetirementAuthorityStore(f.root).load(f.original))!;
    assert.throws(() => assertCircleRetirementWindow(frame, Date.parse(frame.windowEndsAt!)), /window_expired/);
    assert.throws(() => assertCircleRetirementWindow(frame, Date.parse(frame.capturedAt) - 1), /window_expired/);
  } finally { await f.dispose(); }
});

test("restored or replaced authority sidecar cannot refresh permanent claims", async () => {
  const f = await fixture(); try {
    const done = await retireCircleNonce(f.get(), f.ports), store = new CircleRetirementAuthorityStore(f.root), frame = (await store.load(done))!;
    const { authorityHash: _hash, ...body } = frame, replacement = { ...body, policies: body.policies.map(p => ({ ...p, revision: 36 })) };
    await writeFile(join(f.root, "circle-v2-nonce-retirements", `${done.operationId}-authority.json`), canonicalJson({ ...replacement, authorityHash: hashObject(replacement) }) + "\n", { mode: 0o600 });
    await assert.rejects(f.store.assertClaim(done, "sign"), /durable_claim_required/);
    await assert.rejects(f.store.assertClaim(done, "send"), /durable_claim_required/);
    assert.deepEqual(f.counts(), { signs: 1, sends: 1, releases: 1 });
  } finally { await f.dispose(); }
});
