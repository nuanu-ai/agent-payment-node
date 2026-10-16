// SYNTHETIC generation vectors over captured public bytes. No live simulation, signature, send or paid acceptance.
import assert from "node:assert/strict";
import test from "node:test";
import { canonicalJson, sha256 } from "../../src/canonical.js";
import { swapMechanismDigest, type SwapMechanismPin } from "../../src/swap/pin.js";
import type { SolanaRpcPort } from "../../src/solana/rpc.js";
import { JUPITER_V6_PROGRAM, SOLANA_USDC_MINT } from "../../src/swap/jupiter-solana/catalog.js";
import { JUPITER_V1_RUNTIME_099DA3_PROGRAM_PINS, JUPITER_V1_RUNTIME_099DA3_WHIRLPOOL_C422B2_PROGRAM_PINS,
 JUPITER_V1_WHIRLPOOL_PROGRAM } from "../../src/swap/jupiter-solana/v1-pins.js";
import { JUPITER_V1_FINITE_ROUTES, routeConfigForMaterial, routeConfigForQuote, type JupiterV1RouteConfig,
 JUPITER_V1_OLD_ROUTE, JUPITER_V1_WHIRLPOOL_FP_ROUTE, JUPITER_V1_WHIRLPOOL_V2_ROUTE, JUPITER_V1_WHIRLPOOL_4H_ROUTE,
 JUPITER_V1_WHIRLPOOL_RUNTIME_099DA3_ROUTE, JUPITER_V1_WHIRLPOOL_FP_RUNTIME_099DA3_ROUTE, JUPITER_V1_WHIRLPOOL_V2_RUNTIME_099DA3_ROUTE,
 JUPITER_V1_WHIRLPOOL_4H_RUNTIME_099DA3_ROUTE, JUPITER_V1_WHIRLPOOL_RUNTIME_C422B2_ROUTE, JUPITER_V1_WHIRLPOOL_FP_RUNTIME_C422B2_ROUTE,
 JUPITER_V1_WHIRLPOOL_V2_RUNTIME_C422B2_ROUTE, JUPITER_V1_WHIRLPOOL_4H_RUNTIME_C422B2_ROUTE } from "../../src/swap/jupiter-solana/v1-route-config.js";
import { validateJupiterV1Material, type JupiterV1ResolvedMaterial } from "../../src/swap/jupiter-solana/v1-material.js";
import { guardJupiterV1WhirlpoolMaterial } from "../../src/swap/jupiter-solana/v1-guard.js";
import { JupiterV1MaterialResolver } from "../../src/swap/jupiter-solana/v1-resolver.js";
import { proveJupiterV1Simulation, validateFinalizedJupiterV1Receipt } from "../../src/swap/jupiter-solana/v1-proof.js";
import { JupiterV1OwnerAdmission } from "../../src/swap/jupiter-solana/v1-admission.js";
import { ChainAccountStore } from "../../src/chain-account-store.js";
import { AssetUsageLedger } from "../../src/asset-usage-ledger.js";
import { sealAssetPolicyRegistry } from "../../src/asset-policy-registry.js";
import { fixture, mutate } from "../fixtures/jupiter-v1/material.js";
import { simulation, receipt } from "../fixtures/jupiter-v1/scenarios.js";
import { syntheticFpMaterial } from "../fixtures/jupiter-v1-whirlpool-fp/material.js";
import { liveSimulationCapture } from "../fixtures/jupiter-v1-live-simulation-83/capture.js";
import { syntheticV2Simulation, syntheticV2Receipt } from "../fixtures/jupiter-v1-whirlpool-v2/refusal-vectors.js";
import { runtime099da3Material, syntheticC422b2Material, withWhirlpoolProgramData, type C422b2Lane } from "../fixtures/whirlpool-runtime-c422b2/material.js";
import { WHIRLPOOL_C422B2, whirlpoolC422b2ProgramData } from "../fixtures/whirlpool-runtime-c422b2/programdata.js";
import { temporaryState } from "./helpers.js";

