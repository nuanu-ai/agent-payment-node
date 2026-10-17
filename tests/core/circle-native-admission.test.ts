import { sealOperation, sealWallet } from "../../src/state-integrity.js";
import { advanceCircle } from "./circle-v1-journal.js";
import { evmDirectFingerprint } from "../../src/evm-direct.js";
import { DirectPublicEffectJournal } from "../../src/direct-public-effect.js";
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, readFile, rm, realpath } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { encodeFunctionResult } from "viem";
import { StateStore } from "../../src/state.js";
import { canonicalJson, hashObject } from "../../src/canonical.js";
import { evmNativeCustody } from "../../src/evm-native-custody.js";
import { circleNativeSourceIdentity } from "../../src/circle-native-admission.js";
import type { CircleNativeAdmission } from "../../src/legacy/circle-native-admission-rider.js";
import { OperationService } from "../../src/operation-service.js";

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

test("R8: native Arbitrum ETH to any local custody wallet does not wait for this account's finalized Circle source; other recipients do", async () => {
  const s = await setup(); try {
    const before = await readFile(s.path), treasury = await s.core.wallet.ensure("treasury-ops") as { address: string };
    let entered!: () => void, release!: () => void;
    const inside = new Promise<void>(resolve => { entered = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
    const held = s.state.withLocks([`profile:${s.state.profileHash("default")}`], async () => { entered(); await gate; }); await inside;
    const prepare = (recipient: string, key: string) => s.core.execute({ command: "transfer.prepare", profile: s.buyer, asset: { chainId: 42161, token: "native" }, recipient, amount: "0.00015", maxFeeWei: "5000000000000", idempotencyKey: key });
    // A recipient that is not a local custody wallet still waits for the unresolved Circle route.
    const outside = await prepare(`0x${"55".repeat(20)}`, "circle-direct-outside");
    assert.equal(outside.error?.code, "APN_OPERATION_BLOCKED", JSON.stringify(outside));
    // Any local custody profile's wallet (not only `default`): admitted while profile default stays locked elsewhere.
    const inner = await prepare(treasury.address, "circle-direct-treasury");
    release(); await held;
    assert.equal(inner.ok, true, JSON.stringify(inner));
    assert.equal(s.calls(), 0, "no Circle source re-read: the journal's own finalized source proof decides"); assert.deepEqual(await readFile(s.path), before);
    assert.equal((await s.state.listOperations(s.op.profileHash)).length, 1);
  } finally { await rm(s.root, { recursive: true, force: true }); }
});

test("R8: an INCLUDED (not yet finalized) Circle source keeps the account held even for a local custody recipient", async () => {
  const s = await setup(); try {
    s.op = advanceCircle(s.op, { source: { ...s.op.source!, finalityTag: "included", integrityHash: hashObject((({ integrityHash: _, ...body }) => ({ ...body, finalityTag: "included" }))(s.op.source!)) } }, "included", Date.parse(s.op.preparedAt)); await s.save();
    const value = await s.core.execute({ command: "transfer.prepare", profile: s.buyer, asset: { chainId: 42161, token: "native" }, recipient: s.recipient, amount: "0.00015", maxFeeWei: "5000000000000", idempotencyKey: "circle-direct-included" });
    assert.equal(value.error?.code, "APN_OPERATION_BLOCKED", JSON.stringify(value)); assert.equal(s.calls(), 0);
  } finally { await rm(s.root, { recursive: true, force: true }); }
});

test("a record prepared with the retired Circle rider is refused before the owner screen or any signature", async () => {
  const s = await setup(); try {
    const record = await riderRecord(s, "rider-refused"), before = await readFile(s.path);
    const refused = await s.core.execute({ command: "transfer.approve", operationId: record.operationId });
    assert.equal(refused.error?.code, "APN_REPREPARE_REQUIRED", JSON.stringify(refused));
    const ended = (await s.state.findOperation(record.operationId))!;
    assert.equal(ended.state, "failed_before_effect"); assert.equal(ended.reason, "circle_native_admission_retired");
    assert.equal(s.approval.intents.length, 0); assert.equal(s.rpc.broadcastCount, 0); assert.deepEqual(await readFile(s.path), before);
  } finally { await rm(s.root, { recursive: true, force: true }); }
});

/** A record as 0.5.41 wrote it: a plain Arbitrum native prepare beside a settled-source Circle operation, plus the rider. */
async function riderRecord(s: Awaited<ReturnType<typeof setup>>, key: string): Promise<OperationRecord> {
  await rm(s.path);
  const value = await s.core.execute({ command: "transfer.prepare", profile: s.buyer, asset: { chainId: 42161, token: "native" }, recipient: s.recipient, amount: "0.00015", maxFeeWei: "5000000000000", idempotencyKey: key });
  assert.equal(value.ok, true, JSON.stringify(value)); await s.save();
  const plain = (await s.state.listOperations(s.op.profileHash))[0]!;
  // The 0.5.41 rider as that release stored it: the `default` recipient custody and the one finalized source it relied on.
  const admission: CircleNativeAdmission = { schemaVersion: "apn.circle-finalized-native-admission.v1", recipientCustody: await evmNativeCustody(s.state, "default"),
    sources: [{ operationId: s.op.operationId, sourceIdentityHash: circleNativeSourceIdentity(s.op) }] };
  const { integrityHash: _old, ...body } = plain, evm = { ...plain.evm!, circleNativeAdmission: admission };
  const record = sealOperation({ ...body, evm, fingerprint: evmDirectFingerprint({ ...body, evm }) });
  // Written as the old version left it; the current write guard rightly refuses to rewrite a frozen fingerprint.
  await writeFile(join(s.root, "operations", record.profileHash, `${record.operationId}.json`), canonicalJson(record), { mode: 0o600 });
  await rm(join(s.root, "direct-public-effects", record.profileHash, `${record.operationId}.prepared.json`));
  await new DirectPublicEffectJournal(s.state).prepare(record);
  return record;
}


