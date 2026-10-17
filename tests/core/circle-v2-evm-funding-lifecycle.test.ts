/** Synthetic CPU-only public observations and owner policies; no current-chain or financial proof. */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getAddress, keccak256, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { hashObject, canonicalJson } from "../../src/canonical.js";
import { StateStore } from "../../src/state.js";
import { AllowlistPolicyStore } from "../../src/allowlist-policy-store.js";
import { OperationService } from "../../src/operation-service.js";
import { CircleUsage } from "../../src/circle-v2-evm/usage.js";
import { CircleRepository, validateCircleFundingAdvance } from "../../src/circle-v2-evm/repository.js";
import { circleFundingBinding, quoteCircleFundingFee } from "../../src/circle-v2-evm/funding-binding.js";
import { circleFundingFingerprint, sealCircleFundingOperation, advanceCircleFundingOperation, validateCircleFundingOperation, validateKnownCircle, type CircleFundingOperationV2 } from "../../src/circle-v2-evm/funding-operation.js";
import { circleEnvelope, validateCircle } from "../../src/circle-v2-evm/operation-model.js";
import { CIRCLE_SOURCE_OWNER, CIRCLE_SOURCE_TOKEN, CIRCLE_MESSENGER, CIRCLE_TRANSMITTER, circleLegacyRoute as circleRoute } from "../../src/circle-v2-evm/catalog.js";
import { bindCircleAttestation, circleWord, decodeCircleMessage, decodeCircleSource, decodeCircleDestination, encodeCircleApproval, encodeCircleBurn, encodeCircleMint, verifyCircleApproval, CIRCLE_ZERO } from "../../src/circle-v2-evm/protocol.js";
import { verifyCircleMintPreflight, verifyCircleClosureFinality } from "../../src/circle-v2-evm/preflight.js";
import { initial, at, fundingIdentity } from "./circle-v2-evm-nonce-runtime-fixtures.js";
import { event, observation, message, snapshot } from "./circle-v2-evm-runtime-fixtures.js";
const recipient = getAddress(`0x${"55".repeat(20)}`), feeRecipient = getAddress(`0x${"44".repeat(20)}`);
const params = { recipient, amountAtomic: "1000000", maxFeeAtomic: "1000", minMintAtomic: "999000" };
function funding(root: string, chain: 143 | 1329 | 59144, profile = circleRoute(chain).gasPayerProfile): CircleFundingOperationV2 {
  const legacy = initial(root, chain, profile), b = circleFundingBinding(chain, fundingIdentity(legacy), params), feeQuote = quoteCircleFundingFee(b, [{ finalityThreshold: 1000, minimumFee: 1 }], at, at);
  const { schemaVersion: _v, integrityHash: _h, transitions: _t, externalFulfillment: _e, nonceRetirement: _n, ...rest } = legacy;
  const effects = rest.effects.map(e => { const { envelopeHash: _oldHash, ...envelope } = e.envelope;
    return { ...e, envelope: circleEnvelope({ ...envelope, data: e.role === "burn" ? encodeCircleBurn(chain, b) : encodeCircleApproval(false, b) }) }; });
  let op = sealCircleFundingOperation({ ...rest, schemaVersion: "apn.circle-v2-evm-operation.v2", funding: b, feeQuote, feeQuoteAtomic: feeQuote.quotedFeeAtomic,
    state: "awaiting_source", policies: rest.policies.map(p => ({ ...p, activationDigest: "a".repeat(64) })), expiresAt: new Date(at + 900000).toISOString(), effects, transitions: [] });
  op = sealCircleFundingOperation({ ...op, fingerprint: circleFundingFingerprint(op) });
  return advanceCircleFundingOperation(op, {}, "prepared", at);
}
function fundingMessage(op: CircleFundingOperationV2, attested = false, fee = 100n): Hex {
  let bytes = message(op.destinationChain, attested, fee);
  const put = (offset: number, word: string) => { bytes = `${bytes.slice(0, 2 + offset * 2)}${word}${bytes.slice(2 + (offset + 32) * 2)}` as Hex; };
  put(184, circleWord(op.funding.recipient).slice(2)); put(216, BigInt(op.funding.amountAtomic).toString(16).padStart(64, "0")); put(280, BigInt(op.funding.maxFeeAtomic).toString(16).padStart(64, "0")); return bytes;
}
function source(op: CircleFundingOperationV2) {
  const b = op.funding;
  return observation(42161, CIRCLE_SOURCE_OWNER, CIRCLE_MESSENGER, encodeCircleBurn(op.destinationChain, b), [
    event("MessageSent", CIRCLE_TRANSMITTER, { message: fundingMessage(op) }, 0),
    event("DepositForBurn", CIRCLE_MESSENGER, { burnToken: CIRCLE_SOURCE_TOKEN, amount: BigInt(b.amountAtomic), depositor: CIRCLE_SOURCE_OWNER,
      mintRecipient: circleWord(b.recipient), destinationDomain: b.destinationDomain, destinationTokenMessenger: circleWord(CIRCLE_MESSENGER), destinationCaller: CIRCLE_ZERO, maxFee: BigInt(b.maxFeeAtomic), minFinalityThreshold: 1000, hookData: "0x" }, 1) ]);
}
async function issuer(op: CircleFundingOperationV2, proof: ReturnType<typeof decodeCircleSource>, fee = 100n) {
  const bytes = fundingMessage(op, true, fee), m = decodeCircleMessage(bytes, op.destinationChain, true, op.funding);
  const signers = [1n, 2n].map(n => privateKeyToAccount(`0x${n.toString(16).padStart(64, "0")}`)).sort((a,b) => BigInt(a.address) < BigInt(b.address) ? -1 : 1);
  const sigs = await Promise.all(signers.map(s => s.sign({ hash: keccak256(bytes) })));
  return { sourceTxHash: proof.transactionHash, messages: [{ cctpVersion: 2, status: "complete", eventNonce: m.nonce, message: bytes, attestation: `0x${sigs.map(s => s.slice(2)).join("")}`,
    decodedMessage: { sourceDomain: "3", destinationDomain: String(op.funding.destinationDomain), nonce: m.nonce, sender: circleWord(CIRCLE_MESSENGER), recipient: circleWord(CIRCLE_MESSENGER), destinationCaller: CIRCLE_ZERO,
      messageBody: m.body, minFinalityThreshold: "1000", finalityThresholdExecuted: "1000", decodedMessageBody: { burnToken: circleWord(CIRCLE_SOURCE_TOKEN), mintRecipient: circleWord(recipient), amount: params.amountAtomic,
        messageSender: circleWord(CIRCLE_SOURCE_OWNER), maxFee: params.maxFeeAtomic, feeExecuted: m.feeExecutedAtomic, expirationBlock: m.expirationBlock, hookData: "0x" } } }] };
}