const lanes: readonly { lane: C422b2Lane; previous: JupiterV1RouteConfig; fresh: JupiterV1RouteConfig; historical: JupiterV1RouteConfig }[] = [
 { lane: "83", previous: JUPITER_V1_WHIRLPOOL_RUNTIME_099DA3_ROUTE, fresh: JUPITER_V1_WHIRLPOOL_RUNTIME_C422B2_ROUTE, historical: JUPITER_V1_OLD_ROUTE },
 { lane: "fp", previous: JUPITER_V1_WHIRLPOOL_FP_RUNTIME_099DA3_ROUTE, fresh: JUPITER_V1_WHIRLPOOL_FP_RUNTIME_C422B2_ROUTE, historical: JUPITER_V1_WHIRLPOOL_FP_ROUTE },
 { lane: "esv", previous: JUPITER_V1_WHIRLPOOL_V2_RUNTIME_099DA3_ROUTE, fresh: JUPITER_V1_WHIRLPOOL_V2_RUNTIME_C422B2_ROUTE, historical: JUPITER_V1_WHIRLPOOL_V2_ROUTE },
 { lane: "4h", previous: JUPITER_V1_WHIRLPOOL_4H_RUNTIME_099DA3_ROUTE, fresh: JUPITER_V1_WHIRLPOOL_4H_RUNTIME_C422B2_ROUTE, historical: JUPITER_V1_WHIRLPOOL_4H_ROUTE },
];
// 0.5.40 values: every preceding generation keeps its route order, mechanism digest and registry digest.
const PRECEDING = [
 ["whirlpool-v1-83-sol-usdc", "ad61f7c981282e494684f41649552531437fa31f6db0d18dee1aa4d7c6b96b92", "b54b3d63bd62557dbbf25d290a7ccade678562976de6b06eafa79e7d2be17623"],
 ["whirlpool-swap-v2-esv-sol-usdc", "c0ba30b8f7e47ce275c198599be046822dd5204740cc4985c27e0374041728b6", "6eaa301befb65188ba2ae0a2ab9a19627592a8ed89bc0b18f0ec47b0d9eccc64"],
 ["whirlpool-swap-v2-4h-sol-usdc", "159b633d3c4d297c9dd94f1b5266155841bd63fbc904fe6e4d1642209e8a9183", "dbd7856e390650990ef4b32b0074d5512d98600c18569b105f0b6c8a05c41cb1"],
 ["whirlpool-v1-fp-sol-usdc", "c859502204a2534d9356bc1139b83ce56d363aae5ebd7d46dc00477d48081ebe", "48fb407fd13ce45bbb740734a9f0e865695921f6f34e79ce72cd606310917e71"],
 ["whirlpool-v1-fp-sol-usdc-runtime-099da3", "e7a6c90a6be1b1059cafadc60227cbc303b4c8e9cbdce1beb8eacd898a134b2f", "2db21bd04077ad7d2ce5f6103e0bc058e5eab17e4cfb82c9402a978b10c000e3"],
 ["whirlpool-v1-83-sol-usdc-runtime-099da3", "f8bcdf0e2beeb784153a7c7ffd114846f486c3ec2b1590b9509617420ccf1a5f", "32d64fc2b9fd97e96c9787a0fb1ab6618292fac536ff2fdd303ccab5e2387818"],
 ["whirlpool-swap-v2-esv-sol-usdc-runtime-099da3", "f57175222a5cfb5c532cd04a6443604447d9930c0bf03fd9976bcb5f60fd1c7c", "4f8e7b72893453a38e0a227f86148fc781e33704b328581697bad99cb16549a6"],
 ["whirlpool-swap-v2-4h-sol-usdc-runtime-099da3", "d38d122aead09afa8a4f0ef4368ed29fe415b4f625c418699d6f3406deab65d9", "8e4535d44e148c540576679ac332c7fe68f7ca8773bf6f1d9c9a6b73cdcc4c95"],
];
const whirlpoolRow = (m: JupiterV1ResolvedMaterial) => m.programPins.find(p => p.programId === JUPITER_V1_WHIRLPOOL_PROGRAM)!;
const previousWhirlpool = () => Buffer.from(fixture().semanticAccounts.find(a => a.address === whirlpoolRow(fixture()).programDataAddress)!.dataBase64, "base64");

