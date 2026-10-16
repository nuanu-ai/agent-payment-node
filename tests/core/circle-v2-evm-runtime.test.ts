const issuerFeeRecipient = getAddress(`0x${"44".repeat(20)}`);
import { circleRuntimeBytecode } from "../../src/circle-v2-evm/rpc.js";
import { verifyCircleFinalizedRevert } from "../../src/circle-v2-evm/revert-proof.js";
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, realpath, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getAddress, type Hex } from "viem";
import { StateStore } from "../../src/state.js";
import { canonicalJson, hashObject } from "../../src/canonical.js";
import { seal as sealUsage, reservationIdFor, idempotency } from "../../src/asset-usage-ledger-record.js";
import { CircleRepository, validateCircleAdvance } from "../../src/circle-v2-evm/repository.js";
import { advanceCircle, circleEnvelope, sealCircle, validateCircle, type CircleOperationV1, type CircleEffect, type CircleRole } from "../../src/circle-v2-evm/operation-model.js";
import { approveCircleSource, approveCircleMint, executeCircleEffect, observeCircle, cleanupCircle, type CircleLifecyclePorts } from "../../src/circle-v2-evm/lifecycle.js";
import { CIRCLE_SOURCE_OWNER, CIRCLE_SOURCE_TOKEN, CIRCLE_MESSENGER, CIRCLE_TRANSMITTER, CIRCLE_RECIPIENT, circleRoute } from "../../src/circle-v2-evm/catalog.js";
import { decodeCircleSource, bindCircleAttestation, decodeCircleDestination, encodeCircleApproval, encodeCircleBurn, encodeCircleMint, circleWord, circleHex } from "../../src/circle-v2-evm/protocol.js";
import { OperationService } from "../../src/operation-service.js";
import { storedOperationDomains } from "../../src/operation-conflict-domain.js";
import { source, iris, snapshot, event, observation } from "./circle-v2-evm-runtime-fixtures.js";
const at = Date.parse("2026-10-09T01:00:00.000Z"), route = circleRoute(143), tx = `0x${"11".repeat(32)}` as Hex;
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
function ports(start: CircleOperationV1, overrides: Partial<CircleLifecyclePorts> = {}) {
  let current = start, signs = 0, sends = 0;
  const saved: CircleOperationV1[] = [];
  const p: CircleLifecyclePorts = { now: () => at + 1, save: async next => { validateCircleAdvance(current, next); current = next; saved.push(next); }, assertOwnerPolicyAndConflicts: async () => {}, authorizationDeadline: async () => null, approve: async () => {}, preflight: async () => {},
    seal: async (op, effect) => { signs++; return { schemaVersion: "apn.circle-v2-evm-effect.v1", operationId: op.operationId, role: effect.role, fingerprint: op.fingerprint, envelopeHash: effect.envelope.envelopeHash, rawTransaction: "0x02", transactionHash: tx, materialHash: "9".repeat(64) }; },
    loadMaterial: async (op, effect) => ({ schemaVersion: "apn.circle-v2-evm-effect.v1", operationId: op.operationId, role: effect.role, fingerprint: op.fingerprint, envelopeHash: effect.envelope.envelopeHash, rawTransaction: "0x02", transactionHash: tx, materialHash: "9".repeat(64) }), broadcast: async () => { sends++; return tx; },
    observeEffect: async () => null, observeSource: async () => null, observeDestination: async () => null, allowance: async () => "0", attestation: async () => null,
    mintEnvelope: async op => circleEnvelope({ chainId: 143, from: route.gasPayer, to: CIRCLE_TRANSMITTER, data: encodeCircleMint(op.attestation!), valueAtomic: "0", nonceAtomic: "10", gasLimitAtomic: "500000", maxFeePerGasAtomic: "102000000000", maxPriorityFeePerGasAtomic: "0" }),
    cleanupEnvelope: async () => { throw new Error("unused"); }, usage: async (op, target) => usage(op, target === "finalized" ? "finalized" : "unknown_finality"), ...overrides };
  return { p, saved, current: () => current, signs: () => signs, sends: () => sends };
}
test("lost broadcast holds a durable submission fence and explicit replay observes without signing or sending", async () => {
  let op = initial(); op = advanceCircle(op, { usage: usage(op) }, "reserved", at); const p = ports(op, { broadcast: async () => { throw new Error("lost RPC"); } });
  op = await approveCircleSource(op, p.p); assert.equal(op.effects[0]!.phase, "unknown"); assert.equal(p.signs(), 1);
  assert.ok(p.saved.some(x => x.effects[0]!.phase === "submission_started")); assert.ok(op.usage.every(x => x.state === "unknown_finality"));
  await approveCircleSource(op, p.p); assert.equal(p.signs(), 1); assert.equal(p.sends(), 0);
});
test("crash after the signing mark with no saved bytes resumes the same frozen envelope once under fresh consent", async () => {
  let op = initial(); op = advanceCircle(op, { usage: usage(op) }, "reserved", at); op = advanceCircle(op, { effects: op.effects.map(e => e.role === "approval" ? { ...e, phase: "signing_started" } : e), state: "source_unknown" }, "signing_fence", at);
  let saved = false; const p = ports(op, { loadMaterial: async (o, e) => saved && e.role === "approval" ? { schemaVersion: "apn.circle-v2-evm-effect.v1", operationId: o.operationId, role: e.role, fingerprint: o.fingerprint, envelopeHash: e.envelope.envelopeHash, rawTransaction: "0x02", transactionHash: tx, materialHash: "9".repeat(64) } : null });
  const seal = p.p.seal; p.p.seal = async (o, e, g) => { assert.equal(e.phase, "signing_started"); const m = await seal(o, e, g); saved = true; return m; };
  const resumed = await approveCircleSource(op, p.p); assert.equal(resumed.effects[0]!.phase, "submitted"); assert.equal(p.signs(), 1); assert.equal(p.sends(), 1);
  assert.ok(p.saved.some(x => x.effects[0]!.phase === "submission_started"));
});
test("a signing fence with saved material recovers as resumable sealed bytes, never as unknown", async () => {
  let op = initial(); op = advanceCircle(op, { usage: usage(op) }, "reserved", at); op = advanceCircle(op, { effects: op.effects.map(e => e.role === "approval" ? { ...e, phase: "signing_started" } : e), state: "source_unknown" }, "signing_fence", at);
  const p = ports(op); const recovered = await observeCircle(op, p.p); assert.equal(recovered.effects[0]!.phase, "sealed"); assert.equal(recovered.effects[0]!.transactionHash, tx); assert.equal(p.signs(), 0); assert.equal(p.sends(), 0);
  const sent = await approveCircleSource(recovered, p.p); assert.equal(sent.effects[0]!.phase, "submitted"); assert.equal(p.signs(), 0); assert.equal(p.sends(), 1);
});
async function sourceReady(finalized = false, chain: 143 | 1329 | 59144 = 143) {
  let op = initial(undefined, chain); op = advanceCircle(op, { usage: usage(op, "unknown_finality") }, "reserved", at);
  const raw = source(chain), proof = decodeCircleSource(finalized ? { ...raw, finalityTag: "finalized" } : raw, chain), attestation = await bindCircleAttestation(proof, await iris(proof), snapshot(chain));
  op = advanceCircle(op, { source: proof, attestation, effects: op.effects.map(e => ({ ...e, phase: "confirmed", transactionHash: tx, materialHash: "9".repeat(64), proof })), state: "awaiting_mint" }, "source_confirmed", at);
  return op;
}
test("issuer Fast attestation permits one mint while source finality pending, but cannot complete or finalize usage", async () => {
  const op = await sourceReady(), p = ports(op);
  p.p.observeSource = async () => decodeCircleSource({ ...source(143), finalityHead: { hash: `0x${"ab".repeat(32)}`, number: "0xb" } }, 143);
  const refreshed = await observeCircle(op, p.p); assert.equal(refreshed.state, "awaiting_mint"); assert.equal(refreshed.destination, null);
  const minted = await approveCircleMint(refreshed, p.p);
  assert.equal(minted.source!.finalityTag, "included"); assert.equal(minted.effects.find(e => e.role === "mint")!.phase, "submitted"); assert.equal(minted.terminal, false); assert.equal(minted.usageFinalized, false);
  assert.equal(p.signs(), 1); assert.equal(p.sends(), 1); await approveCircleMint(minted, p.p); assert.equal(p.signs(), 1); assert.equal(p.sends(), 1);
});
test("source reorg refuses mint and preserves all holds", async () => {
  const op = await sourceReady(), p = ports(op, { observeSource: async () => ({ ...op.source!, blockHash: `0x${"ff".repeat(32)}` }) });
  await assert.rejects(approveCircleMint(op, p.p), /source_reorg/); assert.equal(p.signs(), 0); assert.equal(p.sends(), 0);
});
test("both Circle account domains are exposed to shared cross-rail conflicts and global idempotency", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "circle-crossrail-")));
  try {
    const repo = new CircleRepository(root), op = initial(root); await repo.save(op); const service = new OperationService(new StateStore(root));
    await assert.rejects(service.assertEvmAccountAvailable(op.profileHash, 42161, CIRCLE_SOURCE_OWNER), { code: "APN_OPERATION_BLOCKED" });
    await assert.rejects(service.assertEvmAccountAvailable(op.destinationProfileHash, 143, route.gasPayer), { code: "APN_OPERATION_BLOCKED" });
    await service.assertEvmAccountAvailable(op.profileHash, 1329, CIRCLE_SOURCE_OWNER); assert.equal((await service.required(op.operationId)).kind, "circle_route");
    assert.equal((await service.findIdempotency(op.idempotencyHash))!.kind, "circle_route"); await assert.rejects(service.resolvePrepare({ kind: "direct_transfer", profileHash: op.profileHash, operationId: op.operationId, idempotencyHash: op.idempotencyHash, requestHash: op.requestHash }), { code: "APN_IDEMPOTENCY_CONFLICT" });
    assert.equal(storedOperationDomains({ kind: "circle_route", record: op })!.length, 2);
    const persisted = await readFile(join(root, "circle-v2-evm", `${op.operationId}.json`), "utf8"); assert.equal(persisted, `${canonicalJson(op)}\n`);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test("journal forbids source nonce, fee ceiling, destination payer and terminal-finality forgery", () => {
  const op = initial(); validateCircle(op);
  for (const changed of [{ ...op, effects: op.effects.map(e => e.role === "burn" ? { ...e, envelope: circleEnvelope({ ...e.envelope, nonceAtomic: "8" }) } : e) },
    { ...op, sourceCustody: { ...op.sourceCustody, walletAddress: route.gasPayer } }, { ...op, state: "completed", terminal: true, usageFinalized: true }]) assert.throws(() => validateCircle(sealCircle(changed as CircleOperationV1)));
  assert.throws(() => validateCircleAdvance(op, advanceCircle(op, { feeQuoteAtomic: "100" }, "tamper", at)), /continuity/);
});
test("shared profile and operation locks allow exactly one concurrent financial claim", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "circle-doubleclaim-")));
  try {
    const state = new StateStore(root, { lockWaitMs: 5000 }), repo = new CircleRepository(root); let op = initial(root); await repo.save(op); op = advanceCircle(op, { usage: usage(op) }, "reserved", at); await repo.save(op);
    const counts = { signs: 0, sends: 0 };
    const claim = () => state.withLocks([`profile:${op.profileHash}`, `operation:${op.operationId}`], async () => {
      const current = (await repo.load(op.operationId))!, p = ports(current, { save: next => repo.save(next) });
      const result = await approveCircleSource(current, p.p); counts.signs += p.signs(); counts.sends += p.sends(); return result;
    });
    const results = await Promise.all([claim(), claim()]); assert.equal(counts.signs, 1); assert.equal(counts.sends, 1);
    assert.equal(results[1]!.effects[0]!.transactionHash, tx); assert.equal((await repo.load(op.operationId))!.effects[0]!.phase, "submitted");
  } finally { await rm(root, { recursive: true, force: true }); }
});
test("destination safe mint leaves usage held until independently finalized source is observed", async () => {
  let op = await sourceReady(); const p = ports(op); op = await approveCircleMint(op, p.p);
  const attested = op.attestation!, logs = [event("Transfer", route.token, { from: getAddress(`0x${"0".repeat(40)}`), to: CIRCLE_RECIPIENT, value: 40094n }, 0),
    event("Transfer", route.token, { from: getAddress(`0x${"0".repeat(40)}`), to: issuerFeeRecipient, value: 6n }, 1),
    event("MintAndWithdraw", CIRCLE_MESSENGER, { mintRecipient: CIRCLE_RECIPIENT, amount: 40094n, mintToken: route.token, feeCollected: 6n }, 2),
    event("MessageReceived", CIRCLE_TRANSMITTER, { caller: route.gasPayer, sourceDomain: 3, nonce: attested.nonce, sender: circleWord(CIRCLE_MESSENGER), finalityThresholdExecuted: 1000, messageBody: attested.body }, 3)];
  const minted = decodeCircleDestination(op.source!, attested, observation(143, route.gasPayer, CIRCLE_TRANSMITTER, encodeCircleMint(attested), logs), "1", undefined, issuerFeeRecipient);
  p.p.observeDestination = async () => minted; op = await observeCircle(op, p.p); assert.equal(op.state, "awaiting_finality"); assert.equal(op.terminal, false); assert.ok(op.usage.every(u => u.state === "unknown_finality"));
  const heldUsage = canonicalJson(op.usage), signs = p.signs(), sends = p.sends();
  let settlements = 0; p.p.usage = async (current, target) => { settlements++; return usage(current, target === "finalized" ? "finalized" : "unknown_finality"); };
  const raw = source(143);
  for (const height of [11, 12]) {
    const included = decodeCircleSource({ ...raw, finalityHead: { hash: `0x${height.toString(16).padStart(2, "0").repeat(32)}`, number: `0x${height.toString(16)}` } }, 143);
    assert.notEqual(included.finalityBlockHash, op.source!.finalityBlockHash);
    p.p.observeSource = async () => included; op = await observeCircle(op, p.p);
    assert.equal(op.state, "awaiting_finality"); assert.equal(op.terminal, false); assert.equal(op.usageFinalized, false);
    assert.equal(op.usage.length, 5); assert.equal(canonicalJson(op.usage), heldUsage);
    assert.equal(p.signs(), signs); assert.equal(p.sends(), sends); assert.equal(settlements, 0);
    assert.equal(op.source!.finalityBlockNumberAtomic, String(height)); assert.equal(op.source!.finalityTag, "included");
  }
  const finalized = decodeCircleSource({ ...raw, finalityTag: "finalized" }, 143); p.p.observeSource = async () => finalized;
  p.p.observeDestination = async () => null; op = await observeCircle(op, p.p); assert.equal(op.terminal, false);
  p.p.observeDestination = async () => ({ ...minted, blockHash: `0x${"99".repeat(32)}` }); await assert.rejects(observeCircle(op, p.p), /destination_reorg/);
  p.p.observeDestination = async () => minted; op = await observeCircle(op, p.p); assert.equal(op.state, "completed"); assert.equal(op.terminal, true); assert.ok(op.usage.every(u => u.state === "finalized")); validateCircle(op);
});
test("only a canonical finalized reverted source effect can enter explicit cleanup", async () => {
  const op = await sourceReady(), raw = source(143), receipt = { ...(raw.receipt as Record<string, unknown>), status: "0x0", logs: [] };
  const proof = verifyCircleFinalizedRevert(op.effects[1]!, { ...raw, receipt, finalityTag: "finalized" }); assert.equal(proof.receiptHash, hashObject(receipt)); assert.equal(proof.outcome, "reverted");
  assert.throws(() => verifyCircleFinalizedRevert(op.effects[1]!, { ...raw, receipt }), /finalized/);
  const ambiguous = advanceCircle(op, { source: null, attestation: null, state: "source_unknown", residualAllowanceAtomic: "40100", effects: op.effects.map(e => e.role === "burn" ? { ...e, phase: "unknown", proof: null } : e) }, "ambiguous_source", at);
  const p = ports(ambiguous); await assert.rejects(cleanupCircle(ambiguous, p.p), /cleanup_requires/); assert.equal(p.signs(), 0); assert.equal(p.sends(), 0);
});
test("a different Circle route queues after source inclusion; other money rails retain the source hold", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "circle-included-queue-")));
  try {
    const state = new StateStore(root); await state.initialize(); await mkdir(join(root, "circle-v2-evm"), { mode: 0o700 });
    const previous = await sourceReady(); validateCircle(previous); await writeFile(join(root, "circle-v2-evm", `${previous.operationId}.json`), `${canonicalJson(previous)}\n`, { mode: 0o600 });
    const service = new OperationService(state), next = initial(root, 1329); validateCircle(next);
    await service.assertCircleAccountsAvailable(next);
    await assert.rejects(service.assertEvmAccountAvailable(previous.profileHash, 42161, CIRCLE_SOURCE_OWNER), { code: "APN_OPERATION_BLOCKED" });
    assert.equal(previous.terminal, false); assert.equal(previous.source!.finalityTag, "included"); assert.ok(previous.usage.every(u => u.state === "unknown_finality"));
  } finally { await rm(root, { recursive: true, force: true }); }
});
test("unsubmitted explicit cancellation releases reserves only after proving no private material and zero allowance", async () => {
  let op = initial(); op = advanceCircle(op, { usage: usage(op) }, "reserved", at);
  const cancelledUsage = usage(op).map(u => { const { reservationDigest: _digest, ...body } = u; return sealUsage({ ...body, state: "failed_before_effect", outcomeDigest: "f".repeat(64) }); });
  const p = ports(op, { loadMaterial: async () => null, usage: async (_op, target) => { assert.equal(target, "failed_before_effect"); return cancelledUsage; } });
  const cancelled = await cleanupCircle(op, p.p); assert.equal(cancelled.state, "cancelled_unsubmitted"); assert.equal(cancelled.terminal, true); assert.equal(p.signs(), 0); assert.equal(p.sends(), 0);
  const hostile = ports(op); await assert.rejects(cleanupCircle(op, hostile.p), /private_material_present/);
});

