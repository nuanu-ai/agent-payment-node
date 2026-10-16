// SYNTHETIC vectors over captured public bytes. No live simulation, signature, send or paid acceptance.
import assert from "node:assert/strict";
import test from "node:test";
import { getAddressEncoder, address } from "@solana/kit";
import { canonicalJson, sha256 } from "../../src/canonical.js";
import { swapMechanismDigest, type SwapMechanismPin } from "../../src/swap/pin.js";
import { swapRouteDigest } from "../../src/swap/route-admission.js";
import { JUPITER_V6_PROGRAM, SOLANA_USDC_MINT, ASSOCIATED_TOKEN_PROGRAM } from "../../src/swap/jupiter-solana/catalog.js";
import { JUPITER_V1_PROGRAM_AUTHORITIES, JUPITER_V1_WHIRLPOOL_PROGRAM } from "../../src/swap/jupiter-solana/v1-pins.js";
import { JUPITER_V1_HISTORICAL_ROUTES, JUPITER_V1_ROUTES, routeConfigForMaterial, routeConfigForQuote, type JupiterV1RouteConfig,
 JUPITER_V1_OLD_ROUTE, JUPITER_V1_WHIRLPOOL_FP_ROUTE, JUPITER_V1_WHIRLPOOL_RUNTIME_099DA3_ROUTE, JUPITER_V1_WHIRLPOOL_FP_RUNTIME_099DA3_ROUTE,
 JUPITER_V1_WHIRLPOOL_V2_RUNTIME_099DA3_ROUTE, JUPITER_V1_WHIRLPOOL_4H_RUNTIME_099DA3_ROUTE, JUPITER_V1_WHIRLPOOL_RUNTIME_C422B2_ROUTE,
 JUPITER_V1_WHIRLPOOL_FP_RUNTIME_C422B2_ROUTE, JUPITER_V1_WHIRLPOOL_V2_RUNTIME_C422B2_ROUTE, JUPITER_V1_WHIRLPOOL_4H_RUNTIME_C422B2_ROUTE } from "../../src/swap/jupiter-solana/v1-route-config.js";
import { validateJupiterV1Material, type JupiterV1ResolvedMaterial } from "../../src/swap/jupiter-solana/v1-material.js";
import { guardJupiterV1WhirlpoolMaterial } from "../../src/swap/jupiter-solana/v1-guard.js";
import { proveJupiterV1Simulation, validateFinalizedJupiterV1Receipt } from "../../src/swap/jupiter-solana/v1-proof.js";
import { JupiterV1OwnerAdmission } from "../../src/swap/jupiter-solana/v1-admission.js";
import { ChainAccountStore } from "../../src/chain-account-store.js";
import { AssetUsageLedger } from "../../src/asset-usage-ledger.js";
import { sealAssetPolicyRegistry } from "../../src/asset-policy-registry.js";
import { fixture, mutate } from "../fixtures/jupiter-v1/material.js";
import { authorityMaterial, capturedPort } from "../fixtures/jupiter-v1/authority.js";
import { simulation, receipt } from "../fixtures/jupiter-v1/scenarios.js";
import { syntheticFpMaterial } from "../fixtures/jupiter-v1-whirlpool-fp/material.js";
import { liveSimulationCapture } from "../fixtures/jupiter-v1-live-simulation-83/capture.js";
import { syntheticV2Simulation, syntheticV2Receipt } from "../fixtures/jupiter-v1-whirlpool-v2/refusal-vectors.js";
import { runtime099da3Material, syntheticC422b2Material, type C422b2Lane } from "../fixtures/whirlpool-runtime-c422b2/material.js";
import { WHIRLPOOL_C422B2, whirlpoolC422b2ProgramData } from "../fixtures/whirlpool-runtime-c422b2/programdata.js";
import { temporaryState } from "./helpers.js";

