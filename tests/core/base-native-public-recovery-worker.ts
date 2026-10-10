import assert from "node:assert/strict";
import { keccak256, parseTransaction, serializeTransaction } from "viem";
import { readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { ApnCore } from "../../src/core.js";
import { TtyTransferApproval } from "../../src/tty-approval.js";
import { verifyEffect } from "../../src/transfer-policy.js";
import { LocalWalletNative } from "../../src/local-wallet-native.js";
import { DirectPublicEffectJournal } from "../../src/direct-public-effect.js";
import { directCustodyPayload } from "../../src/direct-public-effect.js";
import { hashObject, canonicalJson } from "../../src/canonical.js";
import { appendTransition, sealOperation, sealWallet } from "../../src/state-integrity.js";
import { StateStore } from "../../src/state.js";
import { EvmWrappingSecret, EvmTestRpc, EVM_REQUEST } from "./evm-helpers.js";
import { RECIPIENT, TestClock } from "./helpers.js";
import { projectLegacyLocalProfile } from "../../src/provider-profile.js";
import { activateDirectPolicy, evmDirectAdmissions } from "./direct-allowlist-helpers.js";
const [mode, root] = process.argv.slice(2); if (!root || !mode) throw new Error("Missing artificial fixture arguments");
const state = new StateStore(root), wrapping = new EvmWrappingSecret(), rpc = new EvmTestRpc(), clock = new TestClock(); clock.value = new Date();
const native = new LocalWalletNative(state, wrapping); // Genuine production terminal, never an approval callback.
rpc.receiptEnabled = false;
let physicalSends = 0, signCalls = 0;
const send = rpc.submitRawTransaction.bind(rpc);
rpc.submitRawTransaction = async raw => {
  if (mode === "crash-marked") process.exit(77);
  physicalSends++; await writeFile(join(root, "physical-sends.json"), String(physicalSends), { mode: 0o600 }); return await send(raw);
};
const request = native.request.bind(native);
const core = new ApnCore({ state, rpc, clock, native: { request: async value => {
  if (value.operation === "directTransfer.approveAndSign") signCalls++;
  const result = await request(value);
  if (value.operation === "directTransfer.approveAndSign" && mode === "dispatch-custody-change") {
    const op = (await state.findOperation(value.payload.operationId as string))!, wallet = (await state.loadWallet(op.profileHash))!, { integrityHash: _, ...body } = wallet;
    await state.writeWallet(sealWallet({ ...body, bindingHash: "a".repeat(64) }));
  }
  if (value.operation === "directTransfer.approveAndSign" && ["lost-response", "generic-started", "crash-signed", "tamper"].includes(mode)) {
    if (mode === "crash-signed") process.exit(78);
    throw new Error("synthetic response lost after durable signed proof");
  }
  return result;
} } });
let id: string;
if (mode.startsWith("restart-")) id = await readFile(join(root, "operation-id.txt"), "utf8");
else {
  const wallet = await core.wallet.ensure("default") as { address: typeof RECIPIENT }; rpc.sender = wallet.address; rpc.balances = { ...rpc.balances, address: wallet.address };
  await activateDirectPolicy(root, "default", { accounts: { evm: wallet.address }, admissions: evmDirectAdmissions(), now: clock.now() });
  const prepared = await core.transfer.prepare(["generic-started", "old-awaiting-generic", "attempt-awaiting-generic"].includes(mode) ? EVM_REQUEST : {
    command: "transfer.prepare", profile: "default", idempotencyKey: "genuine-legacy-test", recipient: RECIPIENT, amount: "1.25" }) as { operation_id: string };
  id = prepared.operation_id; await writeFile(join(root, "operation-id.txt"), id, { mode: 0o600 });
  if (mode.startsWith("old-awaiting") || mode === "attempt-awaiting-generic") {
    const op = (await state.findOperation(id))!, before = wrapping.loads, reads = rpc.balanceCalls + rpc.nonceCalls + rpc.genericBalanceCalls;
    if (mode === "attempt-awaiting-generic") await new DirectPublicEffectJournal(state).beginSigning(op);
    else await rm(join(root, "direct-public-effects", op.profileHash), { recursive: true });
    clock.value = new Date(Date.parse(op.expiresAt)+1000);
    await assert.rejects(core.transfer.approve(id), { code: "APN_OPERATION_BLOCKED" });
    if (["old-awaiting-generic", "attempt-awaiting-generic"].includes(mode)) await assert.rejects(core.transfer.prepare({ ...EVM_REQUEST, idempotencyKey: "cannot-retire-unknown-old-effect" }), { code: "APN_OPERATION_BLOCKED" });
    assert.equal((await state.findOperation(id))!.integrityHash, op.integrityHash);
    assert.equal(wrapping.loads, before); assert.equal(physicalSends, 0); assert.equal(signCalls, 0);
    assert.equal(rpc.balanceCalls+rpc.nonceCalls+rpc.genericBalanceCalls, reads);
    console.log("RESULT:"+JSON.stringify({ mode, recoveryKeyLoads: 0, recoverySends: 0, recoverySigns: 0, state: op.state })); process.exit(0);
  }
  if (mode === "dispatch-verification-race") {
    const message = DirectPublicEffectJournal.prototype.attestationMessage;
    let changed = false;
    DirectPublicEffectJournal.prototype.attestationMessage = async function(operation, effect) {
      const result = await message.call(this, operation, effect);
      const marked = await readFile(join(root, "direct-submissions", operation.profileHash, `${id}.json`), "utf8").then(() => true, () => false);
      if (marked && !changed) {
        changed = true;
        const wallet = (await state.loadWallet(operation.profileHash))!;
        await state.writeProviderProfile({ ...projectLegacyLocalProfile(wallet), revision: 2 });
      }
      return result;
    };
  }
  const beforeApprovalKeys = wrapping.loads;
  let immutableSnapshot: { operationHash: string; preparedBytes: string; signingBytes: string; walletHash: string; providerHash: string } | undefined;
  if (mode === "old-intent-mutation") {
    const approve = TtyTransferApproval.prototype.approve;
    TtyTransferApproval.prototype.approve = async function(intent) {
      await approve.call(this, intent);
      assert.equal(Object.isFrozen(intent), true);
      const op = (await state.findOperation(id))!, prefix = join(root, "direct-public-effects", op.profileHash, id);
      immutableSnapshot = { operationHash: op.integrityHash, preparedBytes: await readFile(`${prefix}.prepared.json`, "utf8"),
        signingBytes: await readFile(`${prefix}.signing.json`, "utf8"), walletHash: hashObject(await state.loadWallet(op.profileHash)),
        providerHash: hashObject(await state.loadProviderProfile(op.profileHash)) };
      for (const [field, value] of Object.entries({ nonceAtomic: "9", transactionData: "0xdeadbeef", recipient: "0x1111111111111111111111111111111111111111", gasLimitAtomic: "21000", maxFeePerGasAtomic: "1", maxPriorityFeePerGasAtomic: "1", fingerprint: "a".repeat(64), walletAddress: RECIPIENT })) {
        assert.throws(() => { (intent as unknown as Record<string, unknown>)[field] = value; }, TypeError);
      }
      throw new Error("TEST rejected immutable intent mutation after genuine approval");
    };
  }
  if (mode === "crash-approval-started") TtyTransferApproval.prototype.approve = async () => { process.exit(79); };
  if (mode === "before-public") DirectPublicEffectJournal.prototype.publish = async () => { throw new Error("crash after encrypted save before public proof"); };
  try { await core.transfer.approve(id); }
  catch (error) { if (!["lost-response", "generic-started", "before-public", "dispatch-custody-change", "tamper", "dispatch-verification-race", "old-intent-mutation", "genuine-decline"].includes(mode)) throw error; }
  if (mode === "old-intent-mutation") { assert.equal(wrapping.loads, beforeApprovalKeys); assert.equal(physicalSends, 0); }
  if (["old-intent-mutation", "genuine-decline"].includes(mode)) {
    const declined = (await state.findOperation(id))!, prefix = join(root, "direct-public-effects", declined.profileHash, id);
    assert.equal(declined.state, "started");
    const preparedBytes = await readFile(`${prefix}.prepared.json`, "utf8"), signingBytes = await readFile(`${prefix}.signing.json`, "utf8");
    if (immutableSnapshot !== undefined) {
      assert.equal(declined.integrityHash, immutableSnapshot.operationHash);
      assert.equal(preparedBytes, immutableSnapshot.preparedBytes); assert.equal(signingBytes, immutableSnapshot.signingBytes);
      assert.equal(hashObject(await state.loadWallet(declined.profileHash)), immutableSnapshot.walletHash);
      assert.equal(hashObject(await state.loadProviderProfile(declined.profileHash)), immutableSnapshot.providerHash);
    }
    const proofBytes = await readFile(`${prefix}.no-private-entry.json`, "utf8"), proof = JSON.parse(proofBytes);
    assert.equal(proof.operationIntegrityHash, declined.integrityHash);
    assert.equal(proof.outcome, "native_approval_returned_before_private_entry");
    const beforeKeys = wrapping.loads, beforeSigns = signCalls;
    await assert.rejects(core.transfer.resume(id), { code: "APN_REPREPARE_REQUIRED" });
    const ended = (await state.findOperation(id))!;
    assert.equal(ended.state, "failed_before_effect"); assert.equal(ended.terminal, true);
    assert.equal(ended.economics!.nonceAtomic, declined.economics!.nonceAtomic);
    assert.equal(hashObject(directCustodyPayload(ended)), hashObject(directCustodyPayload(declined)));
    assert.equal((await core.transfer.resume(id) as { state: string }).state, "failed_before_effect");
    assert.equal((await state.findOperation(id))!.integrityHash, ended.integrityHash);
    await core.transfer.status(id);
    await assert.rejects(native.request({ requestId: "no-private-repeat-sign", version: "apn.native.v1", operation: "directTransfer.approveAndSign", payload: directCustodyPayload(ended) }));
    await assert.rejects(native.request({ requestId: "no-private-effect-probe", version: "apn.native.v1", operation: "effectMaterial.get", payload: {
      profile: ended.profile, operationId: id, fingerprint: ended.fingerprint, expectedPayloadHash: hashObject(directCustodyPayload(ended)) } }));
    await native.request({ requestId: "public-description-test", version: "apn.native.v1", operation: "wallet.describe", payload: { profile: "default" } });
    assert.equal(await readFile(`${prefix}.prepared.json`, "utf8"), preparedBytes);
    assert.equal(await readFile(`${prefix}.signing.json`, "utf8"), signingBytes);
    assert.equal(await readFile(`${prefix}.no-private-entry.json`, "utf8"), proofBytes);
    assert.equal(wrapping.loads, beforeKeys); assert.equal(wrapping.loads, beforeApprovalKeys);
    assert.equal(physicalSends, 0); assert.equal(signCalls, beforeSigns);
    console.log("RESULT:"+JSON.stringify({ mode, recoveryKeyLoads: 0, recoverySends: 0, recoverySigns: 0,
      immutableOperationHash: immutableSnapshot?.operationHash ?? null, declinedOperationHash: declined.integrityHash,
      preparedRecordHash: hashObject(JSON.parse(preparedBytes)), signingRecordHash: hashObject(JSON.parse(signingBytes)), state: ended.state }));
    process.exit(0);
  }
}
let op = (await state.findOperation(id))!;
if (mode === "fresh") {
  const raw = rpc.submissions[0]!;
  const transaction = parseTransaction(raw);
  if (transaction.type !== "eip1559") throw new Error("TEST requires the genuine EIP1559 effect");
  await verifyEffect({ rawTransaction: raw, transactionHash: keccak256(raw), rawTransactionHash: keccak256(raw) }, op);
  for (const changed of [{ nonce: transaction.nonce! + 1 }, { data: "0xdeadbeef" as const }, { to: RECIPIENT }, { maxFeePerGas: transaction.maxFeePerGas! + 1n }, { maxPriorityFeePerGas: transaction.maxPriorityFeePerGas! + 1n }]) {
    const different = serializeTransaction({ ...transaction, ...changed }, { r: transaction.r!, s: transaction.s!, yParity: transaction.yParity! });
    await assert.rejects(verifyEffect({ rawTransaction: different, transactionHash: keccak256(different), rawTransactionHash: keccak256(different) }, op), { code: "APN_NATIVE_PROTOCOL" });
  }
  await assert.rejects(verifyEffect({ rawTransaction: raw, transactionHash: `0x${"f".repeat(64)}`, rawTransactionHash: keccak256(raw) }, op), { code: "APN_NATIVE_PROTOCOL" });
}
if (mode.startsWith("restart-")) {
  physicalSends = Number(await readFile(join(root, "physical-sends.json"), "utf8").catch(() => "0"));
  rpc.sender = op.walletAddress; rpc.balances = { ...rpc.balances, address: op.walletAddress };
}
if (mode === "old-attempt-signed") {
  const path = join(root, "direct-public-effects", op.profileHash, `${id}.signing.json`);
  const marker = JSON.parse(await readFile(path, "utf8"));
  delete marker.publicOutcomeKey; marker.schemaVersion = "apn.direct-public-signing.v1";
  await writeFile(path, canonicalJson(marker)+"\n", { mode: 0o600 });
}
if (["signed", "unknown"].includes(mode)) {
  const next = mode === "signed" ? "signed_not_submitted" : "unknown_finality";
  const { integrityHash: _, ...body } = op;
  op = sealOperation({ ...body, state: next, reason: "artificial_retained_state", proofClass: "test_existing_effect",
    transitions: appendTransition(op.transitions, { at: clock.now().toISOString(), state: next, terminal: false, reason: "artificial_retained_state", proofClass: "test_existing_effect" }) });
  await state.writeOperation(op);
}
if (mode === "receipt-mismatch") rpc.receipt = { transactionHash: `0x${"f".repeat(64)}`, blockNumberAtomic: "12345", status: "success", observedAt: clock.now().toISOString(), rpcOrigin: rpc.rpcOrigin, logs: [] };
if (mode === "missing-old") await rm(join(root, "direct-public-effects", op.profileHash), { recursive: true });
if (["tamper", "forged-attestation", "clone-wrong-op", "clone-wrong-wallet"].includes(mode)) {
  const path = join(root, "direct-public-effects", op.profileHash, `${id}.signed.json`);
  const value = JSON.parse(await readFile(path, "utf8"));
  if (mode === "tamper") { value.transactionHash = `0x${"f".repeat(64)}`; value.rawTransactionHash = value.transactionHash; }
  if (mode === "forged-attestation") value.attestation = `0x${"11".repeat(64)}1b`;
  if (mode === "clone-wrong-op") value.binding.operationId = "f".repeat(64);
  if (mode === "clone-wrong-wallet") value.binding.custody.walletAddress = RECIPIENT;
  const { integrityHash: _, ...body } = value; value.integrityHash = hashObject(body);
  await writeFile(path, canonicalJson(value)+"\n", { mode: 0o600 });
}
if (mode === "custody-change") {
  const wallet = (await state.loadWallet(op.profileHash))!, { integrityHash: _, ...body } = wallet;
  await state.writeWallet(sealWallet({ ...body, bindingHash: "a".repeat(64) }));
}
if (mode === "verification-race") {
  const message = DirectPublicEffectJournal.prototype.attestationMessage;
  let changed = false;
  DirectPublicEffectJournal.prototype.attestationMessage = async function(operation, effect) {
    const result = await message.call(this, operation, effect);
    if (!changed) {
      changed = true;
      const wallet = (await state.loadWallet(op.profileHash))!;
      await state.writeProviderProfile({ ...projectLegacyLocalProfile(wallet), revision: 2 });
    }
    return result;
  };
}
const beforeKeys = wrapping.loads, beforeSends = physicalSends, beforeSigns = signCalls;
const blocked = ["missing-old", "tamper", "custody-change", "before-public", "dispatch-custody-change", "forged-attestation", "clone-wrong-op", "clone-wrong-wallet", "verification-race", "dispatch-verification-race", "old-intent-mutation", "restart-crash-approval-started"].includes(mode);
for (let repeat = 0; repeat < 2; repeat++) {
  if (blocked) await assert.rejects(core.transfer.resume(id));
  else {
    const result = await core.transfer.resume(id) as { transaction_hash: string; state: string };
    assert.equal(result.transaction_hash, op.transactionHash ?? (await new DirectPublicEffectJournal(state).effect((await state.findOperation(id))!)).transactionHash);
    assert.ok(["unknown_finality", "submitted_pending"].includes(result.state));
  }
  await core.transfer.status(id);
  await assert.rejects(core.transfer.approve(id), { code: "APN_OPERATION_BLOCKED" });
}
assert.equal(wrapping.loads, beforeKeys); assert.equal(physicalSends, beforeSends); assert.equal(signCalls, beforeSigns);
await assert.rejects(native.request({ requestId: "reject-repeat-signing", version: "apn.native.v1", operation: "directTransfer.approveAndSign", payload: directCustodyPayload((await state.findOperation(id))!) }));
assert.equal(wrapping.loads, beforeKeys);
assert.equal((await state.findOperation(id))!.terminal, false);
const stored = (await state.findOperation(id))!;
assert.equal(stored.economics!.nonceAtomic, op.economics!.nonceAtomic);
if (["before-public", "restart-crash-approval-started"].includes(mode)) assert.equal(stored.state, "started");
if (mode === "restart-crash-approval-started") {
  await assert.rejects(readFile(join(root, "direct-public-effects", stored.profileHash, `${id}.no-private-entry.json`)), { code: "ENOENT" });
  const marker = JSON.parse(await readFile(join(root, "direct-public-effects", stored.profileHash, `${id}.signing.json`), "utf8"));
  assert.equal(marker.schemaVersion, "apn.direct-public-signing.v2");
}
const probeRequest = { requestId: "public-effect-probe", version: "apn.native.v1" as const, operation: "effectMaterial.get" as const,
  payload: { profile: stored.profile, operationId: id, fingerprint: stored.fingerprint, expectedPayloadHash: hashObject(directCustodyPayload(stored)) } };
if (blocked) await assert.rejects(native.request(probeRequest));
else {
  const probe = await native.request(probeRequest);
  assert.deepEqual(Object.keys(probe as object).sort(), ["rawTransactionHash", "transactionHash"]);
}
assert.equal(wrapping.loads, beforeKeys);
if (!blocked) {
  const publicProof = await new DirectPublicEffectJournal(state).effect(stored);
  assert.deepEqual(Object.keys(publicProof).sort(), ["rawTransactionHash", "transactionHash"]);
}
const describe = () => native.request({ requestId: "public-description-test", version: "apn.native.v1", operation: "wallet.describe", payload: { profile: "default" } });
if (["custody-change", "dispatch-custody-change"].includes(mode)) await assert.rejects(describe()); else await describe();
assert.equal(wrapping.loads, beforeKeys);
console.log("RESULT:"+JSON.stringify({ mode, physicalSends, signCalls, recoveryKeyLoads: wrapping.loads-beforeKeys, recoverySends: physicalSends-beforeSends, recoverySigns: signCalls-beforeSigns, state: stored.state }));