test("runtime bytecode has the EIP-170 bound while wire fields retain their narrower bound", () => {
  const actualTransmitterLength = `0x${"ab".repeat(16882)}`; assert.equal(actualTransmitterLength.length, 33766); assert.equal(circleRuntimeBytecode(actualTransmitterLength), actualTransmitterLength);
  assert.equal(circleRuntimeBytecode(`0x${"AB".repeat(24576)}`), `0x${"ab".repeat(24576)}`);
  for (const value of [`0x${"ab".repeat(24577)}`, "0xabc", "0xz1", "0X00", null, "00"]) assert.throws(() => circleRuntimeBytecode(value), /runtime_bytecode/);
  assert.equal(circleRuntimeBytecode("0x"), "0x"); assert.throws(() => circleHex(actualTransmitterLength), /hex/); assert.equal(circleHex(`0x${"ab".repeat(16384)}`).length, 32770);
});
test("expired TTY and first preflight fail before any private marker", async () => {
  for (const delayed of ["tty", "preflight"] as const) {
    let now = at + 1, op = initial(); op = advanceCircle(op, { usage: usage(op) }, "reserved", at);
    const p = ports(op, { now: () => now, approve: async () => { if (delayed === "tty") now += 60000; }, preflight: async () => { if (delayed === "preflight") now += 60000; } });
    await assert.rejects(approveCircleSource(op, p.p), /consent/); assert.equal(p.signs(), 0); assert.equal(p.sends(), 0); assert.equal(p.current().effects[0]!.phase, "prepared");
  }
  let op = initial(); op = advanceCircle(op, { usage: usage(op) }, "reserved", at); let now = Date.parse(op.expiresAt) - 1;
  const p = ports(op, { now: () => now, approve: async () => { now += 2; } }); await assert.rejects(approveCircleSource(op, p.p), /consent/); assert.equal(p.signs(), 0);
});
test("expiry before the submission fence keeps signed bytes resumable; after the fence it is unknown and never signs or sends again", async () => {
  for (const delayed of ["signing_fence", "sign", "sign_result", "material_sealed", "submission_fence", "dispatch"] as const) {
    let now = at + 1, op = initial(); op = advanceCircle(op, { usage: usage(op) }, "reserved", at); const signed = new Set<string>();
    const p = ports(op, { now: () => now, loadMaterial: async (o, e) => signed.has(e.role) ? { schemaVersion: "apn.circle-v2-evm-effect.v1", operationId: o.operationId, role: e.role, fingerprint: o.fingerprint, envelopeHash: e.envelope.envelopeHash, rawTransaction: "0x02", transactionHash: tx, materialHash: "9".repeat(64) } : null });
    const save = p.p.save, broadcast = p.p.broadcast; let fired = false;
    const fake = ports(op).p.seal, seal = async (...args: Parameters<typeof fake>) => { const m = await fake(...args); signed.add(args[1].role); return m; };
    let signCount = 0;
    const once = (hit: boolean) => { if (hit && !fired) { fired = true; now += 60000; } };
    p.p.save = async next => { await save(next); const reason = next.transitions.at(-1)!.reason; once(delayed === "signing_fence" && reason === "approval_signing_fence" || delayed === "material_sealed" && reason === "approval_material_sealed" || delayed === "submission_fence" && reason === "approval_submission_fence"); };
    p.p.seal = async (current, effect, guard) => { if (delayed === "sign" && !fired) { once(true); guard(); } signCount++; const result = await seal(current, effect, guard); once(delayed === "sign_result"); return result; };
    p.p.broadcast = async (effect, raw, guard) => { once(delayed === "dispatch"); guard(); return broadcast(effect, raw, guard); };
    if (delayed === "submission_fence" || delayed === "dispatch") {
      op = await approveCircleSource(op, p.p); assert.equal(op.effects[0]!.phase, "unknown", delayed); assert.equal(p.sends(), 0, delayed);
      const before = signCount; await approveCircleSource(op, p.p); assert.equal(signCount, before, delayed); assert.equal(p.sends(), 0, delayed);
      continue;
    }
    await assert.rejects(approveCircleSource(op, p.p), /consent/, delayed);
    const unsent = p.current().effects[0]!; assert.ok(["signing_started", "sealed"].includes(unsent.phase), delayed); assert.equal(p.sends(), 0, delayed);
    assert.ok(!p.saved.some(x => x.effects[0]!.phase === "unknown"), delayed);
    const resumed = await approveCircleSource(p.current(), p.p); assert.equal(resumed.effects[0]!.phase, "submitted", delayed);
    assert.equal(signCount, 1, delayed); assert.equal(p.sends(), 1, delayed);
  }
});
test("a signed-but-unsent source effect stays resumable after the preparation window; nothing new is signed after it", async () => {
  const ready = await sourceReady();
  const sealedBurn = advanceCircle(ready, { source: null, attestation: null, state: "source_unknown", residualAllowanceAtomic: "40100", effects: ready.effects.map(e => e.role === "burn" ? { ...e, phase: "sealed", proof: null } : e) }, "burn_sealed_unsent", at);
  const now = Date.parse(sealedBurn.expiresAt) + 1, p = ports(sealedBurn, { now: () => now });
  const sent = await approveCircleSource(sealedBurn, p.p); assert.equal(sent.effects[1]!.phase, "submitted"); assert.equal(p.signs(), 0); assert.equal(p.sends(), 1);
  const preparedBurn = advanceCircle(sealedBurn, { effects: sealedBurn.effects.map(e => e.role === "burn" ? { ...e, phase: "prepared", transactionHash: null, materialHash: null } : e) }, "burn_not_signed", at);
  const q = ports(preparedBurn, { now: () => now });
  await assert.rejects(approveCircleSource(preparedBurn, q.p), /source_preparation_expired/); assert.equal(q.signs(), 0); assert.equal(q.sends(), 0);
});
test("an abandoned signed-but-unsent burn exits through approve-zero cleanup at the same pending nonce", async () => {
  const ready = await sourceReady();
  const sealedBurn = advanceCircle(ready, { source: null, attestation: null, state: "source_unknown", residualAllowanceAtomic: "40100", effects: ready.effects.map(e => e.role === "burn" ? { ...e, phase: "sealed", proof: null } : e) }, "burn_sealed_unsent", at);
  const p = ports(sealedBurn, { cleanupEnvelope: async () => circleEnvelope({ chainId: 42161, from: CIRCLE_SOURCE_OWNER, to: CIRCLE_SOURCE_TOKEN, data: encodeCircleApproval(true), valueAtomic: "0", nonceAtomic: "2", gasLimitAtomic: "50000", maxFeePerGasAtomic: "20000000", maxPriorityFeePerGasAtomic: "0" }) });
  const cleaned = await cleanupCircle(sealedBurn, p.p); const cleanup = cleaned.effects.find(e => e.role === "cleanup")!;
  assert.equal(cleaned.state, "cleanup_required"); assert.equal(cleanup.phase, "submitted"); assert.equal(cleaned.effects[1]!.phase, "sealed"); assert.equal(p.signs(), 1); assert.equal(p.sends(), 1);
  await assert.rejects(approveCircleSource(cleaned, p.p), /explicit_cleanup_required/); assert.equal(p.sends(), 1);
});
test("private consent cannot be forged, reused after controller return or applied to another effect", async () => {
  let op = initial(); op = advanceCircle(op, { usage: usage(op) }, "reserved", at); const p = ports(op);
  await assert.rejects(executeCircleEffect(op, "approval", p.p), /consent/); await assert.rejects(executeCircleEffect(op, "burn", p.p, () => {}), /consent/);
  let captured: (() => void) | undefined; const broadcast = p.p.broadcast; p.p.broadcast = async (effect, raw, guard) => { captured = guard; return broadcast(effect, raw, guard); };
  op = await approveCircleSource(op, p.p); assert.equal(p.sends(), 1); assert.ok(captured); assert.throws(() => captured!(), /consent/);
  await assert.rejects(executeCircleEffect(op, "burn", p.p, captured), /consent/); assert.equal(p.sends(), 1);
});
test("mint and no-effect cancellation have fresh finite TTY authority", async () => {
  const mint = await sourceReady(); let now = at + 1, p = ports(mint, { now: () => now, approve: async () => { now += 60000; } });
  await assert.rejects(approveCircleMint(mint, p.p), /consent/); assert.equal(p.signs(), 0); assert.equal(p.sends(), 0);
  let cancelled = initial(); cancelled = advanceCircle(cancelled, { usage: usage(cancelled) }, "reserved", at); now = at + 1;
  p = ports(cancelled, { now: () => now, loadMaterial: async () => null, approve: async () => { now += 60000; } }); await assert.rejects(cleanupCircle(cancelled, p.p), /consent/); assert.equal(p.current().terminal, false);
});
test("bound policy expiry at the single pre-signing preflight prevents signing and dispatch", async () => {
  let now = at + 1, op = initial(); op = advanceCircle(op, { usage: usage(op) }, "reserved", at); let preflights = 0, confirms = 0;
  const p = ports(op, { now: () => now, authorizationDeadline: async () => new Date(at + 2).toISOString(), assertOwnerPolicyAndConflicts: async () => { confirms++; }, preflight: async () => { preflights++; now += 1; } });
  await assert.rejects(approveCircleSource(op, p.p), /consent/); assert.equal(p.signs(), 0); assert.equal(p.current().effects[0]!.phase, "prepared");
  assert.equal(p.sends(), 0); assert.equal(preflights, 1); assert.equal(confirms, 3);
});
test("owner, policy and chain preflight run once per effect before signing and never after the seal", async () => {
  let op = initial(); op = advanceCircle(op, { usage: usage(op) }, "reserved", at); const order: string[] = [];
  const p = ports(op, { assertOwnerPolicyAndConflicts: async () => { order.push("owner"); }, preflight: async () => { order.push("preflight"); } });
  const seal = p.p.seal, broadcast = p.p.broadcast;
  p.p.seal = async (o, e, g) => { order.push("seal"); return seal(o, e, g); }; p.p.broadcast = async (e, r, g) => { order.push("send"); return broadcast(e, r, g); };
  await approveCircleSource(op, p.p); assert.deepEqual(order, ["owner", "owner", "owner", "preflight", "seal", "send"]);
});
test("policy expiry after a submission fence or queued dispatch remains observation-only", async () => {
  for (const delayed of ["fence", "dispatch"] as const) {
    let now = at + 1, op = initial(); op = advanceCircle(op, { usage: usage(op) }, "reserved", at);
    const p = ports(op, { now: () => now, authorizationDeadline: async () => new Date(at + 2).toISOString() }), save = p.p.save, broadcast = p.p.broadcast;
    p.p.save = async next => { await save(next); if (delayed === "fence" && next.transitions.at(-1)!.reason === "approval_submission_fence") now++; };
    p.p.broadcast = async (effect, raw, guard) => { if (delayed === "dispatch") now++; guard(); return broadcast(effect, raw, guard); };
    op = await approveCircleSource(op, p.p); assert.equal(op.effects[0]!.phase, "unknown"); assert.equal(p.sends(), 0); const signs = p.signs(); await approveCircleSource(op, p.p); assert.equal(p.signs(), signs); assert.equal(p.sends(), 0);
  }
});
test("later or absent owner policy expiry preserves the finite sixty-second TTY bound", async () => {
  for (const expiry of [null, new Date(at + 7200000).toISOString()]) {
    let now = at + 1, op = initial(); op = advanceCircle(op, { usage: usage(op) }, "reserved", at);
    const p = ports(op, { now: () => now, authorizationDeadline: async () => expiry, approve: async (_op, _role, deadline) => { assert.equal(deadline, new Date(at + 60001).toISOString()); now += 60000; } });
    await assert.rejects(approveCircleSource(op, p.p), /consent/); assert.equal(p.signs(), 0); assert.equal(p.sends(), 0);
  }
});
test("expired or revised policy cannot prevent proven-unsubmitted cancellation or grant a financial exemption", async () => {
  let op = initial(); op = advanceCircle(op, { usage: usage(op) }, "reserved", at); let released = 0, policyReads = 0;
  const closed = usage(op).map(u => { const { reservationDigest: _digest, ...body } = u; return sealUsage({ ...body, state: "failed_before_effect", outcomeDigest: "f".repeat(64) }); });
  const p = ports(op, { loadMaterial: async () => null, authorizationDeadline: async () => { policyReads++; throw new Error("expired_or_revised_active_policy"); }, approve: async (_op, role) => { assert.equal(role, "cancel"); }, usage: async (_op, target) => { assert.equal(target, "failed_before_effect"); released++; return closed; } });
  const cancelled = await cleanupCircle(op, p.p); assert.equal(cancelled.state, "cancelled_unsubmitted"); assert.equal(policyReads, 0); assert.equal(released, 1); assert.equal(p.signs(), 0); assert.equal(p.sends(), 0);
  let financial = await sourceReady(); financial = advanceCircle(financial, { source: null, attestation: null, state: "cleanup_required", residualAllowanceAtomic: "40100", effects: financial.effects.map(e => e.role === "burn" ? { ...e, phase: "prepared", transactionHash: null, materialHash: null, proof: null } : e) }, "burn_not_attempted", at);
  const cleanup = ports(financial, { authorizationDeadline: async () => { throw new Error("expired_or_revised_active_policy"); }, cleanupEnvelope: async () => circleEnvelope({ chainId: 42161, from: CIRCLE_SOURCE_OWNER, to: CIRCLE_SOURCE_TOKEN, data: encodeCircleApproval(true), valueAtomic: "0", nonceAtomic: "3", gasLimitAtomic: "50000", maxFeePerGasAtomic: "20000000", maxPriorityFeePerGasAtomic: "0" }) });
  await assert.rejects(cleanupCircle(financial, cleanup.p), /expired_or_revised/); assert.equal(cleanup.signs(), 0); assert.equal(cleanup.sends(), 0);
  const unknown = advanceCircle(op, { state: "source_unknown", effects: op.effects.map(e => e.role === "approval" ? { ...e, phase: "unknown", transactionHash: tx, materialHash: "9".repeat(64) } : e) }, "unknown_signing", at);
  const held = ports(unknown, { usage: async () => { throw new Error("must_not_release"); }, authorizationDeadline: async () => null }); await assert.rejects(cleanupCircle(unknown, held.p), /cleanup_requires/); assert.equal(held.signs(), 0); assert.equal(held.sends(), 0);
});

