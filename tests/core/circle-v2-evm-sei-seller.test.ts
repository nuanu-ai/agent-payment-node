const issuerFeeRecipient = getAddress(`0x${"44".repeat(20)}`);
import assert from "node:assert/strict";
import test from "node:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getAddress } from "viem";
import { hashObject, canonicalJson } from "../../src/canonical.js";
import { StateStore } from "../../src/state.js";
import { circleRoute, CIRCLE_SEI_SELLER, CIRCLE_SOURCE_OWNER, CIRCLE_SOURCE_TOKEN, CIRCLE_MESSENGER, CIRCLE_TRANSMITTER, CIRCLE_RECIPIENT } from "../../src/circle-v2-evm/catalog.js";
import { circleEnvelope, sealCircle, advanceCircle, validateCircle, type CircleOperationV1 } from "../../src/circle-v2-evm/operation-model.js";
import { decodeCircleSource, bindCircleAttestation, decodeCircleDestination, encodeCircleApproval, encodeCircleBurn, encodeCircleMint, circleWord } from "../../src/circle-v2-evm/protocol.js";
import { verifyCircleDestinationAccount } from "../../src/circle-v2-evm/preflight.js";
import { bindCircleEvmCommand } from "../../src/circle-v2-evm/command-catalog.js";
import { source, iris, snapshot, event, observation } from "./circle-v2-evm-runtime-fixtures.js";
const at=Date.parse("2026-10-09T01:00:00.000Z");
function initial(root = join(tmpdir(), "circle-fixture"), chain: 143 | 1329 | 59144 = 143, profile?: string): CircleOperationV1 {
  const selected = circleRoute(chain, profile);
  const state = new StateStore(root), profileHash = state.profileHash("evm-live-buyer"), destinationProfileHash = state.profileHash(selected.gasPayerProfile);
  const custody = (profileHash: string, walletAddress: typeof CIRCLE_SOURCE_OWNER) => ({ schemaVersion: "apn.evm-native-custody.v1" as const, profileHash, walletAddress, walletBindingHash: "a".repeat(64), walletCreatedAt: new Date(at).toISOString(), providerId: "local" as const, providerAccountBindingHash: "a".repeat(64), providerCapabilityHash: "b".repeat(64), providerRevision: 1 });
  const envelope = (role: "approval" | "burn") => circleEnvelope({ chainId: 42161, from: CIRCLE_SOURCE_OWNER, to: role === "approval" ? CIRCLE_SOURCE_TOKEN : CIRCLE_MESSENGER, data: role === "approval" ? encodeCircleApproval() : encodeCircleBurn(chain), valueAtomic: "0", nonceAtomic: role === "approval" ? "1" : "2", gasLimitAtomic: role === "approval" ? "65536" : "500000", maxFeePerGasAtomic: "20000000", maxPriorityFeePerGasAtomic: "0" });
  const effects = (["approval", "burn"] as const).map(role => ({ role, phase: "prepared" as const, envelope: envelope(role), transactionHash: null, materialHash: null, proof: null }));
  const body = sealCircle({ schemaVersion: "apn.circle-v2-evm-operation.v1", operationId: "1".repeat(64), profile: "evm-live-buyer", profileHash, destinationProfile: selected.gasPayerProfile, destinationProfileHash, idempotencyHash: "2".repeat(64), requestHash: "3".repeat(64), fingerprint: "4".repeat(64), destinationChain: chain,
    sourceCustody: custody(profileHash, CIRCLE_SOURCE_OWNER), destinationCustody: custody(destinationProfileHash, selected.gasPayer), policies: [{ profile: "evm-live-buyer", profileHash, policyDigest: "5".repeat(64), revision: 1 }, { profile: selected.gasPayerProfile, profileHash: destinationProfileHash, policyDigest: selected.gasPayerProfile === "evm-live-buyer" ? "5".repeat(64) : "6".repeat(64), revision: 1 }].filter((p, i, all) => all.findIndex(x => x.profileHash === p.profileHash) === i),
    preparedAt: new Date(at).toISOString(), expiresAt: new Date(at + 600_000).toISOString(), deploymentDigest: "7".repeat(64), feeQuoteAtomic: "6", state: "awaiting_source", terminal: false, effects, source: null, attestation: null, destination: null, residualAllowanceAtomic: "0", usage: [], usageFinalized: false, transitions: [] });
  return advanceCircle(body, {}, "prepared", at);
}

