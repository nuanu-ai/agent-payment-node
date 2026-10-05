import assert from "node:assert/strict";
import test from "node:test";
import { decodeFunctionData, encodeFunctionData, type Hex } from "viem";
import { observePermit2Production, consumePermit2ObservationProof } from "../../src/x402-permit2/production-observer.js";
import { PERMIT2_DIRECT_PROXY_ABI } from "../../src/x402-permit2/proxy-abi.js";
import { productionRecordBody, sealPermit2ProductionRecord } from "../../src/x402-permit2/production-repository.js";
import { factHash, observerFixture, word } from "./x402-permit2-production-observer-fixture.js";
import { protocolSecond } from "./x402-permit2-production-protocol-fixture.js";

for (const sponsor of [false, true]) test(`finite observer attests finalized exact ${sponsor ? "sponsored" : "allowance"} settlement without permit-success claim`, async t => {
  const f = await observerFixture(t, sponsor), result = await observePermit2Production(f.input);
  assert.equal(result.projection.outcome, "settled"); assert.ok(result.proof);
  assert.equal(result.projection.tokenPermitOutcome, sponsor ? "not_proven" : "not_requested");
  assert.equal(result.projection.blockNumber, "42"); assert.equal(result.projection.blockHash, f.wire.block.hash);
  assert.deepEqual(result.projection.rpc, { attempts: 4, admissions: 4, physicalDispatches: 4, logicalReads: 11, errors: 0,
    methods: { eth_chainId: 2, eth_getBlockByNumber: 4, eth_getTransactionByHash: 1, eth_getTransactionReceipt: 1, eth_getCode: 2, eth_call: 1 } });
  assert.equal(f.batches.length, 4);
  const exposed = JSON.stringify(result);
  for (const secret of ["private", f.permit2Signature, f.input.rpcUrl, f.wire.tx.input]) assert.equal(exposed.includes(secret), false);
  assert.equal((await consumePermit2ObservationProof(result.proof, f.record, f.signed, "settlement")).outcome, "settled");
  await assert.rejects(consumePermit2ObservationProof(result.proof, f.record, f.signed, "settlement"));
});

for (const sponsor of [false, true]) test(`finite observer proves expired unused ${sponsor ? "sponsored" : "allowance"} authorization without needing saved signature bundle`, async t => {
  const f = await observerFixture(t, sponsor), input = { ...f.input, signed: null, locator: null, mode: "expired_unused" as const };
  // Test mock's context only selects the expected block; it is not supplied as authority to the observer.
  (f.input as { mode: string }).mode = "expired_unused";
  const result = await observePermit2Production(input);
  assert.equal(result.projection.outcome, "expired_unused"); assert.ok(result.proof);
  assert.equal(result.projection.signedHash, null); assert.equal(result.projection.transactionHash, null);
  assert.equal(result.projection.rpc.physicalDispatches, 3); assert.equal(result.projection.rpc.logicalReads, sponsor ? 9 : 8);
  assert.equal((await consumePermit2ObservationProof(result.proof, f.record, null, "expired_unused")).outcome, "expired_unused");
});

const faults = ["value", "proxy", "sender", "suffix", "nonce", "recipient", "amount", "inner_from", "token", "deadline", "branch", "log_identity", "log_index", "duplicate",
  "event", "reorg", "unfinalized", "missing", "chain", "proxy_code", "permit2_code", "domain", "canonical", "http"] as const;
for (const fault of faults) test(`finite settlement observer holds ${fault} and never retries`, async t => {
  const f = await observerFixture(t), w = f.wire;
  switch (fault) {
    case "value": w.tx.value = "0x1"; break;
    case "proxy": w.tx.to = f.prepared.token; break;
    case "sender": w.tx.from = `0x${"0".repeat(40)}`; break;
    case "suffix": w.tx.input = `${w.tx.input}00`; break;
    case "nonce": case "recipient": case "amount": case "inner_from": case "token": case "deadline": {
      const decoded = decodeFunctionData({ abi: PERMIT2_DIRECT_PROXY_ABI, data: w.tx.input });
      assert.equal(decoded.functionName, "settle"); const args = [...decoded.args] as any[];
      if (fault === "inner_from") args[1] = f.prepared.payTo;
      if (fault === "token") args[0] = { ...args[0], permitted: { ...args[0].permitted, token: f.prepared.payTo } };
      if (fault === "deadline") args[0] = { ...args[0], deadline: BigInt(protocolSecond + 59) };
      if (fault === "nonce") args[0] = { ...args[0], nonce: 8n };
      if (fault === "amount") args[0] = { ...args[0], permitted: { ...args[0].permitted, amount: 9999n } };
      if (fault === "recipient") args[2] = { ...args[2], to: f.prepared.payer };
      w.tx.input = encodeFunctionData({ abi: PERMIT2_DIRECT_PROXY_ABI, functionName: "settle", args: args as any }); break;
    }
    case "branch": w.tx.input = `0xfa340378${w.tx.input.slice(10)}`; break;
    case "log_identity": w.receipt.logs[0]!.blockHash = factHash("d"); break;
    case "log_index": w.receipt.logs[1]!.logIndex = "0x2"; break;
    case "duplicate": w.receipt.logs.push({ ...w.receipt.logs[1]!, logIndex: "0x4" }); break;
    case "event": w.receipt.logs[1]!.data = word(0n); break;
    case "reorg": w.reorg = true; break;
    case "unfinalized": w.finalized.number = "0x29"; break;
    case "missing": w.missing = true; break;
    case "chain": w.chain = "0x1"; break;
    case "proxy_code": w.proxyCode = "0x6001"; break;
    case "permit2_code": w.permit2Code = "0x6001"; break;
    case "domain": w.domain = factHash("e"); break;
    case "canonical": w.unsupportedCanonical = true; break;
    case "http": w.httpStatus = 503; break;
  }
  const result = await observePermit2Production(f.input);
  assert.equal(result.projection.outcome, "hold"); assert.equal(result.proof, null);
  assert.equal(result.projection.rpc.physicalDispatches, f.batches.length);
  assert.ok(f.batches.length <= 4); assert.equal(f.batches.flat().filter(call => call.method === "eth_getTransactionReceipt").length, 1);
  if (fault === "http") { assert.equal(f.batches.length, 1); assert.equal(result.projection.rpc.errors, 1); }
});