import { seal as sealUsage, reservationIdFor, idempotency } from "../../src/asset-usage-ledger-record.js";
import { approveCircleFundingSource, approveCircleFundingMint, executeCircleFundingEffect, observeCircleFunding, cleanupCircleFunding, assertCircleFundingEffectGuard, type CircleFundingLifecyclePorts } from "../../src/circle-v2-evm/funding-lifecycle.js";
import { type CircleEffect, type CircleRole } from "../../src/circle-v2-evm/operation-model.js";
import { type CircleFundingMaterial } from "../../src/circle-v2-evm/funding-custody.js";
const tx = `0x${"11".repeat(32)}` as Hex;
function holds(op: CircleFundingOperationV2, target: "reserved" | "unknown_finality" | "finalized" | "failed_before_effect" | "failed_confirmed_revert" | "released_unsubmitted" = "reserved") {
  return ["usdc", "approval", "burn", "cleanup", "mint"].map((key,i) => {
    const identity = { account:i===4?op.funding.gasPayer:CIRCLE_SOURCE_OWNER, chain:i===4?`eip155:${op.destinationChain}`:"eip155:42161",asset:i===0?{kind:"token" as const,identifier:CIRCLE_SOURCE_TOKEN}:{kind:"native" as const,identifier:null}}, ih=idempotency(`${op.operationId}:${key}`);
    const actual=target==="finalized"&&i===3?"failed_confirmed_revert":target;
    return sealUsage({schemaVersion:"apn.asset-usage-reservation.v1",reservationId:reservationIdFor(identity,ih),idempotencyHash:ih,policyDigest:op.policies.find(x=>x.profileHash===(i===4?op.destinationProfileHash:op.profileHash))!.policyDigest,registryVersion:"synthetic-b2",...identity,rail:"bridge",amountAtomic:i===0?op.funding.amountAtomic:i===4?circleRoute(op.destinationChain,op.destinationProfile).destinationNativeCap:i===3?"15000000000000":"30000000000000",state:actual,reservedAt:new Date(at).toISOString(),updatedAt:new Date(at).toISOString(),effectAt:["finalized","failed_confirmed_revert"].includes(actual)?new Date(at).toISOString():null,outcomeDigest:["finalized","failed_confirmed_revert","failed_before_effect","released_unsubmitted"].includes(actual)?"8".repeat(64):null,...(actual==="failed_confirmed_revert"?{consumedAtomic:"0"}:{})});
  });
}
function reserved(chain:143|59144|1329=143,profile?: "default" | "evm-live-buyer" | "evm-live-seller") {const op=funding(join(tmpdir(),"b2-synthetic"),chain,profile);return advanceCircleFundingOperation(op,{usage:holds(op)},"reserved",at);}
function controller(start:CircleFundingOperationV2,overrides:Partial<CircleFundingLifecyclePorts>={}) {
 let current=start,clock=at+1,signs=0,sends=0,consents=0;const saved:CircleFundingOperationV2[]=[];
 const material=(o:CircleFundingOperationV2,e:CircleEffect):CircleFundingMaterial=>({schemaVersion:"apn.circle-v2-evm-effect.v2",operationId:o.operationId,role:e.role,fingerprint:o.fingerprint,envelopeHash:e.envelope.envelopeHash,rawTransaction:"0x02",transactionHash:tx,materialHash:"9".repeat(64)});
 const ports:CircleFundingLifecyclePorts={now:()=>clock,save:async o=>{validateCircleFundingAdvance(current,o);current=o;saved.push(o);},assertOwnerPolicyAndConflicts:async()=>{},authorizationDeadline:async()=>new Date(at+900000).toISOString(),approve:async()=>{consents++;},preflight:async()=>{},seal:async(o,e,g)=>{assertCircleFundingEffectGuard(o,e,g);signs++;return material(o,e);},loadMaterial:async(o,e)=>material(o,e),broadcast:async(e,_raw,g)=>{g();assert.equal(current.effects.find(x=>x.role===e.role)!.phase,"submission_started");sends++;return tx;},observeEffect:async()=>null,observeSource:async()=>null,observeDestination:async()=>null,allowance:async()=>"0",attestation:async()=>null,mintEnvelope:async o=>circleEnvelope({chainId:o.destinationChain,from:o.funding.gasPayer,to:CIRCLE_TRANSMITTER,data:encodeCircleMint(o.attestation!),valueAtomic:"0",nonceAtomic:"10",gasLimitAtomic:"500000",maxFeePerGasAtomic:o.destinationChain===143?"102000000000":"20000000",maxPriorityFeePerGasAtomic:"0"}),cleanupEnvelope:async o=>circleEnvelope({chainId:42161,from:CIRCLE_SOURCE_OWNER,to:CIRCLE_SOURCE_TOKEN,data:encodeCircleApproval(true,o.funding),valueAtomic:"0",nonceAtomic:"3",gasLimitAtomic:"50000",maxFeePerGasAtomic:"20000000",maxPriorityFeePerGasAtomic:"0"}),usage:async(o,t)=>holds(o,t),...overrides};
 return {ports,current:()=>current,saved,signs:()=>signs,sends:()=>sends,consents:()=>consents,setClock:(n:number)=>{clock=n;}};
}

