import assert from "node:assert/strict";
import test from "node:test";
import { canonicalJson } from "../../src/canonical.js";
import { swapMechanismDigest } from "../../src/swap/pin.js";
import { routeConfigForQuote, routeConfigForMaterial, JUPITER_V1_HISTORICAL_ROUTES, JUPITER_V1_ROUTES,
 JUPITER_V1_WHIRLPOOL_FP_ROUTE as OLD, JUPITER_V1_WHIRLPOOL_FP_RUNTIME_099DA3_ROUTE as NEW, JUPITER_V1_WHIRLPOOL_RUNTIME_099DA3_ROUTE as NEW83 } from "../../src/swap/jupiter-solana/v1-route-config.js";
import { validateJupiterV1Material } from "../../src/swap/jupiter-solana/v1-material.js";
import { guardJupiterV1WhirlpoolMaterial } from "../../src/swap/jupiter-solana/v1-guard.js";
import { JupiterV1MaterialResolver } from "../../src/swap/jupiter-solana/v1-resolver.js";
import type { SolanaRpcPort } from "../../src/solana/rpc.js";
import { JUPITER_V6_PROGRAM } from "../../src/swap/jupiter-solana/catalog.js";
import { syntheticFpMaterial } from "../fixtures/jupiter-v1-whirlpool-fp/material.js";
import { syntheticRuntime099da3Material } from "../fixtures/jupiter-v1-runtime-099da3/material.js";
import { fixture, mutate } from "../fixtures/jupiter-v1/material.js";
import { simulation, receipt } from "../fixtures/jupiter-v1/scenarios.js";
import { proveJupiterV1Simulation, validateFinalizedJupiterV1Receipt } from "../../src/swap/jupiter-solana/v1-proof.js";

