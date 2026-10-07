import { generateKeyPairSync } from "node:crypto";
import { DirectPublicEffectJournal } from "../../src/direct-public-effect.js";
import { AssetUsageLedger } from "../../src/asset-usage-ledger.js";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import type { OperationRecord } from "../../src/model.js";
import { parseTransaction } from "viem";
import { canonicalJson, hashObject } from "../../src/canonical.js";
import { evmCustodyPayload } from "../../src/evm-transfer-approval.js";
import { evmDirectFingerprint } from "../../src/evm-direct.js";
import { projectLegacyLocalProfile } from "../../src/provider-profile.js";
import { appendTransition, sealOperation, sealWallet, validateOperation } from "../../src/state-integrity.js";
import { EVM_REQUEST, ensureDirectWallet, evmCore } from "./evm-helpers.js";
import { temporaryState } from "./helpers.js";

async function prepared(t: test.TestContext) {
  const temp = await temporaryState(); t.after(temp.cleanup);
  const s = evmCore(temp.root), wallet = await ensureDirectWallet(s); s.rpc.sender = wallet.address; s.rpc.receiptEnabled = false;
  const result = await s.core.transfer.prepare(EVM_REQUEST) as { operation_id: string };
  const operation = (await s.state.findOperation(result.operation_id))!;
  return { ...s, temp, operation };
}

/** Enter started through canonical production approval transition, stopping before Native private work. */
async function enterStarted(s: Awaited<ReturnType<typeof prepared>>) {
  const original = s.local.request.bind(s.local);
  s.local.request = async request => {
    if (request.operation === "directTransfer.approveAndSign") throw new Error("TEST pause before Native");
    return await original(request);
  };
  await assert.rejects(s.core.transfer.approve(s.operation.operationId));
  s.local.request = original;
  s.operation = (await s.state.findOperation(s.operation.operationId))!;
  assert.equal(s.operation.state, "started");
}

test("direct Native awaiting approval refuses before key load or approval", async t => {
  const s = await prepared(t), before = s.wrapping.loads;
  await assert.rejects(s.local.request({ requestId: "awaiting-native-refusal", version: "apn.native.v1", operation: "directTransfer.approveAndSign", payload: evmCustodyPayload(s.operation) }), { code: "APN_NATIVE_PROTOCOL" });
  assert.equal(s.wrapping.loads, before); assert.equal(s.approval.intents.length, 0); assert.equal(s.rpc.broadcastCount, 0);
  assert.equal((await s.state.findOperation(s.operation.operationId))!.integrityHash, s.operation.integrityHash);
});

for (const kind of ["wallet", "provider", "envelope"] as const) test(`${kind} public identity drift refuses genuine native signing before wrapping-secret load`, async t => {
  const s = await prepared(t); await enterStarted(s); const original = (await s.state.loadWallet(s.operation.profileHash))!;
  const before = s.wrapping.loads;
  if (kind === "wallet") {
    const { integrityHash: _, ...body } = original;
    await s.state.writeWallet(sealWallet({ ...body, bindingHash: "a".repeat(64) }));
  } else if (kind === "provider") {
    await s.state.writeProviderProfile({ ...projectLegacyLocalProfile(original), revision: 2 });
  } else {
    const value = await s.state.loadEncryptedWalletEnvelope("default") as { identity: { createdAt: string; bindingHash: string } };
    value.identity.createdAt = new Date(Date.parse(original.createdAt) + 1000).toISOString();
    value.identity.bindingHash = hashObject({ profile: "default", address: original.address, createdAt: value.identity.createdAt });
    await s.state.writeEncryptedWalletEnvelope("default", value);
  }
  await assert.rejects(s.local.request({ requestId: "native-send-safety-test", version: "apn.native.v1", operation: "directTransfer.approveAndSign", payload: evmCustodyPayload(s.operation) }), { code: "APN_PROFILE_DRIFT" });
  assert.equal(s.wrapping.loads, before); assert.equal(s.rpc.broadcastCount, 0);
  assert.equal(s.approval.intents.length, 0);
  assert.equal((await s.state.findOperation(s.operation.operationId))!.integrityHash, s.operation.integrityHash);
});

