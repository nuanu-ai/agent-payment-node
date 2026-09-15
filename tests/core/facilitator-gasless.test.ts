import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { getAddress, recoverAddress } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { approvalCode } from "../../src/approval-code.js";
import { canonicalJson, hashObject } from "../../src/canonical.js";
import { ApnCore } from "../../src/core.js";
import { EncryptedWalletStore } from "../../src/encrypted-wallet-store.js";
import { LocalFacilitatorSigner } from "../../src/facilitator-gasless/custody.js";
import { PayAiFacilitator, type FacilitatorPayment, type FacilitatorPort } from "../../src/facilitator-gasless/facilitator.js";
import { facilitatorFail } from "../../src/facilitator-gasless/failure.js";
import { AVALANCHE_FACILITATOR as R } from "../../src/facilitator-gasless/registry.js";
import { facilitatorAuthorizationDigest, facilitatorRequirement, newFacilitatorAuthorization } from "../../src/facilitator-gasless/requirement.js";
import { AvalancheFacilitatorRpc, type FacilitatorRpcPort, type FacilitatorTransferQuery } from "../../src/facilitator-gasless/rpc.js";
import { transitionFacilitator } from "../../src/facilitator-gasless/transitions.js";
import type { GaslessTransport } from "../../src/gasless/https.js";
import type { GaslessBlock } from "../../src/gasless/model.js";
import type { Address, Hex } from "../../src/model.js";
import { StateStore, sealWallet } from "../../src/state.js";
import { GASLESS_TEST_RECIPIENT, GaslessApproval, GaslessWrapping, testWord } from "./gasless-helpers.js";
import { temporaryState } from "./helpers.js";

const NOW = new Date("2026-09-15T12:00:00.000Z");
const SECONDS = Math.floor(NOW.getTime() / 1000);
const TX = testWord("avalanche-settlement");
const RPC_URL = "https://api.avax.network/ext/bc/C/rpc";
const block = (number: number, timestamp: number): GaslessBlock =>
  ({ numberAtomic: String(number), hash: testWord(`block-${number}`), timestampAtomic: String(timestamp) });

class AvalancheRpc implements FacilitatorRpcPort {
  readonly rpcOrigin = "https://avalanche-rpc.example";
  readonly rpcEndpointHash = hashObject("avalanche-rpc");
  calls: string[] = [];
  head = block(1000, SECONDS);
  balance = 50_000_000n;
  usedNonce: Hex | null = null;
  settledIn: Hex | null = null;
  async assertChain() { this.calls.push("assertChain"); }
  async finalized() { this.calls.push("finalized"); return structuredClone(this.head); }
  async usdcBalance() { this.calls.push("usdcBalance"); return this.balance; }
  async authorizationUsed(_owner: Address, nonce: Hex) { this.calls.push("authorizationUsed"); return this.usedNonce === nonce; }
  async findAuthorizationLog(_owner: Address, nonce: Hex) {
    this.calls.push("findAuthorizationLog");
    return this.usedNonce === nonce ? this.settledIn : null;
  }
  async settledTransfer(query: FacilitatorTransferQuery) {
    this.calls.push("settledTransfer");
    if (this.usedNonce !== query.nonce || this.settledIn !== query.transactionHash) return null;
    return { transactionHash: query.transactionHash, block: block(1001, SECONDS + 2), finalized: structuredClone(this.head),
      receiptHash: hashObject("receipt"), deliveredAtomic: query.amountAtomic };
  }
}

class Facilitator implements FacilitatorPort {
  calls: string[] = [];
  payments: FacilitatorPayment[] = [];
  verifyFails: "rejected" | null = null;
  settleFails: "unavailable" | null = null;
  constructor(private readonly rpc: AvalancheRpc) {}
  async supported() {
    this.calls.push("supported");
    return { endpointOrigin: R.facilitatorOrigin, endpointHash: R.facilitatorEndpointHash, signers: [...R.approvedSigners],
      supportedResponseHash: hashObject("supported"), observedAt: NOW.toISOString() };
  }
  async verify(payment: FacilitatorPayment) {
    this.calls.push("verify"); this.payments.push(structuredClone(payment));
    if (this.verifyFails === "rejected") facilitatorFail("facilitator_gasless_verify_rejected");
    return { observedAt: NOW.toISOString(), payer: payment.authorization.from, responseHash: hashObject("verify") };
  }
  async settle(payment: FacilitatorPayment) {
    this.calls.push("settle");
    // The relayer's transaction lands on-chain even when its response is lost.
    this.rpc.usedNonce = payment.authorization.nonce; this.rpc.settledIn = TX; this.rpc.head = block(1002, SECONDS + 4);
    if (this.settleFails === "unavailable") throw new Error("canary_settle_secret");
    return { observedAt: NOW.toISOString(), transactionHash: TX, pending: false, responseHash: hashObject("settle") };
  }
}