test("c422b2 appends four routes; the eight preceding routes keep order, digests and contracts", () => {
 assert.deepEqual(JUPITER_V1_FINITE_ROUTES.slice(0, 8).map(r => [r.routeId, swapMechanismDigest(r.mechanismPin), r.protocolRegistry.registryDigest]), PRECEDING);
 assert.deepEqual(JUPITER_V1_FINITE_ROUTES.slice(8).map(r => [r.routeId, swapMechanismDigest(r.mechanismPin), r.protocolRegistry.registryDigest]), [
  ["whirlpool-v1-83-sol-usdc-runtime-c422b2", "4c46bcfd9d2e24985efca7cfe73e174cd0b36e8054daf0499a99f590bb94ee7e", "330d187eee7db765183befcc319fda3075f8306093d890c84369210fe66851f8"],
  ["whirlpool-v1-fp-sol-usdc-runtime-c422b2", "1f321322bc0d384f6cad129b17e01c196087a371d7668ec6071578675c131ec5", "440a4b7a38235c1f66a9eab49cbb4fc3420238bbc71e2220921ab7c72104bdb1"],
  ["whirlpool-swap-v2-esv-sol-usdc-runtime-c422b2", "30a73ea0637238081aeb70f29a538d196b03697163883ef04be502a51b5bacd5", "6f0a7b4580be24ad0fa18e99d9388f0be67c0724fca850194f5ec98a27d0b3e9"],
  ["whirlpool-swap-v2-4h-sol-usdc-runtime-c422b2", "7cd3351d54a1d8ee3517269613fcbd56b10aebc5adfcbdd002f2dc588196099f", "779bafe47c78d319e211d3e4053075faac81a414918d067ea7d7e6a1487add3c"]]);
 assert.deepEqual(JUPITER_V1_FINITE_ROUTES.slice(8).map(r => r.routeId), lanes.map(l => l.fresh.routeId));
 for (const { previous, fresh } of lanes) {
  const { routeId: _a, mechanismPin: _b, protocolRegistry: _c, runtimeProgramPins: _d, ...before } = previous;
  const { routeId: _e, mechanismPin: _f, protocolRegistry: _g, runtimeProgramPins: pins, ...after } = fresh;
  assert.equal(canonicalJson(after), canonicalJson(before));
  assert.equal(pins, JUPITER_V1_RUNTIME_099DA3_WHIRLPOOL_C422B2_PROGRAM_PINS);
  const { protocolVersion: _h, validationPolicyIdentity: _i, validationPolicyVersion: _j, ...pinBefore } = previous.mechanismPin;
  const { protocolVersion: _k, validationPolicyIdentity: _l, validationPolicyVersion: _m, ...pinAfter } = fresh.mechanismPin;
  assert.equal(canonicalJson(pinAfter), canonicalJson(pinBefore));
  assert.notEqual(swapMechanismDigest(fresh.mechanismPin), swapMechanismDigest(previous.mechanismPin));
 }
 assert.equal(new Set(lanes.map(l => swapMechanismDigest(l.fresh.mechanismPin))).size, 4);
 assert.deepEqual(JUPITER_V1_RUNTIME_099DA3_WHIRLPOOL_C422B2_PROGRAM_PINS.map(p => p.programId === JUPITER_V1_WHIRLPOOL_PROGRAM ?
  { ...p, payloadHash: "610b1e394973bd1b86de8afc983524bd21dea177e87bfae75ec289d4c350f9ae", programDataHash: undefined } : p),
  JUPITER_V1_RUNTIME_099DA3_PROGRAM_PINS.map(p => ({ ...p, ...(p.programId === JUPITER_V1_WHIRLPOOL_PROGRAM ? { programDataHash: undefined } : {}) })));
 const row = JUPITER_V1_RUNTIME_099DA3_WHIRLPOOL_C422B2_PROGRAM_PINS.find(p => p.programId === JUPITER_V1_WHIRLPOOL_PROGRAM)!;
 assert.deepEqual([row.payloadHash, row.programDataHash], [WHIRLPOOL_C422B2.payloadHash, WHIRLPOOL_C422B2.programDataHash]);
});