test("Sei seller is a finite profile/account variant; historical buyer/default selectors remain identical", () => {
  const buyer=circleRoute(1329), seller=circleRoute(1329,"evm-live-seller");
  assert.deepEqual(circleRoute(1329,"evm-live-buyer"),buyer);
  const {gasPayer:_b,gasPayerProfile:_bp,...bp}=buyer,{gasPayer:_s,gasPayerProfile:_sp,...sp}=seller; assert.deepEqual(bp,sp);
  assert.equal(seller.gasPayer,CIRCLE_SEI_SELLER); assert.equal(seller.gasPayerProfile,"evm-live-seller");
  for(const [chain,profile] of [[1329,"default"],[1329,"arbitrary"],[143,"evm-live-seller"],[59144,"evm-live-seller"]] as const) assert.throws(()=>circleRoute(chain,profile));
  for(const chain of [1329,59144,143] as const) assert.deepEqual(circleRoute(chain,circleRoute(chain).gasPayerProfile),circleRoute(chain));
});
test("frozen seller profile and custody bind strict journal/nonce/fee while old absent metadata hashes are unchanged", () => {
  const legacy=initial(undefined,1329), bytes=canonicalJson(legacy), hash=legacy.integrityHash;
  assert.equal(validateCircle(legacy),legacy); assert.equal(canonicalJson(legacy),bytes); assert.equal(legacy.integrityHash,hash); assert.equal(legacy.policies[0]!.activationDigest,undefined);
  const seller=initial(undefined,1329,"evm-live-seller"); validateCircle(seller);
  assert.equal(seller.profile,"evm-live-buyer"); assert.equal(seller.destinationCustody.walletAddress,CIRCLE_SEI_SELLER);
  assert.equal(seller.effects[1]!.envelope.data,legacy.effects[1]!.envelope.data); assert.equal(seller.effects[1]!.envelope.nonceAtomic,legacy.effects[1]!.envelope.nonceAtomic);
  assert.throws(()=>validateCircle(sealCircle({...seller,destinationCustody:legacy.destinationCustody})));
  assert.throws(()=>validateCircle(sealCircle({...seller,destinationProfile:"evm-live-buyer"})));
});
test("seller account preflight cannot authorize buyer, arbitrary payer, non-Sei or wrong profile", () => {
  const account={chainId:1329,address:CIRCLE_SEI_SELLER,nativeBalanceAtomic:"50000000000000000",usdcBalanceAtomic:"0",allowanceAtomic:"0",latestNonceAtomic:"3",pendingNonceAtomic:"3"};
  assert.equal(verifyCircleDestinationAccount(account,1329,"evm-live-seller"),"3");
  assert.throws(()=>verifyCircleDestinationAccount(account,1329)); assert.throws(()=>verifyCircleDestinationAccount({...account,address:CIRCLE_SOURCE_OWNER},1329,"evm-live-seller"));
  assert.throws(()=>verifyCircleDestinationAccount(account,59144,"evm-live-seller"));
});
test("same pinned burn and issuer attestation mint canonical USDC only through the frozen seller variant", async () => {
  const proof=decodeCircleSource(source(1329),1329), attested=await bindCircleAttestation(proof,await iris(proof),snapshot(1329)), route=circleRoute(1329,"evm-live-seller");
  const logs=[event("Transfer",route.token,{from:getAddress(`0x${"0".repeat(40)}`),to:CIRCLE_RECIPIENT,value:40094n},0),event("Transfer",route.token,{from:getAddress(`0x${"0".repeat(40)}`),to:issuerFeeRecipient,value:6n},1),event("MintAndWithdraw",CIRCLE_MESSENGER,{mintRecipient:CIRCLE_RECIPIENT,amount:40094n,mintToken:route.token,feeCollected:6n},2),event("MessageReceived",CIRCLE_TRANSMITTER,{caller:CIRCLE_SEI_SELLER,sourceDomain:3,nonce:attested.nonce,sender:circleWord(CIRCLE_MESSENGER),finalityThresholdExecuted:1000,messageBody:attested.body},3)];
  const observed=observation(1329,CIRCLE_SEI_SELLER,CIRCLE_TRANSMITTER,encodeCircleMint(attested),logs);
  const minted=decodeCircleDestination(proof,attested,observed,"1","evm-live-seller",issuerFeeRecipient); assert.equal(minted.amountAtomic,"40094"); assert.equal(minted.finalityTag,"safe");
  assert.throws(()=>decodeCircleDestination(proof,attested,observed,"1")); assert.throws(()=>decodeCircleDestination(proof,attested,observed,"0","evm-live-seller",issuerFeeRecipient));
  assert.equal(proof.sourceMessage,decodeCircleSource(source(1329),1329).sourceMessage); assert.equal(attested.feeExecutedAtomic,"6");
});
test("normal CLI has the explicit finite seller selector", () => {
  const request=bindCircleEvmCommand("circle evm prepare",{"--profile":"evm-live-buyer","--destination-profile":"evm-live-seller","--destination-chain":"1329","--idempotency-key":"mm-sei-seller-20261009"});
  assert.equal(request.command,"circle.evm.prepare"); assert.equal((request as any).destinationProfile,"evm-live-seller"); assert.equal((request as any).destinationChain,1329);
});