async function fixture(root: string) {
  const key = generatePrivateKey(), account = privateKeyToAccount(key), profile = "avalanche-local", state = new StateStore(root);
  const wrapping = new GaslessWrapping(), wallets = new EncryptedWalletStore(state, wrapping);
  await state.initialize();
  const identity = { profile, address: account.address, chainId: 8453 as const, createdAt: NOW.toISOString(),
    bindingHash: hashObject({ profile, address: account.address, createdAt: NOW.toISOString() }) };
  await wallets.save(identity, { version: "apn.wallet-secret.v1", privateKey: key, directEffects: {}, x402Effects: {} }, Buffer.alloc(32, 73));
  await state.writeWallet(sealWallet({ schemaVersion: "apn.state.v1", profile, profileHash: state.profileHash(profile),
    address: identity.address, createdAt: identity.createdAt, bindingHash: identity.bindingHash }));
  const rpc = new AvalancheRpc(), facilitator = new Facilitator(rpc), approval = new GaslessApproval();
  let now = NOW.getTime();
  const core = new ApnCore({ state, clock: { now: () => new Date(now) }, facilitatorGasless: { rpc: () => rpc, facilitator,
    signer: new LocalFacilitatorSigner(state, wrapping), approval } });
  const request = { chainId: 43114 as const, recipient: GASLESS_TEST_RECIPIENT, grossAtomic: "1500000", maxFeeAtomic: "0",
    minReceivedAtomic: "1500000" };
  const prepareInput = (idempotencyKey: string) => ({ command: "gasless.transfer.prepare", profile, request, idempotencyKey }) as const;
  const prepare = async (idempotencyKey = "avalanche-facilitator-0001") => {
    const response = await core.execute(prepareInput(idempotencyKey));
    assert.equal(response.ok, true, response.error?.message);
    return (response.operation as { operation_id: string }).operation_id;
  };
  const record = async (id: string) => (await core.facilitatorGasless.records.findOperation(id))!;
  return { key, account, profile, state, wrapping, rpc, facilitator, approval, core, prepareInput, prepare, record,
    advance: (milliseconds: number) => { now += milliseconds; } };
}

test("a Local profile on Avalanche settles once through the facilitator and completes from finalized evidence", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const s = await fixture(temporary.root), id = await s.prepare(), prepared = await s.record(id);
  assert.equal(prepared.kind, "facilitator_gasless_transfer"); assert.equal(prepared.state, "awaiting_approval");
  assert.deepEqual(prepared.intent.requirement, { scheme: "exact", network: "eip155:43114", amount: "1500000", asset: R.token,
    payTo: GASLESS_TEST_RECIPIENT.toLowerCase(), maxTimeoutSeconds: 60, extra: { assetTransferMethod: "eip3009", name: "USD Coin", version: "2" } });
  const replay = await s.core.execute(s.prepareInput("avalanche-facilitator-0001"));
  assert.equal((replay.operation as { operation_id: string }).operation_id, id);
  assert.equal(s.wrapping.loads, 0);

  const response = await s.core.execute({ command: "gasless.transfer.approve", operationId: id });
  assert.equal(response.ok, true, response.error?.message);
  const op = response.operation as any, stored = await s.record(id), payment = s.facilitator.payments[0]!;
  assert.equal(stored.state, "completed"); assert.equal(op.proof_class, "rpc_finalized_correlated");
  assert.equal(op.transfer.actual_delivered_atomic, "1500000"); assert.equal(op.fees.token_fee_atomic, "0");
  assert.equal(op.transaction_hash, TX); assert.equal(op.facilitator.settle.outcome, "accepted");
  assert.deepEqual(s.facilitator.calls, ["supported", "supported", "verify", "settle"]);
  assert.equal(s.approval.calls[0]!.exactPhrase, approvalCode("gasless", stored.fingerprint));
  assert.equal(payment.authorization.from, s.account.address.toLowerCase());
  assert.equal(payment.authorization.to, GASLESS_TEST_RECIPIENT.toLowerCase());
  assert.equal(payment.authorization.value, "1500000");
  assert.equal(payment.authorization.validBefore, String(SECONDS + R.validitySeconds));
  assert.equal(stored.signed!.digest, facilitatorAuthorizationDigest(payment.authorization));
  assert.equal(await recoverAddress({ hash: stored.signed!.digest, signature: payment.signature }), s.account.address);

  const receipt = await s.core.execute({ command: "receipt.get", operationId: id });
  assert.equal(receipt.ok, true, receipt.error?.message);
  for (const text of [canonicalJson(stored), JSON.stringify(receipt)]) {
    assert.equal(text.includes(payment.signature.slice(2)), false);
    assert.equal(text.includes(s.key.slice(2)), false);
  }
  const calls = [...s.facilitator.calls];
  await s.core.execute({ command: "operation.resume", operationId: id });
  await s.core.execute({ command: "gasless.transfer.approve", operationId: id });
  assert.deepEqual(s.facilitator.calls, calls);
});

