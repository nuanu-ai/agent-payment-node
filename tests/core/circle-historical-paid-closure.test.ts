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
import { CircleRpc } from "../../src/circle-v2-evm/rpc.js";
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
  return { root, state, op, put, env, maps, transport, wrapping, source, destination, repo: new CircleRepository(root), usage: new CircleUsage(state, () => at), service: new CircleEvmService(state, wrapping, env, () => at, {}, transport as never), calls, counts: () => ({ ledgerReads, ledgerWrites, privateCalls }), noteReads: () => ledgerReads++, noteWrites: () => ledgerWrites++ };
}
for (const route of ["linea", "monad"] as const) test(`actual ${route} historical completion reaches normal terminal ledger without any private action`, async t => {
  const f = await fixture(route); t.after(() => rm(f.root, { recursive: true, force: true })); const original = canonicalJson(f.op); const closed = route === "linea" ? await f.service.observe(f.op.operationId) : await f.service.adoptExternalMint(f.op.operationId, HISTORICAL_MONAD_MINT);
  assert.equal(closed.terminal, true); assert.equal(closed.state, route === "linea" ? "completed" : "external_fulfilled"); assert.equal(closed.usageFinalized, true); assert.equal(canonicalJson(closed.transitions.slice(0, f.op.transitions.length)), canonicalJson(f.op.transitions));
  const frozen = await new HistoricalPaidClosureStore(f.root).load(closed); assert.equal(canonicalJson(frozen!.originalOperation), original);
  for (const effect of f.op.effects) if (effect.proof !== null && ["safe", "finalized"].includes(effect.proof.finalityTag)) assert.equal(canonicalJson(closed.effects.find(e => e.role === effect.role)!.proof), canonicalJson(effect.proof));
  assert.deepEqual(closed.usage.map(r => r.state), route === "linea" ? ["finalized", "finalized", "finalized", "failed_confirmed_revert", "finalized"] : ["finalized", "finalized", "finalized", "released_unsubmitted", "released_unsubmitted"]); assert.deepEqual(closed.usage.map(r => r.state === "finalized" ? r.consumedAtomic ?? r.amountAtomic : r.state === "failed_confirmed_revert" ? r.consumedAtomic : "0"), route === "linea" ? ["40100", "30000000000000", "30000000000000", "0", "100000000000000"] : ["40100", "30000000000000", "30000000000000", "0", "0"]);
  assert.equal((BigInt(frozen!.source.approvalProof.actualFeeAtomic) + BigInt(frozen!.source.sourceProof.actualFeeAtomic)).toString(), route === "linea" ? "3316173690000" : "3340739532000"); if (route === "linea") assert.equal(frozen!.destination.receipt.actualFeeAtomic, "75731200000000");
  assert.equal(f.counts().privateCalls, 0); assert.ok(!f.calls.some(q => /send|estimate/u.test(q.method))); assert.ok(f.calls.length <= 160); t.diagnostic(`Offline logical/cache counters ${route}: ${canonicalJson(frozen!.readCounts)}`); t.diagnostic(`Offline transport requests ${route}: ${f.calls.length}; source ${f.calls.filter(q => q.chain === 42161).length}; destination ${f.calls.filter(q => q.chain !== 42161).length}`);
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

/** Replay-state oracle only: every header/wire remains an authentic captured value.
 * Earlier current deployment/state responses are explicitly copied to already captured
 * earlier canonical heads; later wallet state changes are oracle substitutions. The
 * two initial coordinator tests above use only unmodified genuine captured responses. */
async function earlierReplayOracle(f: Awaited<ReturnType<typeof fixture>>) {
  const snapshot = new Map([...f.maps].map(([chain, map]) => [chain, new Map(map)])), source = f.maps.get(42161)!, destination = f.maps.get(f.op.destinationChain)!;
  const oldSource = (await read("circle-historical-paid-source", "rpc-trace.json")).find((x: any) => x.request.method === "eth_getBlockByNumber" && x.request.params[0] === "finalized").response.result;
  const oldDestination = destination.get(canonicalJson({ method: "eth_getBlockByNumber", params: ["0x" + BigInt(f.op.effects.find((e: any) => e.role === "mint")?.proof?.finalityBlockNumberAtomic ?? 111842140).toString(16), false] })) as { hash: string };
  assert.ok(oldDestination);
  for (const [map, tag, old] of [[source, "finalized", oldSource], [destination, "safe", oldDestination]] as const) {
    const headKey = canonicalJson({ method: "eth_getBlockByNumber", params: [tag, false] }), fresh = map.get(headKey) as { hash: string }; assert.notEqual(fresh.hash, old.hash);
    for (const [key, value] of [...map]) { const q = JSON.parse(key); if (["eth_getCode", "eth_getStorageAt", "eth_call", "eth_getTransactionCount"].includes(q.method) && key.includes(fresh.hash)) map.set(key.replaceAll(fresh.hash, old.hash), structuredClone(value)); }
    map.set(headKey, structuredClone(old));
  }
  return () => { for (const [chain, map] of snapshot) { f.maps.set(chain, new Map(map)); } const map = f.maps.get(42161)!; for (const [key, value] of [...map]) { const q = JSON.parse(key); if (q.method === "eth_getTransactionCount" && (q.params[1] === "latest" || q.params[1] === "pending" || typeof q.params[1] === "object" && q.params[1].blockHash === (map.get(canonicalJson({ method: "eth_getBlockByNumber", params: ["finalized", false] })) as { hash: string }).hash)) map.set(key, "0x63");
    if (q.method === "eth_call" && typeof q.params[1] === "object" && q.params[1].blockHash === (map.get(canonicalJson({ method: "eth_getBlockByNumber", params: ["finalized", false] })) as { hash: string }).hash) { const data = q.params[0].data as string; if (data.startsWith("0xdd62ed3e")) map.set(key, "0x" + (40100n).toString(16).padStart(64, "0")); if (data.startsWith("0x70a08231")) map.set(key, "0x" + (57824n).toString(16).padStart(64, "0")); }
  }
  const destination = f.maps.get(f.op.destinationChain)!, destHead = destination.get(canonicalJson({ method: "eth_getBlockByNumber", params: ["safe", false] })) as { hash: string };
  for (const [key] of [...destination]) { const q = JSON.parse(key); if (q.method === "eth_call" && q.params[0].data.startsWith("0x70a08231") && typeof q.params[1] === "object") { q.params[1] = { blockHash: destHead.hash, requireCanonical: true }; destination.set(canonicalJson(q), "0x" + (57824n).toString(16).padStart(64, "0")); } }
  for (const tag of ["latest", "pending"]) destination.set(canonicalJson({ method: "eth_getTransactionCount", params: [f.op.destinationCustody.walletAddress, tag] }), "0x64");
  };
}
for (const route of ["linea", "monad"] as const) test(`labeled ${route} replay-state oracle repairs partial ledger after both heads and wallet activity advance`, async t => {
  const f = await fixture(route); t.after(() => rm(f.root, { recursive: true, force: true })); const advance = await earlierReplayOracle(f), realTransition = AssetUsageLedger.prototype.transition; let writes = 0;
  const crash = t.mock.method(AssetUsageLedger.prototype, "transition", async function (this: AssetUsageLedger, input: Parameters<AssetUsageLedger["transition"]>[0]) { if (++writes === 3) throw Error("TEST_CRASH_AFTER_TWO_ROWS"); return realTransition.call(this, input); });
  await assert.rejects(route === "linea" ? f.service.observe(f.op.operationId) : f.service.adoptExternalMint(f.op.operationId, HISTORICAL_MONAD_MINT), /TEST_CRASH/); crash.mock.restore();
  const store = new HistoricalPaidClosureStore(f.root), frozen = canonicalJson(await store.load(f.op)); assert.equal(canonicalJson(await f.repo.load(f.op.operationId)), canonicalJson(f.op)); advance();
  const before = f.calls.length, closed = route === "linea" ? await f.service.observe(f.op.operationId) : await f.service.adoptExternalMint(f.op.operationId, HISTORICAL_MONAD_MINT);
  assert.equal(closed.terminal, true); assert.equal(canonicalJson(await store.load(closed)), frozen); assert.equal(f.counts().privateCalls, 0); assert.ok(f.calls.length - before <= 160); t.diagnostic(`Labeled ${route} partial repair offline transport requests: ${f.calls.length - before}; frozen unique end-head anchors: 2 (source approval/burn same hash; destination separate endpoint/chain)`);
  const journal = canonicalJson(closed), beforeReplay = f.calls.length; let replayWrites = 0; const forbidden = t.mock.method(AssetUsageLedger.prototype, "transition", async () => { replayWrites++; throw Error("DUPLICATE_LEDGER_CHARGE"); });
  const replay = await f.service.observe(f.op.operationId); assert.equal(canonicalJson(replay), journal); assert.equal(canonicalJson(await store.load(replay)), frozen); assert.equal(replayWrites, 0); assert.ok(f.calls.length > beforeReplay); assert.ok(f.calls.length - beforeReplay <= 160); t.diagnostic(`Labeled ${route} terminal canonical replay offline transport requests: ${f.calls.length - beforeReplay}`); forbidden.mock.restore();
});
test("closed canonical observation refuses altered frozen ledger outcome without new charge", async t => {
  const f = await fixture("linea"); t.after(() => rm(f.root, { recursive: true, force: true })); const closed = await f.service.observe(f.op.operationId), row = closed.usage[0]!, identity = { account: row.account, chain: row.chain, asset: row.asset };
  const actual = AssetUsageLedger.prototype.load; let writes = 0; t.mock.method(AssetUsageLedger.prototype, "load", async function (this: AssetUsageLedger, input: Parameters<AssetUsageLedger["load"]>[0], id: string) { const result = await actual.call(this, input, id); return id === row.reservationId ? { ...result!, outcomeDigest: "f".repeat(64) } : result; }); t.mock.method(AssetUsageLedger.prototype, "transition", async () => { writes++; throw Error("LEDGER"); });
  await assert.rejects(f.service.observe(closed.operationId), /historical_paid_ledger_outcome/); assert.equal(writes, 0); assert.equal(f.counts().privateCalls, 0); assert.equal(identity.account, row.account);
});

test("present undefined owned Linea timestamp refuses as an own property before ledger", async t => {
  const f = await fixture("linea"); t.after(() => rm(f.root, { recursive: true, force: true })); const original = CircleRpc.prototype.observation; let ledger = 0;
  t.mock.method(CircleRpc.prototype, "observation", async function (this: CircleRpc, ...args: Parameters<CircleRpc["observation"]>) { const o = await original.apply(this, args); return this.chainId === 59144 && o !== null ? { ...o, transaction: { ...o.transaction as object, blockTimestamp: undefined } } : o; }); t.mock.method(AssetUsageLedger.prototype, "load", async () => { ledger++; throw Error("LEDGER"); });
  await assert.rejects(f.service.observe(f.op.operationId), /historical_paid_owned_timestamp/); assert.equal(ledger, 0); assert.equal(f.counts().privateCalls, 0);
});
test("private combined certificate refuses a different StateStore object even at the same root", async t => {
  const f = await fixture("linea"); t.after(() => rm(f.root, { recursive: true, force: true })); const token = await verifyHistoricalPaidClosure(f.state, f.op, f.source, f.destination); let ledger = 0; t.mock.method(AssetUsageLedger.prototype, "load", async () => { ledger++; throw Error("LEDGER"); });
  await assert.rejects(new CircleUsage(new StateStore(f.root), () => at).closeHistoricalPaid(f.op, token), /private_settlement_required/); assert.equal(ledger, 0);
});
test("rehashed caller sidecar with forged destination proof cannot mint fresh settlement authority", async t => {
  const f = await fixture("linea"); t.after(() => rm(f.root, { recursive: true, force: true })); await verifyHistoricalPaidClosure(f.state, f.op, f.source, f.destination); const sidecar = structuredClone(await new HistoricalPaidClosureStore(f.root).load(f.op))!; (sidecar.destination.receipt as { actualFeeAtomic: string }).actualFeeAtomic = "1"; const { proofHash: _old, ...body } = sidecar; (sidecar as { proofHash: string }).proofHash = hashObject(body); await f.put(`circle-historical-paid-closure/${f.op.operationId}.json`, sidecar); let ledger = 0; t.mock.method(AssetUsageLedger.prototype, "load", async () => { ledger++; throw Error("LEDGER"); });
  await assert.rejects(f.service.observe(f.op.operationId), /saved_canonical_proof_changed/); assert.equal(ledger, 0); assert.equal(f.counts().privateCalls, 0);
});
for (const bad of ["historical_reorg", "current_pin_drift"] as const) test(`terminal canonical observation refuses ${bad} without ledger or new charge`, async t => {
  let active = false; const current = (await read("circle-historical-paid-closure", "source-current-finalized-result.json")).operations.linea.deployment.blockHash;
  const f = await fixture("linea", (chain, method, params, result) => { if (active && bad === "historical_reorg" && chain === 59144 && method === "eth_getBlockByNumber" && params[0] === "0x1ec6fa7") return { ...result as object, hash: "0x" + "e".repeat(64) }; if (active && bad === "current_pin_drift" && chain === 42161 && method === "eth_getCode" && (params[1] as { blockHash: string }).blockHash === current) return "0x01"; return result; }); t.after(() => rm(f.root, { recursive: true, force: true })); const closed = await f.service.observe(f.op.operationId), original = canonicalJson(closed); active = true; let ledger = 0; t.mock.method(AssetUsageLedger.prototype, "load", async () => { ledger++; throw Error("LEDGER"); }); t.mock.method(AssetUsageLedger.prototype, "transition", async () => { ledger++; throw Error("LEDGER"); });
  await assert.rejects(f.service.observe(closed.operationId)); assert.equal(ledger, 0); assert.equal(canonicalJson(await f.repo.load(closed.operationId)), original); assert.equal(f.counts().privateCalls, 0);
});
for (const kind of ["missing_public_identity", "unreadable_public_identity"] as const) test(`Monad outsider classification refuses legacy ${kind} before ledger`, async t => {
  const f = await fixture("monad"); t.after(() => rm(f.root, { recursive: true, force: true })); await f.put("wallets/legacy-outsider.json", { publicMetadataOnlyNegative: true });
  if (kind === "unreadable_public_identity") { const original = StateStore.prototype.loadWallet; t.mock.method(StateStore.prototype, "loadWallet", async function (this: StateStore, hash: string) { if (hash === f.state.profileHash("legacy-outsider")) throw Error("PUBLIC_IDENTITY_UNREADABLE"); return original.call(this, hash); }); }
  let ledger = 0; t.mock.method(AssetUsageLedger.prototype, "load", async () => { ledger++; throw Error("LEDGER"); }); t.mock.method(AssetUsageLedger.prototype, "transition", async () => { ledger++; throw Error("LEDGER"); });
  await assert.rejects(f.service.adoptExternalMint(f.op.operationId, HISTORICAL_MONAD_MINT), /external_public_wallet_identity_incomplete|PUBLIC_IDENTITY_UNREADABLE/); assert.equal(ledger, 0); assert.equal(f.counts().privateCalls, 0);
});
test("hash-consistent foreign external proof cannot reclassify owned Linea native usage", async t => {
  const f = await fixture("linea"), other = await fixture("monad"); t.after(() => Promise.all([f, other].map(x => rm(x.root, { recursive: true, force: true }))));
  await verifyHistoricalPaidClosure(f.state, f.op, f.source, f.destination); await verifyHistoricalPaidClosure(other.state, other.op, other.source, other.destination);
  const store = new HistoricalPaidClosureStore(f.root), hostile: any = structuredClone(await store.load(f.op)), external = (await new HistoricalPaidClosureStore(other.root).load(other.op))!.externalFulfillment!;
  hostile.externalFulfillment = external; hostile.outcomes = hostile.outcomes.map((p: any, index: number) => { const state = index >= 3 ? "released_unsubmitted" : "finalized"; return { ...p, state, consumedAtomic: null, outcomeDigest: hashObject({ kind: "circle_external_mint_fulfillment", operationId: f.op.operationId, fingerprint: f.op.fingerprint, proofHash: external.proofHash, reservationId: p.reservation.reservationId, index, state }) }; });
  const { proofHash: _prior, ...body } = hostile; hostile.proofHash = hashObject(body); await f.put(`circle-historical-paid-closure/${f.op.operationId}.json`, hostile); let ledger = 0; t.mock.method(AssetUsageLedger.prototype, "load", async () => { ledger++; throw Error("LEDGER"); }); t.mock.method(AssetUsageLedger.prototype, "transition", async () => { ledger++; throw Error("LEDGER"); });
  await assert.rejects(f.service.observe(f.op.operationId), /accounting_classification/); assert.equal(ledger, 0); assert.equal(canonicalJson(await f.repo.load(f.op.operationId)), canonicalJson(f.op));
});
for (const drift of ["caller", "destination_transaction", "classification"] as const) test(`hash-consistent Monad frozen ${drift} mutation cannot certify external settlement`, async t => {
  const f = await fixture("monad"); t.after(() => rm(f.root, { recursive: true, force: true })); await verifyHistoricalPaidClosure(f.state, f.op, f.source, f.destination); const hostile: any = structuredClone(await new HistoricalPaidClosureStore(f.root).load(f.op));
  if (drift === "caller") hostile.externalFulfillment.caller = "0x0000000000000000000000000000000000000001";
  if (drift === "destination_transaction") hostile.externalFulfillment.destinationReceipt.transactionHash = "0x" + "f".repeat(64);
  if (drift === "classification") hostile.destination.kind = "owned_linea";
  const { proofHash: _old, ...externalBody } = hostile.externalFulfillment; hostile.externalFulfillment.proofHash = hashObject(externalBody);
  hostile.outcomes = hostile.outcomes.map((p: any, index: number) => ({ ...p, outcomeDigest: hashObject({ kind: "circle_external_mint_fulfillment", operationId: f.op.operationId, fingerprint: f.op.fingerprint, proofHash: hostile.externalFulfillment.proofHash, reservationId: p.reservation.reservationId, index, state: p.state }) })); const { proofHash: _prior, ...body } = hostile; hostile.proofHash = hashObject(body); await f.put(`circle-historical-paid-closure/${f.op.operationId}.json`, hostile);
  let ledger = 0; t.mock.method(AssetUsageLedger.prototype, "load", async () => { ledger++; throw Error("LEDGER"); }); t.mock.method(AssetUsageLedger.prototype, "transition", async () => { ledger++; throw Error("LEDGER"); }); await assert.rejects(f.service.adoptExternalMint(f.op.operationId, HISTORICAL_MONAD_MINT), /classification/); assert.equal(ledger, 0);
});
