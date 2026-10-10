// SYNTHETIC generation and effect vectors. No live simulation or paid acceptance.
import assert from "node:assert/strict";
import test from "node:test";
import { address, getAddressEncoder, getBase58Decoder, getBase58Encoder } from "@solana/kit";
import { canonicalJson, sha256 } from "../../src/canonical.js";
import { swapMechanismDigest, type SwapMechanismPin } from "../../src/swap/pin.js";
import { JUPITER_V6_PROGRAM, ADDRESS_LOOKUP_TABLE_PROGRAM } from "../../src/swap/jupiter-solana/catalog.js";
import { JUPITER_V1_RUNTIME_099DA3_PROGRAM_PINS } from "../../src/swap/jupiter-solana/v1-pins.js";
import { routeConfigForQuote, routeConfigForMaterial, JUPITER_V1_FINITE_ROUTES,
 JUPITER_V1_WHIRLPOOL_V2_ROUTE as OLD_ESV, JUPITER_V1_WHIRLPOOL_4H_ROUTE as OLD_4H,
 JUPITER_V1_WHIRLPOOL_V2_RUNTIME_099DA3_ROUTE as NEW_ESV,
 JUPITER_V1_WHIRLPOOL_4H_RUNTIME_099DA3_ROUTE as NEW_4H } from "../../src/swap/jupiter-solana/v1-route-config.js";
import { jupiterV1MaterialDigest, validateJupiterV1Material, type JupiterV1ResolvedMaterial } from "../../src/swap/jupiter-solana/v1-material.js";
import { assembleJupiterV1, decodeJupiterV1AddressTable } from "../../src/swap/jupiter-solana/v1-resolver.js";
import { jupiterV1Instructions, jupiterV1Lifetime, jupiterV1ResponseHash } from "../../src/swap/jupiter-solana/v1-codec.js";
import { guardJupiterV1WhirlpoolMaterial } from "../../src/swap/jupiter-solana/v1-guard.js";
import { proveJupiterV1Simulation, validateFinalizedJupiterV1Receipt } from "../../src/swap/jupiter-solana/v1-proof.js";
import { syntheticV2Material, syntheticV2Simulation, syntheticV2Receipt } from "../fixtures/jupiter-v1-whirlpool-v2/refusal-vectors.js";
import { captured4H } from "../fixtures/jupiter-v1-whirlpool-4h/capture.js";
import { syntheticRuntime099da3Material } from "../fixtures/jupiter-v1-runtime-099da3/material.js";
import { mutate } from "../fixtures/jupiter-v1/material.js";
import { temporaryState } from "./helpers.js";
import { ChainAccountStore } from "../../src/chain-account-store.js";
import { AssetUsageLedger } from "../../src/asset-usage-ledger.js";
import { sealAssetPolicyRegistry } from "../../src/asset-policy-registry.js";
import { JupiterV1OwnerAdmission } from "../../src/swap/jupiter-solana/v1-admission.js";
import { SOLANA_USDC_MINT } from "../../src/swap/jupiter-solana/catalog.js";

function historical(lane: "esv" | "4h"): JupiterV1ResolvedMaterial {
 const m = syntheticV2Material(); if (lane === "esv") return m;
 const c = captured4H();
 for (const p of m.programPins) if (p.programDataAddress !== null && !c.accounts.some(a => a.address === p.programDataAddress))
  c.accounts.push({...m.semanticAccounts.find(a => a.address === p.programDataAddress)!});
 // The diagnostic capture has no ALT response. Build a TEST-only active table
 // from its instruction addresses; these bytes are synthetic, not a chain claim.
 const slot = "454594650";
 const keys = [...new Set(jupiterV1Instructions(c.build).flatMap(ix => ix.accounts.map(a => a.pubkey)))].filter(k => k !== m.payer);
 for (const tableAddress of c.build.addressLookupTableAddresses) {
  assert.equal(c.accounts.some(a => a.address === tableAddress), false);
  const data = Buffer.alloc(56 + keys.length * 32); data.writeUInt32LE(1, 0);
  data.writeBigUInt64LE((1n << 64n) - 1n, 4); data.writeBigUInt64LE(BigInt(slot) - 1n, 12);
  keys.forEach((key, i) => Buffer.from(getAddressEncoder().encode(address(key))).copy(data, 56 + i * 32));
  c.accounts.push({address: tableAddress, slot, existence: "present", owner: ADDRESS_LOOKUP_TABLE_PROGRAM,
   executable: false, lamports: "1000000", dataBase64: data.toString("base64"), dataHash: sha256(data)});
 }
 const accounts = c.accounts.map(a => ({...a, slot}));
 const addressTables = c.build.addressLookupTableAddresses.map(k => decodeJupiterV1AddressTable(accounts.find(a => a.address === k)!));
 const {materialDigest: _digest, ...original} = m;
 const body = {...original, quoteResponse: c.quote, rawBuildResponse: c.build,
  quoteResponseHash: jupiterV1ResponseHash(c.quote), rawBuildResponseHash: jupiterV1ResponseHash(c.build),
  lifetime: jupiterV1Lifetime(c.build), ...assembleJupiterV1(m.payer, c.build, addressTables),
  rawInstructions: jupiterV1Instructions(c.build), semanticAccounts: accounts, addressTables, accountSlot: slot};
 return {...body, materialDigest: jupiterV1MaterialDigest(body)};
}
function upgraded(lane: "esv" | "4h"): JupiterV1ResolvedMaterial {
 const m = historical(lane), donor = syntheticRuntime099da3Material("83");
 const pin = donor.programPins.find(p => p.programId === JUPITER_V6_PROGRAM)!;
 const data = donor.semanticAccounts.find(a => a.address === pin.programDataAddress)!;
 const semanticAccounts = m.semanticAccounts.map(a => ({...a, slot: donor.accountSlot,
  ...(a.address === pin.programDataAddress ? {dataBase64: data.dataBase64, dataHash: data.dataHash} : {})}));
 const addressTables = m.addressTables.map(t => ({...t, account: semanticAccounts.find(a => a.address === t.account.address)!}));
 const {materialDigest: _digest, ...original} = m;
 const body = {...original, semanticAccounts, addressTables, accountSlot: donor.accountSlot,
  programPins: m.programPins.map(p => p.programId === JUPITER_V6_PROGRAM ? {...pin} : p)};
 return {...body, materialDigest: jupiterV1MaterialDigest(body)};
}
const lanes = [{lane: "esv", old: OLD_ESV, fresh: NEW_ESV}, {lane: "4h", old: OLD_4H, fresh: NEW_4H}] as const;

