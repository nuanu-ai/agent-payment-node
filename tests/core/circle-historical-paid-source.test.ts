import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, realpath, rm, readFile, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalJson, hashObject } from "../../src/canonical.js";
import { StateStore } from "../../src/state.js";
import { CircleRpc } from "../../src/circle-v2-evm/rpc.js";
import { CircleExternalRpc, CircleExternalRpcBudget } from "../../src/circle-v2-evm/external-rpc.js";
import { CircleEffectStore } from "../../src/circle-v2-evm/custody.js";
import { validateCircle, type CircleOperationV1 } from "../../src/circle-v2-evm/operation-model.js";
import { historicalPaidSourceBody, verifyHistoricalPaidSource } from "../../src/circle-v2-evm/historical-paid-source.js";
const directory = join(process.cwd(), "tests/fixtures/circle-historical-paid-source");
const read = async (name: string) => JSON.parse(await readFile(join(directory, name), "utf8"));
async function fixture(route: "linea" | "monad", mutate?: (method: string, params: unknown[], result: unknown) => unknown) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "historical-paid-source-"))), state = new StateStore(root), op = validateCircle(await read(route + "-public-operation.json"));
  await mkdir(join(root, "circle-v2-evm"), { mode: 0o700 }); await writeFile(join(root, "circle-v2-evm", op.operationId + ".json"), canonicalJson(op), { mode: 0o600 });
  await mkdir(join(root, "circle-v2-evm-effects"), { mode: 0o700 });
  for (const role of ["approval", "burn"] as const) { const { encryptedBodyPresent, tagPresent, ...header } = await read(`${route}-${role}-public-material-header.json`); assert.equal(encryptedBodyPresent, true); assert.equal(tagPresent, true); await writeFile(join(root, "circle-v2-evm-effects", `${op.operationId}-${role}.json`), canonicalJson({ ...header, ciphertext: "TEST_ONLY_NOT_DECRYPTABLE", tag: Buffer.alloc(16).toString("base64") }), { mode: 0o600 }); }
  const trace = [...await read("rpc-trace.json"), ...await read("deployment-rpc-trace.json"), ...(await read("fixture-reanchors.json")).trace], replies = new Map<string, unknown>();
  for (const item of trace) replies.set(canonicalJson({ method: item.request.method, params: item.request.params }), item.response.result);
  let requests = 0, privateCalls = 0; const methods: string[] = [], rawTransactions: Record<string, unknown>[] = [];
  const transport = { request: async (_url: string, _method: string, raw: string | null) => { requests++; const q = JSON.parse(raw!); methods.push(q.method); const key = canonicalJson({ method: q.method, params: q.params }); if (!replies.has(key)) throw Error("Missing authentic public capture " + key); const original = structuredClone(replies.get(key)); if (q.method === "eth_getTransactionByHash") rawTransactions.push(original as Record<string, unknown>); const result = mutate?.(q.method, q.params, original) ?? original; return { status: 200, body: JSON.stringify({ jsonrpc: "2.0", id: q.id, result }) }; } };
  const budget = new CircleExternalRpcBudget(() => 1, 120001, transport as never), source = new CircleExternalRpc("https://arbitrum-one-public.nodies.app", 42161, budget);
  return { root, state, op, source, rawTransactions, counts: () => ({ requests, privateCalls, methods }), headers: new CircleEffectStore(root, { load: async () => { privateCalls++; throw Error("PRIVATE"); }, create: async () => { privateCalls++; throw Error("PRIVATE"); } }) };
}
for (const route of ["linea", "monad"] as const) test(`authentic ${route} source signed wire and historical zero allowance verify without private access`, async t => {
  const f = await fixture(route); t.after(() => rm(f.root, { recursive: true, force: true })); const before = canonicalJson(f.op), token = await verifyHistoricalPaidSource(f.state, f.op, f.source), result = await historicalPaidSourceBody(token, f.state, f.op);
  assert.equal(result.evidence.allowanceAtomic, "0"); assert.equal(result.evidence.nonceFloorAtomic, route === "linea" ? "80" : "83"); assert.equal(result.evidence.sourceProof.finalityTag, "finalized"); assert.equal(result.evidence.approvalProof.transactionHashBinding, f.op.effects[0]!.proof!.transactionHashBinding); assert.equal(result.evidence.sourceProof.transactionHashBinding, f.op.effects[1]!.proof!.transactionHashBinding); assert.equal(result.evidence.sourceProof.actualFeeAtomic, f.op.effects[1]!.proof!.actualFeeAtomic); assert.equal(Object.isFrozen(result.operation.usage), true); assert.equal(canonicalJson(f.op), before); assert.equal(f.counts().privateCalls, 0); assert.ok(f.counts().requests <= 160); assert.ok(!f.counts().methods.some(m => /send|estimate|maxPriority/u.test(m)));
  assert.ok(f.rawTransactions.some(tx => [tx.r, tx.s].some(v => typeof v === "string" && v.length === 65)));
  const trace = await read("rpc-trace.json"); for (const tx of f.rawTransactions) { const original = trace.find((entry: { request: { method: string }; response: { result: Record<string, unknown> } }) => entry.request.method === "eth_getTransactionByHash" && entry.response.result.hash === tx.hash).response.result; assert.equal(canonicalJson(tx), canonicalJson(original)); assert.equal(Object.hasOwn(tx, "blockTimestamp"), false); }
  const publicHeaders = await f.headers.historicalPaidHeaders(f.op); assert.ok(!canonicalJson(publicHeaders).includes("ciphertext")); assert.ok(!canonicalJson(publicHeaders).includes("tag")); assert.equal(f.counts().privateCalls, 0);
  await assert.rejects(historicalPaidSourceBody({ kind: "verified-historical-paid-source" }, f.state, f.op), /private_source_required/);
  await assert.rejects(historicalPaidSourceBody(structuredClone(token), f.state, f.op), /private_source_required/);
  await assert.rejects(historicalPaidSourceBody(token, new StateStore(f.root), f.op), /private_source_required/);
  const foreign = structuredClone(f.op); Object.assign(foreign.usage[0]!, { reservationId: "f".repeat(64) }); await assert.rejects(historicalPaidSourceBody(token, f.state, foreign), /private_source_required/);
  assert.throws(() => Object.assign(result.operation.usage[0]!, { reservationId: "f".repeat(64) }), TypeError); assert.throws(() => Object.assign(result.evidence, { allowanceAtomic: "40100" }), TypeError);
});
for (const drift of ["reservation", "policy", "custody", "foreign_cleanup"] as const) test(`caller ${drift} cannot pass durable historical source admission`, async t => {
  const f = await fixture("linea"); t.after(() => rm(f.root, { recursive: true, force: true })); const op = structuredClone(f.op);
  if (drift === "reservation") Object.assign(op.usage[0]!, { reservationId: "f".repeat(64) });
  if (drift === "policy") Object.assign(op.policies[0]!, { policyDigest: "f".repeat(64) });
  if (drift === "custody") Object.assign(op.sourceCustody, { walletAddress: "0x1111111111111111111111111111111111111111" });
  if (drift === "foreign_cleanup") Object.assign(op, { effects: [...op.effects, { ...op.effects[0]!, role: "cleanup", transactionHash: "0xcb44ba560d8b819a1f3d60f08ac68d34481598ea499c6b5456955ec594e82c8d" }] });
  await assert.rejects(verifyHistoricalPaidSource(f.state, op, f.source), /durable_operation_changed/); assert.equal(f.counts().requests, 0);
});
for (const bad of ["allowance", "historical_nonce", "current_nonce", "index", "member", "signature", "receipt", "zero_head", "reorg", "code", "timestamp_null", "timestamp_wrong", "header_timestamp", "other_field"] as const) test(`authentic historical source refuses ${bad} before any authority`, async t => {
  const f = await fixture("linea", (method, params, result) => {
    if (bad === "allowance" && method === "eth_call" && (params[0] as { data: string }).data.startsWith("0xdd62ed3e") && BigInt(result as string) === 0n) return "0x" + "0".repeat(63) + "1";
    if (bad === "historical_nonce" && method === "eth_getTransactionCount" && typeof params[1] === "object") return "0x4f";
    if (bad === "current_nonce" && method === "eth_getTransactionCount" && params[1] === "latest") return "0x4f";
    if (bad === "index" && method === "eth_getTransactionReceipt") return { ...(result as object), transactionIndex: "0x0" };
    if (bad === "member" && method === "eth_getBlockByNumber" && params[0] === "0x1e954369") return { ...(result as object), transactions: [] };
    if (bad === "signature" && method === "eth_getTransactionByHash") return { ...(result as object), r: "0x" + "1".repeat(64) };
    if (bad === "receipt" && method === "eth_getTransactionReceipt") return { ...(result as object), gasUsed: "0x1" };
    if (bad === "zero_head" && method === "eth_getBlockByNumber" && params[0] === "finalized") return { ...(result as object), hash: "0x" + "0".repeat(64) };
    if (bad === "reorg" && method === "eth_getBlockByNumber" && params[0] === "0x1e954507") return { ...(result as object), hash: "0x" + "e".repeat(64) };
    if (bad === "timestamp_null" && method === "eth_getTransactionByHash") return { ...(result as object), blockTimestamp: null };
    if (bad === "timestamp_wrong" && method === "eth_getTransactionByHash") return { ...(result as object), blockTimestamp: "0x1" };
    if (bad === "header_timestamp" && method === "eth_getBlockByNumber" && params[0] === "0x1e954369") return { ...(result as object), timestamp: "0x1" };
    if (bad === "other_field" && method === "eth_getTransactionByHash") return { ...(result as object), gasPrice: "0x1" };
    if (bad === "code" && method === "eth_getCode") return "0x01";
    return result;
  }); t.after(() => rm(f.root, { recursive: true, force: true })); await assert.rejects(verifyHistoricalPaidSource(f.state, f.op, f.source)); assert.equal(f.counts().privateCalls, 0); assert.ok(!f.counts().methods.includes("eth_sendRawTransaction"));
});