test("unforgeable private effect guard refuses forged signing authority before callbacks",async()=>{const op=reserved(),c=controller(op);assert.throws(()=>assertCircleFundingEffectGuard(op,op.effects[0]!,()=>{}));await assert.rejects(executeCircleFundingEffect(op,"approval",c.ports,()=>{}));assert.equal(c.signs(),0);assert.equal(c.sends(),0);});
for(const stage of ["tty","first-preflight","second-preflight","broadcast"] as const)test(`finite source authority expires at ${stage} without retry`,async()=>{let c:ReturnType<typeof controller>;let pre=0;c=controller(reserved(),{approve:async()=>{if(stage==="tty")c.setClock(at+60002);},preflight:async()=>{if(++pre===(stage==="first-preflight"?1:stage==="second-preflight"?2:-1))c.setClock(at+60002);},broadcast:async(_e,_r,g)=>{c.setClock(at+60002);g();return tx;}});if(stage==="tty"||stage==="first-preflight")await assert.rejects(approveCircleFundingSource(c.current(),c.ports));else{const op=await approveCircleFundingSource(c.current(),c.ports);assert.equal(op.effects[0]!.phase,"unknown");await approveCircleFundingSource(op,c.ports);assert.equal(c.signs(),1);}assert.equal(c.sends(),0);});
test("ambiguous send preserves unknown holds; repeat never signs or sends",async()=>{const c=controller(reserved(),{broadcast:async()=>{throw Error("SYNTHETIC_SECRET_DO_NOT_EXPORT");}});const op=await approveCircleFundingSource(c.current(),c.ports);assert.equal(op.effects[0]!.phase,"unknown");assert.ok(op.usage.every(r=>r.state==="unknown_finality"));await approveCircleFundingSource(op,c.ports);assert.equal(c.signs(),1);assert.equal(c.sends(),0);assert.ok(!JSON.stringify(op).includes("SYNTHETIC_SECRET"));});
test("crash after durable signing fence without material defers to the permanent sign claim and never sends",async()=>{let op=reserved();op=advanceCircleFundingOperation(op,{effects:op.effects.map(e=>e.role==="approval"?{...e,phase:"signing_started"}:e),state:"source_unknown"},"crash",at);const c=controller(op,{loadMaterial:async()=>null,seal:async()=>{throw Error("funding_effect_permanently_claimed");}});await assert.rejects(approveCircleFundingSource(op,c.ports),/permanently_claimed/);assert.equal(c.current().effects[0]!.phase,"signing_started");assert.equal(c.signs(),0);assert.equal(c.sends(),0);});
test("signing fence with saved material resumes as sealed bytes and sends once without re-signing",async()=>{let op=reserved();op=advanceCircleFundingOperation(op,{effects:op.effects.map(e=>e.role==="approval"?{...e,phase:"signing_started"}:e),state:"source_unknown"},"crash",at);const c=controller(op);const sent=await approveCircleFundingSource(op,c.ports);assert.equal(sent.effects[0]!.phase,"submitted");assert.ok(c.saved.some(x=>x.effects[0]!.phase==="sealed"&&x.transitions.at(-1)!.reason==="approval_material_recovered_unsent"));assert.ok(!c.saved.some(x=>x.effects[0]!.phase==="unknown"));assert.equal(c.signs(),0);assert.equal(c.sends(),1);});
test("changed beneficiary/context cannot reuse private admission guard",async()=>{let c:ReturnType<typeof controller>;c=controller(reserved(),{seal:async(o,e,g)=>{assertCircleFundingEffectGuard(o,e,g);assert.throws(()=>assertCircleFundingEffectGuard({...o,fingerprint:"b".repeat(64)},e,g));assert.throws(()=>assertCircleFundingEffectGuard(o,{...e,envelope:{...e.envelope,envelopeHash:"b".repeat(64)}},g));throw Error("STOP_AFTER_NEGATIVES");}});await assert.rejects(approveCircleFundingSource(c.current(),c.ports),/STOP_AFTER_NEGATIVES/);assert.equal(c.current().effects[0]!.phase,"signing_started");assert.equal(c.sends(),0);});
test("cancellation cannot release when any private material exists",async()=>{const c=controller(reserved());await assert.rejects(cleanupCircleFunding(c.current(),c.ports));assert.equal(c.consents(),0);assert.equal(c.signs(),0);});
test("cleanup requires independent finalized approve-zero before settling",async()=>{let op=reserved();op=advanceCircleFundingOperation(op,{effects:op.effects.map(e=>e.role==="approval"?{...e,phase:"confirmed",transactionHash:tx,materialHash:"9".repeat(64),proof:{transactionHash:tx,blockHash:tx,blockNumberAtomic:"10",receiptHash:"a".repeat(64),actualFeeAtomic:"1",finalityBlockHash:tx,finalityBlockNumberAtomic:"10",transactionHashBinding:"a".repeat(64),logsHash:"b".repeat(64),finalityTag:"included"}}:e),residualAllowanceAtomic:op.funding.amountAtomic,state:"cleanup_required"},"approval_confirmed",at);const c=controller(op,{allowance:async()=>op.funding.amountAtomic});const cleaned=await cleanupCircleFunding(op,c.ports);assert.equal(cleaned.terminal,false);assert.equal(cleaned.effects.find(e=>e.role==="cleanup")!.phase,"submitted");assert.equal(c.signs(),1);assert.equal(c.sends(),1);});
test("full effect fields cannot change while retaining the declared envelope hash",async()=>{let c:ReturnType<typeof controller>;let checked=0;c=controller(reserved(),{seal:async(o,e,g)=>{for(const [key,value] of Object.entries({chainId:1,nonceAtomic:"44",to:recipient,valueAtomic:"1",data:"0x",gasLimitAtomic:"99999",maxFeePerGasAtomic:"999999",maxPriorityFeePerGasAtomic:"1"})){assert.throws(()=>assertCircleFundingEffectGuard(o,{...e,envelope:{...e.envelope,[key]:value}},g));checked++;}let getters=0;const envelope={...e.envelope};Object.defineProperty(envelope,"to",{enumerable:true,get:()=>{getters++;return recipient;}});assert.throws(()=>assertCircleFundingEffectGuard(o,{...e,envelope},g));assert.equal(getters,0);assert.ok(Object.isFrozen(o));assert.ok(Object.isFrozen(o.funding));assert.ok(Object.isFrozen(e.envelope));assert.throws(()=>{(e.envelope as {nonceAtomic:string}).nonceAtomic="9";});throw Error("STOP_AFTER_GUARD_NEGATIVES");}});await assert.rejects(approveCircleFundingSource(c.current(),c.ports),/STOP_AFTER_GUARD_NEGATIVES/);assert.equal(checked,8);assert.equal(c.current().effects[0]!.phase,"signing_started");assert.equal(c.sends(),0);});
test("accessor and proxy operation inputs refuse before any consent or preflight",async()=>{const op=reserved(),c=controller(op);let getters=0;const accessor={...op};Object.defineProperty(accessor,"funding",{enumerable:true,get:()=>{getters++;return op.funding;}});await assert.rejects(approveCircleFundingSource(accessor,c.ports));await assert.rejects(approveCircleFundingSource(new Proxy(op,{}),c.ports));assert.equal(getters,0);assert.equal(c.consents(),0);assert.equal(c.signs(),0);assert.equal(c.sends(),0);});
test("a resumed sealed funding approval whose nonce was consumed elsewhere ends as never sent and releases holds",async()=>{let op=reserved();op=advanceCircleFundingOperation(op,{effects:op.effects.map(e=>e.role==="approval"?{...e,phase:"sealed",transactionHash:tx,materialHash:"9".repeat(64)}:e),state:"source_unknown"},"sealed",at);let discards=0;const c=controller(op,{unsent:{outcome:async()=>"never_lands",discard:async()=>{discards++;}}});const done=await approveCircleFundingSource(op,c.ports);assert.equal(done.state,"cancelled_unsubmitted");assert.equal(done.terminal,true);assert.equal(done.effects[0]!.phase,"abandoned_unsent");assert.equal(discards,1);assert.equal(c.sends(),0);assert.equal(c.signs(),0);assert.ok(done.usage.every(u=>u.state==="failed_before_effect"));});

