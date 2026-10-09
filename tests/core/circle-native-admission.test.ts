import { sealWallet } from "../../src/state-integrity.js";
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, readFile, rm, realpath } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { encodeFunctionResult } from "viem";
import { StateStore } from "../../src/state.js";
import { canonicalJson, hashObject } from "../../src/canonical.js";
import { evmNativeCustody } from "../../src/evm-native-custody.js";
import { verifyCircleNativeAdmission, recheckCircleNativeAdmission } from "../../src/circle-native-admission.js";
import { OperationService } from "../../src/operation-service.js";
import { sealCircle, advanceCircle } from "../../src/circle-v2-evm/operation-model.js";
import { sourceReady } from "./circle-native-admission-fixture.js";
import { source, observation, event } from "./circle-v2-evm-runtime-fixtures.js";
import { CIRCLE_SOURCE_OWNER, CIRCLE_SOURCE_TOKEN, CIRCLE_MESSENGER } from "../../src/circle-v2-evm/catalog.js";
import { CIRCLE_RPC_ABI } from "../../src/circle-v2-evm/rpc.js";
import { decodeCircleSource, verifyCircleApproval, encodeCircleApproval } from "../../src/circle-v2-evm/protocol.js";
import { evmCore, ensureDirectWallet, EvmTestRpc } from "./evm-helpers.js";
import { activateDirectPolicy, evmDirectAdmissions } from "./direct-allowlist-helpers.js";
import type { RpcPort } from "../../src/ports.js";
import type { OperationRecord } from "../../src/model.js";

async function setup() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "circle-native-admission-"))), core = evmCore(root);
  core.rpc.chainId = 42161; core.rpc.l1Fee = 0n; core.rpc.operatorFee = 0n; core.rpc.fees = { gasLimitAtomic: "21000", maxFeePerGasAtomic: "20000000", maxPriorityFeePerGasAtomic: "0" };
  const recipient = await ensureDirectWallet(core), buyer = "evm-live-buyer";
  await core.core.wallet.ensure(buyer);
  // Public fixture identities are deliberately separate from signing keys; these tests never enter private custody.
  const oldWallet = (await core.state.loadWallet(core.state.profileHash(buyer)))!;
  const { integrityHash: _oldHash, ...walletBody } = oldWallet;
  const wallet = sealWallet({ ...walletBody, address: CIRCLE_SOURCE_OWNER, bindingHash: hashObject({ profile: buyer, address: CIRCLE_SOURCE_OWNER, createdAt: oldWallet.createdAt }) });
  await writeFile(join(root, "wallets", wallet.profileHash, "wallet.json"), canonicalJson(wallet), { mode: 0o600 });
  await core.state.removeProviderProfile(wallet.profileHash);
  const envelope = await core.state.loadEncryptedWalletEnvelope(buyer) as Record<string, unknown>;
  const identity = { ...(envelope.identity as Record<string, unknown>), address: wallet.address, bindingHash: wallet.bindingHash };
  await writeFile(join(root, "wallets", `${buyer}.json`), canonicalJson({ ...envelope, identity }), { mode: 0o600 });
  await activateDirectPolicy(root, buyer, { accounts: { evm: wallet.address }, admissions: evmDirectAdmissions(), now: core.clock.now() });
  let op = await sourceReady(true, 59144);
  const burn = source(59144), btx = { ...(burn.transaction as Record<string, unknown>), nonce: "0x2", maxPriorityFeePerGas: "0x0" };
  const b = { ...burn, transaction: btx, finalityTag: "finalized" as const };
  const approval = observation(42161, CIRCLE_SOURCE_OWNER, CIRCLE_SOURCE_TOKEN, encodeCircleApproval(), [event("Approval", CIRCLE_SOURCE_TOKEN, { owner: CIRCLE_SOURCE_OWNER, spender: CIRCLE_MESSENGER, value: 40100n }, 0)]);
  const a = { ...approval, transaction: { ...(approval.transaction as Record<string, unknown>), nonce: "0x1", gas: "0x10000", maxPriorityFeePerGas: "0x0" }, receipt: { ...(approval.receipt as Record<string, unknown>), gasUsed: "0xc350" }, finalityTag: "finalized" as const };
  const bp = decodeCircleSource(b, 59144), ap = verifyCircleApproval(a, false, "40100");
  op = advanceCircle(op, { sourceCustody: await evmNativeCustody(core.state, buyer), source: bp, effects: op.effects.map(e => ({ ...e, proof: e.role === "approval" ? { ...ap, finalityTag: "included" as const } : bp })) }, "fixture_source_receipts", Date.parse(op.preparedAt));
  await mkdir(join(root, "circle-v2-evm"), { mode: 0o700 });
  const path = join(root, "circle-v2-evm", `${op.operationId}.json`);
  const save = async () => writeFile(path, `${canonicalJson(op)}\n`, { mode: 0o600 }); await save();
  let calls = 0, zero = true, reorg = false, phase = 0, allowanceCalls = 0;
  const port = core.rpc as EvmTestRpc & Required<Pick<RpcPort, "coinbaseGaslessCall">>;
  port.coinbaseGaslessCall = async (method, params) => {
    calls++;
    if (method === "eth_getTransactionCount") return `0x${BigInt(core.rpc.nonceAtomic).toString(16)}`;
    if (method === "eth_chainId") { phase++; return "0xa4b1"; }
    const current = phase % 2 === 1 ? a : b;
    if (method === "eth_getTransactionByHash") return current.transaction;
    if (method === "eth_getTransactionReceipt") return current.receipt;
    if (method === "eth_getBlockByNumber") return reorg ? { ...current.canonicalBlock as object, hash: `0x${"ff".repeat(32)}` } : current.canonicalBlock;
    if (method === "eth_call") return encodeFunctionResult({ abi: CIRCLE_RPC_ABI, functionName: "allowance", result: ++allowanceCalls % 2 === 1 ? 40100n : zero ? 0n : 1n });
    throw new Error(String(method));
  };
  return { ...core, root, buyer, recipient: recipient.address, path, port, save, get op() { return op; }, set op(value) { op = value; }, calls: () => calls, setZero: () => { zero = false; }, setReorg: () => { reorg = true; } };
}

