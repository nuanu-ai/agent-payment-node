import assert from "node:assert/strict";
import { chmod, lstat, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { keccak256, recoverTypedDataAddress } from "viem";
import { canonicalJson, domainHash } from "../../src/canonical.js";
import { runCli } from "../../src/cli.js";
import { BASE_USDC } from "../../src/constants.js";
import { ApnCore } from "../../src/core.js";
import { EncryptedWalletStore } from "../../src/encrypted-wallet-store.js";
import { ApnError } from "../../src/errors.js";
import { LocalWalletNative } from "../../src/local-wallet-native.js";
import type { WrappingSecretPort } from "../../src/macos-keychain.js";
import type { Address, Hex } from "../../src/model.js";
import type { NativeRequest, RpcReceipt } from "../../src/ports.js";
import { StateStore } from "../../src/state.js";
import type { TransferApprovalIntent, TransferApprovalPort } from "../../src/tty-approval.js";
import { isExactTransferApproval, transferApprovalPhrase } from "../../src/tty-approval.js";
import { x402AuthorizationIntentHash } from "../../src/x402-state-integrity.js";
import { RECIPIENT, TestClock, TestProfilePolicy, TestRpc, temporaryState } from "./helpers.js";
import { QueuedHttp, challengeObservation } from "./x402-helpers.js";
import { X402_PAYMENT_REQUIRED, X402_URL, canonicalPaymentRequiredHeader } from "./x402-vectors.js";

const MASTER = Buffer.from("11".repeat(32), "hex");
const WRONG_MASTER = Buffer.from("22".repeat(32), "hex");
const REQUEST_ID = "12345678-1234-4234-8234-123456789abc";

class TestWrappingSecret implements WrappingSecretPort {
  value: Buffer | null;
  creates = 0;
  loads = 0;

  constructor(value: Buffer | null = MASTER) { this.value = value === null ? null : Buffer.from(value); }

  async load(): Promise<Buffer | null> {
    this.loads += 1;
    return this.value === null ? null : Buffer.from(this.value);
  }
  async create(): Promise<Buffer> {
    this.creates += 1;
    this.value ??= Buffer.from(MASTER);
    return Buffer.from(this.value);
  }
}

class RecordingApproval implements TransferApprovalPort {
  readonly intents: TransferApprovalIntent[] = [];
  async approve(intent: TransferApprovalIntent): Promise<void> { this.intents.push(intent); }
}

test("doctor keychain probes custody without creating a wallet or wrapping secret", async (t) => {
  const temporary = await temporaryState();
  t.after(temporary.cleanup);
  const wrapping = new TestWrappingSecret(null);
  const result = await runCli(["doctor", "keychain"], {}, {
    stateRoot: temporary.root,
    wrappingSecret: wrapping,
    approval: new RecordingApproval(),
  });
  assert.equal(result.ok, true);
  assert.equal((result.data as { status: string }).status, "absent");
  assert.equal(wrapping.loads, 1);
  assert.equal(wrapping.creates, 0);
  await assert.rejects(stat(temporary.root), { code: "ENOENT" });
});

test("CLI creates, reuses, and restarts one encrypted disposable wallet under the injected APN home", async (t) => {
  const temporary = await temporaryState();
  t.after(temporary.cleanup);
  const wrapping = new TestWrappingSecret(null);
  const approval = new RecordingApproval();

  const created = await runCli(["wallet", "ensure", "--profile", "default"], {}, {
    stateRoot: temporary.root,
    wrappingSecret: wrapping,
    approval,
  });
  assert.equal(created.ok, true);
  const address = (created.data as { readonly address: Address }).address;
  assert.match(address, /^0x[0-9A-Fa-f]{40}$/);
  assert.equal((created.data as { readonly custody: string }).custody, "local_software_disposable");

  const envelopePath = join(temporary.root, "wallets", "default.json");
  const envelope = await readFile(envelopePath, "utf8");
  assert.equal(envelope.includes("privateKey"), false);
  assert.equal(envelope.includes(MASTER.toString("base64")), false);
  assert.equal((await lstat(temporary.root)).mode & 0o777, 0o700);
  assert.equal((await lstat(envelopePath)).mode & 0o777, 0o600);

  const reused = await runCli(["wallet", "ensure", "--profile", "default"], {}, {
    stateRoot: temporary.root,
    wrappingSecret: wrapping,
    approval,
  });
  const restarted = await runCli(["wallet", "status", "--profile", "default"], {}, {
    stateRoot: temporary.root,
    wrappingSecret: wrapping,
    approval,
  });
  const loadsBeforeDoctor = wrapping.loads;
  const doctor = await runCli(["doctor", "keychain"], {}, {
    stateRoot: temporary.root,
    wrappingSecret: wrapping,
    approval,
  });
  assert.equal((reused.data as { readonly address: Address }).address, address);
  assert.equal((restarted.data as { readonly address: Address }).address, address);
  assert.equal((doctor.data as { readonly status: string }).status, "ready");
  assert.equal((doctor.data as { readonly address: Address }).address, address);
  assert.equal(wrapping.loads, loadsBeforeDoctor + 1);
  assert.equal(wrapping.creates, 1);
  assert.equal(JSON.stringify(created).includes("privateKey"), false);
});

test("encrypted wallet fails closed for missing/wrong wrapping secret, tag tamper, and unsafe mode", async (t) => {
  const temporary = await temporaryState();
  t.after(temporary.cleanup);
  const state = new StateStore(temporary.root);
  const native = new LocalWalletNative(state, new TestWrappingSecret());
  const core = new ApnCore({ state, native });
  assert.equal((await core.execute({ command: "wallet.ensure", profile: "default" })).ok, true);
  const envelopePath = join(temporary.root, "wallets", "default.json");
  const original = await readFile(envelopePath, "utf8");

  for (const wrapping of [new TestWrappingSecret(null), new TestWrappingSecret(WRONG_MASTER)]) {
    const result = await new ApnCore({
      state: new StateStore(temporary.root),
      native: new LocalWalletNative(new StateStore(temporary.root), wrapping),
    }).execute({ command: "wallet.status", profile: "default" });
    assert.equal(result.ok, false);
    assert.equal(result.error?.code, "APN_STATE_CORRUPT");
  }

  const tampered = JSON.parse(original) as { cipher: { tag: string } };
  const tag = Buffer.from(tampered.cipher.tag, "base64");
  tag[0] = (tag[0] ?? 0) ^ 1;
  tampered.cipher.tag = tag.toString("base64");
  await writeFile(envelopePath, `${canonicalJson(tampered)}\n`, { encoding: "utf8", mode: 0o600 });
  const tagResult = await new ApnCore({
    state: new StateStore(temporary.root),
    native: new LocalWalletNative(new StateStore(temporary.root), new TestWrappingSecret()),
  }).execute({ command: "wallet.status", profile: "default" });
  assert.equal(tagResult.ok, false);
  assert.equal(tagResult.error?.code, "APN_STATE_CORRUPT");

  await writeFile(envelopePath, original, { encoding: "utf8", mode: 0o600 });
  await chmod(envelopePath, 0o644);
  const modeResult = await new ApnCore({
    state: new StateStore(temporary.root),
    native: new LocalWalletNative(new StateStore(temporary.root), new TestWrappingSecret()),
  }).execute({ command: "wallet.status", profile: "default" });
  assert.equal(modeResult.ok, false);
  assert.equal(modeResult.error?.code, "APN_STATE_SECURITY");
});

test("authenticated but malformed recovery effect material fails closed", async (t) => {
  const temporary = await temporaryState();
  t.after(temporary.cleanup);
  const wrapping = new TestWrappingSecret();
  const state = new StateStore(temporary.root);
  await state.initialize();
  const wallets = new EncryptedWalletStore(state, wrapping);
  const loaded = await wallets.ensure("default");
  loaded.secret.directEffects["a".repeat(64)] = {
    payloadHash: "b".repeat(64),
    transactionHash: `0x${"11".repeat(32)}` as Hex,
    rawTransaction: "0x02" as Hex,
    rawTransactionHash: `0x${"22".repeat(32)}` as Hex,
  };
  await wallets.save(loaded.identity, loaded.secret);
  wallets.clear(loaded.secret);
  await assert.rejects(wallets.describe("default"), (error: unknown) => {
    assert.equal((error as ApnError).code, "APN_STATE_CORRUPT");
    return true;
  });
});

test("concurrent first use converges on one address and one encrypted envelope", async (t) => {
  const temporary = await temporaryState();
  t.after(temporary.cleanup);
  const wrapping = new TestWrappingSecret(null);
  const make = () => {
    const state = new StateStore(temporary.root, { lockWaitMs: 2_000 });
    return new ApnCore({ state, native: new LocalWalletNative(state, wrapping, new RecordingApproval()) });
  };
  const [left, right] = await Promise.all([
    make().execute({ command: "wallet.ensure", profile: "default" }),
    make().execute({ command: "wallet.ensure", profile: "default" }),
  ]);
  assert.equal(left.ok, true);
  assert.equal(right.ok, true);
  assert.equal((left.data as { address: string }).address, (right.data as { address: string }).address);
  assert.equal(wrapping.creates, 1);
});

test("direct-transfer approval completes before the encrypted private key is loaded", async (t) => {
  const temporary = await temporaryState();
  t.after(temporary.cleanup);
  const trace: string[] = [];
  class OrderedWrappingSecret extends TestWrappingSecret {
    override async load(): Promise<Buffer | null> {
      trace.push("key-load");
      return await super.load();
    }
  }
  const wrapping = new OrderedWrappingSecret();
  const approval: TransferApprovalPort = {
    approve: async () => {
      assert.equal(trace.includes("key-load"), false, "wallet key loaded before approval completed");
      trace.push("approval");
    },
  };
  const rpc = new TestRpc();
  const clock = new TestClock();
  clock.value = new Date(Math.floor(Date.now() / 1_000) * 1_000);
  const state = new StateStore(temporary.root);
  const core = new ApnCore({ state, native: new LocalWalletNative(state, wrapping, approval), rpc, clock });
  const wallet = await core.execute({ command: "wallet.ensure", profile: "default" });
  rpc.balances = { ...rpc.balances, address: (wallet.data as { address: Address }).address };
  trace.length = 0;
  const prepared = await core.execute({
    command: "transfer.prepare",
    profile: "default",
    idempotencyKey: "approval-before-key-load-001",
    recipient: RECIPIENT,
    amount: "0.01",
  });
  const operationId = (prepared.operation as { operation_id: string }).operation_id;
  const approved = await core.execute({ command: "transfer.approve", operationId });

  assert.equal(approved.ok, true, JSON.stringify(approved));
  assert.deepEqual(trace.slice(0, 2), ["approval", "key-load"]);
});

test("local custody persists one approved direct-transfer effect and restart resubmits byte-identical material", async (t) => {
  const temporary = await temporaryState();
  t.after(temporary.cleanup);
  const wrapping = new TestWrappingSecret();
  const approval = new RecordingApproval();
  const rpc = new TestRpc();
  const clock = new TestClock();
  clock.value = new Date(Math.floor(Date.now() / 1_000) * 1_000);
  const firstState = new StateStore(temporary.root);
  const first = new ApnCore({ state: firstState, native: new LocalWalletNative(firstState, wrapping, approval), rpc, clock });
  const wallet = await first.execute({ command: "wallet.ensure", profile: "default" });
  const address = (wallet.data as { address: Address }).address;
  rpc.balances = { ...rpc.balances, address };

  const prepared = await first.execute({
    command: "transfer.prepare",
    profile: "default",
    idempotencyKey: "encrypted-direct-001",
    recipient: RECIPIENT,
    amount: "1.25",
  });
  const operationId = (prepared.operation as { operation_id: string }).operation_id;
  rpc.submitError = new Error("lost response");
  const ambiguous = await first.execute({ command: "transfer.approve", operationId });
  assert.equal((ambiguous.operation as { state: string }).state, "unknown_finality");
  assert.equal(approval.intents.length, 1);
  assert.equal(rpc.submissions.length, 1);
  const raw = rpc.submissions[0];
  assert.ok(raw);

  rpc.submitError = null;
  rpc.returnedHash = keccak256(raw);
  const restartedState = new StateStore(temporary.root);
  const restarted = new ApnCore({ state: restartedState, native: new LocalWalletNative(restartedState, wrapping, approval), rpc, clock });
  const resubmitted = await restarted.execute({ command: "operation.resume", operationId });
  assert.equal((resubmitted.operation as { state: string }).state, "submitted_pending");
  assert.equal(rpc.submissions.length, 2);
  assert.equal(rpc.submissions[1], raw);
  assert.equal(approval.intents.length, 1);

  const transactionHash = keccak256(raw);
  rpc.receipt = exactDynamicReceipt(address, transactionHash, "1250000");
  const completed = await restarted.execute({ command: "operation.resume", operationId });
  assert.equal((completed.operation as { state: string }).state, "completed");
  const receipt = await restarted.execute({ command: "receipt.get", operationId });
  assert.equal(receipt.ok, true);
  assert.equal((receipt.receipt as { transaction_hash: string }).transaction_hash, transactionHash);
  const publicBytes = JSON.stringify([ambiguous, resubmitted, completed, receipt]);
  assert.equal(publicBytes.includes(raw), false);
  assert.equal((await readFile(join(temporary.root, "wallets", "default.json"), "utf8")).includes(raw), false);
});

test("x402 authorization is signed once, encrypted, and recovered identically after restart", async (t) => {
  const temporary = await temporaryState();
  t.after(temporary.cleanup);
  const wrapping = new TestWrappingSecret();
  const firstState = new StateStore(temporary.root);
  const first = new LocalWalletNative(firstState, wrapping, new RecordingApproval());
  const wallet = await first.request(nativeRequest("wallet.ensure", { profile: "default" })) as { address: Address };
  const x402Wallet = wallet.address.toLowerCase() as Address;
  const now = Math.floor(Date.now() / 1_000);
  const payee = "0x2222222222222222222222222222222222222222" as Address;
  const authorization = {
    from: x402Wallet,
    to: payee,
    value: "1000",
    validAfter: "0" as const,
    validBefore: String(now + 120),
    nonce: `0x${"ab".repeat(32)}` as Hex,
    createdAt: String(now),
  };
  const createPayload = {
    profile: "default",
    operationId: "a".repeat(64),
    fingerprint: "b".repeat(64),
    wallet: x402Wallet,
    chainId: "8453",
    token: BASE_USDC.toLowerCase(),
    resource: { origin: "https://seller.example", path: "/resource", urlHash: "c".repeat(64) },
    capAtomic: "1000",
    payee,
    amountAtomic: "1000",
    tokenDomain: { name: "USD Coin", version: "2" },
    authorization,
    paymentIdentifierPosture: "absent",
    offerHash: "d".repeat(64),
    intentHash: x402AuthorizationIntentHash(authorization),
  };
  const created = await first.request(nativeRequest("x402Exact.approveAndAuthorize", createPayload)) as X402Material;
  const recoveredAddress = await recoverTypedDataAddress({
    domain: { name: "USD Coin", version: "2", chainId: 8453, verifyingContract: BASE_USDC },
    types: { TransferWithAuthorization: [
      { name: "from", type: "address" }, { name: "to", type: "address" },
      { name: "value", type: "uint256" }, { name: "validAfter", type: "uint256" },
      { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" },
    ] },
    primaryType: "TransferWithAuthorization",
    message: { from: x402Wallet, to: payee, value: 1000n, validAfter: 0n, validBefore: BigInt(now + 120), nonce: authorization.nonce },
    signature: created.signature,
  });
  assert.equal(recoveredAddress.toLowerCase(), x402Wallet);
  assert.equal(created.signatureHash, domainHash("apn.x402.signature.v1", Buffer.from(created.signature.slice(2), "hex")));

  const recoveryPayload = {
    profile: createPayload.profile,
    operationId: createPayload.operationId,
    fingerprint: createPayload.fingerprint,
    wallet: createPayload.wallet,
    chainId: createPayload.chainId,
    token: createPayload.token,
    tokenDomain: createPayload.tokenDomain,
    authorization: {
      from: authorization.from, to: authorization.to, value: authorization.value,
      validAfter: authorization.validAfter, validBefore: authorization.validBefore, nonce: authorization.nonce,
    },
    intentHash: createPayload.intentHash,
    expectedSignatureHash: created.signatureHash,
  };
  const restartedState = new StateStore(temporary.root);
  const restarted = new LocalWalletNative(restartedState, wrapping, new RecordingApproval());
  const recovered = await restarted.request(nativeRequest("x402Exact.authorizationMaterial.get", recoveryPayload));
  assert.deepEqual(recovered, created);
  const envelope = await readFile(join(temporary.root, "wallets", "default.json"), "utf8");
  assert.equal(envelope.includes(created.signature), false);
});

test("real encrypted custody completes the core x402 prepare and authorize boundary", async (t) => {
  const temporary = await temporaryState();
  t.after(temporary.cleanup);
  const wrapping = new TestWrappingSecret();
  const clock = new TestClock();
  clock.value = new Date(Math.floor(Date.now() / 1_000) * 1_000);
  const rpc = new TestRpc();
  const http = new QueuedHttp([
    challengeObservation({ header: canonicalPaymentRequiredHeader(X402_PAYMENT_REQUIRED) }),
  ]);
  const state = new StateStore(temporary.root);
  const core = new ApnCore({
    state,
    native: new LocalWalletNative(state, wrapping, new RecordingApproval()),
    rpc,
    http,
    clock,
    policy: new TestProfilePolicy(),
  });
  const wallet = await core.execute({ command: "wallet.ensure", profile: "default" });
  const address = (wallet.data as { address: Address }).address.toLowerCase() as Address;
  rpc.x402Evidence = {
    ...rpc.x402Evidence,
    address,
    observedAt: clock.value.toISOString(),
    block: { ...rpc.x402Evidence.block, timestamp: String(Math.floor(clock.value.getTime() / 1_000)) },
  };
  const prepared = await core.execute({
    command: "x402.fetch.prepare",
    profile: "default",
    url: X402_URL,
    maxAmountAtomic: "2000000",
    idempotencyKey: "encrypted-x402-core-001",
  });
  assert.equal(prepared.ok, true, JSON.stringify(prepared));
  const operationId = (prepared.operation as { operationId: string }).operationId;
  const approved = await core.execute({ command: "x402.fetch.approve", operationId });
  assert.equal(approved.ok, true, JSON.stringify(approved));
  assert.equal((approved.operation as { state: string }).state, "authorized_not_sent");
  assert.equal(http.calls.length, 1);
  const restartedState = new StateStore(temporary.root);
  const restarted = new ApnCore({
    state: restartedState,
    native: new LocalWalletNative(restartedState, wrapping, new RecordingApproval()),
    rpc,
    http,
    clock,
    policy: new TestProfilePolicy(),
  });
  const status = await restarted.execute({ command: "operation.status", operationId });
  assert.equal((status.operation as { state: string }).state, "authorized_not_sent");
});

test("direct-transfer approval phrase is byte-exact", () => {
  const phrase = transferApprovalPhrase("a".repeat(64));
  assert.equal(isExactTransferApproval(phrase, phrase), true);
  for (const variant of [phrase.toLowerCase(), `${phrase} `, phrase.slice(1), `${phrase}\r`]) {
    assert.equal(isExactTransferApproval(phrase, variant), false);
  }
});

interface X402Material {
  readonly authorization: Readonly<Record<string, string>>;
  readonly signature: Hex;
  readonly signatureHash: string;
}

function nativeRequest(operation: NativeRequest["operation"], payload: Readonly<Record<string, unknown>>): NativeRequest {
  return { version: "apn.native.v1", requestId: REQUEST_ID, operation, payload };
}

function exactDynamicReceipt(address: Address, transactionHash: Hex, amountAtomic: string): RpcReceipt {
  return {
    transactionHash,
    status: "success",
    blockNumberAtomic: "12350",
    observedAt: new Date().toISOString(),
    rpcOrigin: "https://rpc.example",
    logs: [{
      address: BASE_USDC,
      topics: [
        "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
        `0x${address.slice(2).toLowerCase().padStart(64, "0")}` as Hex,
        `0x${RECIPIENT.slice(2).toLowerCase().padStart(64, "0")}` as Hex,
      ],
      data: `0x${BigInt(amountAtomic).toString(16).padStart(64, "0")}` as Hex,
    }],
  };
}