test("historical saved materials still dispatch through their own registered generation", () => {
 assert.equal(routeConfigForMaterial(fixture()), JUPITER_V1_OLD_ROUTE);
 assert.equal(routeConfigForMaterial(syntheticFpMaterial()), JUPITER_V1_WHIRLPOOL_FP_ROUTE);
 const live = liveSimulationCapture().material; validateJupiterV1Material(live);
 assert.equal(routeConfigForMaterial(live), JUPITER_V1_OLD_ROUTE);
 for (const { lane, previous } of lanes) {
  const m = runtime099da3Material(lane); validateJupiterV1Material(m);
  assert.equal(routeConfigForMaterial(m), previous);
 }
});

for (const { lane, previous, fresh, historical } of lanes) {
 test(`SYNTHETIC ${lane}: the new Whirlpool bytes select only the c422b2 generation`, async () => {
  const m = syntheticC422b2Material(lane), past = runtime099da3Material(lane);
  validateJupiterV1Material(m);
  assert.equal(whirlpoolRow(m).deploymentSlot, WHIRLPOOL_C422B2.deploymentSlot);
  assert.equal(routeConfigForMaterial(m), fresh);
  assert.equal(routeConfigForQuote(m.quoteResponse), historical);
  assert.equal(routeConfigForQuote(m.quoteResponse, fresh.routeId), fresh);
  assert.equal(m.messageHash, past.messageHash);
  const guarded = await guardJupiterV1WhirlpoolMaterial(m);
  assert.equal(guarded.routeId, fresh.variant === 47 ? fresh.routeId : undefined);
  assert.equal(routeConfigForMaterial(past), previous);
  assert.throws(() => routeConfigForQuote(m.quoteResponse, lanes.find(l => l.lane !== lane && l.fresh.pool !== fresh.pool)!.fresh.routeId));
 });
 for (const change of ["old bytes under the new pin", "one changed payload bit", "unregistered payload", "changed deployment header", "missing Whirlpool pin", "duplicate Whirlpool pin"] as const)
  test(`SYNTHETIC ${lane}: the c422b2 generation refuses ${change}`, async () => {
   let m: JupiterV1ResolvedMaterial;
   if (change === "unregistered payload") { const d = whirlpoolC422b2ProgramData(); d[45 + 1_000] = d[45 + 1_000]! ^ 1; m = withWhirlpoolProgramData(runtime099da3Material(lane), d); }
   else m = mutate(syntheticC422b2Material(lane), v => {
    const row = v.programPins.find((p: { programId: string }) => p.programId === JUPITER_V1_WHIRLPOOL_PROGRAM);
    const account = v.semanticAccounts.find((a: { address: string }) => a.address === row.programDataAddress);
    if (change === "missing Whirlpool pin") v.programPins = v.programPins.filter((p: { programId: string }) => p.programId !== JUPITER_V1_WHIRLPOOL_PROGRAM);
    else if (change === "duplicate Whirlpool pin") v.programPins.push({ ...row });
    else if (change === "old bytes under the new pin") account.dataBase64 = previousWhirlpool().toString("base64");
    else { const d = Buffer.from(account.dataBase64, "base64"), offset = change === "changed deployment header" ? 4 : 45 + 1_000;
     d[offset] = d[offset]! ^ 1; account.dataBase64 = d.toString("base64"); }
   });
   if (change === "unregistered payload" || change === "missing Whirlpool pin" || change === "duplicate Whirlpool pin") assert.throws(() => routeConfigForMaterial(m));
   await assert.rejects(guardJupiterV1WhirlpoolMaterial(m));
  });
}