test("present own undefined timestamp is refused by real verifier before any private access", async t => {
  const f = await fixture("linea"); t.after(() => rm(f.root, { recursive: true, force: true })); const original = f.source.observation.bind(f.source);
  t.mock.method(f.source, "observation", async (...args: Parameters<typeof original>) => { const result = await original(...args); if (result === null) return null; return { ...result, transaction: { ...(result.transaction as object), blockTimestamp: undefined } }; });
  await assert.rejects(verifyHistoricalPaidSource(f.state, f.op, f.source), /transaction_timestamp_changed/); assert.equal(f.counts().privateCalls, 0);
});

for (const bad of ["zero", "range", "high_s", "nonhex", "long", "other_signature", "wire_hash"] as const) test(`strict historical signature refuses ${bad}`, async t => {
  const f = await fixture("linea", (method, _params, result) => {
    if (method !== "eth_getTransactionByHash") return result;
    const tx = result as Record<string, unknown>, order = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
    return { ...tx, ...(bad === "wire_hash" ? { hash: "0x" + "e".repeat(64) } : bad === "high_s" ? { s: "0x" + (order / 2n + 1n).toString(16) } : { r: bad === "zero" ? "0x0" : bad === "range" ? "0x" + order.toString(16) : bad === "nonhex" ? "0xxyz" : bad === "long" ? "0x" + "1".repeat(65) : "0x1" }) };
  }); t.after(() => rm(f.root, { recursive: true, force: true }));
  await assert.rejects(verifyHistoricalPaidSource(f.state, f.op, f.source), /signature_scalar|signature_changed|exact_finalized_wire_required/); assert.equal(f.counts().privateCalls, 0);
});

