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
  return ["usdc", "approval-native", "burn-native", "cleanup-native", "mint-native"].map((key, i) => {
    const identity = { account: i === 4 ? route.gasPayer : CIRCLE_SOURCE_OWNER, chain: i === 4 ? "eip155:143" : "eip155:42161", asset: i === 0 ? { kind: "token" as const, identifier: CIRCLE_SOURCE_TOKEN } : { kind: "native" as const, identifier: null } }, idempotencyHash = idempotency(`${op.operationId}:${key}`);
    return sealUsage({ schemaVersion: "apn.asset-usage-reservation.v1", reservationId: reservationIdFor(identity, idempotencyHash), idempotencyHash, policyDigest: op.policies[i === 4 ? 1 : 0]!.policyDigest, registryVersion: "circle-fixture", ...identity, rail: "bridge", amountAtomic: i === 0 ? "40100" : i === 4 ? route.destinationNativeCap : i === 3 ? "15000000000000" : "30000000000000", state: target,
      reservedAt: new Date(at).toISOString(), updatedAt: new Date(at).toISOString(), effectAt: target === "finalized" ? new Date(at).toISOString() : null, outcomeDigest: target === "finalized" ? "8".repeat(64) : null });
  });
}
function ports(start: CircleOperationV1, overrides: Partial<CircleLifecyclePorts> = {}) {
  let current = start, signs = 0, sends = 0;
  const saved: CircleOperationV1[] = [];
  const p: CircleLifecyclePorts = { now: () => at + 1, save: async next => { validateCircleAdvance(current, next); current = next; saved.push(next); }, assertOwnerPolicyAndConflicts: async () => {}, approve: async () => {}, preflight: async () => {},
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
test("crash immediately after signing mark cannot re-enter custody even if no sealed bytes were saved", async () => {
  let op = initial(); op = advanceCircle(op, { usage: usage(op) }, "reserved", at); op = advanceCircle(op, { effects: op.effects.map(e => e.role === "approval" ? { ...e, phase: "signing_started" } : e), state: "source_unknown" }, "signing_fence", at);
  const p = ports(op, { loadMaterial: async () => null }); const recovered = await approveCircleSource(op, p.p); assert.equal(recovered.effects[0]!.phase, "signing_started"); assert.equal(p.signs(), 0); assert.equal(p.sends(), 0);
});
test("unknown signing can recover encrypted material only for observation", async () => {
  let op = initial(); op = advanceCircle(op, { usage: usage(op) }, "reserved", at); op = advanceCircle(op, { effects: op.effects.map(e => e.role === "approval" ? { ...e, phase: "signing_started" } : e), state: "source_unknown" }, "signing_fence", at);
  const p = ports(op); const recovered = await observeCircle(op, p.p); assert.equal(recovered.effects[0]!.phase, "unknown"); assert.equal(recovered.effects[0]!.transactionHash, tx); assert.equal(p.signs(), 0); assert.equal(p.sends(), 0);
});
async function sourceReady(finalized = false) {
  let op = initial(); op = advanceCircle(op, { usage: usage(op, "unknown_finality") }, "reserved", at);
  const raw = source(143), proof = decodeCircleSource(finalized ? { ...raw, finalityTag: "finalized" } : raw, 143), attestation = await bindCircleAttestation(proof, await iris(proof), snapshot(143));
  op = advanceCircle(op, { source: proof, attestation, effects: op.effects.map(e => ({ ...e, phase: "confirmed", transactionHash: tx, materialHash: "9".repeat(64), proof })), state: "awaiting_mint" }, "source_confirmed", at);
  return op;
}
test("issuer Fast attestation permits one mint while source finality pending, but cannot complete or finalize usage", async () => {
  const op = await sourceReady(), p = ports(op); const minted = await approveCircleMint(op, p.p);
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
    event("MintAndWithdraw", CIRCLE_MESSENGER, { mintRecipient: CIRCLE_RECIPIENT, amount: 40094n, mintToken: route.token }, 1),
    event("MessageReceived", CIRCLE_TRANSMITTER, { caller: route.gasPayer, sourceDomain: 3, nonce: attested.nonce, sender: circleWord(CIRCLE_MESSENGER), finalityThresholdExecuted: 1000, messageBody: attested.body }, 2)];
  const minted = decodeCircleDestination(op.source!, attested, observation(143, route.gasPayer, CIRCLE_TRANSMITTER, encodeCircleMint(attested), logs), "1");
  p.p.observeDestination = async () => minted; op = await observeCircle(op, p.p); assert.equal(op.state, "awaiting_finality"); assert.equal(op.terminal, false); assert.ok(op.usage.every(u => u.state === "unknown_finality"));
  const raw = source(143), finalized = decodeCircleSource({ ...raw, finalityTag: "finalized" }, 143); p.p.observeSource = async () => finalized;
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
test("expiry after signing or submission fences becomes unknown and never signs or sends again", async () => {
  for (const delayed of ["signing_fence", "sign", "sign_result", "material_sealed", "submission_fence", "dispatch"] as const) {
    let now = at + 1, op = initial(); op = advanceCircle(op, { usage: usage(op) }, "reserved", at); const p = ports(op, { now: () => now });
    const save = p.p.save, seal = p.p.seal, broadcast = p.p.broadcast;
    p.p.save = async next => { await save(next); const reason = next.transitions.at(-1)!.reason; if (delayed === "signing_fence" && reason === "approval_signing_fence" || delayed === "material_sealed" && reason === "approval_material_sealed" || delayed === "submission_fence" && reason === "approval_submission_fence") now += 60000; };
    p.p.seal = async (current, effect, guard) => { if (delayed === "sign") { now += 60000; guard(); } const result = await seal(current, effect, guard); if (delayed === "sign_result") now += 60000; return result; };
    p.p.broadcast = async (effect, raw, guard) => { if (delayed === "dispatch") now += 60000; guard(); return broadcast(effect, raw, guard); };
    op = await approveCircleSource(op, p.p); assert.equal(op.effects[0]!.phase, "unknown", delayed); assert.equal(p.sends(), 0, delayed);
    const signed = p.signs(); await approveCircleSource(op, p.p); assert.equal(p.signs(), signed, delayed); assert.equal(p.sends(), 0, delayed);
  }
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