test("saved included source with pending finality acquires fresh issuer proof without closing holds", async () => {
  const ready = await sourceReady(), op = advanceCircle(ready, { attestation: null }, "issuer_pending", at); const requested: boolean[] = []; let issuers = 0;
  const p = ports(op, { observeSource: async (_op, finalized) => { requested.push(finalized); return finalized ? null : op.source; }, attestation: async () => { issuers++; return ready.attestation; } });
  const observed = await observeCircle(op, p.p); assert.deepEqual(requested, [true, false]); assert.equal(issuers, 1); assert.deepEqual(observed.attestation, ready.attestation);
  assert.equal(observed.source!.finalityTag, "included"); assert.equal(observed.terminal, false); assert.equal(observed.usageFinalized, false); assert.ok(observed.usage.every(u => u.state === "unknown_finality")); assert.equal(p.signs(), 0); assert.equal(p.sends(), 0);
});
test("pending-finality fallback requires exact fresh canonical source and never manufactures issuer proof", async () => {
  const ready = await sourceReady(), op = advanceCircle(ready, { attestation: null }, "issuer_pending", at);
  for (const key of ["transactionHash", "blockHash", "receiptHash", "sourceMessageHash"] as const) {
    let issuers = 0; const changed = { ...op.source!, [key]: key === "receiptHash" ? "f".repeat(64) : `0x${"ff".repeat(32)}` };
    const p = ports(op, { observeSource: async (_op, finalized) => finalized ? null : changed, attestation: async () => { issuers++; return ready.attestation; } });
    await assert.rejects(observeCircle(op, p.p), /source_reorg_holds_required/); assert.equal(issuers, 0); assert.equal(p.signs(), 0); assert.equal(p.sends(), 0);
  }
  for (const canonical of [null, op.source]) {
    let issuers = 0; const p = ports(op, { observeSource: async (_op, finalized) => finalized ? null : canonical, attestation: async () => { issuers++; return null; } });
    const observed = await observeCircle(op, p.p); assert.equal(observed.attestation, null); assert.equal(issuers, canonical === null ? 0 : 1); assert.equal(observed.terminal, false); assert.equal(observed.usageFinalized, false);
  }
});
test("saved finalized source cannot use included fallback to mask absent finalized canonical proof", async () => {
  const op = await sourceReady(true), requested: boolean[] = []; const p = ports(op, { observeSource: async (_op, finalized) => { requested.push(finalized); return null; } });
  const observed = await observeCircle(op, p.p); assert.deepEqual(requested, [true]); assert.equal(observed.terminal, false); assert.equal(observed.usageFinalized, false);
});