test("SwapV2 registrations append two generations without changing preceding route order or per-pool contracts", () => {
 assert.deepEqual(JUPITER_V1_FINITE_ROUTES.map(r => r.routeId), ["whirlpool-v1-83-sol-usdc", "whirlpool-swap-v2-esv-sol-usdc", "whirlpool-swap-v2-4h-sol-usdc", "whirlpool-v1-fp-sol-usdc", "whirlpool-v1-fp-sol-usdc-runtime-099da3", "whirlpool-v1-83-sol-usdc-runtime-099da3", NEW_ESV.routeId, NEW_4H.routeId]);
 for (const {old, fresh} of lanes) {
  assert.equal(fresh.runtimeProgramPins, JUPITER_V1_RUNTIME_099DA3_PROGRAM_PINS);
  const {routeId: _oldId, mechanismPin: _oldPin, protocolRegistry: _oldRegistry, ...oldContract} = old;
  const {routeId: _newId, mechanismPin: _newPin, protocolRegistry: _newRegistry, runtimeProgramPins: _runtime, ...newContract} = fresh;
  assert.equal(canonicalJson(newContract), canonicalJson(oldContract));
  assert.notEqual(swapMechanismDigest(fresh.mechanismPin), swapMechanismDigest(old.mechanismPin));
  assert.notEqual(fresh.protocolRegistry.registryDigest, old.protocolRegistry.registryDigest);
 }
 assert.notEqual(swapMechanismDigest(NEW_ESV.mechanismPin), swapMechanismDigest(NEW_4H.mechanismPin));
});
for (const {lane, old, fresh} of lanes) {
 test(`SYNTHETIC ${lane} selects only the exact registered old or upgraded generation`, async () => {
  const past = historical(lane), m = upgraded(lane);
  validateJupiterV1Material(past); validateJupiterV1Material(m);
  assert.equal(routeConfigForQuote(m.quoteResponse), old);
  assert.equal(routeConfigForQuote(m.quoteResponse, fresh.routeId), fresh);
  assert.equal(routeConfigForMaterial(past), old); assert.equal(routeConfigForMaterial(m), fresh);
  assert.equal(m.messageHash, past.messageHash);
  assert.throws(() => routeConfigForQuote(m.quoteResponse, lane === "esv" ? NEW_4H.routeId : NEW_ESV.routeId));
  assert.equal((await guardJupiterV1WhirlpoolMaterial(m)).routeId, fresh.routeId);
 });
 for (const change of ["unknown payload", "changed full header", "changed payload bytes", "missing pin", "duplicate pin", "foreign pool"] as const)
 test(`SYNTHETIC ${lane} refuses ${change} after material rehash`, async () => {
  const m = mutate(upgraded(lane), v => {
   const p = v.programPins.find((p: {programId: string}) => p.programId === JUPITER_V6_PROGRAM);
   if (change === "unknown payload") p.storedPayloadHash = "0".repeat(64);
   else if (change === "missing pin") v.programPins = v.programPins.filter((p: {programId: string}) => p.programId !== JUPITER_V6_PROGRAM);
   else if (change === "duplicate pin") v.programPins.push({...p});
   else if (change === "foreign pool") v.quoteResponse.routePlan[0].swapInfo.ammKey = lane === "esv" ? NEW_4H.pool : NEW_ESV.pool;
   else { const a = v.semanticAccounts.find((a: {address: string}) => a.address === p.programDataAddress), d = Buffer.from(a.dataBase64, "base64");
    const offset = change === "changed full header" ? 4 : d.length - 1; d[offset] = d[offset]! ^ 1; a.dataBase64 = d.toString("base64"); a.dataHash = sha256(d);
    p.programDataHash = a.dataHash;
   }
  });
  await assert.rejects(guardJupiterV1WhirlpoolMaterial(m));
 });
 test(`SYNTHETIC ${lane} upgraded simulation and finalized receipt retain both minima and native expense`, async () => {
  const g = await guardJupiterV1WhirlpoolMaterial(upgraded(lane)), sim = syntheticV2Simulation(g);
  const proof = await proveJupiterV1Simulation({async call(method, params) {assert.equal(method, "simulateTransaction"); assert.equal(params[0], g.material.transactionBase64); return sim;}}, g);
  const r = syntheticV2Receipt(g);
  const result = await validateFinalizedJupiterV1Receipt({async call(method) {return method === "getSignatureStatuses" ? r.status : r.response;}}, g, {signature: r.signature});
  assert.equal(result.recipientOutputAtomic, proof.recipientOutputAtomic);
  assert.equal(proof.nativeSpendLamports, "1006400");
 });
 for (const change of ["threshold", "remaining accounts", "duplicate native", "foreign native role", "Memo CPI"] as const)
 test(`SYNTHETIC ${lane} upgraded simulation refuses ${change}`, async () => {
  const g = await guardJupiterV1WhirlpoolMaterial(upgraded(lane)), sim = syntheticV2Simulation(g), ix = sim.value.innerInstructions[0].instructions[0];
  if (change === "duplicate native") sim.value.innerInstructions[0].instructions.push({...ix});
  else if (change === "foreign native role") ix.accounts[0] = g.material.compiledAccounts.findIndex(a => a.address === g.payer);
  else if (change === "Memo CPI") ix.programIdIndex = g.material.compiledAccounts.findIndex(a => a.address === "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
  else { const d = Buffer.from(getBase58Encoder().encode(ix.data)); d[change === "threshold" ? 16 : 42] = 1; ix.data = getBase58Decoder().decode(d); }
  await assert.rejects(proveJupiterV1Simulation({async call() {return sim;}}, g));
 });
 test(`SYNTHETIC ${lane} requires both assets' exact upgraded admission; historical and mixed admissions cannot select it`, async t => {
  const temp = await temporaryState(); t.after(temp.cleanup);
  const profile = `synthetic-${lane}-generation`, payer = upgraded(lane).payer;
  const store = new ChainAccountStore(temp.root, {async load() {return Buffer.alloc(32, 77);}, async create() {return Buffer.alloc(32, 77);}});
  await store.ensureLocal({profile, rail: "solana", create: async () => ({address: payer, seed: Buffer.alloc(32, 9)})});
  const registry = (inputPin: SwapMechanismPin, outputPin = inputPin) => {const now = new Date(); return sealAssetPolicyRegistry({schemaVersion: "apn.asset-policy-registry.v1", registryVersion: "synthetic-generation.1", publishedAt: now.toISOString(), effectiveDate: now.toISOString().slice(0, 10), effectiveAt: new Date(now.getTime()-1000).toISOString(), expiresAt: new Date(now.getTime()+3600000).toISOString(), chains: [{chain: fresh.mechanismPin.chain, family: "solana", name: "Solana", assets: [{kind: "native", identifier: null, symbol: "SOL", decimals: 9, rails: {direct: false, gasless: false, x402: false, bridge: false, swap: true}, caps: {maximumPerTransferAtomic: "6000000", dailyLimitAtomic: "6000000"}, mechanismPins: {swap: inputPin}}, {kind: "token", identifier: SOLANA_USDC_MINT, symbol: "USDC", decimals: 6, rails: {direct: false, gasless: false, x402: false, bridge: false, swap: true}, caps: {maximumPerTransferAtomic: "500000", dailyLimitAtomic: "500000"}, mechanismPins: {swap: outputPin}}]}]});};
  let active = registry(fresh.mechanismPin);
  const admission = new JupiterV1OwnerAdmission(store, async () => ({profile, registry: active, digest: active.policyDigest, revision: 1, accounts: {solana: payer}, activationDigest: "a".repeat(64), activatedAt: active.effectiveAt!}), new AssetUsageLedger(temp.root), () => new Date());
  assert.equal((await admission.resolveRoute(profile, "1000000", "115960", payer)).route, fresh);
  active = registry(old.mechanismPin); assert.equal((await admission.resolveRoute(profile, "1000000", "115960", payer)).route, old);
  for (const pair of [[old.mechanismPin, fresh.mechanismPin], [fresh.mechanismPin, old.mechanismPin], [fresh.mechanismPin, lane === "esv" ? NEW_4H.mechanismPin : NEW_ESV.mechanismPin]]) {
   active = registry(pair[0]!, pair[1]!); await assert.rejects(admission.resolveRoute(profile, "1000000", "115960", payer));
  }
 });
}