for (const route of ["linea", "monad"] as const) test(`authentic ${route} present canonical timestamp preserves full saved binding`, async t => {
  const trace = await read("rpc-trace.json"), headers = new Map<string, string>();
  for (const entry of trace) if (entry.request.method === "eth_getBlockByNumber" && entry.response.result !== null) headers.set(entry.response.result.hash, entry.response.result.timestamp);
  const f = await fixture(route, (method, _params, result) => method === "eth_getTransactionByHash" ? { ...(result as object), blockTimestamp: headers.get((result as { blockHash: string }).blockHash) } : result);
  t.after(() => rm(f.root, { recursive: true, force: true })); const token = await verifyHistoricalPaidSource(f.state, f.op, f.source), body = await historicalPaidSourceBody(token, f.state, f.op);
  assert.equal(body.evidence.approvalProof.transactionHashBinding, f.op.effects[0]!.proof!.transactionHashBinding); assert.equal(body.evidence.sourceProof.transactionHashBinding, f.op.effects[1]!.proof!.transactionHashBinding); assert.equal(f.counts().privateCalls, 0);
});
test("missing retained source material header refuses before public oracle", async t => {
  const f = await fixture("linea"); t.after(() => rm(f.root, { recursive: true, force: true })); await rm(join(f.root, "circle-v2-evm-effects", `${f.op.operationId}-approval.json`));
  await assert.rejects(verifyHistoricalPaidSource(f.state, f.op, f.source), /material_header_required/); assert.equal(f.counts().requests, 1); assert.equal(f.counts().privateCalls, 0);
});