test("finalized Linea mint scopes conflicts to its destination payer without freeing any source unknown holds", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "circle-mint-payer-conflict-")));
  try {
    const state = new StateStore(root); await state.initialize(); const repo = new CircleRepository(root), service = new OperationService(state);
    const fixture = async (op: CircleOperationV1) => { validateCircle(op); await mkdir(join(root, "circle-v2-evm"), { recursive: true, mode: 0o700 }); await writeFile(join(root, "circle-v2-evm", `${op.operationId}.json`), `${canonicalJson(op)}\n`, { mode: 0o600 }); };
    const current = await sourceReady(true, 59144); await fixture(current);
    const otherBase = initial(root), other = advanceCircle(sealCircle({ ...otherBase, operationId: "8".repeat(64), idempotencyHash: "8".repeat(64) }), { state: "source_unknown", effects: otherBase.effects.map(e => e.role === "approval" ? { ...e, phase: "unknown" } : e) }, "other_unknown", at);
    await fixture(other); const oldBytes = await readFile(join(root, "circle-v2-evm", `${other.operationId}.json`), "utf8");
    await service.assertCircleAccountsAvailable(current, true, "mint");
    for (const role of [undefined, "approval", "burn", "cleanup"] as const) await assert.rejects(service.assertCircleAccountsAvailable(current, true, role), { code: "APN_OPERATION_BLOCKED" });
    const mintEnvelope = async (op: CircleOperationV1) => circleEnvelope({ chainId: 59144, from: CIRCLE_SOURCE_OWNER, to: CIRCLE_TRANSMITTER, data: encodeCircleMint(op.attestation!), valueAtomic: "0", nonceAtomic: "10", gasLimitAtomic: "500000", maxFeePerGasAtomic: "100000000", maxPriorityFeePerGasAtomic: "0" });
    const normal = ports(current, { save: op => repo.save(op), mintEnvelope, assertOwnerPolicyAndConflicts: (op, role) => service.assertCircleAccountsAvailable(op, true, role) });
    const submitted = await approveCircleMint(current, normal.p); assert.equal(submitted.effects.find(e => e.role === "mint")!.phase, "submitted"); assert.equal(normal.signs(), 1); assert.equal(normal.sends(), 1);
    await fixture(current);
    const expired = ports(current, { save: op => repo.save(op), mintEnvelope, assertOwnerPolicyAndConflicts: (op, role) => service.assertCircleAccountsAvailable(op, true, role), authorizationDeadline: async () => new Date(at + 1).toISOString() });
    await assert.rejects(approveCircleMint(current, expired.p), /consent_expired/); assert.equal(expired.signs(), 0); assert.equal(expired.sends(), 0);
    await fixture(current);
    const included = await sourceReady(false, 59144); await writeFile(join(root, "circle-v2-evm", `${current.operationId}.json`), `${canonicalJson(included)}\n`, { mode: 0o600 });
    await assert.rejects(service.assertCircleAccountsAvailable(included, true, "mint"), { code: "APN_OPERATION_BLOCKED" });
    await writeFile(join(root, "circle-v2-evm", `${current.operationId}.json`), `${canonicalJson(current)}\n`, { mode: 0o600 });
    const ownUnknown = sealCircle({ ...current, effects: current.effects.map(e => e.role === "approval" ? { ...e, phase: "unknown" as const } : e) });
    await writeFile(join(root, "circle-v2-evm", `${current.operationId}.json`), `${canonicalJson(ownUnknown)}\n`, { mode: 0o600 });
    await assert.rejects(service.assertCircleAccountsAvailable(ownUnknown, true, "mint"));
    await writeFile(join(root, "circle-v2-evm", `${current.operationId}.json`), `${canonicalJson(current)}\n`, { mode: 0o600 });
    const destinationBase = initial(root, 59144), destinationUnknown = advanceCircle(sealCircle({ ...destinationBase, operationId: "9".repeat(64), idempotencyHash: "9".repeat(64) }), { state: "source_unknown", effects: destinationBase.effects.map(e => e.role === "approval" ? { ...e, phase: "unknown" } : e) }, "destination_unknown", at);
    await fixture(destinationUnknown); await assert.rejects(service.assertCircleAccountsAvailable(current, true, "mint"), (e: unknown) => { const error = e as { details: Record<string, string> }; assert.equal(error.details.blockingNetwork, "evm:59144"); return true; });
    assert.equal(await readFile(join(root, "circle-v2-evm", `${other.operationId}.json`), "utf8"), oldBytes); assert.equal(current.terminal, false); assert.ok(current.usage.every(u => u.state === "unknown_finality"));
  } finally { await rm(root, { recursive: true, force: true }); }
});