const lanes: readonly { lane: C422b2Lane; previous: JupiterV1RouteConfig; c422b2: JupiterV1RouteConfig; current: JupiterV1RouteConfig }[] = [
 { lane: "83", previous: JUPITER_V1_WHIRLPOOL_RUNTIME_099DA3_ROUTE, c422b2: JUPITER_V1_WHIRLPOOL_RUNTIME_C422B2_ROUTE, current: JUPITER_V1_ROUTES[0]! },
 { lane: "fp", previous: JUPITER_V1_WHIRLPOOL_FP_RUNTIME_099DA3_ROUTE, c422b2: JUPITER_V1_WHIRLPOOL_FP_RUNTIME_C422B2_ROUTE, current: JUPITER_V1_ROUTES[1]! },
 { lane: "esv", previous: JUPITER_V1_WHIRLPOOL_V2_RUNTIME_099DA3_ROUTE, c422b2: JUPITER_V1_WHIRLPOOL_V2_RUNTIME_C422B2_ROUTE, current: JUPITER_V1_ROUTES[2]! },
 { lane: "4h", previous: JUPITER_V1_WHIRLPOOL_4H_RUNTIME_099DA3_ROUTE, c422b2: JUPITER_V1_WHIRLPOOL_4H_RUNTIME_C422B2_ROUTE, current: JUPITER_V1_ROUTES[3]! },
];
// 0.5.40–0.5.42 values: every historical generation keeps its route order, mechanism digest and registry digest.
const HISTORICAL = [
 ["whirlpool-v1-83-sol-usdc", "ad61f7c981282e494684f41649552531437fa31f6db0d18dee1aa4d7c6b96b92", "b54b3d63bd62557dbbf25d290a7ccade678562976de6b06eafa79e7d2be17623"],
 ["whirlpool-swap-v2-esv-sol-usdc", "c0ba30b8f7e47ce275c198599be046822dd5204740cc4985c27e0374041728b6", "6eaa301befb65188ba2ae0a2ab9a19627592a8ed89bc0b18f0ec47b0d9eccc64"],
 ["whirlpool-swap-v2-4h-sol-usdc", "159b633d3c4d297c9dd94f1b5266155841bd63fbc904fe6e4d1642209e8a9183", "dbd7856e390650990ef4b32b0074d5512d98600c18569b105f0b6c8a05c41cb1"],
 ["whirlpool-v1-fp-sol-usdc", "c859502204a2534d9356bc1139b83ce56d363aae5ebd7d46dc00477d48081ebe", "48fb407fd13ce45bbb740734a9f0e865695921f6f34e79ce72cd606310917e71"],
 ["whirlpool-v1-fp-sol-usdc-runtime-099da3", "e7a6c90a6be1b1059cafadc60227cbc303b4c8e9cbdce1beb8eacd898a134b2f", "2db21bd04077ad7d2ce5f6103e0bc058e5eab17e4cfb82c9402a978b10c000e3"],
 ["whirlpool-v1-83-sol-usdc-runtime-099da3", "f8bcdf0e2beeb784153a7c7ffd114846f486c3ec2b1590b9509617420ccf1a5f", "32d64fc2b9fd97e96c9787a0fb1ab6618292fac536ff2fdd303ccab5e2387818"],
 ["whirlpool-swap-v2-esv-sol-usdc-runtime-099da3", "f57175222a5cfb5c532cd04a6443604447d9930c0bf03fd9976bcb5f60fd1c7c", "4f8e7b72893453a38e0a227f86148fc781e33704b328581697bad99cb16549a6"],
 ["whirlpool-swap-v2-4h-sol-usdc-runtime-099da3", "d38d122aead09afa8a4f0ef4368ed29fe415b4f625c418699d6f3406deab65d9", "8e4535d44e148c540576679ac332c7fe68f7ca8773bf6f1d9c9a6b73cdcc4c95"],
 ["whirlpool-v1-83-sol-usdc-runtime-c422b2", "4c46bcfd9d2e24985efca7cfe73e174cd0b36e8054daf0499a99f590bb94ee7e", "330d187eee7db765183befcc319fda3075f8306093d890c84369210fe66851f8"],
 ["whirlpool-v1-fp-sol-usdc-runtime-c422b2", "1f321322bc0d384f6cad129b17e01c196087a371d7668ec6071578675c131ec5", "440a4b7a38235c1f66a9eab49cbb4fc3420238bbc71e2220921ab7c72104bdb1"],
 ["whirlpool-swap-v2-esv-sol-usdc-runtime-c422b2", "30a73ea0637238081aeb70f29a538d196b03697163883ef04be502a51b5bacd5", "6f0a7b4580be24ad0fa18e99d9388f0be67c0724fca850194f5ec98a27d0b3e9"],
 ["whirlpool-swap-v2-4h-sol-usdc-runtime-c422b2", "7cd3351d54a1d8ee3517269613fcbd56b10aebc5adfcbdd002f2dc588196099f", "779bafe47c78d319e211d3e4053075faac81a414918d067ea7d7e6a1487add3c"],
];
const whirlpoolRow = (m: JupiterV1ResolvedMaterial) => m.programPins.find(p => p.programId === JUPITER_V1_WHIRLPOOL_PROGRAM)!;
const WHIRLPOOL_PROGRAMDATA = JUPITER_V1_PROGRAM_AUTHORITIES.find(p => p.programId === JUPITER_V1_WHIRLPOOL_PROGRAM)!.programDataAddress;
function reason(error: unknown): unknown { return (error as { details?: { reason?: unknown } }).details?.reason; }

