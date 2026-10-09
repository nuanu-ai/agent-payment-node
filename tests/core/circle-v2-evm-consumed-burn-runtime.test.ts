import { approvalObservationFixture, savedApprovalProof, officialApprovalTransaction } from "./circle-v2-evm-approval-public-fixture.js";
import { OperationService } from "../../src/operation-service.js";
import { consumerTransaction, consumerReceipt } from "./circle-v2-evm-consumed-public-fixture.js";
import { CONSUMER_HASH, CONSUMER_BLOCK_HASH, verifyConsumedNonce } from "../../src/circle-v2-evm/consumed-burn-rpc.js";
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
for (const variant of ["cancelled", "restored_zero_evidence", "finalized", "included", "lost_reply", "changed_again", "burn_race", "principal_changed", "fee_cap", "tty_expired", "after_sign_expired", "tls_expired", "policy_expired", "missing_native", "unrelated_conflict", "approval_reorg", "cleanup_reorg", "final_principal_changed", "final_nonce_changed", "original_burn_submission_fence", "original_burn_submitted_once", "consumer_missing", "consumer_included", "consumer_wrong_nonce", "consumer_wrong_sender", "consumer_wrong_chain", "consumer_wrong_input", "consumer_token_log", "consumer_auth", "consumer_wrong_membership", "consumer_wrong_index", "consumer_zero_head", "consumer_old_time", "consumer_current_zero_head", "consumer_reorg", "consumer_reanchor", "archive_missing", "nonce_drift", "approval_timestamp_present", "approval_timestamp_wrong", "approval_timestamp_null", "approval_timestamp_empty", "approval_timestamp_type", "approval_header_both_wrong", "approval_header_zero", "approval_header_time", "approval_header_number", "approval_header_membership", "approval_field_drift", "approval_quantity"] as const) test(`consumed burn full production cleanupNonce ${variant}: real prepare, journal and ledger`, async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "circle-runtime-retirement-"))); t.after(() => rm(root, { recursive: true, force: true }));
  const state = new StateStore(root), policyStore = new AllowlistPolicyStore(root), repo = new CircleRepository(root); let clock = at;
  const usage = new CircleUsage(state, () => clock), route = circleRoute(1329, "evm-live-seller"); let op = initial(root, 1329, "evm-live-seller");
  op = sealCircle({ ...op, operationId: SEALED_BURN_OPERATION, transitions: [], effects: op.effects.map(e => { const { envelopeHash: _hash, ...body } = e.envelope; return { ...e, envelope: circleEnvelope({ ...body, nonceAtomic: e.role === "approval" ? "83" : "84", gasLimitAtomic: e.role === "approval" ? "68201" : "600000", maxFeePerGasAtomic: e.role === "approval" ? "40300000" : "40040000" }) }; }) });
  const approvalObservation = structuredClone(approvalObservationFixture);
  const approvalProof = savedApprovalProof as unknown as ReturnType<typeof verifyCircleApproval>;
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
  let rows = await usage.withPolicyLocks([op.profile, op.destinationProfile], () => usage.reserve(op)); op = advanceCircle(op, { usage: rows }, "all_assets_reserved", at); await repo.save(op);
  rows = await usage.withPolicyLocks([op.profile, op.destinationProfile], () => usage.follow(op, "unknown_finality"));
  op = advanceCircle(op, { usage: rows, effects: op.effects.map(e => e.role === "approval" ? { ...e, phase: "signing_started" } : e), state: "source_unknown" }, "approval_signing_fence", at); await repo.save(op);
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
  } let tty = 0, signs = 0, sends = 0, materialLoads = 0, material: CircleMaterial | null = null;
  const service = new CircleEvmService(state, { load: async () => { throw Error("REAL_KEYS_FORBIDDEN"); } } as never, {}, () => clock);
  const internal = service as unknown as { custody: LocalCircleCustody; ports(op: CircleOperationV1, recovery?: boolean): CircleNonceRetirementPorts; preflightDeployments(): Promise<{ digest: string }> };
  t.mock.method(state, "loadWallet", async (h: string) => { const c = h === op.profileHash ? op.sourceCustody : op.destinationCustody; return { profile: h === op.profileHash ? op.profile : op.destinationProfile, profileHash: h, address: c.walletAddress, bindingHash: c.walletBindingHash, createdAt: c.walletCreatedAt } as never; });
  t.mock.method(state, "loadProviderProfile", async (h: string) => { const c = h === op.profileHash ? op.sourceCustody : op.destinationCustody; return { profile: h === op.profileHash ? op.profile : op.destinationProfile, profile_hash: h, provider_id: "local", public_address: c.walletAddress, account_binding_hash: c.walletBindingHash, capability_hash: c.providerCapabilityHash, revision: 1, drift: { state: "bound" } } as never; });
  await mkdir(join(root, "circle-v2-evm-effects"), { mode: 0o700 });
  await writeFile(join(root, "circle-v2-evm-effects", `${op.operationId}-approval.json`), canonicalJson({ schemaVersion: "apn.circle-v2-evm-effect-envelope.v1", operationId: op.operationId, role: "approval", fingerprint: op.fingerprint, envelopeHash: op.effects[0]!.envelope.envelopeHash, salt: "AA==", nonce: "AA==", ciphertext: "AA==", tag: "AA==" }) + "\n", { mode: 0o600 });
  await writeFile(join(root, "circle-v2-evm-effects", `${op.operationId}-burn.json`), canonicalJson({ schemaVersion: "apn.circle-v2-evm-effect-envelope.v1", operationId: op.operationId, role: "burn", fingerprint: op.fingerprint, envelopeHash: op.effects[1]!.envelope.envelopeHash, salt: "AA==", nonce: "AA==", ciphertext: "AA==", tag: "AA==" }) + "\n", { mode: 0o600 });
  t.mock.method(internal.custody, "seal", async (o: CircleOperationV1, e: CircleEffect, guard: () => void) => { guard(); assert.equal(e.role, "cleanup"); assert.equal(await new CircleNonceRetirementStore(root).hasClaim(o, "sign"), true); await assert.rejects(new CircleNonceRetirementStore(root).assertOriginalEffectsAvailable(o.operationId), /permanently_retired/); signs++; if (variant === "after_sign_expired") clock += 60001; material = { schemaVersion: "apn.circle-v2-evm-effect.v1", operationId: o.operationId, fingerprint: o.fingerprint, role: "cleanup", envelopeHash: e.envelope.envelopeHash, rawTransaction: raw, transactionHash: cleanupHash, materialHash: "c".repeat(64) }; return material; });
  t.mock.method(internal.custody, "load", async () => { materialLoads++; return material; });
  const originalPorts = internal.ports.bind(internal); t.mock.method(internal, "ports", (...args: [CircleOperationV1, boolean?]) => { const ports = originalPorts(...args); ports.approve = async () => { tty++; if (["cancelled", "changed_again", "restored_zero_evidence"].includes(variant)) throw Error("CANCELLED_TTY"); if (variant === "tty_expired") clock += 60001; }; return ports; });
  const { envelopeHash: _oldEnvelopeHash, ...originalEnvelope } = op.effects[0]!.envelope;
  const quoted = circleEnvelope({ ...originalEnvelope, nonceAtomic: "85", data: encodeCircleApproval(true) });
  t.mock.method(internal, "preflightDeployments", async () => ({ digest: op.deploymentDigest }));
  const originalRpcCall = CircleRpc.prototype.call, originalRpcBlock = CircleRpc.prototype.block, originalRpcIdentity = CircleRpc.prototype.identity;
  t.mock.method(CircleRpc.prototype, "identity", async () => {});
  t.mock.method(CircleRpc.prototype, "account", async () => ({ latestNonceAtomic: "85", pendingNonceAtomic: "85", usdcBalanceAtomic: "97924", allowanceAtomic: "40100", nativeBalanceAtomic: "99999999999999" } as never));
  t.mock.method(CircleRpc.prototype, "envelope", async () => variant === "fee_cap" ? circleEnvelope({ ...originalEnvelope, nonceAtomic: "85", data: encodeCircleApproval(true), maxFeePerGasAtomic: "99999999999" }) : quoted);
  t.mock.method(CircleRpc.prototype, "read", async (_to: string, name: string, _args: readonly unknown[], tag = "latest") => { if (variant === "archive_missing" && tag === "0x1e95e873") throw Error("ARCHIVE_REQUIRED"); return name === "balanceOf" ? ((variant === "principal_changed" && tag === "latest") || (variant === "final_principal_changed" && sends > 0 && tag !== "0x1e95e873") ? 99999n : 97924n) : tag === "0x1e95e873" ? 40100n : sends > 0 ? 0n : 40100n; });
  const realObservation = CircleRpc.prototype.observation;
  let approvalBlockReads = 0;
  function approvalTransaction() {
      const transaction: Record<string, unknown> = structuredClone(approvalObservation.transaction);
      if (variant === "approval_timestamp_present") return structuredClone(officialApprovalTransaction);
      if (variant === "approval_timestamp_wrong") transaction.blockTimestamp = "0x6ac8a32a";
      if (variant === "approval_timestamp_null") transaction.blockTimestamp = null;
      if (variant === "approval_timestamp_empty") transaction.blockTimestamp = "";
      if (variant === "approval_timestamp_type") transaction.blockTimestamp = 1791533865;
      if (variant === "approval_field_drift") transaction.gasPrice = "0x1ff2cf1";
      if (variant === "approval_quantity") transaction.transactionIndex = "0x00";
      return transaction;
  }
  t.mock.method(CircleRpc.prototype, "call", async (name: string, params: readonly unknown[], guard?: () => void) => {
    if (name === "eth_getTransactionCount" && variant === "nonce_drift") return "0x56";
    if (name === "eth_getTransactionCount") return params[1] === "latest" || params[1] === "pending" ? (sends > 0 ? "0x56" : "0x55") : variant === "final_nonce_changed" && sends > 0 ? "0x57" : sends > 0 ? "0x56" : "0x55";
    if (name === "eth_getTransactionReceipt") return variant === "burn_race" ? {} : null;
    if (name === "eth_getTransactionByHash") return { hash: SEALED_BURN_HASH, ...op.effects[1]!.envelope, from: CIRCLE_SOURCE_OWNER, to: CIRCLE_MESSENGER, input: op.effects[1]!.envelope.data, nonce: "0x54", gas: "0x927c0", maxFeePerGas: "0x2625a00", maxPriorityFeePerGas: "0x0", value: "0x0", chainId: "0xa4b1", blockHash: null, blockNumber: null };
    if (name === "eth_maxPriorityFeePerGas") return "0x1"; if (name === "eth_getBalance") return "0xffffffffffffffff";
    if (name === "eth_estimateGas") return "0x10000"; if (name === "eth_call") return "0x01";
    if (name === "eth_sendRawTransaction") { assert.equal(params[0], raw); assert.equal(await new CircleNonceRetirementStore(root).hasClaim((await repo.load(op.operationId))!, "send"), true); if (variant === "tls_expired") clock += 60001; guard?.(); sends++; if (variant === "lost_reply") throw Error("LOST_REPLY"); return cleanupHash; } throw Error(name);
  });
  const canonical = { ...observation(42161, CIRCLE_SOURCE_OWNER, CIRCLE_SOURCE_TOKEN, encodeCircleApproval(true), [event("Approval", CIRCLE_SOURCE_TOKEN, { owner: CIRCLE_SOURCE_OWNER, spender: CIRCLE_MESSENGER, value: 0n }, 0)]) };
  canonical.finalityTag = "finalized"; canonical.transaction = { ...(canonical.transaction as Record<string, unknown>), hash: cleanupHash, nonce: "0x55", gas: "0x10a69", maxFeePerGas: "0x266ede0", maxPriorityFeePerGas: "0x0", blockNumber: "0x1e95f9af" };
  const receipt = canonical.receipt as { logs: Record<string, unknown>[] }; canonical.receipt = { ...receipt, transactionHash: cleanupHash, blockNumber: "0x1e95f9af", gasUsed: "0x10000", effectiveGasPrice: "0x1312d00", logs: receipt.logs.map(l => ({ ...l, transactionHash: cleanupHash, blockNumber: "0x1e95f9af" })) };
  (canonical.canonicalBlock as Record<string, unknown>).transactions = [cleanupHash];
  for (const b of [canonical.canonicalBlock, canonical.recheckedBlock]) (b as Record<string, unknown>).number = "0x1e95f9af";
  (canonical.finalityHead as Record<string, unknown>).number = "0x1e95f9b6"; (canonical.finalityHead as Record<string, unknown>).timestamp = "0x6ac8a7ff";
  const consumer = { ...canonical, transaction: consumerTransaction, receipt: consumerReceipt, canonicalBlock: { number: consumerTransaction.blockNumber, hash: CONSUMER_BLOCK_HASH, timestamp: "0x6ac8a7fb", transactions: ["0x" + "01".repeat(32), "0x" + "02".repeat(32), "0x" + "03".repeat(32), "0x" + "04".repeat(32), CONSUMER_HASH] }, recheckedBlock: { number: consumerTransaction.blockNumber, hash: CONSUMER_BLOCK_HASH, timestamp: "0x6ac8a7fb" }, finalityHead: { ...(canonical.finalityHead as object), number: "0x1e95f9b6", timestamp: "0x6ac8a7ff" } };
  verifyConsumedNonce(consumer);
  let cleanupReads = 0;
  t.mock.method(CircleRpc.prototype, "observation", async (hash: string, tag: string) => { assert.equal(tag, "finalized"); if (hash === CONSUMER_HASH) {
      if (variant === "consumer_missing") return null;
      const transaction = { ...consumerTransaction }, receipt = { ...consumerReceipt };
      if (variant === "consumer_wrong_nonce") transaction.nonce = "0x55";
      if (variant === "consumer_wrong_sender") transaction.from = "0x0000000000000000000000000000000000000001";
      if (variant === "consumer_wrong_chain") transaction.chainId = "0x1";
      if (variant === "consumer_wrong_input") transaction.input = "0x095ea7b3";
      return { ...consumer, finalityHead: variant === "consumer_zero_head" ? { ...(consumer.finalityHead as object), hash: "0x" + "00".repeat(32) } : variant === "consumer_old_time" ? { ...(consumer.finalityHead as object), timestamp: "0x1" } : consumer.finalityHead, transaction: variant === "consumer_auth" ? { ...transaction, authorizationList: [{}] } : transaction, receipt: variant === "consumer_token_log" ? { ...receipt, logs: [{}] } : receipt, finalityTag: variant === "consumer_included" ? "included" : "finalized", canonicalBlock: variant === "consumer_wrong_index" ? { ...(consumer.canonicalBlock as object), transactions: [CONSUMER_HASH] } : variant === "consumer_wrong_membership" ? { ...(consumer.canonicalBlock as object), transactions: [] } : consumer.canonicalBlock, recheckedBlock: variant === "consumer_reorg" ? { ...(consumer.recheckedBlock as object), hash: "0x" + "ff".repeat(32) } : consumer.recheckedBlock };
    } if (hash === oldHash) {
      let blockReads = 0;
      const rpc = new CircleRpc("https://example.org", 42161, { request: async (_url, _method, body) => {
        const request = JSON.parse(body!); let result: unknown;
        if (request.method === "eth_chainId") result = "0xa4b1";
        else if (request.method === "eth_getTransactionByHash") result = approvalTransaction();
        else if (request.method === "eth_getTransactionReceipt") result = variant === "approval_reorg" ? { ...approvalObservation.receipt, effectiveGasPrice: "0x1ff2cf1" } : approvalObservation.receipt;
        else if (request.method === "eth_getBlockByNumber") {
          if (request.params[0] === "finalized") result = { ...(canonical.finalityHead as object), timestamp: "0x6ac8a7ff" };
          else { const block = structuredClone(approvalObservation.canonicalBlock); blockReads++;
            if (variant === "approval_header_time" && blockReads === 2) block.timestamp = "0x6ac8a32a";
            if (variant === "approval_header_number" && blockReads === 2) block.number = "0x1e95e874";
            if (variant === "approval_header_membership") block.transactions = [];
            if (variant === "approval_header_both_wrong") block.timestamp = "0x6ac8a32a";
            if (variant === "approval_header_zero") block.timestamp = "0x0";
            result = block;
          }
        } else throw Error("UNEXPECTED_APPROVAL_RPC");
        return { status: 200, body: JSON.stringify({ jsonrpc: "2.0", id: request.id, result }) };
      } });
      Object.defineProperties(rpc, { call: { value: originalRpcCall }, block: { value: originalRpcBlock }, identity: { value: originalRpcIdentity } });
      return realObservation.call(rpc, oldHash, "finalized");
    } if (variant === "cleanup_reorg" && ++cleanupReads > 1) return { ...canonical, receipt: { ...(canonical.receipt as object), effectiveGasPrice: "0x1312d01" } }; return ["included", "lost_reply", "after_sign_expired", "tls_expired"].includes(variant) ? null : canonical; });
  t.mock.method(CircleRpc.prototype, "block", async (tag: string) => { if (tag === "0x1e95e873") {
    const block = structuredClone(approvalObservation.canonicalBlock); approvalBlockReads++;
    if (variant === "approval_header_time" && approvalBlockReads % 3 === 2) block.timestamp = "0x6ac8a32a";
    if (variant === "approval_header_number" && approvalBlockReads % 3 === 2) block.number = "0x1e95e874";
    if (variant === "approval_header_membership") block.transactions = [];
            if (variant === "approval_header_both_wrong") block.timestamp = "0x6ac8a32a";
            if (variant === "approval_header_zero") block.timestamp = "0x0";
    return block;
  } return ({ number: tag === "0x1e95e873" ? "0x1e95e873" : tag === consumerTransaction.blockNumber ? consumerTransaction.blockNumber : tag === "0x1e95f9af" ? "0x1e95f9af" : "0x1e95f9b6", timestamp: tag === consumerTransaction.blockNumber ? "0x6ac8a7fb" : "0x6ac8a7ff", hash: variant === "consumer_current_zero_head" && tag === "finalized" ? "0x" + "00".repeat(32) : variant === "consumer_reanchor" && tag === "0x1e95f9b6" ? "0x" + "ff".repeat(32) : tag === consumerTransaction.blockNumber ? CONSUMER_BLOCK_HASH : (canonical.finalityHead as Record<string, unknown>).hash, baseFeePerGas: "0x1312d00" }); });
  if (variant === "original_burn_submission_fence" || variant === "original_burn_submitted_once") {
    await assert.rejects(service.cleanupNonce(op.operationId), /exact_sealed_sei_burn_retirement_required/); assert.equal(tty, 0); assert.equal(signs, 0); assert.equal(sends, 0);
    assert.equal((await repo.load(op.operationId))!.integrityHash, parent.integrityHash); assert.equal(await new CircleRetirementAuthorityStore(root).load(op), null);
    const store = new CircleNonceRetirementStore(root); assert.equal(await store.intent(op), null); assert.equal(await store.hasClaim(op, "sign"), false); assert.equal(await store.hasClaim(op, "send"), false);
    for (const row of rows) assert.equal((await new AssetUsageLedger(root).load(row, row.reservationId))!.reservationDigest, row.reservationDigest);
  } else if (variant.startsWith("approval_timestamp_") && variant !== "approval_timestamp_present" || variant.startsWith("approval_header_") || variant === "approval_field_drift" || variant === "approval_quantity") {
    await assert.rejects(service.cleanupNonce(op.operationId), /consumed_approval_timestamp|quantity/); assert.equal(tty, 0); assert.equal(signs, 0); assert.equal(sends, 0); assert.equal(materialLoads, 0);
    for (const row of rows) assert.equal((await new AssetUsageLedger(root).load(row, row.reservationId))!.reservationDigest, row.reservationDigest);
  } else if (variant.startsWith("consumer_") || variant === "archive_missing" || variant === "nonce_drift") {
    await assert.rejects(service.cleanupNonce(op.operationId), /consumer|consumed|ARCHIVE_REQUIRED/); assert.equal(tty, 0); assert.equal(signs, 0); assert.equal(sends, 0);
    for (const row of rows) assert.equal((await new AssetUsageLedger(root).load(row, row.reservationId))!.state, "unknown_finality");
  } else if (["burn_race", "principal_changed", "fee_cap", "policy_expired", "missing_native", "unrelated_conflict", "approval_reorg"].includes(variant)) {
    await assert.rejects(service.cleanupNonce(op.operationId), /consumed_nonce_principal_or_allowance_changed|retirement_source_principal_changed|envelope_fee_cap|retirement_native_full_upper_balance|active_owner_asset_policy_required|exact_circle_mechanism_admission_required|Another|conflict|retirement_original_approval_reorg|policy has expired|asset is not listed/); assert.equal(tty, 0);
  } else if (["finalized", "approval_timestamp_present"].includes(variant)) {
    const done = await service.cleanupNonce(op.operationId); assert.equal(done.state, "nonce_retired"); validateCircle(done);
    assert.deepEqual(done.transitions.slice(0, parent.transitions.length), parent.transitions); assert.deepEqual(done.effects.slice(0, 2), parent.effects); assert.deepEqual(done.policies, parent.policies);
    assert.deepEqual(done.usage.map(r => r.consumedAtomic), ["0", "1116903336000", "0", "1310720000000", "0"]); assert.equal(signs, 1); assert.equal(sends, 1);
    await service.observe(op.operationId); assert.equal(signs, 1); assert.equal(sends, 1);
    await new OperationService(state).assertCircleAccountsAvailable(initial(root, 1329, "evm-live-seller"));
    for (const row of done.usage) assert.equal((await new AssetUsageLedger(root).load(row, row.reservationId))!.consumedAtomic, row.consumedAtomic);
  } else if (["cleanup_reorg", "final_principal_changed", "final_nonce_changed"].includes(variant)) {
    await assert.rejects(service.cleanupNonce(op.operationId), /retirement_cleanup_reorg|retirement_source_principal_changed|consumed_nonce_principal_or_allowance_changed|consumed_finalized_evidence_changed/);
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
    if (variant === "restored_zero_evidence") {
      const path = join(root, "circle-v2-nonce-retirements", `${op.operationId}-intent.json`), intent = JSON.parse(await readFile(path, "utf8"));
      intent.consumedBurn.consumerProof.finalityBlockHash = "0x" + "00".repeat(32); const { intentHash: _hash, ...body } = intent; intent.intentHash = hashObject(body);
      await writeFile(path, canonicalJson(intent) + "\n", { mode: 0o600 }); await assert.rejects(service.cleanupNonce(op.operationId), /consumed_burn_proof_shape/); assert.equal(tty, 1);
    }
    if (variant === "changed_again") { const h = (await policyStore.read(op.profile)).entries.at(-1)!; await policyStore.appendDecision(op.profile, h.entryDigest, { status: "active", revision: h.revision, stagedRecordDigest: h.stagedRecordDigest, policyDigest: h.policyDigest, registry: h.registry!, approvalFingerprint: hashObject("again"), decidedAt: new Date(clock).toISOString() }); await assert.rejects(service.cleanupNonce(op.operationId), /owner_policy_changed/); }
    for (const row of rows) assert.equal((await new AssetUsageLedger(root).load(row, row.reservationId))!.reservationDigest, row.reservationDigest);
  }
  assert.equal(canonicalJson(parent), parentBytes); if (!["finalized", "approval_timestamp_present", "included", "lost_reply", "after_sign_expired", "tls_expired", "cleanup_reorg", "final_principal_changed", "final_nonce_changed"].includes(variant)) { assert.equal(signs, 0); assert.equal(sends, 0); }
  if (!variant.startsWith("consumer_") && !variant.startsWith("approval_timestamp_") && !variant.startsWith("approval_header_") && !["approval_field_drift", "approval_quantity"].includes(variant) && !["archive_missing", "nonce_drift", "burn_race", "principal_changed", "fee_cap", "policy_expired", "missing_native", "unrelated_conflict", "approval_reorg", "original_burn_submission_fence", "original_burn_submitted_once"].includes(variant)) await assert.rejects(new CircleNonceRetirementStore(root).assertOriginalEffectsAvailable(op.operationId), /permanently_retired/);
});