test("service public binding drift refuses before started and never reads custody", async t => {
  const s = await prepared(t), wallet = (await s.state.loadWallet(s.operation.profileHash))!;
  await s.state.writeProviderProfile({ ...projectLegacyLocalProfile(wallet), revision: 2 });
  const before = s.wrapping.loads;
  await assert.rejects(s.core.transfer.approve(s.operation.operationId), { code: "APN_PROFILE_DRIFT" });
  assert.equal((await s.state.findOperation(s.operation.operationId))!.state, "awaiting_approval");
  assert.equal(s.wrapping.loads, before); assert.equal(s.approval.intents.length, 0); assert.equal(s.rpc.broadcastCount, 0);
});

test("legacy unsigned operation without native binding refuses without rewriting its digest", async t => {
  const s = await prepared(t), { nativeCustody: _, ...evm } = s.operation.evm!;
  const { integrityHash: __, ...body } = s.operation;
  const old = sealOperation({ ...body, evm, fingerprint: evmDirectFingerprint({ ...s.operation, evm }) });
  await writeFile(join(s.temp.root, "operations", old.profileHash, `${old.operationId}.json`), `${canonicalJson(old)}\n`, { mode: 0o600 });
  const before = s.wrapping.loads;
  await assert.rejects(s.core.transfer.approve(old.operationId), { code: "APN_REPREPARE_REQUIRED" });
  assert.equal((await s.state.findOperation(old.operationId))!.integrityHash, old.integrityHash);
  assert.equal(s.wrapping.loads, before); assert.equal(s.rpc.broadcastCount, 0);
});

for (const [phase, exit, sends] of [["dispatch-before-crash", 75, 0], ["dispatch-after-crash", 76, 1]] as const) test(`${phase}: real process loss leaves a durable fence and restart never dispatches`, async t => {
  const s = await prepared(t), worker = fileURLToPath(new URL("./evm-crash-worker.js", import.meta.url));
  const crashed = spawnSync(process.execPath, [worker, phase, s.temp.root, s.operation.operationId], { encoding: "utf8", timeout: 15000 });
  assert.equal(crashed.status, exit, crashed.stderr);
  const stored = (await s.state.findOperation(s.operation.operationId))!;
  assert.equal(stored.state, "signed_not_submitted");
  const marker = JSON.parse(await readFile(join(s.temp.root, "direct-submissions", stored.profileHash, `${stored.operationId}.json`), "utf8"));
  assert.equal(marker.binding.transactionHash, stored.transactionHash); assert.equal(marker.binding.signedPayloadHash, hashObject(evmCustodyPayload(stored)));
  const witness = await readFile(join(s.temp.root, "fake-dispatch-witness.json"), "utf8").then(JSON.parse).catch(() => null);
  assert.equal(witness?.sends ?? 0, sends);
  const recovered = spawnSync(process.execPath, [worker, "resume", s.temp.root, stored.operationId], { encoding: "utf8", timeout: 15000 });
  assert.equal(recovered.status, 0, recovered.stderr);
  const result = JSON.parse(recovered.stdout);
  assert.equal(result.result.state, "unknown_finality"); assert.equal(result.submissions, 0); assert.equal(result.approvals, 0);
  const again = evmCore(s.temp.root, s.rpc, s.wrapping); const before = s.wrapping.loads;
  await again.core.transfer.resume(stored.operationId);
  assert.equal(s.rpc.broadcastCount, 0); assert.equal(s.wrapping.loads, before);
});