/** R4 for a possibly-broadcast mint: the real lifecycle up to a mint whose broadcast answer is lost after its fence. */
async function lostMint(ambiguous: (e: CircleEffect) => Promise<"own_transaction_known" | "never_lands" | "resend_identical" | "other_transaction_pending">, overrides: Partial<CircleFundingLifecyclePorts> = {}) {
  const start = reserved(143, "default"), raw = source(start), included = decodeCircleSource(raw, 143, start.funding);
  const attested = await bindCircleAttestation(included, await issuer(start, included), snapshot(143), start.funding);
  const proof = { transactionHash: tx, blockHash: tx, blockNumberAtomic: "10", receiptHash: "a".repeat(64), actualFeeAtomic: "1", finalityBlockHash: tx, finalityBlockNumberAtomic: "10", transactionHashBinding: "a".repeat(64), logsHash: "b".repeat(64), finalityTag: "included" as const };
  const counts = { resends: [] as string[], discards: 0, outcomes: 0, mintEnvelopes: 0 }; let lose = true;
  // The command that lost the answer already sent these bytes once: as the runtime does, it does not send them again.
  const c = controller(start, { observeEffect: async (_o, e) => e.phase === "submitted" && e.role !== "mint" ? e.role === "burn" ? included : proof : null,
    observeSource: async o => ["confirmed", "submitted"].includes(o.effects[1]!.phase) ? included : null, attestation: async () => attested,
    broadcast: async (e, _raw, g) => { g(); if (e.role === "mint" && lose) throw Error("TEST lost mint answer after its submission fence"); return tx; },
    mintEnvelope: async o => circleEnvelope({ chainId: o.destinationChain, from: o.funding.gasPayer, to: CIRCLE_TRANSMITTER, data: encodeCircleMint(o.attestation!), valueAtomic: "0",
      nonceAtomic: String(10 + counts.mintEnvelopes++), gasLimitAtomic: "500000", maxFeePerGasAtomic: "102000000000", maxPriorityFeePerGasAtomic: "0" }),
    unsent: { outcome: async () => "nonce_not_consumed", ambiguous: async (_o, e) => { counts.outcomes++; return lose ? "own_transaction_known" : ambiguous(e); },
      resend: async (_o, e, rawTransaction) => { assert.equal(e.role, "mint"); counts.resends.push(rawTransaction); return true; }, discard: async () => { counts.discards++; } },
    messageNonceUsed: async () => false, ...overrides });
  let op = await approveCircleFundingSource(start, c.ports); assert.equal(op.state, "awaiting_mint"); assert.notEqual(op.attestation, null);
  op = await approveCircleFundingMint(op, c.ports); lose = false;
  assert.equal(op.effects.find(e => e.role === "mint")!.phase, "unknown"); assert.equal(op.state, "mint_unknown"); assert.equal(c.signs(), 3);
  return { op, c, counts };
}