test("a refused Avalanche approval ends before signing or facilitator exposure", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const s = await fixture(temporary.root), id = await s.prepare();
  s.approval.accepted = false;
  const response = await s.core.execute({ command: "gasless.transfer.approve", operationId: id });
  assert.equal(response.ok, true, response.error?.message);
  assert.equal((response.operation as any).state, "failed_before_effect");
  assert.equal((response.operation as any).reason, "facilitator_gasless_approval_rejected");
  assert.deepEqual(s.facilitator.calls, ["supported"]); assert.equal(s.wrapping.loads, 0);
  assert.notEqual(await s.prepare("avalanche-facilitator-0002"), id);
});

test("a rejected verification holds the account until a finalized block proves the authorization expired unused", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const s = await fixture(temporary.root), id = await s.prepare();
  s.facilitator.verifyFails = "rejected";
  const response = await s.core.execute({ command: "gasless.transfer.approve", operationId: id });
  assert.equal(response.ok, true, response.error?.message);
  const exposed = response.operation as any;
  assert.equal(exposed.state, "verify_started"); assert.equal(exposed.terminal, false);
  assert.equal(exposed.facilitator.verify.outcome, "rejected"); assert.equal(exposed.reason, "facilitator_gasless_verify_rejected");
  assert.equal(exposed.proof_class, "effect_observation_pending");
  assert.deepEqual(s.facilitator.calls, ["supported", "supported", "verify"]);
  const blocked = await s.core.execute(s.prepareInput("avalanche-facilitator-0002"));
  assert.equal(blocked.ok, false); assert.equal(blocked.error?.code, "APN_OPERATION_BLOCKED");

  let resumed = await s.core.execute({ command: "operation.resume", operationId: id });
  assert.equal((resumed.operation as any).state, "verify_started");
  const validBefore = Number((await s.record(id)).signed!.authorization.validBefore);
  s.rpc.head = block(1100, validBefore); s.advance(130_000);
  resumed = await s.core.execute({ command: "operation.resume", operationId: id });
  assert.equal(resumed.ok, true, resumed.error?.message);
  const closed = resumed.operation as any;
  assert.equal(closed.state, "expired_unused"); assert.equal(closed.terminal, true);
  assert.equal(closed.proof_class, "rpc_finalized_unused"); assert.equal(closed.transfer.unused_gross_atomic, "1500000");
  assert.deepEqual(s.facilitator.calls, ["supported", "supported", "verify"]);
  assert.notEqual(await s.prepare("avalanche-facilitator-0002"), id);
});

test("a lost settlement response is recovered from the on-chain authorization without a second settlement", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const s = await fixture(temporary.root), id = await s.prepare();
  s.facilitator.settleFails = "unavailable";
  const response = await s.core.execute({ command: "gasless.transfer.approve", operationId: id });
  assert.equal(response.ok, true, response.error?.message);
  const op = response.operation as any, stored = await s.record(id);
  assert.equal(op.state, "completed"); assert.equal(op.facilitator.settle.outcome, "unknown");
  assert.equal(stored.settle!.transactionHash, null); assert.equal(stored.settlement!.transactionHash, TX);
  assert.deepEqual(s.facilitator.calls, ["supported", "supported", "verify", "settle"]);
  assert.ok(s.rpc.calls.includes("findAuthorizationLog"));
  assert.equal(canonicalJson(stored).includes("canary_settle_secret"), false);
});