test("real normal Arb native prepare captures fresh FINALIZED source and public default custody without changing Circle history", async () => {
  const s = await setup(); try {
    const before = await readFile(s.path); const service = new OperationService(s.state);
    await assert.rejects(service.assertEvmAccountAvailable(s.op.profileHash, 42161, CIRCLE_SOURCE_OWNER), { code: "APN_OPERATION_BLOCKED" });
    const value = await s.core.execute({ command: "transfer.prepare", profile: s.buyer, asset: { chainId: 42161, token: "native" }, recipient: s.recipient, amount: "0.00015", maxFeeWei: "5000000000000", idempotencyKey: "circle-direct" });
    assert.equal(value.ok, true, JSON.stringify(value)); const rows = await s.state.listOperations(s.op.profileHash), prepared = rows[0]!;
    assert.ok(prepared.evm?.circleNativeAdmission); assert.equal(s.calls(), 14); assert.deepEqual(await readFile(s.path), before);
    const proof = await recheckCircleNativeAdmission(s.state, prepared, s.port); assert.ok(proof);
    await service.assertFinalizedCircleNativeAccountAvailable(prepared.profileHash, prepared.walletAddress, proof!, prepared);
    assert.equal(s.calls(), 29); assert.deepEqual(await readFile(s.path), before);
    s.setZero(); await assert.rejects(recheckCircleNativeAdmission(s.state, prepared, s.port));
  } finally { await rm(s.root, { recursive: true, force: true }); }
});

test("INCLUDED source, reorg, missing approval proof, unknown approval and other recipient never obtain admission", async () => {
  for (const variant of ["included", "reorg", "missing", "unknown", "recipient"] as const) {
    const s = await setup(); try {
      if (variant === "included") s.op = advanceCircle(s.op, { source: { ...s.op.source!, finalityTag: "included", integrityHash: hashObject((({ integrityHash: _, ...body }) => ({ ...body, finalityTag: "included" }))(s.op.source!)) } }, "included", Date.parse(s.op.preparedAt));
      if (variant === "missing" || variant === "unknown") s.op = advanceCircle(s.op, { effects: s.op.effects.map(e => e.role === "approval" ? { ...e, ...(variant === "missing" ? { proof: null } : { phase: "unknown" as const }) } : e) }, "negative_fixture", Date.parse(s.op.preparedAt));
      if (variant === "reorg") s.setReorg(); else await s.save();
      const check = () => verifyCircleNativeAdmission(s.state, s.port, s.buyer, CIRCLE_SOURCE_OWNER, variant === "recipient" ? CIRCLE_SOURCE_OWNER : s.recipient);
      if (variant === "reorg" || variant === "missing") await assert.rejects(check()); else assert.equal(await check(), null);
      await assert.rejects(new OperationService(s.state).assertEvmAccountAvailable(s.op.profileHash, 42161, CIRCLE_SOURCE_OWNER));
    } finally { await rm(s.root, { recursive: true, force: true }); }
  }
});