function noEffectUsage(op: CircleOperationV1) {
  return usage(op).map(u => { const { reservationDigest: _digest, ...body } = u; return sealUsage({ ...body, state: "failed_before_effect", outcomeDigest: "f".repeat(64) }); });
}
for (const outcome of ["never_lands", "nonce_not_consumed", "own_transaction_known"] as const)
  test(`a resumed sealed approval whose nonce check says ${outcome} ends, resumes once, or is fenced for observation`, async () => {
    let op = initial(); op = advanceCircle(op, { usage: usage(op) }, "reserved", at);
    op = advanceCircle(op, { state: "source_unknown", effects: op.effects.map(e => e.role === "approval" ? { ...e, phase: "sealed", transactionHash: tx, materialHash: "9".repeat(64) } : e) }, "approval_material_sealed", at);
    let checks = 0, discards = 0;
    const p = ports(op, { usage: async (o, target) => target === "failed_before_effect" ? noEffectUsage(o) : usage(o, target === "finalized" ? "finalized" : "unknown_finality"),
      unsent: { outcome: async (_o, effect) => { checks++; assert.equal(effect.transactionHash, tx); return outcome; },
        discard: async (_o, effect) => { discards++; assert.equal(effect.phase, "abandoned_unsent"); } } });
    const result = await approveCircleSource(op, p.p);
    assert.equal(checks, 1); assert.equal(p.signs(), 0);
    if (outcome === "never_lands") {
      assert.equal(result.state, "cancelled_unsubmitted"); assert.equal(result.terminal, true);
      assert.equal(result.effects[0]!.phase, "abandoned_unsent"); assert.equal(result.effects[0]!.transactionHash, tx);
      assert.ok(result.usage.every(u => u.state === "failed_before_effect")); assert.equal(discards, 1); assert.equal(p.sends(), 0);
    } else if (outcome === "nonce_not_consumed") {
      assert.equal(result.effects[0]!.phase, "submitted"); assert.equal(p.sends(), 1); assert.equal(discards, 0);
    } else {
      assert.equal(result.effects[0]!.phase, "submission_started"); assert.equal(p.sends(), 0); assert.equal(discards, 0);
      assert.ok(result.usage.every(u => u.state === "unknown_finality"));
      await approveCircleSource(result, p.p); assert.equal(p.sends(), 0);
    }
  });
