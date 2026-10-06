import { secp256k1 } from "@noble/curves/secp256k1";
import assert from "node:assert/strict";
import test from "node:test";
import { LocalWalletNative } from "../../src/local-wallet-native.js";
import { EncryptedWalletStore, walletCustodyLock, type WalletSecretState } from "../../src/encrypted-wallet-store.js";
import { SecureStateStore } from "../../src/secure-state-store.js";
import { StateStore } from "../../src/state.js";
import { Permit2ProductionSigningFence } from "../../src/x402-permit2/production-signing-fence.js";
import { Permit2ForegroundApprovalAuthority } from "../../src/x402-permit2/production-approval-provenance.js";
import { Permit2ProductionJournal } from "../../src/x402-permit2/production-journal.js";
import { validatePermit2ProductionSigned } from "../../src/x402-permit2/production-signed.js";
import { recoverPermit2Payer } from "../../src/x402-permit2/authorization.js";
import { reconstructPermit2ProductionMaterial } from "../../src/x402-permit2/production-material.js";
import { journalFixture } from "./x402-permit2-production-journal-fixture.js";
import { protocolSecond } from "./x402-permit2-production-protocol-fixture.js";
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; };
async function setup(t: test.TestContext, sponsor = false, maxTimeoutSeconds = 60) {
  const f = await journalFixture(t, sponsor, maxTimeoutSeconds); (f.input as { mode: string }).mode = "expired_unused";
  f.wire.finalized.timestamp = `0x${protocolSecond.toString(16)}`;
  let decrypts = 0, cleared: WalletSecretState | undefined;
  const wrapping = { load: async () => { decrypts++; return Buffer.alloc(32, 7); }, create: async () => { throw new Error("No creation"); } };
  const store = new EncryptedWalletStore(f.state, wrapping);
  await store.save({ profile: "owner", address: f.record.material.wallet.account, chainId: 8453,
    createdAt: f.record.createdAt, bindingHash: f.record.material.wallet.bindingHash },
  { version: "apn.wallet-secret.v1", privateKey: `0x${"1".repeat(64)}`, directEffects: {}, x402Effects: {} }, Buffer.alloc(32, 7));
  const native = new LocalWalletNative(f.state, wrapping), fence = new Permit2ProductionSigningFence(f.root, f.input.rpcUrl, f.now);
  const capability = LocalWalletNative.resolvePermit2LocalCapability(native, f.root);
  const proof = await new Permit2ForegroundApprovalAuthority(f.journal, {}, native, capability, { approve: async () => {} }, f.now).approveOwned(f.record.operationId);
  const result = await f.journal.markApprovedSignatureRisk(f.record.operationId, proof); assert.ok(result.continuation);
  const originalClear = EncryptedWalletStore.prototype.clear;
  t.mock.method(EncryptedWalletStore.prototype, "clear", function(this: EncryptedWalletStore, secret: WalletSecretState) { originalClear.call(this, secret); cleared = secret; });
  return { ...f, native, fence, continuation: result.continuation, decrypts: () => decrypts, cleared: () => cleared,
    sign: () => native.signPermit2Production(f.journal, fence, f.record.operationId, result.continuation!) };
}
for (const sponsor of [false, true]) test(`actual encrypted local signer persists canonical ${sponsor ? "sponsored" : "allowance"} bundle and clears custody`, async t => {
  const f = await setup(t, sponsor);
  t.mock.method(f.native, "request", async () => { throw new Error("No request/reentrant custody path"); });
  (f.native as any).wallets = { describe: async () => { throw new Error("Reflected store cannot sign"); } };
  (f.native as any).state = new StateStore(`${f.root}/foreign`);
  // Public overrides cannot substitute the actual private fence implementation.
  t.mock.method(f.fence, "checkScoped", async () => { throw new Error("Public override ignored"); });
  t.mock.method(f.fence, "consumeScoped", async () => { throw new Error("Public override ignored"); });
  const result = await f.sign(), saved = (await f.journal.findOperation(f.record.operationId))!;
  assert.deepEqual(result.signingOrigin, { kind: "permit2-native-signing-origin" });
  assert.equal(Object.isFrozen(result.signingOrigin), true); assert.equal(Object.getOwnPropertyNames(result.signingOrigin).length, 1);
  const signed = saved.exposureJournal!.signed!; await validatePermit2ProductionSigned(signed, saved);
  const plan = reconstructPermit2ProductionMaterial(saved.material).plan;
  assert.equal((await recoverPermit2Payer(plan.permit2, signed.permit2Signature)).toLowerCase(), f.record.material.wallet.account.toLowerCase());
  assert.equal(signed.eip2612Signature === null, !sponsor);
  assert.equal(f.decrypts(), 1); assert.equal(f.cleared()!.privateKey, `0x${"0".repeat(64)}`);
  assert.equal((await f.lease()).state, "unknown_finality");
  for (const privateValue of [signed.permit2Signature, signed.paymentSignatureHeader, f.record.material.checked.request.url])
    assert.equal(JSON.stringify(result).includes(privateValue), false);
  await assert.rejects(f.sign()); assert.equal(f.decrypts(), 1);
});
test("raw cloned foreign native/journal/op/root/fence grants refuse before real decrypt", async t => {
  const f = await setup(t), id = f.record.operationId;
  for (const grant of [{ kind: f.continuation.kind }, { ...f.continuation }, JSON.parse(JSON.stringify(f.continuation))])
    await assert.rejects(f.native.signPermit2Production(f.journal, f.fence, id, grant));
  const other = new LocalWalletNative(f.state, { load: async () => { throw new Error("Foreign native key"); }, create: async () => { throw new Error("No create"); } });
  await assert.rejects(other.signPermit2Production(f.journal, f.fence, id, f.continuation));
  await assert.rejects(f.native.signPermit2Production(new Permit2ProductionJournal(f.root, f.preparation, f.now), f.fence, id, f.continuation));
  await assert.rejects(f.native.signPermit2Production(f.journal, f.fence, "f".repeat(64), f.continuation));
  for (const fence of [Object.create(Permit2ProductionSigningFence.prototype),
    { withScope: async (_id: unknown, _mode: unknown, action: any) => action({ kind: "permit2-metadata-lock-scope" }) },
    new Permit2ProductionSigningFence(`${f.root}/other`, f.input.rpcUrl, f.now),
    new (class extends Permit2ProductionSigningFence {})(f.root, f.input.rpcUrl, f.now)])
    await assert.rejects(f.native.signPermit2Production(f.journal, fence as Permit2ProductionSigningFence, id, f.continuation));
  const fakeJournal = { root: f.root, claimNativeSigningContinuation: async () => f.record,
    assertNativeSigningContinuation: async () => f.record, nativeSigningSecond: () => protocolSecond + 1,
    releaseNativeSigningContinuation: () => {}, storeSigned: async () => f.record };
  await assert.rejects(f.native.signPermit2Production(fakeJournal as unknown as Permit2ProductionJournal, f.fence, id, f.continuation));
  assert.equal(f.decrypts(), 0); await f.sign(); assert.equal(f.decrypts(), 1);
});
test("actual custody lock wait expires UI grant before decrypt", async t => {
  const f = await setup(t), entered = deferred(), release = deferred();
  const holder = f.state.withLocks([walletCustodyLock(f.state, "owner")], async () => { entered.resolve(); await release.promise; });
  await entered.promise; const signing = f.sign(); await new Promise(r => setTimeout(r, 30)); f.advance(62); release.resolve();
  await holder; await assert.rejects(signing); assert.equal(f.decrypts(), 0);
});
for (const fault of ["expiry", "payer_code", "lease", "chain"] as const) test(`post-decrypt ${fault} denies signature bundle and clears before custody release`, async t => {
  const f = await setup(t, true), original = EncryptedWalletStore.prototype.describe;
  t.mock.method(EncryptedWalletStore.prototype, "describe", async function(this: EncryptedWalletStore, profile: string) {
    const loaded = await original.call(this, profile);
    if (fault === "expiry") f.advance(62);
    if (fault === "chain") f.wire.chain = "0x1";
    if (fault === "lease") await f.usage.transition({ ...await import("../../src/x402-permit2/production-repository.js").then(m => m.productionUsageIdentity(f.record)),
      reservationId: f.record.usageReservationId, policyDigest: f.record.material.owner.policyDigest, state: "finalized", outcomeDigest: "e".repeat(64), expectedCurrentStates: ["unknown_finality"], now: f.now() });
    if (fault === "payer_code") f.wire.payerCode = "0x01";
    return loaded;
  });
  await assert.rejects(f.sign()); assert.equal(f.decrypts(), 1); assert.ok(f.cleared());
  assert.equal(f.cleared()!.privateKey, `0x${"0".repeat(64)}`); assert.equal((await f.journal.findOperation(f.record.operationId))!.exposureJournal!.signed, null);
  await assert.rejects(f.sign()); assert.equal(f.decrypts(), 1);
});
test("deferred describe drains and clears an expired late secret before actual custody unlock", async t => {
  const f = await setup(t), entered = deferred(), release = deferred(), original = EncryptedWalletStore.prototype.describe;
  t.mock.method(EncryptedWalletStore.prototype, "describe", async function(this: EncryptedWalletStore, profile: string) {
    const loaded = await original.call(this, profile); entered.resolve(); await release.promise; return loaded;
  });
  const signing = f.sign(); await entered.promise; let acquired = false;
  const contender = f.state.withLocks([walletCustodyLock(f.state, "owner")], async () => { acquired = true; assert.ok(f.cleared()); });
  f.advance(62); await new Promise(r => setTimeout(r, 30)); assert.equal(acquired, false); release.resolve();
  await assert.rejects(signing); await contender; assert.equal(acquired, true); assert.equal(f.decrypts(), 1);
});
test("store failure occurs after custody release with cleared secret and preserves held risk", async t => {
  const f = await setup(t); let writes = 0;
  const original = (SecureStateStore.prototype as any).writeJson;
  t.mock.method(SecureStateStore.prototype as any, "writeJson", async function(this: SecureStateStore, path: string, value: any, ...rest: any[]) {
    if (value?.exposureJournal?.signed != null) {
      writes++; assert.ok(f.cleared());
      await f.state.withLocks([walletCustodyLock(f.state, "owner")], async () => {}); throw new Error("Synthetic store failure");
    }
    return (original as any).call(this, path, value, ...rest);
  });
  await assert.rejects(f.sign()); assert.equal(writes, 1); assert.equal((await f.lease()).state, "unknown_finality");
  await assert.rejects(f.sign()); assert.equal(f.decrypts(), 1); assert.equal(writes, 1);
});