function publicPort(m: JupiterV1ResolvedMaterial) {
 const methods: string[] = [];
 const wire = (key: string, slice?: { offset: number; length: number }) => {
  const a = m.semanticAccounts.find(a => a.address === key); if (a === undefined || a.existence === "absent") return null;
  const data = Buffer.from(a.dataBase64, "base64");
  return { owner: a.owner, executable: a.executable, lamports: BigInt(a.lamports), space: data.length, rentEpoch: 0n,
   data: [(slice === undefined ? data : data.subarray(slice.offset, slice.offset + slice.length)).toString("base64"), "base64"] };
 };
 const rpc: SolanaRpcPort = { originHash: "0".repeat(64), async call(method, params) {
  methods.push(method); const config = params[1] as { dataSlice?: { offset: number; length: number } } | undefined;
  switch (method) {
   case "getGenesisHash": return m.genesis;
   case "getMultipleAccounts": return { context: { slot: BigInt(m.accountSlot) }, value: (params[0] as string[]).map(k => wire(k, config?.dataSlice)) };
   case "getAccountInfo": return { context: { slot: BigInt(m.accountSlot) }, value: wire(params[0] as string, config?.dataSlice) };
   case "getFeeForMessage": return { context: { slot: BigInt(m.accountSlot) }, value: 6400n };
   case "getBlockHeight": return 1n;
   case "getMinimumBalanceForRentExemption": return 1488440n;
   default: throw Error(`No signing, send or simulation allowed: ${method}`);
  }
 } };
 return { rpc, methods };
}
test("resolver rereads the new Whirlpool bytes only under the selected c422b2 generation", async () => {
 const fresh = syntheticC422b2Material("fp"), p = publicPort(fresh);
 const m = await new JupiterV1MaterialResolver(p.rpc).resolve(fresh.payer, fresh.quoteResponse, fresh.rawBuildResponse, "6000000", undefined,
  JUPITER_V1_WHIRLPOOL_FP_RUNTIME_C422B2_ROUTE.routeId);
 assert.equal(routeConfigForMaterial(m), JUPITER_V1_WHIRLPOOL_FP_RUNTIME_C422B2_ROUTE);
 assert.equal(canonicalJson(m.programPins), canonicalJson(fresh.programPins));
 await guardJupiterV1WhirlpoolMaterial(m);
 for (const [served, routeId] of [[fresh, JUPITER_V1_WHIRLPOOL_FP_RUNTIME_099DA3_ROUTE.routeId], [runtime099da3Material("fp"), JUPITER_V1_WHIRLPOOL_FP_RUNTIME_C422B2_ROUTE.routeId]] as const) {
  const q = publicPort(served);
  await assert.rejects(new JupiterV1MaterialResolver(q.rpc).resolve(served.payer, served.quoteResponse, served.rawBuildResponse, "6000000", undefined, routeId),
   /runtime executable pin changed/u);
  assert.equal(q.methods.includes("getFeeForMessage"), false);
 }
});

test("SYNTHETIC upgraded 83 and Esv guard, simulation and receipt keep the exact finite effect checks", async () => {
 const m = syntheticC422b2Material("83"), g = await guardJupiterV1WhirlpoolMaterial(m), s = simulation(g);
 s.context.slot = Number(m.accountSlot) + 1;
 const proof = await proveJupiterV1Simulation({ async call(method, params) { assert.equal(method, "simulateTransaction"); assert.equal(params[0], m.transactionBase64); return s; } }, g);
 assert.equal(proof.nativeSpendLamports, "1006400");
 const r = receipt(g); r.status.context.slot = s.context.slot + 1; r.status.value[0]!.slot = s.context.slot; r.response.slot = s.context.slot;
 const final = await validateFinalizedJupiterV1Receipt({ async call(method) { return method === "getSignatureStatuses" ? r.status : r.response; } }, g, { signature: r.signature });
 assert.equal(final.recipientOutputAtomic, proof.recipientOutputAtomic);
 const v2 = await guardJupiterV1WhirlpoolMaterial(syntheticC422b2Material("esv")), sv2 = syntheticV2Simulation(v2);
 const proofV2 = await proveJupiterV1Simulation({ async call() { return sv2; } }, v2), rv2 = syntheticV2Receipt(v2);
 const finalV2 = await validateFinalizedJupiterV1Receipt({ async call(method) { return method === "getSignatureStatuses" ? rv2.status : rv2.response; } }, v2, { signature: rv2.signature });
 assert.equal(finalV2.recipientOutputAtomic, proofV2.recipientOutputAtomic);
});