test("an approval interrupted before exposure closes on resume without chain or facilitator access", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const s = await fixture(temporary.root), id = await s.prepare(), op = await s.record(id);
  const authorization = newFacilitatorAuthorization(s.account.address.toLowerCase(), op.intent.requirement, NOW.getTime(), testWord("nonce"));
  const approved = transitionFacilitator(op, { state: "approved", approval: { policy: "apn.facilitator-gasless.foreground-approval.v1",
    fingerprint: op.fingerprint, approvedAt: NOW.toISOString(), expiresAt: op.intent.expiresAt },
    signed: { authorization, digest: facilitatorAuthorizationDigest(authorization), startBlock: block(1000, SECONDS), signatureHash: null } },
    NOW.toISOString());
  await s.core.facilitatorGasless.records.persist(approved);
  const rpcCalls = s.rpc.calls.length, facilitatorCalls = s.facilitator.calls.length;
  const resumed = await s.core.execute({ command: "operation.resume", operationId: id });
  assert.equal(resumed.ok, true, resumed.error?.message);
  assert.equal((resumed.operation as any).state, "failed_before_effect");
  assert.equal((resumed.operation as any).reason, "facilitator_gasless_unexposed");
  assert.equal(s.rpc.calls.length, rpcCalls); assert.equal(s.facilitator.calls.length, facilitatorCalls);
});

test("a tampered Avalanche facilitator record fails closed", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const s = await fixture(temporary.root), id = await s.prepare(), op = await s.record(id);
  const path = join(s.state.root, "facilitator-gasless-operations", op.profileHash, `${id}.json`);
  const stored = JSON.parse(await readFile(path, "utf8"));
  stored.intent.request.grossAtomic = "1500001";
  await writeFile(path, JSON.stringify(stored));
  const status = await s.core.execute({ command: "operation.status", operationId: id });
  assert.equal(status.ok, false); assert.equal(status.error?.code, "APN_STATE_CORRUPT");
});

class Transport implements GaslessTransport {
  requests: { readonly endpoint: string; readonly method: string; readonly body: string | null }[] = [];
  constructor(private readonly responses: Readonly<Record<string, unknown>>) {}
  async request(endpoint: string, method: "POST" | "GET", body: string | null) {
    this.requests.push({ endpoint, method, body });
    return { status: 200, body: JSON.stringify(this.responses[endpoint.slice(R.facilitatorUrl.length + 1)]) };
  }
}

test("the PayAI client requires an approved Avalanche relayer and sends one exact x402 v2 payload per call", async () => {
  const owner = `0x${"a1".repeat(20)}`, requirement = facilitatorRequirement(GASLESS_TEST_RECIPIENT.toLowerCase(), "1000");
  const payment = { requirement, authorization: newFacilitatorAuthorization(owner, requirement, NOW.getTime(), testWord("wire")),
    signature: `0x${"11".repeat(65)}` as Hex };
  const kinds = [{ x402Version: 2, scheme: "exact", network: "eip155:43114" }];
  const transport = new Transport({ supported: { kinds, signers: { "eip155:*": [getAddress(R.approvedSigners[0]!)] } },
    verify: { isValid: true, payer: owner }, settle: { success: false, errorReason: "settlement_pending", transaction: TX,
      network: "eip155:43114", payer: owner } });
  const client = new PayAiFacilitator(transport, () => NOW);
  assert.deepEqual((await client.supported()).signers, [R.approvedSigners[0]]);
  await client.verify(payment);
  const settled = await client.settle(payment);
  assert.equal(settled.pending, true); assert.equal(settled.transactionHash, TX);
  assert.deepEqual(transport.requests.map((r) => [r.method, r.endpoint]), [["GET", `${R.facilitatorUrl}/supported`],
    ["POST", `${R.facilitatorUrl}/verify`], ["POST", `${R.facilitatorUrl}/settle`]]);
  const body = JSON.parse(transport.requests[1]!.body!);
  assert.deepEqual(Object.keys(body).sort(), ["paymentPayload", "paymentRequirements", "x402Version"]);
  assert.deepEqual(body.paymentRequirements, requirement); assert.deepEqual(body.paymentPayload.accepted, requirement);
  assert.deepEqual(body.paymentPayload.payload, { signature: payment.signature, authorization: payment.authorization });

  const unapproved = new PayAiFacilitator(new Transport({ supported: { kinds, signers: { "eip155:*": [`0x${"00".repeat(19)}01`] } } }));
  await assert.rejects(unapproved.supported(), { details: { reason: "facilitator_gasless_capability" } });
  const invalid = new PayAiFacilitator(new Transport({ verify: { isValid: false, invalidReason: "insufficient_funds", payer: owner } }));
  await assert.rejects(invalid.verify(payment), { details: { reason: "facilitator_gasless_verify_rejected" } });
  const failed = new PayAiFacilitator(new Transport({ settle: { success: false, errorReason: "invalid_transaction_state" } }));
  await assert.rejects(failed.settle(payment), { details: { reason: "facilitator_gasless_settle_unknown" } });
});

