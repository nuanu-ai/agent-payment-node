import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, realpath, rm, mkdir, writeFile, readFile } from "node:fs/promises";
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
import { verifyCircleApproval } from "../../src/circle-v2-evm/protocol.js";
import { SEALED_BURN_OPERATION, SEALED_BURN_HASH, SEALED_BURN_MATERIAL, sealedBurnReplacement, assertSealedBurnRetirement, assertSealedBurnReplacement } from "../../src/circle-v2-evm/burn-retirement.js";
import { initial, at } from "./circle-v2-evm-nonce-runtime-fixtures.js";
const raw = "0x02" as Hex, cleanupHash = keccak256(raw), oldHash = "0x26c833d2146ab758511354ff773fa7f0aece6de36bf433a022cc2ef6c74ae39a" as Hex;
for (const variant of ["cancelled", "finalized", "pending", "included", "lost_reply", "changed_again", "burn_race", "principal_changed", "fee_cap", "tty_expired", "after_sign_expired", "tls_expired", "policy_expired", "missing_native", "unrelated_conflict", "approval_reorg", "cleanup_reorg", "final_principal_changed", "final_nonce_changed", "original_burn_submission_fence", "original_burn_submitted_once"] as const) test(`sealed burn full production cleanupNonce ${variant}: real prepare, journal and ledger`, async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "circle-runtime-retirement-"))); t.after(() => rm(root, { recursive: true, force: true }));
  const state = new StateStore(root), policyStore = new AllowlistPolicyStore(root), repo = new CircleRepository(root); let clock = at;
  const usage = new CircleUsage(state, () => clock), route = circleRoute(1329, "evm-live-seller"); let op = initial(root, 1329, "evm-live-seller");
  op = sealCircle({ ...op, operationId: SEALED_BURN_OPERATION, transitions: [], effects: op.effects.map(e => { const { envelopeHash: _hash, ...body } = e.envelope; return { ...e, envelope: circleEnvelope({ ...body, nonceAtomic: e.role === "approval" ? "83" : "84", gasLimitAtomic: e.role === "burn" ? "600000" : body.gasLimitAtomic, maxFeePerGasAtomic: "40000000" }) }; }) });
  const approvalObservation = { ...observation(42161, CIRCLE_SOURCE_OWNER, CIRCLE_SOURCE_TOKEN, encodeCircleApproval(), [event("Approval", CIRCLE_SOURCE_TOKEN, { owner: CIRCLE_SOURCE_OWNER, spender: CIRCLE_MESSENGER, value: 40100n }, 0)]) };
  approvalObservation.transaction = { ...(approvalObservation.transaction as Record<string, unknown>), hash: oldHash, nonce: "0x53", gas: "0x10000", maxFeePerGas: "0x2625a00", maxPriorityFeePerGas: "0x0" };
  const aReceipt = approvalObservation.receipt as { logs: Record<string, unknown>[] }; approvalObservation.receipt = { ...aReceipt, transactionHash: oldHash, gasUsed: "0x823c", effectiveGasPrice: "0x1ff2cf0", logs: aReceipt.logs.map(l => ({ ...l, transactionHash: oldHash })) };
  (approvalObservation.canonicalBlock as Record<string, unknown>).transactions = [oldHash];
  const approvalProof = verifyCircleApproval(approvalObservation, false, "40100");
  const heads = new Map<string, Awaited<ReturnType<AllowlistPolicyStore["appendDecision"]>>>();
  for (const profile of [op.profile, op.destinationProfile]) {
    const record = await policyStore.stage({ profile, now: new Date(at), policy: { schemaVersion: "apn.allowlist-policy-file.v1", overlayVersion: "runtime-recovery", accounts: { evm: profile === op.profile ? CIRCLE_SOURCE_OWNER : route.gasPayer }, effectiveAt: new Date(at - 1).toISOString(), expiresAt: new Date(at + 3600000).toISOString(), admissions: [
      { chain: "eip155:42161", kind: "token", identifier: CIRCLE_SOURCE_TOKEN, rail: "bridge", maximumPerTransferAtomic: "40100", dailyLimitAtomic: "40100", mechanism: circleMechanism(1329) },
      { chain: "eip155:42161", kind: "native", rail: "bridge", maximumPerTransferAtomic: "75000000000000", dailyLimitAtomic: "75000000000000", mechanism: circleMechanism(1329) },
      { chain: "eip155:1329", kind: "native", rail: "bridge", maximumPerTransferAtomic: route.destinationNativeCap, dailyLimitAtomic: route.destinationNativeCap, mechanism: circleMechanism(1329) }] } });
    heads.set(profile, await policyStore.appendDecision(profile, null, { status: "active", revision: record.revision, stagedRecordDigest: record.recordDigest, policyDigest: record.registry.policyDigest, registry: record.registry, approvalFingerprint: hashObject(profile), decidedAt: new Date(at).toISOString() }));
  }
  const policies = await usage.withPolicyLocks([op.profile, op.destinationProfile], () => usage.policies(op));
  op = advanceCircle(sealCircle({ ...op, policies, transitions: [] }), {}, "prepared", at); await repo.save(op);
  const rows = await usage.withPolicyLocks([op.profile, op.destinationProfile], () => usage.reserve(op)); op = advanceCircle(op, { usage: rows }, "all_assets_reserved", at); await repo.save(op);
  op = advanceCircle(op, { effects: op.effects.map(e => e.role === "approval" ? { ...e, phase: "signing_started" } : e), state: "source_unknown" }, "approval_signing_fence", at); await repo.save(op);
  op = advanceCircle(op, { effects: op.effects.map(e => e.role === "approval" ? { ...e, phase: "sealed", transactionHash: oldHash, materialHash: "737a7562b8152338cbeb7319e2c2e3a69985ea5b9fc7a16d090b86b12135f100" } : e) }, "approval_material_sealed", at); await repo.save(op);
  op = advanceCircle(op, { effects: op.effects.map(e => e.role === "approval" ? { ...e, phase: "submission_started" } : e) }, "approval_submission_fence", at); await repo.save(op);
  op = advanceCircle(op, { effects: op.effects.map(e => e.role === "approval" ? { ...e, phase: "confirmed", proof: approvalProof } : e), residualAllowanceAtomic: "40100" }, "approval_canonical_receipt", at); await repo.save(op);
  op = advanceCircle(op, { effects: op.effects.map(e => e.role === "burn" ? { ...e, phase: "signing_started" } : e) }, "burn_signing_fence", at); await repo.save(op);
  op = advanceCircle(op, { effects: op.effects.map(e => e.role === "burn" ? { ...e, phase: "sealed", transactionHash: SEALED_BURN_HASH as Hex, materialHash: SEALED_BURN_MATERIAL } : e) }, "burn_material_sealed", at); await repo.save(op);
  if (variant === "original_burn_submission_fence" || variant === "original_burn_submitted_once") {
    op = advanceCircle(op, { effects: op.effects.map(e => e.role === "burn" ? { ...e, phase: "submission_started" } : e) }, "burn_submission_fence", at); await repo.save(op);
    if (variant === "original_burn_submitted_once") { op = advanceCircle(op, { effects: op.effects.map(e => e.role === "burn" ? { ...e, phase: "submitted" } : e) }, "burn_submitted_once", at); await repo.save(op); }
  }
  op = advanceCircle(op, { effects: op.effects.map(e => e.role === "burn" ? { ...e, phase: "unknown" } : e) }, "burn_fenced_unknown_observe_only", at); await repo.save(op);
  if (variant === "cancelled") {
    for (const patch of [{ destinationChain: 143 as const }, { destinationProfile: "default" }, { effects: op.effects.map(e => e.role === "burn" ? { ...e, materialHash: "a".repeat(64) } : e) }, { effects: op.effects.map(e => e.role === "burn" ? { ...e, phase: "sealed" as const } : e) }]) assert.throws(() => assertSealedBurnRetirement(advanceCircle(op, patch, "negative", at)), /exact_sealed/);
    for (const key of ["from", "to"] as const) { const e = op.effects[1]!, { envelopeHash: _hash, ...body } = e.envelope; assert.throws(() => validateCircle(advanceCircle(op, { effects: op.effects.map(x => x.role === "burn" ? { ...x, envelope: circleEnvelope({ ...body, [key]: "0x0000000000000000000000000000000000000001" }) } : x) }, "negative", at)), /envelope_binding/); }
    const { envelopeHash: _hash, ...body } = op.effects[0]!.envelope, replacement = sealedBurnReplacement(op, circleEnvelope({ ...body, nonceAtomic: "84", data: encodeCircleApproval(true) }), 1n);
    assert.throws(() => assertSealedBurnReplacement(op, { ...replacement, maxFeePerGasAtomic: "49999999" }), /replacement_fee/); assert.throws(() => assertSealedBurnReplacement(op, { ...replacement, maxPriorityFeePerGasAtomic: "0" }), /replacement_fee/);
  }
  const parent = op, parentBytes = canonicalJson(op), head = heads.get(op.profile)!;
  await policyStore.appendDecision(op.profile, head.entryDigest, { status: "active", revision: head.revision, stagedRecordDigest: head.stagedRecordDigest, policyDigest: head.policyDigest, registry: head.registry!, approvalFingerprint: hashObject("current-cleanup"), decidedAt: new Date(at).toISOString() });
  clock = variant === "policy_expired" ? at + 3600001 : at + 600001; await repo.save(op);
  if (variant === "missing_native") {
    const record = await policyStore.stage({ profile: op.profile, expectedRevision: 1, now: new Date(clock), policy: { schemaVersion: "apn.allowlist-policy-file.v1", overlayVersion: "missing-native", accounts: { evm: CIRCLE_SOURCE_OWNER }, effectiveAt: new Date(at).toISOString(), expiresAt: new Date(at + 3600000).toISOString(), admissions: [{ chain: "eip155:42161", kind: "token", identifier: CIRCLE_SOURCE_TOKEN, rail: "bridge", maximumPerTransferAtomic: "40100", dailyLimitAtomic: "40100", mechanism: circleMechanism(1329) }] } });
    const head = (await policyStore.read(op.profile)).entries.at(-1)!;
    await policyStore.appendDecision(op.profile, head.entryDigest, { status: "active", revision: record.revision, stagedRecordDigest: record.recordDigest, policyDigest: record.registry.policyDigest, registry: record.registry, approvalFingerprint: hashObject("missing"), decidedAt: new Date(clock).toISOString() });
  }
  if (variant === "unrelated_conflict") {
    const other = initial(root, 1329, "evm-live-seller"); await repo.save(advanceCircle(sealCircle({ ...other, operationId: "2".repeat(64), policies, transitions: [] }), {}, "prepared", at));
  } let tty = 0, signs = 0, sends = 0, material: CircleMaterial | null = null;
  const service = new CircleEvmService(state, { load: async () => { throw Error("REAL_KEYS_FORBIDDEN"); } } as never, {}, () => clock);
  const internal = service as unknown as { custody: LocalCircleCustody; ports(op: CircleOperationV1, recovery?: boolean): CircleNonceRetirementPorts; preflightDeployments(): Promise<{ digest: string }> };
  t.mock.method(state, "loadWallet", async (h: string) => { const c = h === op.profileHash ? op.sourceCustody : op.destinationCustody; return { profile: h === op.profileHash ? op.profile : op.destinationProfile, profileHash: h, address: c.walletAddress, bindingHash: c.walletBindingHash, createdAt: c.walletCreatedAt } as never; });
  t.mock.method(state, "loadProviderProfile", async (h: string) => { const c = h === op.profileHash ? op.sourceCustody : op.destinationCustody; return { profile: h === op.profileHash ? op.profile : op.destinationProfile, profile_hash: h, provider_id: "local", public_address: c.walletAddress, account_binding_hash: c.walletBindingHash, capability_hash: c.providerCapabilityHash, revision: 1, drift: { state: "bound" } } as never; });
  await mkdir(join(root, "circle-v2-evm-effects"), { mode: 0o700 });
  await writeFile(join(root, "circle-v2-evm-effects", `${op.operationId}-approval.json`), canonicalJson({ schemaVersion: "apn.circle-v2-evm-effect-envelope.v1", operationId: op.operationId, role: "approval", fingerprint: op.fingerprint, envelopeHash: op.effects[0]!.envelope.envelopeHash, salt: "AA==", nonce: "AA==", ciphertext: "AA==", tag: "AA==" }) + "\n", { mode: 0o600 });
  await writeFile(join(root, "circle-v2-evm-effects", `${op.operationId}-burn.json`), canonicalJson({ schemaVersion: "apn.circle-v2-evm-effect-envelope.v1", operationId: op.operationId, role: "burn", fingerprint: op.fingerprint, envelopeHash: op.effects[1]!.envelope.envelopeHash, salt: "AA==", nonce: "AA==", ciphertext: "AA==", tag: "AA==" }) + "\n", { mode: 0o600 });
  t.mock.method(internal.custody, "seal", async (o: CircleOperationV1, e: CircleEffect, guard: () => void) => { guard(); assert.equal(e.role, "cleanup"); assert.equal(await new CircleNonceRetirementStore(root).hasClaim(o, "sign"), true); await assert.rejects(new CircleNonceRetirementStore(root).assertOriginalEffectsAvailable(o.operationId), /permanently_retired/); signs++; if (variant === "after_sign_expired") clock += 60001; material = { schemaVersion: "apn.circle-v2-evm-effect.v1", operationId: o.operationId, fingerprint: o.fingerprint, role: "cleanup", envelopeHash: e.envelope.envelopeHash, rawTransaction: raw, transactionHash: cleanupHash, materialHash: "c".repeat(64) }; return material; });
  t.mock.method(internal.custody, "load", async () => material);
  const originalPorts = internal.ports.bind(internal); t.mock.method(internal, "ports", (...args: [CircleOperationV1, boolean?]) => { const ports = originalPorts(...args); ports.approve = async () => { tty++; if (["cancelled", "changed_again"].includes(variant)) throw Error("CANCELLED_TTY"); if (variant === "tty_expired") clock += 60001; }; return ports; });
  const { envelopeHash: _oldEnvelopeHash, ...originalEnvelope } = op.effects[0]!.envelope;
  const quoted = circleEnvelope({ ...originalEnvelope, nonceAtomic: "84", data: encodeCircleApproval(true) });
  const cleanup = variant === "original_burn_submission_fence" || variant === "original_burn_submitted_once" ? circleEnvelope({ ...originalEnvelope, nonceAtomic: "84", data: encodeCircleApproval(true), maxFeePerGasAtomic: "50000000", maxPriorityFeePerGasAtomic: "1" }) : sealedBurnReplacement(op, quoted, 1n);
  t.mock.method(internal, "preflightDeployments", async () => ({ digest: op.deploymentDigest }));
  t.mock.method(CircleRpc.prototype, "identity", async () => {});
  t.mock.method(CircleRpc.prototype, "account", async () => ({ latestNonceAtomic: "84", pendingNonceAtomic: variant === "pending" ? "85" : "84", allowanceAtomic: "40100", nativeBalanceAtomic: "99999999999999" } as never));
  t.mock.method(CircleRpc.prototype, "envelope", async () => variant === "fee_cap" ? circleEnvelope({ ...originalEnvelope, nonceAtomic: "84", data: encodeCircleApproval(true), maxFeePerGasAtomic: "99999999999" }) : quoted);
  t.mock.method(CircleRpc.prototype, "read", async (_to: string, name: string, _args: readonly unknown[], tag = "latest") => name === "balanceOf" ? ((variant === "principal_changed" && tag === "latest") || (variant === "final_principal_changed" && sends > 0) ? 99999n : 100000n) : tag === "0xa" ? 40100n : sends > 0 ? 0n : 40100n);
  t.mock.method(CircleRpc.prototype, "call", async (name: string, params: readonly unknown[], guard?: () => void) => {
    if (name === "eth_getTransactionCount") return params[1] === "latest" || params[1] === "pending" ? (sends > 0 ? "0x55" : variant === "pending" && params[1] === "pending" ? "0x55" : "0x54") : variant === "final_nonce_changed" ? "0x56" : "0x55";
    if (name === "eth_getTransactionReceipt") return variant === "burn_race" ? {} : null;
    if (name === "eth_getTransactionByHash") return { hash: SEALED_BURN_HASH, ...op.effects[1]!.envelope, from: CIRCLE_SOURCE_OWNER, to: CIRCLE_MESSENGER, input: op.effects[1]!.envelope.data, nonce: "0x54", gas: "0x927c0", maxFeePerGas: "0x2625a00", maxPriorityFeePerGas: "0x0", value: "0x0", chainId: "0xa4b1", blockHash: null, blockNumber: null };
    if (name === "eth_maxPriorityFeePerGas") return "0x1"; if (name === "eth_getBalance") return "0xffffffffffffffff";
    if (name === "eth_estimateGas") return "0x10000"; if (name === "eth_call") return "0x01";
    if (name === "eth_sendRawTransaction") { assert.equal(params[0], raw); assert.equal(await new CircleNonceRetirementStore(root).hasClaim((await repo.load(op.operationId))!, "send"), true); if (variant === "tls_expired") clock += 60001; guard?.(); sends++; if (variant === "lost_reply") throw Error("LOST_REPLY"); return cleanupHash; } throw Error(name);
  });
  const canonical = { ...observation(42161, CIRCLE_SOURCE_OWNER, CIRCLE_SOURCE_TOKEN, encodeCircleApproval(true), [event("Approval", CIRCLE_SOURCE_TOKEN, { owner: CIRCLE_SOURCE_OWNER, spender: CIRCLE_MESSENGER, value: 0n }, 0)]) };
  canonical.finalityTag = "finalized"; canonical.transaction = { ...(canonical.transaction as Record<string, unknown>), hash: cleanupHash, nonce: "0x54", gas: "0x10000", maxFeePerGas: "0x2faf080", maxPriorityFeePerGas: "0x1", blockNumber: "0xb" };
  const receipt = canonical.receipt as { logs: Record<string, unknown>[] }; canonical.receipt = { ...receipt, transactionHash: cleanupHash, blockNumber: "0xb", gasUsed: "0x10000", effectiveGasPrice: "0x1312d00", logs: receipt.logs.map(l => ({ ...l, transactionHash: cleanupHash, blockNumber: "0xb" })) };
  (canonical.canonicalBlock as Record<string, unknown>).transactions = [cleanupHash];
  for (const b of [canonical.canonicalBlock, canonical.recheckedBlock, canonical.finalityHead]) (b as Record<string, unknown>).number = "0xb";
  let cleanupReads = 0;
  t.mock.method(CircleRpc.prototype, "observation", async (hash: string, tag: string) => { assert.equal(tag, "finalized"); if (hash === oldHash) return { ...approvalObservation, finalityTag: "finalized", receipt: variant === "approval_reorg" ? { ...(approvalObservation.receipt as object), effectiveGasPrice: "0x1ff2cf1" } : approvalObservation.receipt }; if (variant === "cleanup_reorg" && ++cleanupReads > 1) return { ...canonical, receipt: { ...(canonical.receipt as object), effectiveGasPrice: "0x1312d01" } }; return ["included", "lost_reply", "after_sign_expired", "tls_expired"].includes(variant) ? null : canonical; });
  t.mock.method(CircleRpc.prototype, "block", async (tag: string) => ({ number: tag === "0xa" ? "0xa" : "0xb", hash: (canonical.finalityHead as Record<string, unknown>).hash, baseFeePerGas: "0x1312d00" }));
  if (variant === "original_burn_submission_fence" || variant === "original_burn_submitted_once") {
    await assert.rejects(service.cleanupNonce(op.operationId), /exact_sealed_sei_burn_retirement_required/); assert.equal(tty, 0); assert.equal(signs, 0); assert.equal(sends, 0);
    assert.equal((await repo.load(op.operationId))!.integrityHash, parent.integrityHash); assert.equal(await new CircleRetirementAuthorityStore(root).load(op), null);
    const store = new CircleNonceRetirementStore(root); assert.equal(await store.intent(op), null); assert.equal(await store.hasClaim(op, "sign"), false); assert.equal(await store.hasClaim(op, "send"), false);
    for (const row of rows) assert.equal((await new AssetUsageLedger(root).load(row, row.reservationId))!.reservationDigest, row.reservationDigest);
  } else if (["burn_race", "principal_changed", "fee_cap", "policy_expired", "missing_native", "unrelated_conflict", "approval_reorg"].includes(variant)) {
    await assert.rejects(service.cleanupNonce(op.operationId), /retirement_original_burn_receipt_present|retirement_source_principal_changed|envelope_fee_cap|active_owner_asset_policy_required|exact_circle_mechanism_admission_required|Another|conflict|retirement_original_approval_reorg|policy has expired|asset is not listed/); assert.equal(tty, 0);
  } else if (["finalized", "pending"].includes(variant)) {
    const done = await service.cleanupNonce(op.operationId); assert.equal(done.state, "nonce_retired"); validateCircle(done);
    assert.deepEqual(done.transitions.slice(0, parent.transitions.length), parent.transitions); assert.deepEqual(done.effects.slice(0, 2), parent.effects); assert.deepEqual(done.policies, parent.policies);
    assert.deepEqual(done.usage.map(r => r.consumedAtomic), ["0", "1116903336000", "0", "1310720000000", "0"]); assert.equal(signs, 1); assert.equal(sends, 1);
    await service.observe(op.operationId); assert.equal(signs, 1); assert.equal(sends, 1);
    for (const row of done.usage) assert.equal((await new AssetUsageLedger(root).load(row, row.reservationId))!.consumedAtomic, row.consumedAtomic);
  } else if (["cleanup_reorg", "final_principal_changed", "final_nonce_changed"].includes(variant)) {
    await assert.rejects(service.cleanupNonce(op.operationId), /retirement_cleanup_reorg|retirement_source_principal_changed|retirement_finalized_principal_or_nonce_changed/);
    assert.equal(signs, 1); assert.equal(sends, 1); for (const row of rows) assert.equal((await new AssetUsageLedger(root).load(row, row.reservationId))!.state, "unknown_finality");
  } else if (["included", "lost_reply", "tty_expired", "after_sign_expired", "tls_expired"].includes(variant)) {
    if (variant === "tty_expired") await assert.rejects(service.cleanupNonce(op.operationId), /consent/);
    else { const saved = await service.cleanupNonce(op.operationId); assert.equal(saved.terminal, false); await service.observe(op.operationId); assert.equal(signs, 1); assert.equal(sends, ["after_sign_expired", "tls_expired"].includes(variant) ? 0 : 1);
      if (["included", "lost_reply"].includes(variant)) { const beforeSign = await readFile(join(root, "circle-v2-nonce-retirements", `${op.operationId}-sign.json`), "utf8"), beforeSend = await readFile(join(root, "circle-v2-nonce-retirements", `${op.operationId}-send.json`), "utf8"); await writeFile(join(root, "circle-v2-evm", `${op.operationId}.json`), parentBytes + "\n", { mode: 0o600 }); await service.cleanupNonce(op.operationId); assert.equal(signs, 1); assert.equal(sends, 1); assert.equal(await readFile(join(root, "circle-v2-nonce-retirements", `${op.operationId}-sign.json`), "utf8"), beforeSign); assert.equal(await readFile(join(root, "circle-v2-nonce-retirements", `${op.operationId}-send.json`), "utf8"), beforeSend); } }
    for (const row of rows) assert.ok(!["failed_confirmed_revert", "finalized"].includes((await new AssetUsageLedger(root).load(row, row.reservationId))!.state));
  } else {
    await assert.rejects(service.cleanupNonce(op.operationId), /CANCELLED_TTY/); assert.equal(tty, 1);
    const saved = (await repo.load(op.operationId))!; validateCircle(saved); assert.deepEqual(saved.transitions.slice(0, parent.transitions.length), parent.transitions); assert.equal(saved.effects[2]!.phase, "prepared");
    await service.observe(op.operationId); assert.equal(tty, 1);
    if (variant === "changed_again") { const h = (await policyStore.read(op.profile)).entries.at(-1)!; await policyStore.appendDecision(op.profile, h.entryDigest, { status: "active", revision: h.revision, stagedRecordDigest: h.stagedRecordDigest, policyDigest: h.policyDigest, registry: h.registry!, approvalFingerprint: hashObject("again"), decidedAt: new Date(clock).toISOString() }); await assert.rejects(service.cleanupNonce(op.operationId), /owner_policy_changed/); }
    for (const row of rows) assert.equal((await new AssetUsageLedger(root).load(row, row.reservationId))!.reservationDigest, row.reservationDigest);
  }
  assert.equal(canonicalJson(parent), parentBytes); if (!["finalized", "pending", "included", "lost_reply", "after_sign_expired", "tls_expired", "cleanup_reorg", "final_principal_changed", "final_nonce_changed"].includes(variant)) { assert.equal(signs, 0); assert.equal(sends, 0); }
  if (!["burn_race", "principal_changed", "fee_cap", "policy_expired", "missing_native", "unrelated_conflict", "approval_reorg", "original_burn_submission_fence", "original_burn_submitted_once"].includes(variant)) await assert.rejects(new CircleNonceRetirementStore(root).assertOriginalEffectsAvailable(op.operationId), /permanently_retired/);
});