test("R4: a lost mint the node does not know, whose nonce is unconsumed, is sent again once per resume as the identical sealed bytes", async () => {
  const s = await lostMint(async () => "resend_identical");
  let op = await observeCircleFunding(s.op, s.c.ports);
  assert.deepEqual(s.counts.resends, ["0x02"]); assert.equal(s.c.signs(), 3);
  assert.equal(op.effects.find(e => e.role === "mint")!.phase, "unknown"); assert.equal(op.transitions.at(-1)!.reason, "mint_identical_sealed_bytes_rebroadcast");
  // approve-mint on the same ambiguous mint only observes: one more identical send for this resume, still no signature.
  op = await approveCircleFundingMint(op, s.c.ports); assert.deepEqual(s.counts.resends, ["0x02", "0x02"]); assert.equal(s.c.signs(), 3); assert.equal(s.c.consents(), 2);
  validateCircleFundingOperation(op);
});

test("R4: a lost mint whose nonce another transaction consumed is abandoned; re-arming a fresh envelope needs fresh foreground consent", async () => {
  let refuse = false;
  const s = await lostMint(async e => e.envelope.nonceAtomic === "10" ? "never_lands" : "own_transaction_known",
    { approve: async (_o, role) => { if (role === "mint" && refuse) throw Error("TEST owner refused the fresh mint"); }, messageNonceUsed: async () => false });
  refuse = true; let op = await observeCircleFunding(s.op, s.c.ports);
  const mint = op.effects.find(e => e.role === "mint")!;
  assert.equal(mint.phase, "abandoned_unsent"); assert.equal(mint.transactionHash, tx); assert.equal(op.state, "awaiting_mint"); assert.equal(s.counts.discards, 1);
  assert.deepEqual(s.counts.resends, []); assert.equal(op.transitions.at(-1)!.reason, "mint_sent_bytes_never_land");
  // The fresh envelope is frozen, but nothing is signed while the owner refuses.
  await assert.rejects(approveCircleFundingMint(op, s.c.ports), /owner refused/);
  op = s.c.current(); const fresh = op.effects.find(e => e.role === "mint")!;
  assert.equal(fresh.phase, "prepared"); assert.equal(fresh.envelope.nonceAtomic, "11"); assert.equal(fresh.transactionHash, null); assert.equal(s.c.signs(), 3);
  assert.equal(op.transitions.at(-1)!.reason, `mint_fresh_envelope_after_never_landed:${tx}`);
  refuse = false; op = await approveCircleFundingMint(op, s.c.ports);
  assert.equal(s.c.signs(), 4); assert.equal(op.effects.find(e => e.role === "mint")!.phase, "submitted"); assert.equal(op.effects.find(e => e.role === "mint")!.envelope.nonceAtomic, "11");
  validateCircleFundingOperation(op);
});

