import assert from "node:assert/strict";
import test from "node:test";
import { readFile, writeFile, symlink, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { Cleanup85CancellationProof } from "../../src/circle-cleanup85-cancellation-contract.js";
import type { VerifiedCleanup86CurrentPurpose } from "../../src/circle-v2-evm/cleanup86-current-purpose.js";
/** F85 is a labeled TEST public-accounting/wire oracle, since no authentic finalized85 fixture
 * exists. Current policy approval, lock scope, admission issuer, one-use certificate, 83/84 public
 * cryptography, carry ledger and controller fences remain production. No private owner/key positive. */
test("current86 actual permission issuer with explicit future F85 TEST public-state oracle", async t => {
  let accountingCalls = 0, accountingRefuse = false;
  t.mock.module("../../src/circle-cleanup85-native-cancellation.js", { namedExports: { verifyCleanup85CancellationAccounting: async () => { accountingCalls++; if (accountingRefuse) throw Error("TEST_F85_accounting_refusal"); } } });
  let publicProof: typeof import("../../src/circle-v2-evm/cleanup85-public-proof.js");
  t.mock.module("../../src/circle-v2-evm/cleanup85-public-proof.js", { namedExports: {
    verifyCleanup85PublicWire: (...args: Parameters<typeof publicProof.verifyCleanup85PublicWire>) => publicProof.verifyCleanup85PublicWire(...args),
    cleanup85Reanchor: (...args: Parameters<typeof publicProof.cleanup85Reanchor>) => publicProof.cleanup85Reanchor(...args),
    assertCancellationProofShape: (...args: Parameters<typeof publicProof.assertCancellationProofShape>) => publicProof.assertCancellationProofShape(...args),
    verifyCancellationPublic: async (_source: unknown, proof: Cleanup85CancellationProof) => { publicProof.assertCancellationProofShape(proof); return structuredClone(proof.observation); }
  } });
  // Register the future-public oracle before any shared production graph is loaded.
  publicProof = await import(new URL("../../src/circle-v2-evm/cleanup85-public-proof.js?unmocked-shape", import.meta.url).href);
  const { temporaryState } = await import("./helpers.js"), { cleanup85PublicState, cleanup85PublicTransport } = await import("./cleanup85-native-public-fixture.js");
  const { hashObject, canonicalJson } = await import("../../src/canonical.js"), { CircleRpc } = await import("../../src/circle-v2-evm/rpc.js");
  const { circleEnvelope } = await import("../../src/circle-v2-evm/operation-model.js"), { circleMechanism } = await import("../../src/circle-v2-evm/usage.js");
  const { CIRCLE_SOURCE_TOKEN, circleRoute } = await import("../../src/circle-v2-evm/catalog.js");
  const { Cleanup85RecoveryStore, assertCleanup85Window } = await import("../../src/circle-v2-evm/cleanup85-recovery-store.js");
  const { Cleanup86Store, validateCleanup86Intent } = await import("../../src/circle-v2-evm/cleanup86-store.js");
  const { verifyCleanup86CurrentPurpose, verifiedCleanup86CurrentPurpose, assertCleanup86CurrentPermission } = await import("../../src/circle-v2-evm/cleanup86-current-purpose.js");
  const { resolveCleanup85NativeLineage, verifiedCleanup85NativeLineage } = await import("../../src/circle-cleanup85-unsigned-retirement.js");
  const { withCleanup85FinancialScope } = await import("../../src/circle-cleanup85-financial-scope.js");
  const { executeAllowlistPolicyCommand } = await import("../../src/allowlist-policy-command.js"), { AllowlistPolicyStore } = await import("../../src/allowlist-policy-store.js");
  const { AssetUsageLedger } = await import("../../src/asset-usage-ledger.js"), { StateStore } = await import("../../src/state.js");
  const { executeCleanup86 } = await import("../../src/circle-v2-evm/cleanup86-controller.js");
  const variants = ["positive", "expired_legacy", "proof", "proof_hash", "root", "copied_token", "nonce", "fee", "day", "expired", "policy", "daily", "perop", "carry", "no_reset", "material", "sign", "send", "history", "history_one", "history_gap", "history_high", "history_corrupt", "history_symlink", "history_directory", "no_private_dto", "no_repeat", "legacy_strict", "historical_reload", "rpc_budget", "f85_accounting_refusal", "claimed_unknown", "normal_cli"] as const;
  for (const variant of variants) await t.test(variant, async t => {
    const temp = await temporaryState(); t.after(temp.cleanup); const f = await cleanup85PublicState(temp.root), transport = await cleanup85PublicTransport(); let clock = Date.parse("2026-10-09T20:00:00.000Z");
    const store = new Cleanup86Store(temp.root), { CircleNonceRetirementStore } = await import("../../src/circle-v2-evm/nonce-retirement-store.js"), parentIntent = (await new CircleNonceRetirementStore(temp.root).intent(f.parent))!;
    const recovery = (await new Cleanup85RecoveryStore(temp.root).load(f.parent, parentIntent))!;
    const frozenPath = join(temp.root, "circle-cleanup85-recovery", `${f.parent.operationId}-intent.json`), frozen = await readFile(frozenPath), parentPath = join(temp.root, "circle-v2-evm", `${f.parent.operationId}.json`), parentBytes = await readFile(parentPath);
    let approvals = 0; const renew = async (profile: string, suffix = "first") => {
      const policies = new AllowlistPolicyStore(temp.root), old = await policies.read(profile), route = circleRoute(1329, "evm-live-seller"), file = join(temp.root, `current-${profile}-${suffix}.json`);
      const policy = { schemaVersion: "apn.allowlist-policy-file.v1", overlayVersion: `current86.${old.records.length + 1}`, accounts: { evm: profile === f.parent.profile ? f.parent.sourceCustody.walletAddress : f.parent.destinationCustody.walletAddress }, effectiveAt: "2026-10-09T19:00:00.000Z", expiresAt: "2026-10-10T01:00:00.000Z", admissions: [
        { chain: "eip155:42161", kind: "token", identifier: CIRCLE_SOURCE_TOKEN, rail: "bridge", maximumPerTransferAtomic: "40100", dailyLimitAtomic: "40100", mechanism: circleMechanism(1329) },
        { chain: "eip155:42161", kind: "native", rail: "bridge", maximumPerTransferAtomic: variant === "perop" ? "14999999999999" : "30000000000000", dailyLimitAtomic: variant === "daily" ? "74999999999999" : "500000000000000", mechanism: circleMechanism(1329) },
        { chain: "eip155:1329", kind: "native", rail: "bridge", maximumPerTransferAtomic: route.destinationNativeCap, dailyLimitAtomic: route.destinationNativeCap, mechanism: circleMechanism(1329) }] };
      await writeFile(file, JSON.stringify(policy), { mode: 0o600 });
      const context = { state: f.state, clock: { now: () => new Date(clock) }, allowlistPolicyApproval: { approve: async (intent: { fingerprint: string; code: string }) => { assert.match(intent.fingerprint, /^[a-f0-9]{64}$/); assert.ok(intent.code.length > 0); approvals++; } } };
      const staged = await executeAllowlistPolicyCommand({ command: "allowlist.policy.stage", profile, file, ...(old.records.length === 0 ? {} : { expectedRevision: old.records.at(-1)!.revision }) }, context);
      const revision = (staged.data as { revision: number }).revision;
      await executeAllowlistPolicyCommand({ command: "allowlist.policy.activate", profile, revision }, context);
    };
    await renew(f.parent.profile); await renew(f.parent.destinationProfile); assert.equal(approvals, 2);
    const lineage = verifiedCleanup85NativeLineage(await resolveCleanup85NativeLineage(f.state, f.request), f.state, f.request);
    const envelopeBody = { chainId: 42161, from: f.parent.sourceCustody.walletAddress, to: recovery.recipientCustody.walletAddress, nonceAtomic: "85", valueAtomic: "1", data: "0x" as const, gasLimitAtomic: "21000", maxFeePerGasAtomic: "45000000", maxPriorityFeePerGasAtomic: "1" }, head = transport.snapshot.archiveAnchor;
    const observation = { transaction: {}, receipt: { blockNumber: head.number, blockHash: head.hash }, canonicalBlock: head, recheckedBlock: head, finalityHead: head, chainId: 42161, finalityTag: "finalized" as const };
    const proofBody = { version: "apn.circle-cleanup85-native-cancellation-proof.v1" as const, requestBinding: hashObject(f.request), operationId: lineage.operationId, fingerprint: "a".repeat(64), materialHash: "b".repeat(64), transactionHash: `0x${"c".repeat(64)}` as const, envelope: { ...envelopeBody, envelopeHash: hashObject(envelopeBody) }, sourceCustody: recovery.sourceCustody, recipientCustody: recovery.recipientCustody, observation, actualFeeAtomic: "1", nativeConsumedAtomic: "2", nativeReservationId: "d".repeat(64), nativeOutcomeDigest: "e".repeat(64) }, proof = { ...proofBody, proofHash: hashObject(proofBody) } as Cleanup85CancellationProof;
    const { envelopeHash: _old, ...old } = f.parent.effects[2]!.envelope, envelope = circleEnvelope({ ...old, nonceAtomic: variant === "nonce" ? "87" : "86", ...(variant === "fee" ? { gasLimitAtomic: "15000000000001", maxFeePerGasAtomic: "1", maxPriorityFeePerGasAtomic: "0" } : {}) });
    const https: typeof transport.https = { request: async (...args) => { const q = JSON.parse(args[2]!); if (q.method === "eth_getTransactionCount") return { status: 200, body: JSON.stringify({ jsonrpc: "2.0", id: q.id, result: variant === "carry" ? "0x57" : "0x56" }) }; if (q.method === "eth_getBlockByNumber" && q.params[0] === "finalized") return { status: 200, body: JSON.stringify({ jsonrpc: "2.0", id: q.id, result: head }) }; return transport.https.request(...args); } };
    const source = new CircleRpc("https://arbitrum-one-public.nodies.app", 42161, https, variant === "rpc_budget" ? 2 : 256), destination = new CircleRpc("https://evm-rpc.sei-apis.com", 1329, https);
    if (variant === "normal_cli") {
      const { CircleEvmService } = await import("../../src/circle-v2-evm/runtime.js"), { approvalCode } = await import("../../src/approval-code.js");
      let keys = 0, terminals = 0, closed = 0; const entered = performance.now(), clockNow = () => clock + Math.floor(performance.now() - entered); t.mock.method(Date, "now", clockNow);
      const { EncryptedWalletStore } = await import("../../src/encrypted-wallet-store.js");
      t.mock.method(EncryptedWalletStore.prototype, "describe", async (profile: string, beforeDecrypt?: () => void, beforeKeyLoad?: (identity: { profile: string; address: typeof f.parent.sourceCustody.walletAddress; bindingHash: string; createdAt: string }) => Promise<void>) => { assert.equal(profile, f.parent.profile); await beforeKeyLoad?.({ profile, address: f.parent.sourceCustody.walletAddress, bindingHash: f.parent.sourceCustody.walletBindingHash, createdAt: f.parent.sourceCustody.walletCreatedAt }); beforeDecrypt?.(); keys++; throw Error("TEST_private_broker_refusal"); });
      const terminal = { isTerminal: () => true, openTerminal: async () => { terminals++; return { fd: 123, write: async () => {}, read: async function* () { const saved = (await store.intent(f.parent, recovery))!; yield Buffer.from(approvalCode("bridge", f.parent.operationId, saved.intentHash) + "\n"); }, close: async () => { closed++; } }; } };
      const runtimeTransport: typeof https = { request: async (...args) => { const q = JSON.parse(args[2]!); if (q.method === "eth_call" && String(q.params[0].data).startsWith("0x095ea7b3")) return { status: 200, body: JSON.stringify({ jsonrpc: "2.0", id: q.id, result: "0x" + "0".repeat(63) + "1" }) }; return https.request(...args); } };
      const service = new CircleEvmService(f.state, { load: async () => { keys++; throw Error("TEST_private_broker_refusal"); }, create: async () => { throw Error("forbidden"); } }, { APN_ARBITRUM_RPC_URL: "https://arbitrum-one-public.nodies.app", APN_SEI_RPC_URL: "https://evm-rpc.sei-apis.com" }, clockNow, terminal, runtimeTransport, { cancellation: { inspect: async () => ({ operationId: proof.operationId, phase: "finalized", transactionHash: proof.transactionHash, proof }), execute: async () => { throw Error("no native cancellation dispatch"); } }, verifyCancellationAccounting: async () => { accountingCalls++; } });
      await assert.rejects(service.approveCleanup86(f.parent.operationId), /TEST_private_broker_refusal/);
      const intent = (await store.intent(f.parent, recovery))!; assert.equal(intent.version, "apn.circle-cleanup86-intent.v3"); assert.equal((await store.effect(f.parent, intent))!.phase, "unknown"); assert.equal(await store.claimed(f.parent, intent, "sign"), true); assert.deepEqual([keys, terminals, closed], [1, 1, 1]);
      await assert.rejects(service.approveCleanup86(f.parent.operationId), /existing_observe_only/); assert.equal(keys, 1); assert.equal(terminals, 1);
      assert.deepEqual(await readFile(frozenPath), frozen); assert.deepEqual(await readFile(parentPath), parentBytes); t.diagnostic(`normal86 bounded TEST public requests=${transport.rows.length}; no signing/send; genuine TEST terminal consumed once`); return;
    }
    let token: VerifiedCleanup86CurrentPurpose | undefined, historicalIntentHash: string | undefined;
    await withCleanup85FinancialScope(f.state, f.request, lineage.operationId, async scope => {
      if (variant === "expired_legacy") { assert.throws(() => assertCleanup85Window(recovery, clock), /window_expired/); return; }
      if (variant === "proof") Object.assign(proof, { requestBinding: "f".repeat(64) });
      if (variant === "proof_hash") Object.assign(proof, { proofHash: "f".repeat(64) });
      accountingRefuse = variant === "f85_accounting_refusal";
      const mint = () => verifyCleanup86CurrentPurpose(f.state, f.parent, recovery, proof, envelope, source, destination, () => clock, scope);
      if (["proof", "proof_hash", "nonce", "fee", "daily", "perop", "carry", "rpc_budget", "f85_accounting_refusal"].includes(variant)) { await assert.rejects(mint()); accountingRefuse = false; return; }
      token = await mint(); const purpose = verifiedCleanup86CurrentPurpose(token, f.state, f.parent, recovery, envelope);
      assert.equal(purpose.maximumFeeAtomic, "15000000000000"); assert.notDeepEqual(purpose.policies, recovery.policies); assert.equal(purpose.recoveryBinding, recovery.recoveryBinding);
      assert.throws(() => verifiedCleanup86CurrentPurpose({ ...token! }, f.state, f.parent, recovery, envelope), /private_current/);
      if (variant === "root") { assert.throws(() => verifiedCleanup86CurrentPurpose(token!, new StateStore(temp.root), f.parent, recovery, envelope), /private_current/); return; }
      if (variant === "copied_token") return;
      if (variant === "day") clock = Date.parse("2026-10-10T00:00:00.000Z");
      if (variant === "expired") clock = Date.parse(purpose.windowEndsAt!);
      if (variant === "day" || variant === "expired") { await assert.rejects(store.startCurrent(f.state, f.parent, recovery, envelope, token)); return; }
      if (variant === "policy") { const originalRead = AllowlistPolicyStore.prototype.readUnderProfileLock; t.mock.method(AllowlistPolicyStore.prototype, "readUnderProfileLock", async function(this: InstanceType<typeof AllowlistPolicyStore>, profile: string) { const value = await originalRead.call(this, profile); return profile === f.parent.profile ? { ...value, entries: [] } : value; }); await assert.rejects(assertCleanup86CurrentPermission(token, f.state, f.parent, recovery, envelope), /active_owner_asset_policy_required/); return; }
      if (["material", "sign", "send", "history"].includes(variant)) { await writeFile(join(temp.root, "circle-cleanup85-recovery", `${f.parent.operationId}-cleanup86-${variant === "history" ? "history-0" : variant}.json`), "{}", { mode: 0o600 }); await assert.rejects(store.startCurrent(f.state, f.parent, recovery, envelope, token), /existing_observe_only/); return; }
      if (variant.startsWith("history_")) {
        const suffix = variant === "history_one" ? "1.json" : variant === "history_gap" ? "7.json" : variant === "history_high" ? "999999999999999999999999.json" : variant === "history_corrupt" ? "broken.json" : "2.json";
        const marker = join(temp.root, "circle-cleanup85-recovery", `${f.parent.operationId}-cleanup86-history-${suffix}`);
        if (variant === "history_symlink") await symlink(parentPath, marker);
        else if (variant === "history_directory") await mkdir(marker, { mode: 0o700 });
        else await writeFile(marker, variant === "history_corrupt" ? "not JSON" : "{}", { mode: 0o600 });
        await assert.rejects(store.startCurrent(f.state, f.parent, recovery, envelope, token), /existing_observe_only/);
        assert.equal(await store.intent(f.parent, recovery), null); return;
      }
      const intent = await store.startCurrent(f.state, f.parent, recovery, envelope, token); assert.equal(intent.version, "apn.circle-cleanup86-intent.v3"); assert.equal((await store.intent(f.parent, recovery))!.intentHash, intent.intentHash);
      if (variant === "legacy_strict") { const { currentPurpose: _purpose, intentHash: _hash, ...body } = intent; assert.throws(() => validateCleanup86Intent({ ...body, version: "apn.circle-cleanup86-intent.v1", intentHash: hashObject({ ...body, version: "apn.circle-cleanup86-intent.v1" }) }, recovery), /intent_binding/); return; }
      if (variant === "historical_reload") { historicalIntentHash = intent.intentHash; return; }
      let prompts = 0, privateCalls = 0; const ports = { now: () => clock, preflight: async () => { await assertCleanup86CurrentPermission(token!, f.state, f.parent, recovery, envelope); }, confirm: async () => { prompts++; if (variant === "claimed_unknown") return; if (variant === "no_reset") { clock += 60_000; return; } throw Error("TEST_stops_at_genuine_owner_foreground_grant_before_private"); }, seal: async () => { privateCalls++; throw Error("forbidden"); }, send: async () => { throw Error("forbidden"); } };
      if (variant === "no_private_dto") { await assert.rejects(executeCleanup86(temp.root, f.parent, intent, store, ports), /private_current/); assert.equal(prompts, 0); return; }
      await assert.rejects(executeCleanup86(temp.root, f.parent, intent, store, ports, { state: f.state, recovery, certificate: token }), variant === "claimed_unknown" ? /forbidden/ : variant === "no_reset" ? /foreground_authority/ : /TEST_stops/); assert.equal(prompts, 1); assert.equal(privateCalls, variant === "claimed_unknown" ? 1 : 0);
      if (variant === "claimed_unknown") { assert.equal((await store.effect(f.parent, intent))!.phase, "unknown"); assert.equal(await store.claimed(f.parent, intent, "sign"), true); }
      await assert.rejects(executeCleanup86(temp.root, f.parent, intent, store, ports, { state: f.state, recovery, certificate: token }), /certificate_used|purpose_expired/); assert.equal(prompts, 1);
      await assert.rejects(store.startCurrent(f.state, f.parent, recovery, envelope, token), /existing_observe_only|purpose_expired/);
    });
    if (historicalIntentHash !== undefined) { await renew(f.parent.profile, "later"); clock += 86_400_000; assert.equal((await store.intent(f.parent, recovery))!.intentHash, historicalIntentHash); }
    if (token !== undefined) assert.throws(() => verifiedCleanup86CurrentPurpose(token!, f.state, f.parent, recovery, envelope), /held_financial_scope/);
    assert.deepEqual(await readFile(frozenPath), frozen); assert.deepEqual(await readFile(parentPath), parentBytes);
    for (const row of f.parent.usage) assert.deepEqual(await new AssetUsageLedger(temp.root).load(row, row.reservationId), row);
    assert.ok(transport.rows.every(x => x.method !== "eth_sendRawTransaction"));
  });
  assert.ok(accountingCalls > 0);
});