for (const fault of ["deadline_equal", "permit2_spent", "token_nonce", "canonical", "domain", "head_reorg"] as const)
  test(`expired-unused observer holds ${fault}`, async t => {
    const f = await observerFixture(t, true); (f.input as { mode: string }).mode = "expired_unused";
    const input = { ...f.input, signed: null, locator: null, mode: "expired_unused" as const };
    if (fault === "deadline_equal") f.wire.finalized.timestamp = `0x${(protocolSecond + 60).toString(16)}`;
    if (fault === "permit2_spent") f.wire.bitmap = word(1n << 7n);
    if (fault === "token_nonce") f.wire.tokenNonce = word(10n);
    if (fault === "canonical") f.wire.unsupportedCanonical = true;
    if (fault === "domain") f.wire.domain = factHash("e");
    if (fault === "head_reorg") f.wire.headReorg = true;
    const result = await observePermit2Production(input); assert.equal(result.projection.outcome, "hold"); assert.equal(result.proof, null);
    assert.ok(f.batches.length <= 3);
  });

test("finalized exact reverted locator never issues terminal failure authority while authorization can be reused", async t => {
  const f = await observerFixture(t); f.wire.receipt.status = "0x0"; f.wire.receipt.logs = [];
  const result = await observePermit2Production(f.input); assert.equal(result.projection.outcome, "hold");
  assert.equal(result.projection.reason, "reverted_locator"); assert.equal(result.proof, null);
});

test("observer snapshots private context, record, locator and bearer before await; proof clone/forgery/mismatch cannot consume", async t => {
  const f = await observerFixture(t), input: any = structuredClone(f.input);
  const pending = observePermit2Production(input);
  input.rpcUrl = "https://9.9.9.9/changed"; input.profile = "changed"; input.locator = factHash("d");
  input.signed.permit2Signature = `0x${"0".repeat(130)}` as Hex;
  (input.record.material.checked.request.headers as Record<string, string>)["x-private-header"] = "changed";
  const result = await pending; assert.equal(result.projection.outcome, "settled"); assert.ok(result.proof);
  assert.ok(f.endpoints.every(endpoint => endpoint === f.input.rpcUrl)); assert.equal(result.projection.transactionHash, f.input.locator);
  await assert.rejects(consumePermit2ObservationProof(structuredClone(result.proof), f.record, f.signed, "settlement"));
  await assert.rejects(consumePermit2ObservationProof({ kind: "checked-permit2-production-observation" }, f.record, f.signed, "settlement"));
  const changed = sealPermit2ProductionRecord({ ...productionRecordBody(f.record), requestHash: "f".repeat(64) });
  await assert.rejects(consumePermit2ObservationProof(result.proof, changed, f.signed, "settlement"));
  await assert.rejects(consumePermit2ObservationProof(result.proof, f.record, f.signed, "expired_unused"));
  const consumed = await Promise.allSettled([consumePermit2ObservationProof(result.proof, f.record, f.signed, "settlement"),
    consumePermit2ObservationProof(result.proof, f.record, f.signed, "settlement")]);
  assert.equal(consumed.filter(value => value.status === "fulfilled").length, 1);
});

test("common provider cooldown distinguishes attempted batch from admitted and physically dispatched POST", async t => {
  const f = await observerFixture(t); f.wire.httpStatus = 429;
  const first = await observePermit2Production(f.input);
  assert.equal(first.projection.outcome, "hold"); assert.equal(first.projection.rpc.physicalDispatches, 1);
  f.wire.httpStatus = 200;
  const next = await observePermit2Production(f.input);
  assert.equal(next.projection.outcome, "hold"); assert.equal(next.proof, null);
  assert.equal(next.projection.rpc.attempts, 1); assert.equal(next.projection.rpc.admissions, 0);
  assert.equal(next.projection.rpc.physicalDispatches, 0); assert.equal(next.projection.rpc.logicalReads, 4);
  assert.equal(next.projection.rpc.errors, 1); assert.equal(f.batches.length, 1);
});

test("repeated observation performs new finite reads with no cached proof or paid retry", async t => {
  const f = await observerFixture(t);
  const first = await observePermit2Production(f.input), second = await observePermit2Production(f.input);
  assert.equal(first.projection.outcome, "settled"); assert.equal(second.projection.outcome, "settled");
  assert.notEqual(first.proof, second.proof); assert.equal(f.batches.length, 8);
  assert.equal(first.projection.rpc.physicalDispatches, 4); assert.equal(second.projection.rpc.physicalDispatches, 4);
  assert.ok(f.batches.flat().every(call => ["eth_chainId", "eth_getBlockByNumber", "eth_getCode", "eth_call",
    "eth_getTransactionByHash", "eth_getTransactionReceipt"].includes(call.method)));
});