test("concurrent approvals permit one initial dispatch and ordinary resume does not replay", async t => {
  const s = await prepared(t);
  const results = await Promise.allSettled([s.core.transfer.approve(s.operation.operationId), s.core.transfer.approve(s.operation.operationId)]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  assert.equal(s.rpc.broadcastCount, 1); assert.equal(s.approval.intents.length, 1);
  const before = s.wrapping.loads;
  await s.core.transfer.resume(s.operation.operationId);
  assert.equal(s.rpc.broadcastCount, 1); assert.equal(s.wrapping.loads, before);
});

test("submission fence hash drift fails closed without custody or another dispatch", async t => {
  const s = await prepared(t); await s.core.transfer.approve(s.operation.operationId);
  const path = join(s.temp.root, "direct-submissions", s.operation.profileHash, `${s.operation.operationId}.json`);
  const value = JSON.parse(await readFile(path, "utf8")); value.binding.transactionHash = `0x${"f".repeat(64)}`;
  value.integrityHash = hashObject({ schemaVersion: value.schemaVersion, binding: value.binding });
  await writeFile(path, `${canonicalJson(value)}\n`, { mode: 0o600 }); const before = s.wrapping.loads;
  await assert.rejects(s.core.transfer.resume(s.operation.operationId), { code: "APN_STATE_CORRUPT" });
  assert.equal(s.rpc.broadcastCount, 1); assert.equal(s.wrapping.loads, before);
});

test("expired legacy unsigned refusal preserves digest and state", async t => {
  const s = await prepared(t), { nativeCustody: _, ...evm } = s.operation.evm!;
  const { integrityHash: __, ...body } = s.operation;
  const old = sealOperation({ ...body, evm, fingerprint: evmDirectFingerprint({ ...s.operation, evm }) });
  await writeFile(join(s.temp.root, "operations", old.profileHash, `${old.operationId}.json`), `${canonicalJson(old)}\n`, { mode: 0o600 });
  s.clock.value = new Date(Date.parse(old.expiresAt) + 1000); const before = s.wrapping.loads;
  await assert.rejects(s.core.transfer.approve(old.operationId), { code: "APN_REPREPARE_REQUIRED" });
  const stored = (await s.state.findOperation(old.operationId))!;
  assert.equal(stored.integrityHash, old.integrityHash); assert.equal(stored.state, "awaiting_approval");
  assert.equal(s.wrapping.loads, before); assert.equal(s.approval.intents.length, 0); assert.equal(s.rpc.broadcastCount, 0);
});

test("recomputed fingerprint cannot rebind an existing prepared operation inside genuine native", async t => {
  const s = await prepared(t); await enterStarted(s); const evm = { ...s.operation.evm!, nativeCustody: { ...s.operation.evm!.nativeCustody!, providerRevision: 2 } };
  const forged = { ...s.operation, evm, fingerprint: evmDirectFingerprint({ ...s.operation, evm }) };
  const before = s.wrapping.loads;
  await assert.rejects(s.local.request({ requestId: "forged-native-binding", version: "apn.native.v1", operation: "directTransfer.approveAndSign",
    payload: evmCustodyPayload(forged) }), { code: "APN_NATIVE_PROTOCOL" });
  assert.equal(s.wrapping.loads, before); assert.equal(s.approval.intents.length, 0); assert.equal(s.rpc.broadcastCount, 0);
});

test("native reprepare rejection is retained as started ambiguity without effect-material decryption", async t => {
  const s = await prepared(t), before = s.wrapping.loads;
  const { ApnError } = await import("../../src/errors.js");
  s.approval.rejection = new ApnError("APN_REPREPARE_REQUIRED", "injected pre-secret native refusal");
  await assert.rejects(s.core.transfer.approve(s.operation.operationId), { code: "APN_REPREPARE_REQUIRED" });
  assert.equal((await s.state.findOperation(s.operation.operationId))!.state, "started");
  assert.equal(s.wrapping.loads, before); assert.equal(s.rpc.broadcastCount, 0);
});

test("provider drift while wrapping secret loads refuses before decrypt and signature creation", async t => {
  const s = await prepared(t), wallet = (await s.state.loadWallet(s.operation.profileHash))!;
  const load = s.wrapping.load.bind(s.wrapping);
  s.wrapping.load = async () => {
    await s.state.writeProviderProfile({ ...projectLegacyLocalProfile(wallet), revision: 2 });
    return await load();
  };
  await assert.rejects(s.core.transfer.approve(s.operation.operationId), { code: "APN_PROFILE_DRIFT" });
  assert.equal((await s.state.findOperation(s.operation.operationId))!.state, "started");
  assert.equal(s.rpc.broadcastCount, 0); assert.equal(s.approval.intents.length, 1);
});

test("old markerless signed window without matching public proof refuses and retains hashes without decrypt or send", async t => {
  const s = await prepared(t), worker = fileURLToPath(new URL("./evm-crash-worker.js", import.meta.url));
  const crashed = spawnSync(process.execPath, [worker, "sign-crash", s.temp.root, s.operation.operationId], { encoding: "utf8", timeout: 15000 });
  assert.equal(crashed.status, 74, crashed.stderr);
  const started = (await s.state.findOperation(s.operation.operationId))!;
  s.clock.value = new Date(Date.now() + 1000);
  const effect = await s.local.request({ requestId: "legacy-fixture-existing-effect", version: "apn.native.v1", operation: "effectMaterial.get",
    payload: { profile: started.profile, operationId: started.operationId, fingerprint: started.fingerprint, expectedPayloadHash: hashObject(evmCustodyPayload(started)) } }) as {
      transactionHash: `0x${string}`; rawTransactionHash: `0x${string}`;
    };
  const { nativeCustody: _, ...evm } = started.evm!;
  const { integrityHash: __, ...body } = started;
  const legacy = sealOperation({ ...body, evm, fingerprint: evmDirectFingerprint({ ...started, evm }), transactionHash: effect.transactionHash, rawTransactionHash: effect.rawTransactionHash,
    state: "signed_not_submitted", reason: "native_effect_material_bound", proofClass: "native_transaction_hash",
    transitions: appendTransition(started.transitions, { at: s.clock.now().toISOString(), state: "signed_not_submitted", terminal: false,
      reason: "native_effect_material_bound", proofClass: "native_transaction_hash" }) });
  validateOperation(legacy);
  await writeFile(join(s.temp.root, "operations", legacy.profileHash, `${legacy.operationId}.json`), `${canonicalJson(legacy)}\n`, { mode: 0o600 });
  const before = s.wrapping.loads;
  await assert.rejects(s.core.transfer.resume(legacy.operationId), { code: "APN_STATE_CORRUPT" });
  const retained = (await s.state.findOperation(legacy.operationId))!;
  assert.equal(retained.transactionHash, legacy.transactionHash); assert.equal(retained.fingerprint, legacy.fingerprint);
  assert.deepEqual(retained.transitions.slice(0, legacy.transitions.length), legacy.transitions);
  assert.equal(s.wrapping.loads, before); assert.equal(s.rpc.broadcastCount, 0);
});


test("async approval cannot mutate caller financial fields or the frozen native signing intent", async t => {
  const s = await prepared(t); await enterStarted(s);
  const caller = structuredClone(evmCustodyPayload(s.operation)) as Record<string, any>;
  const originalPayloadHash = hashObject(caller), originalDigest = s.operation.integrityHash;
  const original = s.approval.approve.bind(s.approval);
  let observedIntent: unknown;
  s.approval.approve = async intent => {
    await original(intent);
    await new Promise<void>(resolve => queueMicrotask(resolve));
    observedIntent = intent;
    caller.chainId = 1;
    caller.walletAddress = "0x3333333333333333333333333333333333333333";
    caller.approval.recipient = "0x3333333333333333333333333333333333333333";
    caller.approval.amountAtomic = "2"; caller.approval.amountDecimal = "0.000002";
    caller.transaction.to = "0x3333333333333333333333333333333333333333";
    caller.transaction.valueAtomic = "2"; caller.transaction.data = "0xdeadbeef";
    caller.transaction.nonceAtomic = "9"; caller.transaction.gasLimitAtomic = "99999";
    caller.transaction.maxFeePerGasAtomic = "1"; caller.transaction.maxPriorityFeePerGasAtomic = "1";
    caller.transaction.accessList.push({ address: caller.walletAddress, storageKeys: [] });
    caller.evm.transactionTo = caller.transaction.to; caller.evm.valueAtomic = "2"; caller.evm.maxFeeWei = "1";
    caller.evm.asset.chainId = 1; caller.evm.asset.address = caller.walletAddress; caller.evm.asset.decimals = 6;
    caller.evm.feeQuote.chainId = 1; caller.evm.feeQuote.totalQuoteWei = "1";
    caller.evm.nativeCustody.walletAddress = caller.walletAddress;
    caller.evm.nativeCustody.walletBindingHash = "f".repeat(64); caller.evm.nativeCustody.providerRevision = 999;
    assert.throws(() => { (intent as any).recipient = caller.approval.recipient; }, TypeError);
    assert.throws(() => { (intent as any).amountAtomic = "2"; }, TypeError);
    assert.throws(() => { (intent as any).evm.transactionTo = caller.transaction.to; }, TypeError);
    assert.throws(() => { (intent as any).evm.asset.chainId = 1; }, TypeError);
    assert.throws(() => { (intent as any).evm.nativeCustody.providerRevision = 999; }, TypeError);
    assert.throws(() => { (intent as any).evm.feeQuote.totalQuoteWei = "1"; }, TypeError);
  };
  const effect = await s.local.request({ requestId: "async-caller-mutation", version: "apn.native.v1", operation: "directTransfer.approveAndSign", payload: caller }) as { rawTransaction: `0x${string}` };
  const signed = parseTransaction(effect.rawTransaction), economy = s.operation.economics!;
  assert.equal(signed.chainId, s.operation.chainId); assert.equal(signed.to, s.operation.evm!.transactionTo);
  assert.equal(signed.value, BigInt(s.operation.evm!.valueAtomic)); assert.equal(signed.nonce, Number(economy.nonceAtomic));
  assert.equal(signed.data ?? "0x", s.operation.transactionData);
  assert.equal(signed.gas, BigInt(economy.gasLimitAtomic)); assert.equal(signed.maxFeePerGas, BigInt(economy.maxFeePerGasAtomic));
  assert.equal(signed.maxPriorityFeePerGas, BigInt(economy.maxPriorityFeePerGasAtomic));
  assert.ok(observedIntent); assert.notEqual(hashObject(caller), originalPayloadHash);
  assert.equal((await s.state.findOperation(s.operation.operationId))!.integrityHash, originalDigest);
  assert.equal(s.rpc.broadcastCount, 0); assert.equal(s.approval.intents.length, 1);
  const recovered = await s.local.request({ requestId: "async-mutation-effect-proof", version: "apn.native.v1", operation: "effectMaterial.get", payload: {
    profile: s.operation.profile, operationId: s.operation.operationId, fingerprint: s.operation.fingerprint, expectedPayloadHash: originalPayloadHash } });
  assert.equal((recovered as { transactionHash: string }).transactionHash, (effect as unknown as { transactionHash: string }).transactionHash);
  assert.equal("rawTransaction" in (recovered as object), false);
});

test("approval-time custody replacement cannot conceal real public provider drift", async t => {
  const s = await prepared(t); await enterStarted(s); const caller = structuredClone(evmCustodyPayload(s.operation)) as Record<string, any>;
  const wallet = (await s.state.loadWallet(s.operation.profileHash))!, before = s.wrapping.loads;
  const original = s.approval.approve.bind(s.approval);
  s.approval.approve = async intent => {
    await original(intent);
    await s.state.writeProviderProfile({ ...projectLegacyLocalProfile(wallet), revision: 2 });
    caller.evm.nativeCustody = { ...caller.evm.nativeCustody, providerRevision: 2 };
  };
  await assert.rejects(s.local.request({ requestId: "approval-custody-replacement", version: "apn.native.v1", operation: "directTransfer.approveAndSign", payload: caller }), { code: "APN_PROFILE_DRIFT" });
  assert.equal(s.wrapping.loads, before); assert.equal(s.approval.intents.length, 1); assert.equal(s.rpc.broadcastCount, 0);
  assert.equal((await s.state.findOperation(s.operation.operationId))!.integrityHash, s.operation.integrityHash);
});

test("generic native admission detaches nested payload before its first asynchronous state read", async t => {
  const s = await prepared(t); await enterStarted(s); const caller = structuredClone(evmCustodyPayload(s.operation)) as Record<string, any>;
  const pending = s.local.request({ requestId: "admission-immediate-mutation", version: "apn.native.v1", operation: "directTransfer.approveAndSign", payload: caller });
  caller.evm.transactionTo = "0x3333333333333333333333333333333333333333";
  caller.evm.asset.chainId = 1; caller.evm.nativeCustody.providerRevision = 999;
  const effect = await pending as { rawTransaction: `0x${string}` };
  const signed = parseTransaction(effect.rawTransaction);
  assert.equal(signed.to, s.operation.recipient); assert.equal(signed.chainId, s.operation.chainId);
  assert.equal((await s.state.findOperation(s.operation.operationId))!.integrityHash, s.operation.integrityHash);
  assert.equal(s.rpc.broadcastCount, 0); assert.equal(s.approval.intents.length, 1);
});

for (const variant of ["missing", "checksum", "attempt-hash", "wrong-profile", "signature", "domain", "phase", "fabricated-outcome", "wrong-public-key", "legacy-attempt", "stale-claim", "signed-conflict", "dispatch-conflict", "custody-change", "verification-custody-race", "lease-conflict", "late-signed-conflict", "late-dispatch-conflict", "late-lease-transition", "private-entry-error"] as const) {
  test(`no-private-entry ${variant}: recovery retains the canonical operation and never enters Native`, async t => {
    const s = await prepared(t), originalError = new Error("TEST-only pre-private callback failure");
    const loads = s.wrapping.loads;
    if (variant === "private-entry-error") {
      s.wrapping.load = async () => { s.wrapping.loads += 1; throw originalError; };
    } else s.approval.rejection = originalError;
    await assert.rejects(s.core.transfer.approve(s.operation.operationId), error => error === originalError);
    const started = (await s.state.findOperation(s.operation.operationId))!;
    assert.equal(started.state, "started"); assert.ok(started.allowlistLease);
    assert.equal(s.wrapping.loads - loads, variant === "private-entry-error" ? 1 : 0);
    const prefix = join(s.temp.root, "direct-public-effects", started.profileHash, started.operationId);
    const outcomePath = `${prefix}.no-private-entry.json`;
    if (variant === "private-entry-error") await assert.rejects(readFile(outcomePath), { code: "ENOENT" });
    else {
      const value = JSON.parse(await readFile(outcomePath, "utf8"));
      assert.equal(value.outcome, "native_approval_returned_before_private_entry");
      assert.equal(value.operationIntegrityHash, started.integrityHash);
      if (variant === "missing") await rm(outcomePath);
      if (["checksum", "attempt-hash", "wrong-profile", "signature", "domain", "phase", "fabricated-outcome", "wrong-public-key", "legacy-attempt"].includes(variant)) {
        if (variant === "checksum") value.integrityHash = "0".repeat(64);
        if (variant === "attempt-hash") value.signingRecordHash = "f".repeat(64);
        if (variant === "wrong-profile") value.binding.profile = "other";
        if (variant === "signature" || variant === "fabricated-outcome") value.controlFlowSignature = Buffer.alloc(64).toString("base64");
        if (variant === "domain") value.domain = "APN_WRONG_PREPRIVATE_DOMAIN";
        if (variant === "phase") value.phase = "after_private_entry";
        if (variant === "wrong-public-key" || variant === "legacy-attempt") {
          const markerPath = `${prefix}.signing.json`, marker = JSON.parse(await readFile(markerPath, "utf8"));
          if (variant === "wrong-public-key") marker.publicOutcomeKey = generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "der" }).toString("base64");
          else { marker.schemaVersion = "apn.direct-public-signing.v1"; delete marker.publicOutcomeKey; }
          await writeFile(markerPath, canonicalJson(marker)+"\n", { mode: 0o600 });
          value.signingRecordHash = hashObject(marker);
        }
        if (variant !== "checksum") { const { integrityHash: _, ...body } = value; value.integrityHash = hashObject(body); }
        await writeFile(outcomePath, canonicalJson(value)+"\n", { mode: 0o600 });
      }
      if (variant === "stale-claim") {
        const value = JSON.parse(await readFile(`${prefix}.prepared.json`, "utf8"));
        value.binding.payloadHash = "f".repeat(64);
        const { integrityHash: _, ...body } = value; value.integrityHash = hashObject(body);
        await writeFile(`${prefix}.prepared.json`, canonicalJson(value)+"\n", { mode: 0o600 });
      }
      if (variant === "signed-conflict") await writeFile(`${prefix}.signed.json`, "{}\n", { mode: 0o600 });
      if (variant === "dispatch-conflict") {
        const { mkdir } = await import("node:fs/promises");
        const directory = join(s.temp.root, "direct-submissions", started.profileHash); await mkdir(directory, { recursive: true, mode: 0o700 });
        await writeFile(join(directory, `${started.operationId}.json`), "{}\n", { mode: 0o600 });
      }
      if (variant === "custody-change") {
        const wallet = (await s.state.loadWallet(started.profileHash))!;
        await s.state.writeProviderProfile({ ...projectLegacyLocalProfile(wallet), revision: 2 });
      }
      if (variant === "verification-custody-race") {
        const original = DirectPublicEffectJournal.prototype.prepared; let changed = false;
        const mock = t.mock.method(DirectPublicEffectJournal.prototype, "prepared", async function(this: DirectPublicEffectJournal, operation: OperationRecord) {
          const value = await original.call(this, operation);
          if (!changed) { changed = true; const wallet = (await s.state.loadWallet(started.profileHash))!;
            await s.state.writeProviderProfile({ ...projectLegacyLocalProfile(wallet), revision: 2 }); }
          return value;
        });
        t.after(() => mock.mock.restore());
      }
      if (variant === "late-signed-conflict" || variant === "late-dispatch-conflict" || variant === "late-lease-transition") {
        const original = DirectPublicEffectJournal.prototype.prepared; let calls = 0, injected = false;
        const mock = t.mock.method(DirectPublicEffectJournal.prototype, "prepared", async function(this: DirectPublicEffectJournal, operation: OperationRecord) {
          const value = await original.call(this, operation);
          // Last authoritative read of the second full public verification, after the old conflict/lease checks.
          if (++calls === 8) {
            injected = true;
            if (variant === "late-signed-conflict") await writeFile(`${prefix}.signed.json`, "{}\n", { mode: 0o600 });
            if (variant === "late-dispatch-conflict") {
              const { mkdir } = await import("node:fs/promises");
              const directory = join(s.temp.root, "direct-submissions", started.profileHash);
              await mkdir(directory, { recursive: true, mode: 0o700 });
              await writeFile(join(directory, `${started.operationId}.json`), "{}\n", { mode: 0o600 });
            }
            if (variant === "late-lease-transition") {
              const r = started.allowlistLease!.reservation;
              await new AssetUsageLedger(s.temp.root).transition({ account: r.account, chain: r.chain, asset: r.asset,
                reservationId: r.reservationId, policyDigest: r.policyDigest, state: "submitted", now: s.clock.now() });
            }
          }
          return value;
        });
        t.after(() => { mock.mock.restore(); assert.equal(injected, true); });
      }
      if (variant === "lease-conflict") {
        const r = started.allowlistLease!.reservation;
        await new AssetUsageLedger(s.temp.root).transition({ account: r.account, chain: r.chain, asset: r.asset,
          reservationId: r.reservationId, policyDigest: r.policyDigest, state: "submitted", now: s.clock.now() });
      }
    }
    let recoveryNativeCalls = 0;
    const recovery = evmCore(s.temp.root, s.rpc, s.wrapping, undefined, () => ({ request: async () => {
      recoveryNativeCalls++; throw new Error("TEST recovery private access forbidden");
    } }));
    const beforeRecovery = s.wrapping.loads;
    for (let repeat = 0; repeat < 2; repeat++) await assert.rejects(recovery.core.transfer.resume(started.operationId), { code: "APN_OPERATION_BLOCKED" });
    const retained = (await s.state.findOperation(started.operationId))!;
    assert.equal(retained.integrityHash, started.integrityHash); assert.equal(retained.terminal, false);
    assert.equal(retained.economics!.nonceAtomic, started.economics!.nonceAtomic);
    assert.equal(s.wrapping.loads, beforeRecovery); assert.equal(recoveryNativeCalls, 0); assert.equal(s.rpc.broadcastCount, 0);
    const r = started.allowlistLease!.reservation;
    const held = (await new AssetUsageLedger(s.temp.root).load({ account: r.account, chain: r.chain, asset: r.asset }, r.reservationId))!;
    assert.equal(held.state, variant === "lease-conflict" || variant === "late-lease-transition" ? "submitted" : "reserved");
    assert.equal(held.amountAtomic, r.amountAtomic); assert.equal(held.reservationId, r.reservationId);
  });
}