test("one current route per pool names no bytes; it shares its pool's route identity and every historical digest stays exact", () => {
 assert.deepEqual(JUPITER_V1_HISTORICAL_ROUTES.map(r => [r.routeId, swapMechanismDigest(r.mechanismPin), r.protocolRegistry.registryDigest]), HISTORICAL);
 assert.deepEqual(JUPITER_V1_ROUTES.map(r => r.pool), lanes.map(l => l.c422b2.pool));
 for (const route of JUPITER_V1_ROUTES) {
  assert.equal(route.runtimeProgramPins, undefined); assert.equal(route.programAuthorities, JUPITER_V1_PROGRAM_AUTHORITIES);
  assert.doesNotMatch(canonicalJson(route.mechanismPin), /[a-f0-9]{64}|slot|runtime/u);
  for (const old of JUPITER_V1_HISTORICAL_ROUTES.filter(r => r.pool === route.pool)) {
   assert.equal(swapRouteDigest(route.mechanismPin), swapRouteDigest(old.mechanismPin));
   const { routeId: _a, mechanismPin: _b, protocolRegistry: _c, runtimeProgramPins: _d, ...shape } = old;
   const { routeId: _e, mechanismPin: _f, protocolRegistry: _g, programAuthorities: _h, ...currentShape } = route;
   assert.equal(canonicalJson(currentShape), canonicalJson(shape));
  }
 }
 const digests = JUPITER_V1_ROUTES.map(r => swapMechanismDigest(r.mechanismPin));
 assert.equal(new Set([...digests, ...HISTORICAL.map(h => h[1])]).size, 16);
 assert.deepEqual(JUPITER_V1_PROGRAM_AUTHORITIES.map(p => [p.role, p.upgradeAuthority]), [
  ["jupiter_v6_program", "CvQZZ23qYDWF2RUpxYJ8y9K4skmuvYEEjH7fK58jtipQ"], ["whirlpool_program", "GwH3Hiv5mACLX3ufTw1pFsrhSPon5tdw252DBs4Rx4PV"],
  ["spl_token_program", null]]);
});

test("historical saved materials still dispatch through their own registered generation", () => {
 assert.equal(routeConfigForMaterial(fixture()), JUPITER_V1_OLD_ROUTE);
 assert.equal(routeConfigForMaterial(syntheticFpMaterial()), JUPITER_V1_WHIRLPOOL_FP_ROUTE);
 const live = liveSimulationCapture().material; validateJupiterV1Material(live);
 assert.equal(routeConfigForMaterial(live), JUPITER_V1_OLD_ROUTE);
 for (const { lane, previous, c422b2 } of lanes) {
  const before = runtime099da3Material(lane), after = syntheticC422b2Material(lane); validateJupiterV1Material(before); validateJupiterV1Material(after);
  assert.equal(routeConfigForMaterial(before), previous); assert.equal(routeConfigForMaterial(after), c422b2);
 }
});

for (const { lane, current } of lanes) {
 test(`SYNTHETIC ${lane}: both Whirlpool deployments resolve to the one current route from 45-byte headers; no program bytes are read or stored`, async () => {
  for (const served of [runtime099da3Material(lane), syntheticC422b2Material(lane)]) {
   const port = capturedPort(served), m = await authorityMaterial(served, port);
   validateJupiterV1Material(m);
   assert.equal(routeConfigForMaterial(m), current); assert.equal(routeConfigForQuote(m.quoteResponse), current);
   assert.equal(whirlpoolRow(m).provenance, "upgrade_authority");
   assert.equal(whirlpoolRow(m).deploymentSlot, whirlpoolRow(served).deploymentSlot);
   assert.equal(m.messageHash, served.messageHash);
   assert.equal(port.methods.includes("getAccountInfo"), false);
   assert.ok(port.methods.filter(method => method === "getMultipleAccounts").length <= 4);
   assert.ok(port.responseBytes() < 200_000, `response bytes ${port.responseBytes()}`);
   const stored = Buffer.byteLength(canonicalJson(m));
   assert.ok(stored < 400_000 && Buffer.byteLength(canonicalJson(served)) > 10_000_000, `stored ${stored}`);
   assert.ok(m.semanticAccounts.filter(a => a.executable || a.address === WHIRLPOOL_PROGRAMDATA).every(a => Buffer.from(a.dataBase64, "base64").length <= 45));
   const guarded = await guardJupiterV1WhirlpoolMaterial(m);
   assert.equal(guarded.routeId, current.variant === 47 ? current.routeId : undefined);
  }
 });
}