test("R4: when the abandoned mint's issuer message is already used on the destination, approve-mint signs nothing, asks nothing and hands it to external adoption", async () => {
  let consents = 0, used = false, handed = 0;
  const s = await lostMint(async () => "never_lands", { approve: async () => { consents++; }, messageNonceUsed: async () => used, externalMint: async () => { handed++; } });
  used = true; const op = await observeCircleFunding(s.op, s.c.ports), before = consents;
  assert.equal(op.effects.find(e => e.role === "mint")!.phase, "abandoned_unsent"); assert.equal(handed, 1);
  const after = await approveCircleFundingMint(op, s.c.ports);
  assert.equal(consents, before); assert.equal(s.c.signs(), 3); assert.equal(handed, 2); assert.equal(after.integrityHash, op.integrityHash); assert.equal(s.c.current().integrityHash, op.integrityHash);
});

for (const outcome of ["resend_identical", "other_transaction_pending"] as const)
test(`R4: a lost mint the node does not know (${outcome}) whose issuer message someone else used is closed, its bytes discarded, never resent`, async () => {
  let used = false, handed = 0;
  const s = await lostMint(async () => outcome, { messageNonceUsed: async () => used, externalMint: async () => { handed++; } });
  used = true; const op = await observeCircleFunding(s.op, s.c.ports), mint = op.effects.find(e => e.role === "mint")!;
  assert.equal(mint.phase, "abandoned_unsent"); assert.equal(mint.transactionHash, tx); assert.equal(op.state, "awaiting_mint");
  assert.equal(op.transitions.at(-1)!.reason, "mint_closed_issuer_message_used_externally"); assert.deepEqual(s.counts.resends, []); assert.equal(s.counts.discards, 1); assert.equal(handed, 1);
  validateCircleFundingOperation(op);
});

