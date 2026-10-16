import assert from "node:assert/strict";
import test from "node:test";
import { keccak256 } from "viem";
import { BASE_USDC } from "../../src/constants.js";
import { ApnCore } from "../../src/core.js";
import { EncryptedWalletStore, type X402EffectMaterial } from "../../src/encrypted-wallet-store.js";
import { ApnError } from "../../src/errors.js";
import { LocalWalletNative } from "../../src/local-wallet-native.js";
import { effectSlot } from "../../src/local-wallet-native-fields.js";
import type { WrappingSecretPort } from "../../src/macos-keychain.js";
import type { Address, Hex } from "../../src/model.js";
import type { NativeRequest, RpcReceipt } from "../../src/ports.js";
import { StateStore } from "../../src/state.js";
import type { TransferApprovalPort } from "../../src/tty-approval.js";
import { releaseSettledWalletEffects } from "../../src/wallet-effect-retention.js";
import { x402AuthorizationIntentHash } from "../../src/x402-state-integrity.js";
import { RECIPIENT, TestClock, TestRpc, temporaryState } from "./helpers.js";

const MASTER = Buffer.from("33".repeat(32), "hex");
const wrapping: WrappingSecretPort = { load: async () => Buffer.from(MASTER), create: async () => Buffer.from(MASTER) };
const approval: TransferApprovalPort = { approve: async () => {} };

function receipt(address: Address, transactionHash: Hex, amountAtomic: string): RpcReceipt {
  return { transactionHash, status: "success", blockNumberAtomic: "12350", observedAt: new Date().toISOString(), rpcOrigin: "https://rpc.example",
    logs: [{ address: BASE_USDC, topics: ["0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
      `0x${address.slice(2).toLowerCase().padStart(64, "0")}` as Hex, `0x${RECIPIENT.slice(2).toLowerCase().padStart(64, "0")}` as Hex],
    data: `0x${BigInt(amountAtomic).toString(16).padStart(64, "0")}` as Hex }] };
}

async function harness(root: string) {
  const rpc = new TestRpc(), clock = new TestClock(), state = new StateStore(root);
  clock.value = new Date(Math.floor(Date.now() / 1_000) * 1_000);
  const core = new ApnCore({ state, native: new LocalWalletNative(state, wrapping, approval), rpc, clock });
  const address = ((await core.execute({ command: "wallet.ensure", profile: "default" })).data as { address: Address }).address;
  rpc.balances = { ...rpc.balances, address };
  const wallets = new EncryptedWalletStore(state, wrapping);
  const effects = async () => { const loaded = (await wallets.describe("default"))!; try { return structuredClone(loaded.secret.directEffects); } finally { wallets.clear(loaded.secret); } };
  const transfer = async (key: string, complete: boolean) => {
    const prepared = await core.execute({ command: "transfer.prepare", profile: "default", idempotencyKey: key, recipient: RECIPIENT, amount: "1.25" });
    const operationId = (prepared.operation as { operation_id: string }).operation_id;
    rpc.submitError = new Error("lost response"); rpc.submissions.length = 0;
    const approved = await core.execute({ command: "transfer.approve", operationId });
    assert.equal((approved.operation as { state: string }).state, "unknown_finality", JSON.stringify(approved));
    rpc.submitError = null;
    if (complete) {
      rpc.receipt = receipt(address, keccak256(rpc.submissions[0]!), "1250000");
      const done = await core.execute({ command: "operation.resume", operationId });
      assert.equal((done.operation as { state: string }).state, "completed", JSON.stringify(done));
    }
    return operationId;
  };
  return { state, wallets, effects, transfer };
}

test("a terminal direct transfer releases its signed material at the next custody write", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const h = await harness(temporary.root);
  const first = await h.transfer("retention-direct-001", true);
  const firstSlot = Object.entries(await h.effects());
  assert.equal(firstSlot.length, 1);
  assert.equal(firstSlot[0]![1].operationId, first);
  const second = await h.transfer("retention-direct-002", false);
  const remaining = Object.values(await h.effects());
  assert.deepEqual(remaining.map(effect => effect.operationId), [second]);
});