for (const { lane, previous, fresh } of lanes.filter(l => l.lane === "83" || l.lane === "esv"))
 test(`SYNTHETIC ${lane}: only both assets' exact c422b2 admission selects the new generation`, async t => {
  const temp = await temporaryState(); t.after(temp.cleanup);
  const profile = `synthetic-${lane}-c422b2`, payer = syntheticC422b2Material(lane).payer;
  const store = new ChainAccountStore(temp.root, { async load() { return Buffer.alloc(32, 77); }, async create() { return Buffer.alloc(32, 77); } });
  await store.ensureLocal({ profile, rail: "solana", create: async () => ({ address: payer, seed: Buffer.alloc(32, 9) }) });
  const registry = (inputPin: SwapMechanismPin, outputPin = inputPin) => { const now = new Date(); return sealAssetPolicyRegistry({ schemaVersion: "apn.asset-policy-registry.v1", registryVersion: "synthetic-c422b2.1", publishedAt: now.toISOString(), effectiveDate: now.toISOString().slice(0, 10), effectiveAt: new Date(now.getTime() - 1000).toISOString(), expiresAt: new Date(now.getTime() + 3600000).toISOString(), chains: [{ chain: fresh.mechanismPin.chain, family: "solana", name: "Solana", assets: [{ kind: "native", identifier: null, symbol: "SOL", decimals: 9, rails: { direct: false, gasless: false, x402: false, bridge: false, swap: true }, caps: { maximumPerTransferAtomic: "6000000", dailyLimitAtomic: "6000000" }, mechanismPins: { swap: inputPin } }, { kind: "token", identifier: SOLANA_USDC_MINT, symbol: "USDC", decimals: 6, rails: { direct: false, gasless: false, x402: false, bridge: false, swap: true }, caps: { maximumPerTransferAtomic: "500000", dailyLimitAtomic: "500000" }, mechanismPins: { swap: outputPin } }] }] }); };
  let active = registry(fresh.mechanismPin);
  const admission = new JupiterV1OwnerAdmission(store, async () => ({ profile, registry: active, digest: active.policyDigest, revision: 1, accounts: { solana: payer }, activationDigest: "a".repeat(64), activatedAt: active.effectiveAt! }), new AssetUsageLedger(temp.root), () => new Date());
  assert.equal((await admission.resolveRoute(profile, "1000000", "115960", payer)).route, fresh);
  active = registry(previous.mechanismPin); assert.equal((await admission.resolveRoute(profile, "1000000", "115960", payer)).route, previous);
  for (const pair of [[previous.mechanismPin, fresh.mechanismPin], [fresh.mechanismPin, previous.mechanismPin]]) {
   active = registry(pair[0]!, pair[1]!); await assert.rejects(admission.resolveRoute(profile, "1000000", "115960", payer));
  }
 });

test("the fixture is the exact two-origin capture", () => {
 const d = whirlpoolC422b2ProgramData();
 assert.deepEqual([sha256(d), sha256(d.subarray(0, 45)), sha256(d.subarray(45)), d.readBigUInt64LE(4).toString()],
  [WHIRLPOOL_C422B2.programDataHash, WHIRLPOOL_C422B2.headerHash, WHIRLPOOL_C422B2.payloadHash, WHIRLPOOL_C422B2.deploymentSlot]);
 assert.notEqual(sha256(previousWhirlpool().subarray(45)), WHIRLPOOL_C422B2.payloadHash);
 assert.equal(JUPITER_V6_PROGRAM, "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4");
});
