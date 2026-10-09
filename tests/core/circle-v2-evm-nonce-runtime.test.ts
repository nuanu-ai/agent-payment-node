import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, realpath, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { keccak256, type Hex } from "viem";
import { StateStore } from "../../src/state.js";
import { hashObject, canonicalJson } from "../../src/canonical.js";
import { AllowlistPolicyStore } from "../../src/allowlist-policy-store.js";
import { AssetUsageLedger } from "../../src/asset-usage-ledger.js";
import { CircleUsage, circleMechanism } from "../../src/circle-v2-evm/usage.js";
import { CircleEvmService } from "../../src/circle-v2-evm/runtime.js";
import { CircleRepository } from "../../src/circle-v2-evm/repository.js";
import { CircleRpc } from "../../src/circle-v2-evm/rpc.js";
import { CircleRetirementAuthorityStore } from "../../src/circle-v2-evm/nonce-retirement-authority.js";
import { CircleNonceRetirementStore } from "../../src/circle-v2-evm/nonce-retirement-store.js";
import { advanceCircle, sealCircle, circleEnvelope, validateCircle, type CircleOperationV1, type CircleEffect } from "../../src/circle-v2-evm/operation-model.js";
import { CIRCLE_SOURCE_OWNER, CIRCLE_SOURCE_TOKEN, CIRCLE_MESSENGER, circleRoute } from "../../src/circle-v2-evm/catalog.js";
import { encodeCircleApproval } from "../../src/circle-v2-evm/protocol.js";
import type { LocalCircleCustody, CircleMaterial } from "../../src/circle-v2-evm/custody.js";
import type { CircleNonceRetirementPorts } from "../../src/circle-v2-evm/nonce-retirement.js";
import { observation, event } from "./circle-v2-evm-runtime-fixtures.js";
import { initial, at } from "./circle-v2-evm-nonce-runtime-fixtures.js";
const raw = "0x02" as Hex, cleanupHash = keccak256(raw), oldHash = `0x${"11".repeat(32)}` as Hex;
for (const variant of ["cancelled", "finalized", "changed_again", "burn_attempt"] as const) test(`full production cleanupNonce ${variant}: real prepare, journal and ledger`, async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "circle-runtime-retirement-"))); t.after(() => rm(root, { recursive: true, force: true }));
  const state = new StateStore(root), policyStore = new AllowlistPolicyStore(root), repo = new CircleRepository(root); let clock = at;
  const usage = new CircleUsage(state, () => clock), route = circleRoute(143); let op = initial(root);
  const heads = new Map<string, Awaited<ReturnType<AllowlistPolicyStore["appendDecision"]>>>();
  for (const profile of [op.profile, op.destinationProfile]) {
    const record = await policyStore.stage({ profile, now: new Date(at), policy: { schemaVersion: "apn.allowlist-policy-file.v1", overlayVersion: "runtime-recovery", accounts: { evm: profile === op.profile ? CIRCLE_SOURCE_OWNER : route.gasPayer }, effectiveAt: new Date(at - 1).toISOString(), expiresAt: new Date(at + 3600000).toISOString(), admissions: [
      { chain: "eip155:42161", kind: "token", identifier: CIRCLE_SOURCE_TOKEN, rail: "bridge", maximumPerTransferAtomic: "40100", dailyLimitAtomic: "40100", mechanism: circleMechanism(143) },
      { chain: "eip155:42161", kind: "native", rail: "bridge", maximumPerTransferAtomic: "75000000000000", dailyLimitAtomic: "75000000000000", mechanism: circleMechanism(143) },
      { chain: "eip155:143", kind: "native", rail: "bridge", maximumPerTransferAtomic: route.destinationNativeCap, dailyLimitAtomic: route.destinationNativeCap, mechanism: circleMechanism(143) }] } });
    heads.set(profile, await policyStore.appendDecision(profile, null, { status: "active", revision: record.revision, stagedRecordDigest: record.recordDigest, policyDigest: record.registry.policyDigest, registry: record.registry, approvalFingerprint: hashObject(profile), decidedAt: new Date(at).toISOString() }));
  }
  const policies = await usage.withPolicyLocks([op.profile, op.destinationProfile], () => usage.policies(op));
  op = advanceCircle(sealCircle({ ...op, policies, transitions: [] }), {}, "prepared", at); await repo.save(op);
  const rows = await usage.withPolicyLocks([op.profile, op.destinationProfile], () => usage.reserve(op)); op = advanceCircle(op, { usage: rows }, "all_assets_reserved", at); await repo.save(op);
  op = advanceCircle(op, { effects: op.effects.map(e => e.role === "approval" ? { ...e, phase: "signing_started" } : e), state: "source_unknown" }, "approval_signing_fence", at); await repo.save(op);
  op = advanceCircle(op, { effects: op.effects.map(e => e.role === "approval" ? { ...e, phase: "sealed", transactionHash: oldHash, materialHash: "9".repeat(64) } : e) }, "approval_material_sealed", at); await repo.save(op);
  op = advanceCircle(op, { effects: op.effects.map(e => e.role === "approval" ? { ...e, phase: "unknown" } : e) }, "approval_fenced_unknown_observe_only", at); await repo.save(op);
  if (variant === "burn_attempt") op = advanceCircle(op, { effects: op.effects.map(e => e.role === "burn" ? { ...e, phase: "signing_started" } : e) }, "burn_signing_fence", at);
  const parent = op, parentBytes = canonicalJson(op), head = heads.get(op.profile)!;
  await policyStore.appendDecision(op.profile, head.entryDigest, { status: "active", revision: head.revision, stagedRecordDigest: head.stagedRecordDigest, policyDigest: head.policyDigest, registry: head.registry!, approvalFingerprint: hashObject("current-cleanup"), decidedAt: new Date(at).toISOString() });
  clock = at + 600001; await repo.save(op); let tty = 0, signs = 0, sends = 0, material: CircleMaterial | null = null;
  const service = new CircleEvmService(state, { load: async () => { throw Error("REAL_KEYS_FORBIDDEN"); } } as never, {}, () => clock);
  const internal = service as unknown as { custody: LocalCircleCustody; ports(op: CircleOperationV1, recovery?: boolean): CircleNonceRetirementPorts; preflightDeployments(): Promise<{ digest: string }> };
  t.mock.method(state, "loadWallet", async (h: string) => { const c = h === op.profileHash ? op.sourceCustody : op.destinationCustody; return { profile: h === op.profileHash ? op.profile : op.destinationProfile, profileHash: h, address: c.walletAddress, bindingHash: c.walletBindingHash, createdAt: c.walletCreatedAt } as never; });
  t.mock.method(state, "loadProviderProfile", async (h: string) => { const c = h === op.profileHash ? op.sourceCustody : op.destinationCustody; return { profile: h === op.profileHash ? op.profile : op.destinationProfile, profile_hash: h, provider_id: "local", public_address: c.walletAddress, account_binding_hash: c.walletBindingHash, capability_hash: c.providerCapabilityHash, revision: 1, drift: { state: "bound" } } as never; });
  await mkdir(join(root, "circle-v2-evm-effects"), { mode: 0o700 });
  await writeFile(join(root, "circle-v2-evm-effects", `${op.operationId}-approval.json`), canonicalJson({ schemaVersion: "apn.circle-v2-evm-effect-envelope.v1", operationId: op.operationId, role: "approval", fingerprint: op.fingerprint, envelopeHash: op.effects[0]!.envelope.envelopeHash, salt: "AA==", nonce: "AA==", ciphertext: "AA==", tag: "AA==" }) + "\n", { mode: 0o600 });
  t.mock.method(internal.custody, "seal", async (o: CircleOperationV1, e: CircleEffect, guard: () => void) => { guard(); signs++; material = { schemaVersion: "apn.circle-v2-evm-effect.v1", operationId: o.operationId, fingerprint: o.fingerprint, role: "cleanup", envelopeHash: e.envelope.envelopeHash, rawTransaction: raw, transactionHash: cleanupHash, materialHash: "c".repeat(64) }; return material; });
  t.mock.method(internal.custody, "load", async () => material);
  const originalPorts = internal.ports.bind(internal); t.mock.method(internal, "ports", (...args: [CircleOperationV1, boolean?]) => { const ports = originalPorts(...args); ports.approve = async () => { tty++; if (variant !== "finalized") throw Error("CANCELLED_TTY"); }; return ports; });
  const { envelopeHash: _oldEnvelopeHash, ...originalEnvelope } = op.effects[0]!.envelope;
  const cleanup = circleEnvelope({ ...originalEnvelope, data: encodeCircleApproval(true) });
  t.mock.method(internal, "preflightDeployments", async () => ({ digest: op.deploymentDigest }));
  t.mock.method(CircleRpc.prototype, "identity", async () => {});
  t.mock.method(CircleRpc.prototype, "account", async () => ({ latestNonceAtomic: "1", pendingNonceAtomic: "1", allowanceAtomic: "0" } as never));
  t.mock.method(CircleRpc.prototype, "envelope", async () => cleanup);
  t.mock.method(CircleRpc.prototype, "read", async () => 0n);
  t.mock.method(CircleRpc.prototype, "call", async (name: string, params: readonly unknown[], guard?: () => void) => { if (name === "eth_getTransactionCount") return params[1] === "latest" || params[1] === "pending" ? "0x1" : "0x2"; if (name === "eth_getBalance") return "0xffffffffffffffff"; if (name === "eth_estimateGas") return "0x10000"; if (name === "eth_call") return "0x01"; if (name === "eth_sendRawTransaction") { guard?.(); sends++; return cleanupHash; } throw Error(name); });
  const canonical = { ...observation(42161, CIRCLE_SOURCE_OWNER, CIRCLE_SOURCE_TOKEN, encodeCircleApproval(true), [event("Approval", CIRCLE_SOURCE_TOKEN, { owner: CIRCLE_SOURCE_OWNER, spender: CIRCLE_MESSENGER, value: 0n }, 0)]) };
  canonical.finalityTag = "finalized"; canonical.transaction = { ...(canonical.transaction as Record<string, unknown>), hash: cleanupHash, nonce: "0x1", gas: "0x10000", maxFeePerGas: "0x1312d00", maxPriorityFeePerGas: "0x0" };
  const receipt = canonical.receipt as { logs: Record<string, unknown>[] }; canonical.receipt = { ...receipt, transactionHash: cleanupHash, gasUsed: "0x10000", effectiveGasPrice: "0x1312d00", logs: receipt.logs.map(l => ({ ...l, transactionHash: cleanupHash })) };
  (canonical.canonicalBlock as Record<string, unknown>).transactions = [cleanupHash];
  t.mock.method(CircleRpc.prototype, "observation", async (_hash: string, tag: string) => { assert.equal(tag, "finalized"); return canonical; });
  t.mock.method(CircleRpc.prototype, "block", async () => ({ number: "0xa", hash: (canonical.finalityHead as Record<string, unknown>).hash }));
  if (variant === "burn_attempt") { await assert.rejects(service.cleanupNonce(op.operationId), /exact_expired/); assert.equal(await new CircleRetirementAuthorityStore(root).load(op), null); }
  else if (variant === "finalized") {
    const done = await service.cleanupNonce(op.operationId); assert.equal(done.state, "nonce_retired"); validateCircle(done);
    assert.deepEqual(done.transitions.slice(0, parent.transitions.length), parent.transitions); assert.deepEqual(done.effects.slice(0, 2), parent.effects); assert.deepEqual(done.policies, parent.policies);
    assert.deepEqual(done.usage.map(r => r.consumedAtomic), ["0", "0", "0", "1310720000000", "0"]); assert.equal(signs, 1); assert.equal(sends, 1); await service.observe(op.operationId); assert.equal(signs, 1); assert.equal(sends, 1);
  } else {
    await assert.rejects(service.cleanupNonce(op.operationId), /CANCELLED_TTY/); assert.equal(tty, 1);
    const saved = (await repo.load(op.operationId))!; validateCircle(saved); assert.equal(saved.transitions.length, parent.transitions.length + 1); assert.deepEqual(saved.transitions.slice(0, parent.transitions.length), parent.transitions); assert.equal(saved.effects[2]!.phase, "prepared");
    await service.observe(op.operationId); assert.equal(tty, 1);
    if (variant === "changed_again") { const h = (await policyStore.read(op.profile)).entries.at(-1)!; await policyStore.appendDecision(op.profile, h.entryDigest, { status: "active", revision: h.revision, stagedRecordDigest: h.stagedRecordDigest, policyDigest: h.policyDigest, registry: h.registry!, approvalFingerprint: hashObject("again"), decidedAt: new Date(clock).toISOString() }); await assert.rejects(service.cleanupNonce(op.operationId), /owner_policy_changed/); }
    for (const row of rows) assert.equal((await new AssetUsageLedger(root).load(row, row.reservationId))!.reservationDigest, row.reservationDigest);
  }
  assert.equal(canonicalJson(parent), parentBytes); if (variant !== "finalized") { assert.equal(signs, 0); assert.equal(sends, 0); }
  if (variant !== "burn_attempt") await assert.rejects(new CircleNonceRetirementStore(root).assertOriginalEffectsAvailable(op.operationId), /permanently_retired/);
});