test("pre-0.5.42 untagged direct slots are matched once: terminal ones are released, live ones are tagged", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const h = await harness(temporary.root);
  const done = await h.transfer("retention-legacy-001", true);
  const loaded = (await h.wallets.describe("default"))!;
  const [slot, effect] = Object.entries(loaded.secret.directEffects)[0]!;
  const { operationId: _tag, ...legacy } = effect;
  loaded.secret.directEffects = { [slot]: legacy, ["f".repeat(64)]: legacy };
  await h.wallets.save(loaded.identity, loaded.secret);
  // The terminal owner's slot is gone; an unmatched slot (another family's) is kept untouched.
  assert.deepEqual(Object.keys(await h.effects()), ["f".repeat(64)]);
  assert.equal(done.length, 64);

  const live = await h.transfer("retention-legacy-002", false);
  const again = (await h.wallets.describe("default"))!;
  const liveSlot = Object.entries(again.secret.directEffects).find(([, item]) => item.operationId === live)![0];
  const { operationId: _liveTag, ...untagged } = again.secret.directEffects[liveSlot]!;
  again.secret.directEffects[liveSlot] = untagged;
  await h.wallets.save(again.identity, again.secret);
  assert.equal((await h.effects())[liveSlot]?.operationId, live);
});

test("expired x402 authorizations are released and unexpired ones kept", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const state = new StateStore(temporary.root); await state.initialize();
  const material = (validBefore: string): X402EffectMaterial => ({ createPayloadHash: "a".repeat(64), recoveryBindingHash: "b".repeat(64),
    authorization: { from: "0x1", to: "0x2", value: "1", validAfter: "0", validBefore, nonce: "0x3" }, signature: "0x00", signatureHash: "c".repeat(64) });
  const secret = { version: "apn.wallet-secret.v1" as const, privateKey: `0x${"01".repeat(32)}` as Hex, directEffects: {},
    x402Effects: { ["1".repeat(64)]: material("1000"), ["2".repeat(64)]: material("1001"), ["3".repeat(64)]: material("999") } };
  await releaseSettledWalletEffects(state, "default", secret, 1_000_500);
  assert.deepEqual(Object.keys(secret.x402Effects), ["2".repeat(64)]);
});

test("native custody refuses to sign an x402 authorization that is already expired", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const state = new StateStore(temporary.root), native = new LocalWalletNative(state, wrapping, approval);
  const request = (operation: NativeRequest["operation"], payload: Readonly<Record<string, unknown>>): NativeRequest =>
    ({ version: "apn.native.v1", requestId: "12345678-1234-4234-8234-123456789abc", operation, payload });
  const wallet = (await native.request(request("wallet.ensure", { profile: "default" })) as { address: Address }).address.toLowerCase() as Address;
  const now = Math.floor(Date.now() / 1_000), payee = "0x2222222222222222222222222222222222222222" as Address;
  const authorization = { from: wallet, to: payee, value: "1000", validAfter: "0" as const, validBefore: String(now - 1),
    nonce: `0x${"ab".repeat(32)}` as Hex, createdAt: String(now - 60) };
  await assert.rejects(native.request(request("x402Exact.approveAndAuthorize", { profile: "default", operationId: "a".repeat(64),
    fingerprint: "b".repeat(64), wallet, chainId: "8453", token: BASE_USDC.toLowerCase(),
    resource: { origin: "https://seller.example", path: "/resource", urlHash: "c".repeat(64) }, capAtomic: "1000", payee,
    amountAtomic: "1000", tokenDomain: { name: "USD Coin", version: "2" }, authorization, paymentIdentifierPosture: "absent",
    offerHash: "d".repeat(64), intentHash: x402AuthorizationIntentHash(authorization) })),
  (error: unknown) => error instanceof ApnError && error.details?.nativeCode === "APN_APPROVAL_EXPIRED");
  const loaded = (await new EncryptedWalletStore(state, wrapping).describe("default"))!;
  assert.deepEqual(loaded.secret.x402Effects, {});
  assert.equal(effectSlot("apn-x402-effect-v1", "default", "a".repeat(64), "b".repeat(64)).length, 64);
});