test("a new Whirlpool deployment by the same authority is accepted; another authority, another ProgramData or loader refuses before fee proof", async () => {
 const served = syntheticC422b2Material("fp");
 const slot = capturedPort(served, (key, data) => { if (key === WHIRLPOOL_PROGRAMDATA) data.writeBigUInt64LE(470_000_000n, 4); });
 assert.equal(whirlpoolRow(await authorityMaterial(served, slot)).deploymentSlot, "470000000");
 const other = Buffer.from(getAddressEncoder().encode(address("11111111111111111111111111111112")));
 for (const [label, edit, expected] of [
  ["authority", (key: string, data: Buffer) => { if (key === WHIRLPOOL_PROGRAMDATA) other.copy(data, 13); }, "solana_program_authority_changed"],
  ["authority removed", (key: string, data: Buffer) => { if (key === WHIRLPOOL_PROGRAMDATA) data[12] = 0; }, "solana_program_authority_changed"],
  ["ProgramData address", (key: string, data: Buffer) => { if (key === JUPITER_V1_WHIRLPOOL_PROGRAM) other.copy(data, 4); }, "solana_program_identity_changed"],
  ["immutable loader", (key: string) => key === ASSOCIATED_TOKEN_PROGRAM ? { owner: "BPFLoaderUpgradeab1e11111111111111111111111" } : undefined, "solana_program_identity_changed"],
 ] as const) {
  const port = capturedPort(served, edit);
  await assert.rejects(authorityMaterial(served, port), error => reason(error) === expected, label);
  assert.equal(port.methods.includes("getFeeForMessage"), false, label);
 }
});

test("saved authority evidence is bound to its own rows; a changed row or header refuses at the guard", async () => {
 const m = await authorityMaterial(syntheticC422b2Material("esv"));
 for (const change of ["deployment slot row", "authority row", "header bytes", "missing row", "byte evidence mixed in"] as const) {
  const tampered = mutate(m, v => {
   const row = v.programPins.find((p: { programId: string }) => p.programId === JUPITER_V1_WHIRLPOOL_PROGRAM);
   if (change === "deployment slot row") row.deploymentSlot = "1";
   else if (change === "authority row") row.upgradeAuthority = "11111111111111111111111111111112";
   else if (change === "missing row") v.programPins = v.programPins.filter((p: { programId: string }) => p.programId !== JUPITER_V6_PROGRAM);
   else if (change === "byte evidence mixed in") v.programPins.push({ ...row, provenance: "runtime_bytes_only", storedPayloadHash: "0".repeat(64) });
   else { const a = v.semanticAccounts.find((a: { address: string }) => a.address === WHIRLPOOL_PROGRAMDATA), d = Buffer.from(a.dataBase64, "base64");
    d[5] = d[5]! ^ 1; a.dataBase64 = d.toString("base64"); }
  });
  await assert.rejects(guardJupiterV1WhirlpoolMaterial(tampered), change);
 }
});

test("SYNTHETIC current 83 and Esv keep the exact simulation and finalized receipt effect checks", async () => {
 const m = await authorityMaterial(syntheticC422b2Material("83")), g = await guardJupiterV1WhirlpoolMaterial(m), s = simulation(g);
 s.context.slot = Number(m.accountSlot) + 1;
 const proof = await proveJupiterV1Simulation({ async call(method, params) { assert.equal(method, "simulateTransaction"); assert.equal(params[0], m.transactionBase64); return s; } }, g);
 assert.equal(proof.nativeSpendLamports, "1006400");
 const r = receipt(g); r.status.context.slot = s.context.slot + 1; r.status.value[0]!.slot = s.context.slot; r.response.slot = s.context.slot;
 const final = await validateFinalizedJupiterV1Receipt({ async call(method) { return method === "getSignatureStatuses" ? r.status : r.response; } }, g, { signature: r.signature });
 assert.equal(final.recipientOutputAtomic, proof.recipientOutputAtomic);
 const v2 = await guardJupiterV1WhirlpoolMaterial(await authorityMaterial(syntheticC422b2Material("esv"))), sv2 = syntheticV2Simulation(v2);
 const proofV2 = await proveJupiterV1Simulation({ async call() { return sv2; } }, v2), rv2 = syntheticV2Receipt(v2);
 const finalV2 = await validateFinalizedJupiterV1Receipt({ async call(method) { return method === "getSignatureStatuses" ? rv2.status : rv2.response; } }, v2, { signature: rv2.signature });
 assert.equal(finalV2.recipientOutputAtomic, proofV2.recipientOutputAtomic);
 // A program account cannot be written by a transaction, but its post-state must still begin with the stored prefix.
 const memo = sv2.value.accounts[v2.material.compiledAccounts.findIndex(a => a.address === "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr")], bytes = Buffer.from(memo.data[0], "base64");
 bytes[0] = bytes[0]! ^ 1; memo.data[0] = bytes.toString("base64");
 await assert.rejects(proveJupiterV1Simulation({ async call() { return sv2; } }, v2), /mutated read-only account data/);
});