test("R4: a lost mint the node knows keeps being observed when its issuer message is used: nothing is closed or handed to adoption", async () => {
  let used = false, handed = 0;
  const s = await lostMint(async () => "own_transaction_known", { messageNonceUsed: async () => used, externalMint: async () => { handed++; } });
  used = true; const op = await observeCircleFunding(s.op, s.c.ports);
  assert.equal(op.effects.find(e => e.role === "mint")!.phase, "unknown"); assert.equal(op.integrityHash, s.op.integrityHash); assert.equal(handed, 0); assert.equal(s.counts.discards, 0);
});

test("R4: a sealed owned mint never sent is closed and discarded once its issuer message is used; approve-mint then asks no consent", async () => {
  const s = await lostMint(async () => "own_transaction_known");
  // The same operation as if the command had stopped after sealing the mint, before its submission fence.
  const sealed = advanceCircleFundingOperation(s.op, { effects: s.op.effects.map(e => e.role === "mint" ? { ...e, phase: "sealed" as const } : e) }, "mint_material_sealed", at + 1);
  let handed = 0, discards = 0, consents = 0;
  const c = controller(sealed, { messageNonceUsed: async () => true, externalMint: async () => { handed++; }, approve: async () => { consents++; },
    unsent: { outcome: async () => "nonce_not_consumed", discard: async (_o, e) => { discards++; assert.equal(e.phase, "abandoned_unsent"); } } });
  let op = await observeCircleFunding(sealed, c.ports);
  assert.equal(op.effects.find(e => e.role === "mint")!.phase, "abandoned_unsent"); assert.equal(op.transitions.at(-1)!.reason, "mint_closed_issuer_message_used_externally");
  assert.deepEqual([discards, handed, c.sends()], [1, 1, 0]);
  op = await approveCircleFundingMint(op, c.ports);
  assert.deepEqual([consents, c.signs(), c.sends(), handed], [0, 0, 0, 2]); validateCircleFundingOperation(op);
});