test("actual normal native path rechecks after TTY and refuses changed allowance or default metadata before signing", async t => {
  const { HttpsBaseRpc } = await import("../../src/rpc.js");
  const { EncryptedWalletStore, walletEnvelopeIdentity } = await import("../../src/encrypted-wallet-store.js");
  for (const variant of ["allowance", "metadata"] as const) {
    const s = await setup(); try {
      const prepared = await s.core.execute({ command: "transfer.prepare", profile: s.buyer, asset: { chainId: 42161, token: "native" }, recipient: s.recipient, amount: "0.00015", maxFeeWei: "5000000000000", idempotencyKey: `native-${variant}` });
      assert.equal(prepared.ok, true); const operation = (await s.state.listOperations(s.op.profileHash))[0]!;
      const publicIdentity = walletEnvelopeIdentity(await s.state.loadEncryptedWalletEnvelope(s.buyer), s.buyer);
      t.mock.method(HttpsBaseRpc.prototype, "coinbaseGaslessCall", s.port.coinbaseGaslessCall);
      t.mock.method(EncryptedWalletStore.prototype, "describe", async (_profile: string, _guard?: () => void, before?: (identity: typeof publicIdentity) => Promise<void>) => {
        await before?.(publicIdentity);
        return { identity: publicIdentity, secret: { version: 1 as const, privateKey: `0x${"01".repeat(32)}` as `0x${string}`, directEffects: {}, x402Effects: {} } };
      });
      t.mock.method(s.approval, "approve", async () => {
        if (variant === "allowance") s.setZero();
        else {
          const wallet = (await s.state.loadWallet(s.state.profileHash("default")))!;
          await s.state.writeWallet(sealWallet({ ...(({ integrityHash: _, ...body }) => body)(wallet), createdAt: new Date(Date.parse(wallet.createdAt) + 1000).toISOString() }));
        }
      });
      const before = await readFile(s.path), refused = await s.core.execute({ command: "transfer.approve", operationId: operation.operationId });
      assert.equal(refused.ok, false); assert.equal(s.rpc.broadcastCount, 0); assert.deepEqual(await readFile(s.path), before);
      assert.equal(await new (await import("../../src/direct-public-effect.js")).DirectPublicEffectJournal(s.state).hasSigned((await s.state.findOperation(operation.operationId))!), false);
      const again = await s.core.execute({ command: "transfer.approve", operationId: operation.operationId }); assert.equal(again.ok, false);
    } finally { t.mock.restoreAll(); await rm(s.root, { recursive: true, force: true }); }
  }
});

test("verified source exclusion refuses forged proof, foreign owner, old unknown and a second unsettled Circle", async () => {
  const s = await setup(); try {
    const service = new OperationService(s.state), result = (await verifyCircleNativeAdmission(s.state, s.port, s.buyer, CIRCLE_SOURCE_OWNER, s.recipient))!;
    await assert.rejects(service.assertFinalizedCircleNativeAccountAvailable(s.op.profileHash, CIRCLE_SOURCE_OWNER, { kind: "verified-circle-native-source" }));
    await assert.rejects(service.assertFinalizedCircleNativeAccountAvailable("e".repeat(64), CIRCLE_SOURCE_OWNER, result.token));
    const other = advanceCircle(sealCircle({ ...s.op, operationId: "8".repeat(64), idempotencyHash: "8".repeat(64) }), { state: "source_unknown", source: null, attestation: null, effects: s.op.effects.map(e => ({ ...e, phase: "unknown" as const })) }, "other_unknown", Date.parse(s.op.preparedAt));
    await writeFile(join(s.root, "circle-v2-evm", `${other.operationId}.json`), canonicalJson(other), { mode: 0o600 });
    await assert.rejects(service.assertFinalizedCircleNativeAccountAvailable(s.op.profileHash, CIRCLE_SOURCE_OWNER, result.token));
    const second = advanceCircle(sealCircle({ ...s.op, operationId: other.operationId, idempotencyHash: "8".repeat(64) }), {}, "second_settled", Date.parse(s.op.preparedAt));
    await writeFile(join(s.root, "circle-v2-evm", `${other.operationId}.json`), canonicalJson(second), { mode: 0o600 });
    assert.equal(await verifyCircleNativeAdmission(s.state, s.port, s.buyer, CIRCLE_SOURCE_OWNER, s.recipient), null);
  } finally { await rm(s.root, { recursive: true, force: true }); }
});

test("normal prepare waits for the existing Circle profile controller lock; late pending nonce change refuses", async () => {
  const s = await setup(); try {
    let entered!: () => void, release!: () => void;
    const inside = new Promise<void>(resolve => { entered = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
    const held = s.state.withLocks([`profile:${s.op.profileHash}`], async () => { entered(); await gate; }); await inside;
    const pending = s.core.execute({ command: "transfer.prepare", profile: s.buyer, asset: { chainId: 42161, token: "native" }, recipient: s.recipient, amount: "0.00015", maxFeeWei: "5000000000000", idempotencyKey: "active-controller" });
    await new Promise(resolve => setTimeout(resolve, 50)); assert.equal(s.calls(), 0); release(); await held;
    assert.equal((await pending).ok, true); const operation = (await s.state.listOperations(s.op.profileHash))[0]!;
    s.rpc.nonceAtomic = (BigInt(operation.economics!.nonceAtomic) + 1n).toString();
    await assert.rejects(recheckCircleNativeAdmission(s.state, operation, s.port)); assert.equal(s.rpc.broadcastCount, 0);
  } finally { await rm(s.root, { recursive: true, force: true }); }
});