test("runtime registration preserves all four historical mechanism and registry digests", () => {
 const pairs = JUPITER_V1_HISTORICAL_ROUTES.slice(0,4).map(r => [swapMechanismDigest(r.mechanismPin),r.protocolRegistry.registryDigest]);
 assert.deepEqual(pairs, [
  ["ad61f7c981282e494684f41649552531437fa31f6db0d18dee1aa4d7c6b96b92","b54b3d63bd62557dbbf25d290a7ccade678562976de6b06eafa79e7d2be17623"],
  ["c0ba30b8f7e47ce275c198599be046822dd5204740cc4985c27e0374041728b6","6eaa301befb65188ba2ae0a2ab9a19627592a8ed89bc0b18f0ec47b0d9eccc64"],
  ["159b633d3c4d297c9dd94f1b5266155841bd63fbc904fe6e4d1642209e8a9183","dbd7856e390650990ef4b32b0074d5512d98600c18569b105f0b6c8a05c41cb1"],
  ["c859502204a2534d9356bc1139b83ce56d363aae5ebd7d46dc00477d48081ebe","48fb407fd13ce45bbb740734a9f0e865695921f6f34e79ce72cd606310917e71"]
 ]);
 assert.notEqual(swapMechanismDigest(NEW.mechanismPin),swapMechanismDigest(OLD.mechanismPin));
 assert.notEqual(NEW.protocolRegistry.registryDigest,OLD.protocolRegistry.registryDigest);
 assert.equal(fixture().materialDigest,"bd2a28b9dc5e99bfe471f0e07c38ffb5ad1f7ded5da8056a13cacbd3bbb961b1");
});
const CURRENT_FP = JUPITER_V1_ROUTES.find(r => r.pool === OLD.pool)!;
test("a new quote names the pool's current route; saved material selects its registered code generation", () => {
 const old = syntheticFpMaterial(), fresh = syntheticRuntime099da3Material();
 assert.equal(routeConfigForQuote(fresh.quoteResponse),CURRENT_FP);
 assert.equal(routeConfigForQuote(fresh.quoteResponse,NEW.routeId),NEW);
 assert.equal(routeConfigForMaterial(old),OLD); assert.equal(routeConfigForMaterial(fresh),NEW);
 validateJupiterV1Material(old); validateJupiterV1Material(fresh);
 assert.equal(fresh.messageHash,old.messageHash);
 const new83 = syntheticRuntime099da3Material("83");
 assert.equal(routeConfigForMaterial(new83),NEW83); validateJupiterV1Material(new83);
 assert.equal(new83.messageHash,fixture().messageHash);
});
test("historical pinless diagnostic stays readable and cannot enter runtime admission or guarded proof",async () => {
 const m = mutate(syntheticFpMaterial(),v => {v.programPins = [];});
 validateJupiterV1Material(m);
 assert.throws(() => routeConfigForMaterial(m));
 await assert.rejects(guardJupiterV1WhirlpoolMaterial(m));
});
for (const kind of ["unknown hash","duplicate program","missing program","changed header hash","old hash on new bytes","changed payload","changed loader header"] as const)
test(`SYNTHETIC runtime generation refuses ${kind} after material rehash`,async () => {
 const m = mutate(syntheticRuntime099da3Material(),v => {
  const p = v.programPins.find((p:any) => p.programId === JUPITER_V6_PROGRAM);
  if (kind === "duplicate program") v.programPins.push({...p});
  else if (kind === "missing program") v.programPins = v.programPins.filter((p:any) => p.programId !== JUPITER_V6_PROGRAM);
  else if (kind === "unknown hash") p.storedPayloadHash = "0".repeat(64);
  else if (kind === "changed header hash") p.programDataHash = "0".repeat(64);
  else if (kind === "old hash on new bytes") p.storedPayloadHash = (syntheticFpMaterial().programPins.find(p => p.programId === JUPITER_V6_PROGRAM) as { storedPayloadHash: string }).storedPayloadHash;
  else { const a = v.semanticAccounts.find((a:any) => a.address === p.programDataAddress), d = Buffer.from(a.dataBase64,"base64");
   const offset = kind === "changed payload" ? d.length - 1 : 4; d[offset] = d[offset]! ^ 1; a.dataBase64 = d.toString("base64"); }
 });
 await assert.rejects(guardJupiterV1WhirlpoolMaterial(m));
});
test("SYNTHETIC upgraded FP guard, simulation and receipt retain the exact finite effect checks",async () => {
 const m = syntheticRuntime099da3Material(), g = await guardJupiterV1WhirlpoolMaterial(m), s = simulation(g);
 s.context.slot = Number(m.accountSlot) + 1;
 const proof = await proveJupiterV1Simulation({async call(method,params) {
  assert.equal(method,"simulateTransaction"); assert.equal(params[0],m.transactionBase64); return s;
 }},g);
 assert.equal(proof.nativeSpendLamports,"1006400");
 const r = receipt(g); r.status.context.slot = s.context.slot + 1; r.status.value[0]!.slot = s.context.slot; r.response.slot = s.context.slot;
 const final = await validateFinalizedJupiterV1Receipt({async call(method) {return method === "getSignatureStatuses" ? r.status : r.response;}},g,{signature:r.signature});
 assert.equal(final.recipientOutputAtomic,proof.recipientOutputAtomic);
});
function publicPort(changeHeader: false | "slot" | "authority" = false, m = syntheticRuntime099da3Material()) {
 const methods:string[] = [];
 const wire = (key:string,slice?:{offset:number;length:number}) => {
  const a = m.semanticAccounts.find(a => a.address === key); if (a === undefined || a.existence === "absent") return null;
  const data = Buffer.from(a.dataBase64,"base64");
  const offset = changeHeader === "slot" ? 4 : 20;
  if (changeHeader !== false && key === m.programPins.find(p => p.programId === JUPITER_V6_PROGRAM)!.programDataAddress) data[offset] = data[offset]! ^ 1;
  return {owner:a.owner,executable:a.executable,lamports:BigInt(a.lamports),space:data.length,rentEpoch:0n,
   data:[(slice === undefined ? data : data.subarray(slice.offset,slice.offset+slice.length)).toString("base64"),"base64"]};
 };
 const rpc:SolanaRpcPort = {originHash:"0".repeat(64),async call(method,params) {
  methods.push(method); const config = params[1] as {dataSlice?:{offset:number;length:number}} | undefined;
  switch(method) {
   case "getGenesisHash": return m.genesis;
   case "getMultipleAccounts": return {context:{slot:BigInt(m.accountSlot)},value:(params[0] as string[]).map(k => wire(k,config?.dataSlice))};
   case "getAccountInfo": return {context:{slot:BigInt(m.accountSlot)},value:wire(params[0] as string,config?.dataSlice)};
   case "getFeeForMessage": return {context:{slot:BigInt(m.accountSlot)},value:6400n};
   case "getBlockHeight": return 1n;
   case "getMinimumBalanceForRentExemption": return 1488440n;
   default: throw Error(`No signing, send or simulation allowed: ${method}`);
  }
 }};
 return {m,rpc,methods};
}
test("resolver reads program headers only and names the pool's current route, whatever generation is deployed",async () => {
 for (const served of [publicPort(), publicPort(false, syntheticFpMaterial())]) {
  const m = await new JupiterV1MaterialResolver(served.rpc).resolve(served.m.payer,served.m.quoteResponse,served.m.rawBuildResponse,"6000000");
  assert.equal(routeConfigForMaterial(m),CURRENT_FP);
  const jup = m.programPins.find(p => p.programId === JUPITER_V6_PROGRAM)!;
  assert.equal(jup.provenance,"upgrade_authority"); assert.equal(jup.upgradeAuthority,"CvQZZ23qYDWF2RUpxYJ8y9K4skmuvYEEjH7fK58jtipQ");
  assert.equal(jup.deploymentSlot, served.m.programPins.find(p => p.programId === JUPITER_V6_PROGRAM)!.deploymentSlot);
  assert.ok(m.semanticAccounts.every(a => Buffer.from(a.dataBase64,"base64").length <= 10_240), "no ProgramData bytes are stored");
  assert.equal(served.methods.includes("getAccountInfo"),false);
  await guardJupiterV1WhirlpoolMaterial(m);
 }
 const p = publicPort();
 await assert.rejects(new JupiterV1MaterialResolver(p.rpc).resolve(p.m.payer,p.m.quoteResponse,p.m.rawBuildResponse,"6000000",undefined,NEW.routeId),
  { code: "APN_OPERATION_BLOCKED", details: { reason: "jupiter_v1_historical_route" } });
});
test("resolver accepts a new JUP6 deployment slot by the same authority and refuses another authority before fee proof",async () => {
 const slot = publicPort("slot"), m = await new JupiterV1MaterialResolver(slot.rpc).resolve(slot.m.payer,slot.m.quoteResponse,slot.m.rawBuildResponse,"6000000");
 assert.notEqual(m.programPins.find(p => p.programId === JUPITER_V6_PROGRAM)!.deploymentSlot, slot.m.programPins.find(p => p.programId === JUPITER_V6_PROGRAM)!.deploymentSlot);
 const p = publicPort("authority");
 await assert.rejects(new JupiterV1MaterialResolver(p.rpc).resolve(p.m.payer,p.m.quoteResponse,p.m.rawBuildResponse,"6000000"),
  (error: { code?: string; details?: Record<string, unknown> }) => error.code === "APN_OPERATION_BLOCKED" &&
   error.details?.reason === "solana_program_authority_changed" && error.details.role === "jupiter_v6_program");
 assert.equal(p.methods.includes("getFeeForMessage"),false);
});

