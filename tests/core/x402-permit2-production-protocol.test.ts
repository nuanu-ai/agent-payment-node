import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { decodeFunctionData, encodeFunctionData, type Abi, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { x402ExactPermit2ProxyABI } from "@x402/evm";
import { canonicalJson, domainHash, sha256 } from "../../src/canonical.js";
import { decodePermit2PaymentSignatureHeader, decodePaymentSignatureHeader } from "../../src/x402-codec.js";
import { createPermit2ProductionSigned, validatePermit2ProductionSigned, publicPermit2ProductionSigned } from "../../src/x402-permit2/production-signed.js";
import { encodePermit2ProductionProxyCall, attributePermit2DirectTransaction } from "../../src/x402-permit2/production-proxy-call.js";
import { inspectPermit2ProductionReceipt } from "../../src/x402-permit2/production-receipt-facts.js";
import { createPermit2ProductionMaterial } from "../../src/x402-permit2/production-material.js";
import { productionRecordBody, sealPermit2ProductionRecord } from "../../src/x402-permit2/production-repository.js";
import { checkPermit2Challenge } from "../../src/x402-permit2/checked-challenge.js";
import { ERC20_TRANSFER_TOPIC, PROXY_SETTLED_TOPIC, PROXY_SETTLED_WITH_PERMIT_TOPIC, X402_EXACT_PERMIT2_PROXY } from "../../src/x402-permit2/registry.js";
import { protocolFixture, protocolSecond, testPayer } from "./x402-permit2-production-protocol-fixture.js";

const officialAbi = JSON.parse(readFileSync("tests/fixtures/x402-permit2/attested-proxy-abi.json", "utf8")) as Abi;
const hash = (letter: string): Hex => `0x${letter.repeat(64)}`;
const topic = (address: string): Hex => `0x${address.slice(2).toLowerCase().padStart(64, "0")}`;
async function factsFixture(sponsor = false) {
  const f = await protocolFixture(sponsor), input = await encodePermit2ProductionProxyCall(f.record, f.signed);
  const tx = { chainId: "0xa86a", to: X402_EXACT_PERMIT2_PROXY, value: "0x0", input,
    hash: hash("a"), blockHash: hash("b"), blockNumber: "0x2a" };
  const identity = { transactionHash: tx.hash, blockHash: tx.blockHash, blockNumber: tx.blockNumber, removed: false };
  const receipt = { transactionHash: tx.hash, blockHash: tx.blockHash, blockNumber: tx.blockNumber, status: "0x1", logs: [
    { ...identity, address: f.prepared.token, logIndex: "0x2", topics: [ERC20_TRANSFER_TOPIC, topic(f.prepared.payer), topic(f.prepared.payTo)],
      data: `0x${BigInt(f.prepared.amountAtomic).toString(16).padStart(64, "0")}` },
    { ...identity, address: X402_EXACT_PERMIT2_PROXY, logIndex: "0x3", topics: [sponsor ? PROXY_SETTLED_WITH_PERMIT_TOPIC : PROXY_SETTLED_TOPIC], data: "0x" },
  ] };
  return { ...f, tx, receipt };
}
function rehashSigned(value: Awaited<ReturnType<typeof protocolFixture>>["signed"], changes: Record<string, unknown>) {
  const { signedHash: _digest, ...body } = { ...value, ...changes };
  return { ...body, signedHash: domainHash("apn.x402-permit2-production.signed.v1", canonicalJson(body)) };
}

for (const sponsor of [false, true]) {
  test(`production signed ${sponsor ? "sponsored" : "allowance"} wire binds full frozen terms, remains private and observation survives expiry`, async () => {
    const f = await protocolFixture(sponsor);
    const decoded = decodePermit2PaymentSignatureHeader(f.signed.paymentSignatureHeader);
    assert.deepEqual(decoded.resource, f.record.material.checked.challenge.resource);
    assert.deepEqual(decoded.accepted, f.prepared.plan.selection.requirement);
    assert.deepEqual(decoded.payload, { signature: f.permit2Signature, permit2Authorization: f.prepared.plan.authorization });
    assert.equal(f.signed.headerHash, sha256(f.signed.paymentSignatureHeader));
    assert.deepEqual(await validatePermit2ProductionSigned(JSON.parse(JSON.stringify(f.signed)), f.record), f.signed);
    assert.throws(() => decodePaymentSignatureHeader(f.signed.paymentSignatureHeader));
    const publicValue = await publicPermit2ProductionSigned(f.signed, f.record);
    assert.equal(JSON.stringify(publicValue).includes("private"), false);
    assert.equal(JSON.stringify(publicValue).includes(f.permit2Signature), false);
    assert.deepEqual(Object.keys(publicValue).sort(), ["headerHash", "operationDigest", "signedHash"]);
    assert.equal(Object.isFrozen(f.signed), true);
    await assert.rejects(createPermit2ProductionSigned(f.record, f.permit2Signature, f.eip2612Signature, protocolSecond - 1));
    await assert.rejects(createPermit2ProductionSigned(f.record, f.permit2Signature, f.eip2612Signature, protocolSecond + 60));
    if (sponsor) assert.deepEqual((decoded.extensions?.eip2612GasSponsoring as { info: unknown }).info,
      { ...f.prepared.plan.eip2612!.info, signature: f.eip2612Signature });
    else assert.equal(decoded.extensions, undefined);
  });

  test(`production ${sponsor ? "settleWithPermit" : "settle"} calldata equals independent official artifact and pinned SDK ABI`, async () => {
    const f = await factsFixture(sponsor), a = f.prepared.plan.authorization;
    const permit = { permitted: { token: a.permitted.token, amount: BigInt(a.permitted.amount) }, nonce: BigInt(a.nonce), deadline: BigInt(a.deadline) };
    const witness = { to: a.witness.to, validAfter: 0n };
    const args = sponsor ? [{ value: BigInt(a.permitted.amount), deadline: BigInt(a.deadline),
      r: `0x${f.eip2612Signature!.slice(2, 66)}`, s: `0x${f.eip2612Signature!.slice(66, 130)}`,
      v: Number.parseInt(f.eip2612Signature!.slice(130), 16) }, permit, a.from, witness, f.permit2Signature] : [permit, a.from, witness, f.permit2Signature];
    const functionName = sponsor ? "settleWithPermit" : "settle";
    assert.equal(f.tx.input, encodeFunctionData({ abi: officialAbi, functionName, args }));
    // Independent official SDK encoding uses its own complete ABI and layout.
    assert.equal(f.tx.input, encodeFunctionData({ abi: x402ExactPermit2ProxyABI as Abi, functionName, args }));
    assert.equal(f.tx.input.slice(0, 10), sponsor ? "0xfa340378" : "0x13cd3b53");
    const result = await inspectPermit2ProductionReceipt(f.record, f.signed, f.tx, f.receipt);
    assert.equal(result.receiptStatus, "succeeded"); assert.equal(result.transferLogIndex, "2"); assert.equal(result.settledLogIndex, "3");
    assert.equal(result.attribution.tokenPermitOutcome, sponsor ? "not_proven" : "not_requested");
    assert.equal(result.finality, "not_checked"); assert.equal(result.terminalAuthority, "none");
    assert.equal(result.attribution.proxyCodeHash, "0xce6429c0bb49284660683287c0a8fe548a88379072327d026626909d202048b9");
  });
}

test("production signed codec rejects wrong payer, malformed/high-s/uppercase signatures, extra flags and changed bearer", async () => {
  const f = await protocolFixture(true), other = privateKeyToAccount(`0x${"2".repeat(64)}`);
  const wrong = await other.signTypedData(f.prepared.plan.permit2 as Parameters<typeof other.signTypedData>[0]);
  for (const signature of [wrong, "0x", `0x${"0".repeat(130)}`, f.permit2Signature.toUpperCase(),
    `${f.permit2Signature.slice(0, 66)}${"f".repeat(64)}1b`]) {
    await assert.rejects(createPermit2ProductionSigned(f.record, signature as Hex, f.eip2612Signature, protocolSecond + 1));
  }
  await assert.rejects(createPermit2ProductionSigned(f.record, f.permit2Signature, null, protocolSecond + 1));
  await assert.rejects(createPermit2ProductionSigned(f.record, f.permit2Signature, f.permit2Signature, protocolSecond + 1));
  const plain = await protocolFixture();
  await assert.rejects(createPermit2ProductionSigned(plain.record, plain.permit2Signature, f.eip2612Signature, protocolSecond + 1));
  for (const change of [{ extra: true }, { headerHash: "a".repeat(64) }, { operationDigest: "a".repeat(64) },
    { paymentSignatureHeader: f.signed.paymentSignatureHeader + "=" }]) {
    await assert.rejects(validatePermit2ProductionSigned(rehashSigned(f.signed, change), f.record));
    await assert.rejects(publicPermit2ProductionSigned(rehashSigned(f.signed, change), f.record));
  }
});

test("async recovery snapshots mutable supplied bearer material instead of publishing a changed signature", async () => {
  const f = await protocolFixture(), supplied = { ...f.signed };
  const validation = validatePermit2ProductionSigned(supplied, f.record);
  supplied.permit2Signature = `0x${"0".repeat(130)}`;
  assert.deepEqual(await validation, f.signed);
});

test("genuine payer signatures for another chain, token, spender, nonce, amount, deadline or witness cannot bind", async () => {
  const f = await protocolFixture(), typed = f.prepared.plan.permit2;
  const mutated = [ { ...typed, domain: { ...typed.domain, chainId: 1 } },
    ...[{ spender: f.prepared.token }, { nonce: 8n }, { deadline: BigInt(protocolSecond + 61) },
      { permitted: { token: X402_EXACT_PERMIT2_PROXY, amount: 10000n } },
      { permitted: { token: f.prepared.token, amount: 9999n } },
      { witness: { to: testPayer.address, validAfter: 0n } }, { witness: { to: f.prepared.payTo, validAfter: 1n } }]
      .map(change => ({ ...typed, message: { ...typed.message, ...change } })) ];
  for (const value of mutated) {
    const signature = await testPayer.signTypedData(value as Parameters<typeof testPayer.signTypedData>[0]);
    await assert.rejects(createPermit2ProductionSigned(f.record, signature, null, protocolSecond + 1));
  }
});

test("signed binding refuses re-frozen request URL, headers, body, method or challenge even with same economics", async () => {
  const f = await protocolFixture(), m = f.record.material;
  const { preparedCanonicalJson: _snapshot, typedDataDigest: _typed, eip2612Digest: _permit, materialHash: _hash, ...input } = m;
  for (const change of [{ method: "GET" }, { headers: { accept: "application/json" } }, { bodyBase64: null },
    { url: "https://seller.example/other?private=changed" }]) {
    const request = { ...m.checked.request, ...change };
    const challenge = { ...m.checked.challenge, resource: { ...m.checked.challenge.resource, url: request.url } };
    const material = createPermit2ProductionMaterial({ ...input, checked: checkPermit2Challenge(challenge, request) });
    const record = sealPermit2ProductionRecord({ ...productionRecordBody(f.record), material });
    await assert.rejects(validatePermit2ProductionSigned(f.signed, record));
  }
  for (const nonce of ["07", "-1", (1n << 256n).toString()]) {
    assert.throws(() => createPermit2ProductionMaterial({ ...input, nonce }));
  }
});

test("direct attribution rejects batching/value/foreign chain/selector/suffix/noncanonical ABI and frozen argument changes", async () => {
  const f = await factsFixture(true);
  for (const change of [{ to: f.prepared.token }, { value: "0x1" }, { value: "0x00" }, { chainId: "0x1" },
    { input: `0xffffffff${f.tx.input.slice(10)}` }, { input: `${f.tx.input}0000` }, { input: f.tx.input.toUpperCase() },
    { blockNumber: "0x02a" }, { hash: hash("0") }, { extra: true }]) {
    await assert.rejects(attributePermit2DirectTransaction(f.record, f.signed, { ...f.tx, ...change }));
  }
  const decoded = decodeFunctionData({ abi: officialAbi, data: f.tx.input });
  const args = structuredClone(decoded.args!);
  const mutations: ((a: unknown[]) => void)[] = [
    a => { (a[0] as { value: bigint }).value = 9999n; },
    a => { (a[0] as { deadline: bigint }).deadline += 1n; },
    a => { (a[0] as { v: number }).v = 0; },
    a => { (a[1] as { nonce: bigint }).nonce = 8n; },
    a => { (a[1] as { deadline: bigint }).deadline += 1n; },
    a => { (a[1] as { permitted: { amount: bigint } }).permitted.amount = 9999n; },
    a => { (a[1] as { permitted: { token: string } }).permitted.token = X402_EXACT_PERMIT2_PROXY; },
    a => { a[2] = f.prepared.payTo; }, a => { (a[3] as { to: string }).to = testPayer.address; },
    a => { (a[3] as { validAfter: bigint }).validAfter = 1n; }, a => { a[4] = `0x${"1".repeat(130)}`; },
  ];
  for (const mutate of mutations) {
    const changed = [...structuredClone(args)]; mutate(changed);
    const input = encodeFunctionData({ abi: officialAbi, functionName: decoded.functionName, args: changed });
    await assert.rejects(inspectPermit2ProductionReceipt(f.record, f.signed, { ...f.tx, input }, f.receipt));
  }
  // Dynamic bytes offset has a leading dirty uint byte; no arbitrary ABI decoder normalization is allowed.
  const dirtyOffset = `${f.tx.input.slice(0, 10 + 12 * 64)}ff${f.tx.input.slice(12 + 12 * 64)}`;
  await assert.rejects(attributePermit2DirectTransaction(f.record, f.signed, { ...f.tx, input: dirtyOffset }));
});

test("receipt input facts enforce empty exact proxy event, log identity/order and exact transfer, never finalize revert", async () => {
  const f = await factsFixture();
  for (const change of [{ topics: [PROXY_SETTLED_WITH_PERMIT_TOPIC] }, { data: "0x00" },
    { topics: [PROXY_SETTLED_TOPIC, hash("c")] }, { removed: true }, { removed: undefined },
    { blockHash: hash("c") }, { blockNumber: "0x2b" }, { transactionHash: hash("c") }, { logIndex: "0x1" }]) {
    await assert.rejects(inspectPermit2ProductionReceipt(f.record, f.signed, f.tx,
      { ...f.receipt, logs: [f.receipt.logs[0], { ...f.receipt.logs[1], ...change }] }));
  }
  for (const change of [{ data: `0x${"0".repeat(64)}` }, { topics: [ERC20_TRANSFER_TOPIC, topic(f.prepared.payTo), topic(f.prepared.payer)] },
    { address: X402_EXACT_PERMIT2_PROXY }, { logIndex: "0x02" }]) {
    await assert.rejects(inspectPermit2ProductionReceipt(f.record, f.signed, f.tx,
      { ...f.receipt, logs: [{ ...f.receipt.logs[0], ...change }, f.receipt.logs[1]] }));
  }
  await assert.rejects(inspectPermit2ProductionReceipt(f.record, f.signed, f.tx, { ...f.receipt, logs: [...f.receipt.logs, { ...f.receipt.logs[1], logIndex: "0x4" }] }));
  const reverted = await inspectPermit2ProductionReceipt(f.record, f.signed, f.tx, { ...f.receipt, status: "0x0", logs: [] });
  assert.equal(reverted.receiptStatus, "reverted_locator"); assert.equal(reverted.terminalAuthority, "none");
  assert.equal(reverted.finality, "not_checked"); assert.equal(reverted.transferLogIndex, null);
});