for (const fault of ["owner", "expired", "identity", "describe"] as const) test(`actual signer ${fault} fault preserves hold and consumes no retry`, async t => {
  const f = await setup(t);
  if (fault === "owner") await f.revoke();
  if (fault === "expired") f.advance(120);
  if (fault === "describe") t.mock.method(EncryptedWalletStore.prototype, "describe", async () => { throw new Error("Synthetic decrypt failure"); });
  if (fault === "identity") {
    const original = EncryptedWalletStore.prototype.describe;
    t.mock.method(EncryptedWalletStore.prototype, "describe", async function(this: EncryptedWalletStore, profile: string) {
      const loaded = await original.call(this, profile); assert.ok(loaded);
      return { ...loaded, identity: { ...loaded.identity, address: "0x2222222222222222222222222222222222222222" } };
    });
  }
  await assert.rejects(f.sign());
  assert.equal((await f.journal.findOperation(f.record.operationId))!.exposureJournal!.signed, null);
  assert.equal((await f.lease()).state, "unknown_finality");
  if (fault === "identity") assert.equal(f.cleared()!.privateKey, `0x${"0".repeat(64)}`);
  const decrypts = f.decrypts(); await assert.rejects(f.sign()); assert.equal(f.decrypts(), decrypts);
});
test("fresh fence failure after optional token signing ends the partial attempt without a second decrypt", async t => {
  const f = await setup(t, true); let fences = 0;
  f.wire.beforeBatch = async calls => {
    if (calls.some(c => c.method === "eth_chainId") && calls.some(c => c.method === "eth_getBlockByNumber" && c.params[0] === "finalized"))
      if (++fences === 4) f.wire.chain = "0x1";
  };
  await assert.rejects(f.sign()); assert.equal(fences, 4); assert.equal(f.decrypts(), 1);
  assert.equal((await f.journal.findOperation(f.record.operationId))!.exposureJournal!.signed, null);
  await assert.rejects(f.sign()); assert.equal(f.decrypts(), 1); assert.equal(f.cleared()!.privateKey, `0x${"0".repeat(64)}`);
});