for (const changed of [false, true]) test(`frozen resolver origin ${changed ? "mismatch refuses before all reads" : "match preserves executable proof"}`, async () => {
 const p = publicPort(), before = canonicalJson(p.m);
 const lifetime = { source: "configured_mainnet_rpc_before_quote_freeze" as const,
  rpcOriginHash: changed ? "1".repeat(64) : p.rpc.originHash,
  contextSlot: p.m.accountSlot, minimumContextSlot: p.m.accountSlot,
  blockhash: p.m.lifetime.blockhash, lastValidBlockHeight: p.m.lifetime.lastValidBlockHeight };
 const resolved = new JupiterV1MaterialResolver(p.rpc).resolve(p.m.payer,p.m.quoteResponse,p.m.rawBuildResponse,"6000000",lifetime,CURRENT_FP.routeId);
 if (changed) {
  await assert.rejects(resolved, { code: "APN_OPERATION_BLOCKED", details: { reason: "jupiter_v1_rpc_origin_mismatch" } });
  assert.deepEqual(p.methods, []);
 } else {
  const fresh = await resolved; assert.deepEqual(fresh.quoteRpcLifetime,lifetime);
  assert.equal(fresh.messageHash,p.m.messageHash); assert.equal(p.methods[0],"getGenesisHash");
  assert.equal(routeConfigForMaterial(fresh),CURRENT_FP);
 }
 assert.equal(canonicalJson(p.m),before);
});
