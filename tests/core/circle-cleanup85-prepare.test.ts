import assert from "node:assert/strict";
import test from "node:test";
import { readFile, mkdtemp, realpath, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { decodeFunctionData, encodeAbiParameters } from "viem";
import { canonicalJson, hashObject } from "../../src/canonical.js";
import { AllowlistPolicyStore } from "../../src/allowlist-policy-store.js";
import { CircleEvmService } from "../../src/circle-v2-evm/runtime.js";
import { CircleRpc, CIRCLE_RPC_ABI } from "../../src/circle-v2-evm/rpc.js";
import { circleMechanism } from "../../src/circle-v2-evm/usage.js";
import { verifyCleanup85RecoveryAdmission, verifiedCleanup85RecoveryAdmission } from "../../src/circle-v2-evm/cleanup85-recovery-admission.js";
import { Cleanup85RecoveryStore } from "../../src/circle-v2-evm/cleanup85-recovery-store.js";
import { CIRCLE_SOURCE_TOKEN, CIRCLE_SOURCE_OWNER, circleRoute } from "../../src/circle-v2-evm/catalog.js";
import { approvalObservationFixture } from "./circle-v2-evm-approval-public-fixture.js";
import { consumerTransaction, consumerReceipt } from "./circle-v2-evm-consumed-public-fixture.js";
import { installCleanup85PublicFixture } from "./circle-cleanup85-public-fixture.js";
/** Real production preparation/admission using authentic saved parent, unsigned public wire,
 * deployment bytecodes/answers and block fixtures. Current account reads are explicit mocks of
 * captured public85/97924/40100 facts; there is no private wallet or financial transport. */
for (const variant of ["current_compatible", "missing_native", "expired_policy", "wrong_owner", "wrong_chain", "nonce_drift", "allowance_drift", "principal_drift", "old_receipt", "consumer_index", "zero_head", "code_drift", "policy_changed", "forged_admission"] as const) test(`normal cleanup85 preparation/admission ${variant}`, async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "cleanup85-prepare-"))); t.after(() => rm(root, { recursive: true, force: true }));
  const { state, op, parent } = await installCleanup85PublicFixture(root), clock = Date.parse("2026-10-09T12:00:00.000Z"), policyStore = new AllowlistPolicyStore(root), route = circleRoute(1329, "evm-live-seller");
  const stage = async (changed = false) => {
    for (const profile of [op.profile, op.destinationProfile]) {
      const policy = { schemaVersion: "apn.allowlist-policy-file.v1", overlayVersion: changed ? "second-compatible" : "fresh-current", accounts: { evm: variant === "wrong_owner" && profile === op.profile ? route.gasPayer : profile === op.profile ? CIRCLE_SOURCE_OWNER : route.gasPayer }, effectiveAt: new Date(clock - 2).toISOString(), expiresAt: new Date(clock + (variant === "expired_policy" ? -1 : 3_600_000)).toISOString(), admissions: [
        { chain: "eip155:42161", kind: "token", identifier: CIRCLE_SOURCE_TOKEN, rail: "bridge", maximumPerTransferAtomic: "40100", dailyLimitAtomic: "40100", mechanism: circleMechanism(1329) },
        ...variant === "missing_native" ? [] : [{ chain: "eip155:42161", kind: "native", rail: "bridge", maximumPerTransferAtomic: "75000000000000", dailyLimitAtomic: "75000000000000", mechanism: circleMechanism(1329) } as const],
        { chain: "eip155:1329", kind: "native", rail: "bridge", maximumPerTransferAtomic: route.destinationNativeCap, dailyLimitAtomic: route.destinationNativeCap, mechanism: circleMechanism(1329) }] } as const;
      const revision = (await policyStore.status(profile))?.revision;
      const record = await policyStore.stage({ profile, now: new Date(clock), policy, ...(revision === undefined ? {} : { expectedRevision: revision }) });
      const prior = (await policyStore.read(profile)).entries.at(-1)?.entryDigest ?? null;
      await policyStore.appendDecision(profile, prior, { status: "active", revision: record.revision, stagedRecordDigest: record.recordDigest, policyDigest: record.registry.policyDigest, registry: record.registry, approvalFingerprint: hashObject(profile + String(changed)), decidedAt: new Date(clock).toISOString() });
    }
  };
  await stage();
  const captures = JSON.parse(await readFile(join(process.cwd(), "tests/fixtures/circle-cleanup85/deployment-rpc.json"), "utf8")) as { responses: { endpoint: string; method: string; params: unknown[]; result: unknown }[] };
  const consumerBlock = JSON.parse(await readFile(join(process.cwd(), "tests/fixtures/circle-cleanup85/nonce84-block.json"), "utf8")).result as Record<string, unknown>;
  if (variant === "consumer_index") (consumerBlock.transactions as unknown[]).reverse();
  let privateCalls = 0, tty = 0, financial = 0, reads = 0;
  const https = { request: async (url: string, _method: "POST" | "GET", body: string | null) => {
    reads++; const q = JSON.parse(body!), key = canonicalJson({ endpoint: new URL(url).toString(), method: q.method, params: q.params });
    const captured = captures.responses.find(x => canonicalJson({ endpoint: x.endpoint, method: x.method, params: x.params }) === key); let result: unknown;
    if (q.method === "eth_sendRawTransaction") { financial++; throw new Error("financial forbidden"); }
    if (captured !== undefined) result = structuredClone(captured.result);
    else if (q.method === "eth_getTransactionCount") result = variant === "nonce_drift" ? "0x56" : "0x55";
    else if (q.method === "eth_getTransactionByHash") result = q.params[0] === op.effects[0]!.transactionHash ? approvalObservationFixture.transaction : q.params[0] === consumerTransaction.hash ? consumerTransaction : null;
    else if (q.method === "eth_getTransactionReceipt") result = q.params[0] === op.effects[0]!.transactionHash ? approvalObservationFixture.receipt : q.params[0] === consumerTransaction.hash ? consumerReceipt : variant === "old_receipt" && q.params[0] === op.effects[2]!.transactionHash ? { status: "0x1" } : null;
    else if (q.method === "eth_getBlockByNumber") result = q.params[0] === approvalObservationFixture.canonicalBlock.number ? approvalObservationFixture.canonicalBlock : q.params[0] === consumerTransaction.blockNumber ? consumerBlock : approvalObservationFixture.finalityHead;
    else if (q.method === "eth_call") { const f = decodeFunctionData({ abi: CIRCLE_RPC_ABI, data: q.params[0].data }); assert.ok(f.functionName === "balanceOf" || f.functionName === "allowance"); result = encodeAbiParameters([{ type: "uint256" }], [f.functionName === "balanceOf" ? variant === "principal_drift" ? 97923n : 97924n : variant === "allowance_drift" ? 0n : 40100n]); }
    else throw new Error(`unhandled public fixture method ${q.method}`);
    if (variant === "wrong_chain" && q.method === "eth_chainId" && new URL(url).hostname.includes("nodies")) result = "0x1";
    if (variant === "code_drift" && q.method === "eth_getCode") result = "0x00";
    if (variant === "zero_head" && q.method === "eth_getBlockByNumber" && q.params[0] === "finalized") result = { ...(result as object), hash: "0x" + "0".repeat(64) };
    return { status: 200, body: JSON.stringify({ jsonrpc: "2.0", id: q.id, result }) };
  } };
  const service = new CircleEvmService(state, { load: async () => { privateCalls++; throw new Error("private forbidden"); } } as never, { APN_ARBITRUM_RPC_URL: "https://arbitrum-one-public.nodies.app", APN_SEI_RPC_URL: "https://evm-rpc.sei-apis.com" }, () => clock, { openTerminal: async () => { tty++; throw new Error("TTY forbidden"); } }, https);
  const before = await readFile(join(root, "circle-v2-evm", `${op.operationId}.json`), "utf8");
  if (["current_compatible", "policy_changed", "forged_admission"].includes(variant)) {
    const request = await service.prepareCleanup85Recovery(op.operationId), intent = await new Cleanup85RecoveryStore(root).load(op, parent); assert.notEqual(hashObject(intent!.policies), hashObject(op.policies));
    if (variant === "policy_changed") { await stage(true); await assert.rejects(service.prepareCleanup85Recovery(op.operationId), /owner_policy_changed/); }
    else {
      const source = new CircleRpc("https://arbitrum-one-public.nodies.app", 42161, https), destination = new CircleRpc("https://evm-rpc.sei-apis.com", 1329, https);
      const token = await verifyCleanup85RecoveryAdmission(state, source, destination, request); assert.equal(verifiedCleanup85RecoveryAdmission(token, request).parent.integrityHash, op.integrityHash);
      assert.throws(() => verifiedCleanup85RecoveryAdmission({ kind: "verified-cleanup85-recovery-admission" }, request), /private_cleanup85/);
      assert.throws(() => verifiedCleanup85RecoveryAdmission(token, { ...request, recoveryBinding: "f".repeat(64) }), /private_cleanup85/);
    }
  } else await assert.rejects(service.prepareCleanup85Recovery(op.operationId));
  assert.equal(await readFile(join(root, "circle-v2-evm", `${op.operationId}.json`), "utf8"), before); assert.deepEqual([privateCalls, tty, financial], [0, 0, 0]); assert.ok(reads < 256);
});