test("deadline expiry after successful signed persistence produces no signing origin", async t => {
  const f = await setup(t), original = (SecureStateStore.prototype as any).writeJson;
  t.mock.method(SecureStateStore.prototype as any, "writeJson", async function(this: SecureStateStore, path: string, value: any, ...rest: any[]) {
    const result = await original.call(this, path, value, ...rest);
    if (value?.exposureJournal?.signed != null) f.advance(62);
    return result;
  });
  await assert.rejects(f.sign()); assert.equal(f.decrypts(), 1); assert.ok(f.cleared());
  assert.ok((await f.journal.findOperation(f.record.operationId))!.exposureJournal!.signed);
  await assert.rejects(f.sign()); assert.equal(f.decrypts(), 1);
});

for (const point of ["describe", "token", "permit2"] as const) test(`await-resumption expiry immediately before ${point} prevents new decrypt or signature`, async t => {
  const f = await setup(t, point !== "describe", 120), original = Permit2ProductionJournal.assertNativeSigningContinuation;
  const originalSign = secp256k1.sign; let signatures = 0, assertions = 0;
  t.mock.method(secp256k1, "sign", (...args: Parameters<typeof originalSign>) => { signatures++; return originalSign(...args); });
  const cutoff = point === "describe" ? 3 : point === "token" ? 10 : 17;
  t.mock.method(Permit2ProductionJournal, "assertNativeSigningContinuation", async (...args: Parameters<typeof original>) => {
    const record = await original(...args);
    if (++assertions === cutoff) queueMicrotask(() => f.advance(62));
    return record;
  });
  await assert.rejects(f.sign());
  assert.equal(f.decrypts(), point === "describe" ? 0 : 1);
  assert.equal(signatures, point === "permit2" ? 1 : 0);
  assert.equal((await f.journal.findOperation(f.record.operationId))!.exposureJournal!.signed, null);
});
test("reflected journal clock cannot revive an expired genuine private UI clock", async t => {
  const f = await setup(t, false, 120), originalSign = secp256k1.sign; let signatures = 0;
  t.mock.method(secp256k1, "sign", (...args: Parameters<typeof originalSign>) => { signatures++; return originalSign(...args); });
  f.advance(62); f.wire.finalized.timestamp = `0x${(protocolSecond + 62).toString(16)}`;
  (f.journal as any).clock = () => new Date((protocolSecond + 1) * 1000);
  assert.ok(BigInt(reconstructPermit2ProductionMaterial(f.record.material).expiresAtUnix) > BigInt(protocolSecond + 62));
  await assert.rejects(f.sign()); assert.equal(f.decrypts(), 0); assert.equal(signatures, 0);
});