test("a sealed burn that can never land leaves the confirmed approval to explicit cleanup", async () => {
  const ready = await sourceReady();
  const sealedBurn = advanceCircle(ready, { source: null, attestation: null, state: "source_unknown", residualAllowanceAtomic: "40100", effects: ready.effects.map(e => e.role === "burn" ? { ...e, phase: "sealed", proof: null } : e) }, "burn_sealed_unsent", at);
  let discards = 0;
  const p = ports(sealedBurn, { unsent: { outcome: async () => "never_lands", discard: async () => { discards++; } } });
  const result = await observeCircle(sealedBurn, p.p);
  assert.equal(result.state, "cleanup_required"); assert.equal(result.terminal, false); assert.equal(result.effects[1]!.phase, "abandoned_unsent");
  assert.equal(discards, 1); assert.equal(p.sends(), 0);
  await assert.rejects(approveCircleSource(result, p.p), /explicit_cleanup_required/);
});
test("a signing fence without saved bytes is cancelled as never sent", async () => {
  let op = initial(); op = advanceCircle(op, { usage: usage(op) }, "reserved", at);
  op = advanceCircle(op, { state: "source_unknown", effects: op.effects.map(e => e.role === "approval" ? { ...e, phase: "signing_started" } : e) }, "signing_fence", at);
  const p = ports(op, { loadMaterial: async () => null, usage: async o => noEffectUsage(o) });
  const cancelled = await cleanupCircle(op, p.p);
  assert.equal(cancelled.state, "cancelled_unsubmitted"); assert.equal(cancelled.effects[0]!.phase, "abandoned_unsent");
  assert.equal(cancelled.effects[0]!.transactionHash, null); assert.equal(p.sends(), 0);
});