test("authoritative custody mutation during failed approval cannot publish no-private-entry proof", async t => {
  const s = await prepared(t), error = new Error("TEST failed callback after on-disk custody mutation");
  const before = s.wrapping.loads;
  s.approval.approve = async () => {
    const wallet = (await s.state.loadWallet(s.operation.profileHash))!;
    await s.state.writeProviderProfile({ ...projectLegacyLocalProfile(wallet), revision: 2 });
    throw error;
  };
  await assert.rejects(s.core.transfer.approve(s.operation.operationId), e => e === error);
  const started = (await s.state.findOperation(s.operation.operationId))!;
  await assert.rejects(readFile(join(s.temp.root, "direct-public-effects", started.profileHash, `${started.operationId}.no-private-entry.json`)), { code: "ENOENT" });
  assert.equal(s.wrapping.loads, before); assert.equal(s.rpc.broadcastCount, 0);
  await assert.rejects(s.core.transfer.resume(started.operationId));
  assert.equal((await s.state.findOperation(started.operationId))!.integrityHash, started.integrityHash);
});

for (const variant of ["operation", "prepared-claim"] as const) test(`authoritative ${variant} mutation inside failed approval cannot prove no private entry`, async t => {
  const s = await prepared(t), error = new Error("TEST pre-private return after authoritative mutation"), before = s.wrapping.loads;
  s.approval.approve = async () => {
    const started = (await s.state.findOperation(s.operation.operationId))!;
    if (variant === "operation") {
      const { integrityHash: _, ...body } = started;
      const changed = sealOperation({ ...body, preparedBlockNumberAtomic: (BigInt(started.preparedBlockNumberAtomic!)+1n).toString() });
      validateOperation(changed);
      // The production write validator rejects this immutable change. Direct TEST-only disk replacement
      // models the requested authoritative-file tamper without relaxing that validator.
      await writeFile(join(s.temp.root, "operations", changed.profileHash, `${changed.operationId}.json`), canonicalJson(changed)+"\n", { mode: 0o600 });
    } else {
      const path = join(s.temp.root, "direct-public-effects", started.profileHash, `${started.operationId}.prepared.json`);
      const value = JSON.parse(await readFile(path, "utf8")); value.binding.payloadHash = "f".repeat(64);
      const { integrityHash: _, ...body } = value; value.integrityHash = hashObject(body);
      await writeFile(path, canonicalJson(value)+"\n", { mode: 0o600 });
    }
    throw error;
  };
  await assert.rejects(s.core.transfer.approve(s.operation.operationId), e => e === error);
  const retained = (await s.state.findOperation(s.operation.operationId))!;
  await assert.rejects(readFile(join(s.temp.root, "direct-public-effects", retained.profileHash, `${retained.operationId}.no-private-entry.json`)), { code: "ENOENT" });
  assert.equal(retained.state, "started"); assert.equal(retained.terminal, false);
  await assert.rejects(s.core.transfer.resume(retained.operationId));
  assert.equal((await s.state.findOperation(retained.operationId))!.integrityHash, retained.integrityHash);
  assert.equal(s.wrapping.loads, before); assert.equal(s.rpc.broadcastCount, 0);
});
