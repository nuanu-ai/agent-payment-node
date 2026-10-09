import { HistoricalPaidRpc } from "../../src/circle-v2-evm/historical-paid-rpc.js";
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, realpath, readFile, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalJson, domainHash, hashObject } from "../../src/canonical.js";
import { StateStore } from "../../src/state.js";
import { AssetUsageLedger } from "../../src/asset-usage-ledger.js";
import { CircleEvmService } from "../../src/circle-v2-evm/runtime.js";
import { CircleRepository } from "../../src/circle-v2-evm/repository.js";
import { CircleUsage } from "../../src/circle-v2-evm/usage.js";
import { CircleExternalRpcBudget } from "../../src/circle-v2-evm/external-rpc.js";
import { HistoricalPaidClosureStore, verifyHistoricalPaidClosure, consumeHistoricalPaidClosure } from "../../src/circle-v2-evm/historical-paid-closure.js";
import { HISTORICAL_MONAD_MINT } from "../../src/circle-v2-evm/historical-paid-destination.js";
const fixtures = join(process.cwd(), "tests/fixtures"), read = async (dir: string, name: string) => JSON.parse(await readFile(join(fixtures, dir, name), "utf8"));
const at = Date.parse("2026-10-09T18:00:00.000Z");
async function fixture(route: "linea" | "monad", mutate?: (chain: number, method: string, params: unknown[], result: unknown) => unknown) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "historical-paid-closure-"))), state = new StateStore(root), op = await read("circle-historical-paid-source", route + "-public-operation.json"), metadata = await read("circle-historical-paid-closure", "public-custody-metadata.json");
  const put = async (path: string, value: unknown) => { await mkdir(join(root, path.slice(0, path.lastIndexOf("/"))), { recursive: true, mode: 0o700 }); await writeFile(join(root, path), canonicalJson(value), { mode: 0o600 }); };
  await put(`circle-v2-evm/${op.operationId}.json`, op);
  for (const profile of ["evm-live-buyer", "default"]) { const wallet = metadata.wallets[profile], provider = metadata.providers[profile]; await state.writeNewWallet(wallet); if (provider !== null) await state.writeNewProviderProfile(provider); }
  for (const role of route === "linea" ? ["approval", "burn", "mint"] : ["approval", "burn"]) { const { encryptedBodyPresent, tagPresent, ...header } = await read(role === "mint" ? "circle-historical-paid-closure" : "circle-historical-paid-source", `${route}-${role}-public-material-header.json`); assert.equal(encryptedBodyPresent, true); assert.equal(tagPresent, true); await put(`circle-v2-evm-effects/${op.operationId}-${role}.json`, { ...header, ciphertext: "TEST_ONLY_NOT_DECRYPTABLE", tag: Buffer.alloc(16).toString("base64") }); }
  for (const row of op.usage) { const identity = { account: row.account, chain: row.chain, asset: row.asset }; await put(`asset-usage/${domainHash("apn.asset-usage-bucket.v1", canonicalJson(identity))}/${row.reservationId}.json`, row); }
  const sourceTrace = [...await read("circle-historical-paid-source", "rpc-trace.json"), ...await read("circle-historical-paid-source", "deployment-rpc-trace.json"), ...(await read("circle-historical-paid-source", "fixture-reanchors.json")).trace, ...await read("circle-historical-paid-closure", "source-current-finalized-rpc-trace.json")], destTrace = await read("circle-historical-paid-closure", route === "linea" ? "linea-official-rpc-trace.json" : "monad-rpc-trace.json");
  const maps = new Map<number, Map<string, unknown>>(); for (const [chain, trace] of [[42161, sourceTrace], [op.destinationChain, destTrace]] as const) { const map = new Map<string, unknown>(); for (const item of trace) if (Object.hasOwn(item.response, "result")) map.set(canonicalJson({ method: item.request.method, params: item.request.params }), item.response.result); maps.set(chain, map); }
  for (const item of await read("circle-historical-paid-closure", "stage2-missing-dtos-rpc-trace.json")) if (item.request && item.response && Object.hasOwn(item.response, "result")) { const chain = item.origin.includes("nodies") ? 42161 : item.origin.includes("linea") ? 59144 : 143; maps.get(chain)?.set(canonicalJson({ method: item.request.method, params: item.request.params }), item.response.result); }
  const calls: { chain: number; method: string; params: unknown[] }[] = []; let ledgerReads = 0, ledgerWrites = 0, privateCalls = 0;
  const transport = { request: async (url: string, _method: string, body: string | null) => { const q = JSON.parse(body!), chain = url.includes("nodies") ? 42161 : op.destinationChain, key = canonicalJson({ method: q.method, params: q.params }), map = maps.get(chain)!; calls.push({ chain, method: q.method, params: q.params }); if (!map.has(key)) throw Error("MISSING AUTHENTIC CAPTURE " + chain + " " + key); const original = structuredClone(map.get(key)), result = mutate?.(chain, q.method, q.params, original) ?? original; return { status: 200, body: JSON.stringify({ jsonrpc: "2.0", id: q.id, result }) }; } };
  const wrapping = { load: async () => { privateCalls++; throw Error("PRIVATE"); }, create: async () => { privateCalls++; throw Error("PRIVATE"); } }, env = { APN_ARBITRUM_RPC_URL: "https://arbitrum-one-public.nodies.app", APN_LINEA_RPC_URL: "https://rpc.linea.build", APN_MONAD_RPC_URL: "https://rpc.monad.xyz" }, budget = new CircleExternalRpcBudget(() => at, at + 120000, transport as never), source = new HistoricalPaidRpc(env.APN_ARBITRUM_RPC_URL, 42161, budget, op.operationId), destination = new HistoricalPaidRpc(route === "linea" ? env.APN_LINEA_RPC_URL : env.APN_MONAD_RPC_URL, op.destinationChain, budget, op.operationId);
  return { root, state, op, put, env, transport, wrapping, source, destination, repo: new CircleRepository(root), usage: new CircleUsage(state, () => at), service: new CircleEvmService(state, wrapping, env, () => at, {}, transport as never), calls, counts: () => ({ ledgerReads, ledgerWrites, privateCalls }), noteReads: () => ledgerReads++, noteWrites: () => ledgerWrites++ };
}
for (const route of ["linea", "monad"] as const) test(`actual ${route} historical completion reaches normal terminal ledger without any private action`, async t => {
  const f = await fixture(route); t.after(() => rm(f.root, { recursive: true, force: true })); const original = canonicalJson(f.op); const closed = route === "linea" ? await f.service.observe(f.op.operationId) : await f.service.adoptExternalMint(f.op.operationId, HISTORICAL_MONAD_MINT);
  assert.equal(closed.terminal, true); assert.equal(closed.state, route === "linea" ? "completed" : "external_fulfilled"); assert.equal(closed.usageFinalized, true); assert.equal(canonicalJson(closed.transitions.slice(0, f.op.transitions.length)), canonicalJson(f.op.transitions));
  const frozen = await new HistoricalPaidClosureStore(f.root).load(closed); assert.equal(canonicalJson(frozen!.originalOperation), original);
  for (const effect of f.op.effects) if (effect.proof !== null && ["safe", "finalized"].includes(effect.proof.finalityTag)) assert.equal(canonicalJson(closed.effects.find(e => e.role === effect.role)!.proof), canonicalJson(effect.proof));
  assert.deepEqual(closed.usage.map(r => r.state), route === "linea" ? ["finalized", "finalized", "finalized", "failed_confirmed_revert", "finalized"] : ["finalized", "finalized", "finalized", "released_unsubmitted", "released_unsubmitted"]); assert.equal(f.counts().privateCalls, 0); assert.ok(!f.calls.some(q => /send|estimate/u.test(q.method))); assert.ok(f.calls.length <= 160); t.diagnostic(`Physical readonly RPC ${route}: ${f.calls.length}; source ${f.calls.filter(q => q.chain === 42161).length}; destination ${f.calls.filter(q => q.chain !== 42161).length}`);
});
for (const drift of ["rid", "policy", "profile", "custody", "outcome"] as const) test(`caller ${drift} drift refuses before public oracle and ledger`, async t => {
  const f = await fixture("linea"); t.after(() => rm(f.root, { recursive: true, force: true })); const forged = structuredClone(f.op);
  if (drift === "rid") forged.usage[0].reservationId = "f".repeat(64);
  if (drift === "policy") forged.policies[0].policyDigest = "f".repeat(64);
  if (drift === "profile") forged.profile = "default";
  if (drift === "custody") forged.sourceCustody.walletBindingHash = "f".repeat(64);
  if (drift === "outcome") forged.usage[0].outcomeDigest = "f".repeat(64);
  let ledger = 0; t.mock.method(AssetUsageLedger.prototype, "load", async () => { ledger++; throw Error("LEDGER"); }); t.mock.method(AssetUsageLedger.prototype, "transition", async () => { ledger++; throw Error("LEDGER"); });
  await assert.rejects(verifyHistoricalPaidClosure(f.state, forged, f.source, f.destination), /durable_frame/); assert.equal(f.calls.length, 0); assert.equal(ledger, 0); assert.equal(f.counts().privateCalls, 0);
});
test("plain or cloned public certificate cannot enter historical ledger consumer", async t => {
  const f = await fixture("linea"); t.after(() => rm(f.root, { recursive: true, force: true })); let ledger = 0; t.mock.method(AssetUsageLedger.prototype, "load", async () => { ledger++; throw Error("LEDGER"); });
  await assert.rejects(f.usage.closeHistoricalPaid(f.op, { kind: "verified-historical-paid-closure" }), /private_settlement_required/); assert.equal(ledger, 0); assert.equal(f.calls.length, 0);
});
for (const bad of ["destination_timestamp_null", "destination_timestamp_wrong", "destination_signature", "destination_reorg", "historical_allowance", "current_source_code", "destination_state", "destination_block_logs"] as const) test(`fresh combined authority refuses ${bad} with zero ledger/private calls`, async t => {
  const sourceResult = await read("circle-historical-paid-closure", "source-current-finalized-result.json"), currentHash = sourceResult.operations.linea.deployment.blockHash;
  const f = await fixture("linea", (chain, method, params, result) => {
    if (chain === 59144 && method === "eth_getTransactionByHash") { if (bad === "destination_timestamp_null") return { ...(result as object), blockTimestamp: null }; if (bad === "destination_timestamp_wrong") return { ...(result as object), blockTimestamp: "0x1" }; if (bad === "destination_signature") return { ...(result as object), r: "0x" + "1".repeat(64) }; }
    if (bad === "destination_reorg" && chain === 59144 && method === "eth_getBlockByNumber" && params[0] === "0x1ec6fa7") return { ...(result as object), hash: "0x" + "e".repeat(64) };
    if (bad === "historical_allowance" && chain === 42161 && method === "eth_call" && (params[0] as { data: string }).data.startsWith("0xdd62ed3e") && BigInt(result as string) === 0n) return "0x" + "0".repeat(63) + "1";
    if (bad === "current_source_code" && chain === 42161 && method === "eth_getCode" && (params[1] as { blockHash: string }).blockHash === currentHash) return "0x01";
    if (bad === "destination_state" && chain === 59144 && method === "eth_call" && (params[0] as { data: string }).data.startsWith("0x70a08231") && BigInt(result as string) === 40095n) return "0x" + (40094n).toString(16).padStart(64, "0");
    if (bad === "destination_block_logs" && chain === 59144 && method === "eth_getLogs") return [];
    return result;
  }); t.after(() => rm(f.root, { recursive: true, force: true })); let ledger = 0; t.mock.method(AssetUsageLedger.prototype, "load", async () => { ledger++; throw Error("LEDGER"); }); t.mock.method(AssetUsageLedger.prototype, "transition", async () => { ledger++; throw Error("LEDGER"); });
  await assert.rejects(f.service.observe(f.op.operationId)); assert.equal(ledger, 0); assert.equal(f.counts().privateCalls, 0); assert.ok(!f.calls.some(q => /send|estimate/u.test(q.method)));
});
test("genuine fresh source/destination certificate cloned with forged public proof cannot enter ledger", async t => {
  const f = await fixture("linea"); t.after(() => rm(f.root, { recursive: true, force: true })); const token = await verifyHistoricalPaidClosure(f.state, f.op, f.source, f.destination), frozen = await new HistoricalPaidClosureStore(f.root).load(f.op); let ledger = 0; t.mock.method(AssetUsageLedger.prototype, "load", async () => { ledger++; throw Error("LEDGER"); });
  const forged = { ...structuredClone(token), source: frozen!.source, destination: { ...frozen!.destination, caller: "foreign" } }; await assert.rejects(f.usage.closeHistoricalPaid(f.op, forged), /private_settlement_required/); assert.equal(ledger, 0);
});
for (const stage of ["postissuance", "duringconsume"] as const) test(`foreign RID mutation ${stage} refuses before first ledger read`, async t => {
  const f = await fixture("linea"); t.after(() => rm(f.root, { recursive: true, force: true })); const alias = structuredClone(f.op), token = await verifyHistoricalPaidClosure(f.state, alias, f.source, f.destination); let ledger = 0;
  t.mock.method(AssetUsageLedger.prototype, "load", async () => { ledger++; throw Error("LEDGER"); });
  if (stage === "postissuance") alias.usage[0].reservationId = "f".repeat(64); else { const load = CircleRepository.prototype.load; t.mock.method(CircleRepository.prototype, "load", async function (this: CircleRepository, id: string) { const op = await load.call(this, id); alias.usage[0].reservationId = "f".repeat(64); return op; }); }
  await assert.rejects(f.usage.closeHistoricalPaid(alias, token), /private_settlement_required|caller_frame_changed/); assert.equal(ledger, 0);
});
test("mutation during ledger await cannot redirect retained frozen usage roster", async t => {
  const f = await fixture("linea"); t.after(() => rm(f.root, { recursive: true, force: true })); const alias = structuredClone(f.op), token = await verifyHistoricalPaidClosure(f.state, alias, f.source, f.destination), foreign = "f".repeat(64), actualLoad = AssetUsageLedger.prototype.load, actualTransition = AssetUsageLedger.prototype.transition; let reads = 0, writes = 0;
  t.mock.method(AssetUsageLedger.prototype, "load", async function (this: AssetUsageLedger, identity: Parameters<AssetUsageLedger["load"]>[0], id: string) { assert.notEqual(id, foreign); reads++; alias.usage[0].reservationId = foreign; return actualLoad.call(this, identity, id); });
  t.mock.method(AssetUsageLedger.prototype, "transition", async function (this: AssetUsageLedger, input: Parameters<AssetUsageLedger["transition"]>[0]) { assert.notEqual(input.reservationId, foreign); writes++; return actualTransition.call(this, input); });
  const rows = await f.usage.closeHistoricalPaid(alias, token); assert.equal(rows[0]!.reservationId, f.op.usage[0].reservationId); assert.equal(reads, 5); assert.equal(writes, 5); await assert.rejects(f.usage.closeHistoricalPaid(f.op, token), /private_settlement_required/);
});