test("R4: a lost approve-zero cleanup whose nonce another transaction took is abandoned and re-armed at a fresh nonce under fresh consent", async () => {
  let op = reserved(); op = advanceCircleFundingOperation(op, { effects: op.effects.map(e => e.role === "approval" ? { ...e, phase: "confirmed", transactionHash: tx, materialHash: "9".repeat(64), proof: { transactionHash: tx, blockHash: tx, blockNumberAtomic: "10", receiptHash: "a".repeat(64), actualFeeAtomic: "1", finalityBlockHash: tx, finalityBlockNumberAtomic: "10", transactionHashBinding: "a".repeat(64), logsHash: "b".repeat(64), finalityTag: "included" as const } } : e), residualAllowanceAtomic: op.funding.amountAtomic, state: "cleanup_required" }, "approval_confirmed", at);
  let lose = true, nonce = 3, consents = 0, discards = 0;
  const c = controller(op, { allowance: async () => op.funding.amountAtomic, approve: async () => { consents++; },
    broadcast: async (e, _raw, g) => { g(); if (lose) throw Error("TEST lost cleanup answer"); assert.equal(e.envelope.nonceAtomic, "4"); return tx; },
    cleanupEnvelope: async o => circleEnvelope({ chainId: 42161, from: CIRCLE_SOURCE_OWNER, to: CIRCLE_SOURCE_TOKEN, data: encodeCircleApproval(true, o.funding), valueAtomic: "0", nonceAtomic: String(nonce++), gasLimitAtomic: "50000", maxFeePerGasAtomic: "20000000", maxPriorityFeePerGasAtomic: "0" }),
    unsent: { outcome: async () => "nonce_not_consumed", ambiguous: async (_o, e) => lose ? "own_transaction_known" : e.envelope.nonceAtomic === "3" ? "never_lands" : "own_transaction_known", discard: async () => { discards++; } } });
  op = await cleanupCircleFunding(op, c.ports); assert.equal(op.effects.find(e => e.role === "cleanup")!.phase, "unknown"); lose = false;
  op = await observeCircleFunding(op, c.ports); assert.equal(op.effects.find(e => e.role === "cleanup")!.phase, "abandoned_unsent"); assert.equal(op.state, "cleanup_required"); assert.equal(discards, 1);
  op = await cleanupCircleFunding(op, c.ports);
  const cleanup = op.effects.find(e => e.role === "cleanup")!;
  assert.equal(cleanup.envelope.nonceAtomic, "4"); assert.equal(cleanup.phase, "submitted"); assert.equal(c.signs(), 2); assert.equal(consents, 2);
  assert.ok(op.transitions.some(t => t.reason === `cleanup_fresh_envelope_after_never_landed:${tx}`)); validateCircleFundingOperation(op);
});