class JsonRpc implements GaslessTransport {
  methods: string[] = [];
  constructor(private readonly answer: (method: string, params: readonly unknown[]) => unknown) {}
  async request(_endpoint: string, _method: "POST" | "GET", body: string | null) {
    const call = JSON.parse(body!) as { id: string; method: string; params: unknown[] };
    this.methods.push(call.method);
    return { status: 200, body: JSON.stringify({ jsonrpc: "2.0", id: call.id, result: this.answer(call.method, call.params) }) };
  }
}
const quantity = (value: bigint | number) => `0x${BigInt(value).toString(16)}`;
const word = (value: string | bigint) => `0x${(typeof value === "bigint" ? value.toString(16) : value.slice(2).toLowerCase()).padStart(64, "0")}`;

test("Avalanche evidence needs one exact authorization and transfer in a finalized receipt", async () => {
  const owner = `0x${"a1".repeat(20)}` as Address, nonce = testWord("rpc-nonce"), included = testWord("included-1001");
  let delivered = 1_500_000n;
  const log = (index: number, topics: readonly string[], data: string) => ({ address: R.token, topics, data, logIndex: quantity(index),
    transactionHash: TX, blockHash: included, blockNumber: quantity(1001), transactionIndex: "0x0", removed: false });
  const transport = new JsonRpc((method, params) => {
    if (method === "eth_chainId") return quantity(43114);
    if (method === "eth_getBlockByNumber") {
      return params[0] === "finalized" ? { number: quantity(1002), hash: testWord("finalized-1002"), timestamp: quantity(SECONDS + 4) }
        : { number: quantity(1001), hash: included, timestamp: quantity(SECONDS + 2) };
    }
    if (method === "eth_getTransactionReceipt") return { transactionHash: TX, status: "0x1", blockNumber: quantity(1001), blockHash: included,
      transactionIndex: "0x0", logs: [log(0, [R.authorizationUsedTopic, word(owner), nonce], "0x"),
        log(1, [R.transferTopic, word(owner), word(GASLESS_TEST_RECIPIENT)], word(delivered))] };
    if (method === "eth_call") return word(1n);
    throw new Error(`unexpected ${method}`);
  });
  const rpc = new AvalancheFacilitatorRpc(RPC_URL, transport);
  const query = { transactionHash: TX, owner, recipient: GASLESS_TEST_RECIPIENT, amountAtomic: "1500000", nonce };
  const evidence = await rpc.settledTransfer(query);
  assert.equal(evidence?.block.numberAtomic, "1001"); assert.equal(evidence?.finalized.numberAtomic, "1002");
  assert.equal(evidence?.deliveredAtomic, "1500000");
  delivered -= 1n;
  await assert.rejects(rpc.settledTransfer(query), { details: { reason: "facilitator_gasless_evidence" } });
});

test("the authorization log scan stops at the first window that reaches validBefore", async () => {
  const transport = new JsonRpc((method, params) => {
    if (method === "eth_getLogs") return [];
    if (method === "eth_getBlockByNumber") {
      const number = BigInt(params[0] as string);
      return { number: params[0], hash: testWord(`scan-${number}`), timestamp: quantity(1000n + number) };
    }
    throw new Error(`unexpected ${method}`);
  });
  const rpc = new AvalancheFacilitatorRpc(RPC_URL, transport);
  const found = await rpc.findAuthorizationLog(`0x${"a1".repeat(20)}` as Address, testWord("scan"), block(0, 1000), block(10_000, 11_000), 4000n);
  assert.equal(found, null);
  assert.deepEqual(transport.methods, ["eth_getLogs", "eth_getBlockByNumber", "eth_getLogs", "eth_getBlockByNumber"]);
});