for (const { lane, previous, c422b2, current } of lanes.filter(l => l.lane === "83" || l.lane === "esv"))
 test(`SYNTHETIC ${lane}: an admission naming any generation of the pool selects its current route with no re-admission; another pool refuses`, async t => {
  const temp = await temporaryState(); t.after(temp.cleanup);
  const profile = `synthetic-${lane}-authority`, payer = syntheticC422b2Material(lane).payer;
  const store = new ChainAccountStore(temp.root, { async load() { return Buffer.alloc(32, 77); }, async create() { return Buffer.alloc(32, 77); } });
  await store.ensureLocal({ profile, rail: "solana", create: async () => ({ address: payer, seed: Buffer.alloc(32, 9) }) });
  const asset = (kind: "native" | "token", pin: SwapMechanismPin) => ({ kind, identifier: kind === "native" ? null : SOLANA_USDC_MINT, symbol: kind === "native" ? "SOL" : "USDC",
   decimals: kind === "native" ? 9 : 6, rails: { direct: false, gasless: false, x402: false, bridge: false, swap: true },
   caps: kind === "native" ? { maximumPerTransferAtomic: "6000000", dailyLimitAtomic: "6000000" } : { maximumPerTransferAtomic: "500000", dailyLimitAtomic: "500000" },
   mechanismPins: { swap: pin } });
  const registry = (inputPin: SwapMechanismPin, outputPin = inputPin) => { const now = new Date(); return sealAssetPolicyRegistry({ schemaVersion: "apn.asset-policy-registry.v1",
   registryVersion: "synthetic-authority.1", publishedAt: now.toISOString(), effectiveDate: now.toISOString().slice(0, 10), effectiveAt: new Date(now.getTime() - 1000).toISOString(),
   expiresAt: new Date(now.getTime() + 3600000).toISOString(), chains: [{ chain: current.mechanismPin.chain, family: "solana", name: "Solana",
    assets: [asset("native", inputPin), asset("token", outputPin)] }] } as Parameters<typeof sealAssetPolicyRegistry>[0]); };
  let active = registry(current.mechanismPin);
  const admission = new JupiterV1OwnerAdmission(store, async () => ({ profile, registry: active, digest: active.policyDigest, revision: 1, accounts: { solana: payer },
   activationDigest: "a".repeat(64), activatedAt: active.effectiveAt! }), new AssetUsageLedger(temp.root), () => new Date());
  assert.equal((await admission.resolveRoute(profile, "1000000", "115960", payer)).route, current);
  for (const pair of [[previous.mechanismPin, previous.mechanismPin], [c422b2.mechanismPin, current.mechanismPin], [current.mechanismPin, previous.mechanismPin]]) {
   active = registry(pair[0]!, pair[1]!); const resolved = await admission.resolveRoute(profile, "1000000", "115960", payer);
   assert.equal(resolved.route, current); assert.ok(resolved.routes.includes(previous) && resolved.routes.includes(c422b2) && resolved.routes.includes(current));
  }
  const other = JUPITER_V1_ROUTES.find(route => route.pool !== current.pool)!;
  for (const pair of [[current.mechanismPin, other.mechanismPin], [other.mechanismPin, previous.mechanismPin]]) {
   active = registry(pair[0]!, pair[1]!); await assert.rejects(admission.resolveRoute(profile, "1000000", "115960", payer));
  }
 });

test("the Whirlpool fixture is the exact two-origin capture", () => {
 const d = whirlpoolC422b2ProgramData();
 assert.deepEqual([sha256(d), sha256(d.subarray(0, 45)), sha256(d.subarray(45)), d.readBigUInt64LE(4).toString()],
  [WHIRLPOOL_C422B2.programDataHash, WHIRLPOOL_C422B2.headerHash, WHIRLPOOL_C422B2.payloadHash, WHIRLPOOL_C422B2.deploymentSlot]);
 assert.equal(JUPITER_V6_PROGRAM, "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4");
});
