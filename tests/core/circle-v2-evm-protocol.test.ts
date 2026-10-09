const issuerFeeRecipient = getAddress(`0x${"44".repeat(20)}`);
import assert from "node:assert/strict";
import test from "node:test";
import { encodeAbiParameters, encodeEventTopics, getAddress, keccak256, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { hashObject } from "../../src/canonical.js";
import { CIRCLE_AMOUNT, CIRCLE_DEPLOYMENT_PINS, CIRCLE_MESSENGER, CIRCLE_MINTER, CIRCLE_RECIPIENT,
  CIRCLE_SOURCE_OWNER, CIRCLE_SOURCE_TOKEN, CIRCLE_TRANSMITTER, circleRoute, type CircleDestinationChain } from "../../src/circle-v2-evm/catalog.js";
import { CIRCLE_ABI, CIRCLE_ZERO, bindCircleAttestation, circleWord, decodeCircleDestination, decodeCircleMessage, decodeCircleSource,
  encodeCircleApproval, encodeCircleBurn, encodeCircleMint, verifyCircleApproval, circleAttesterConfigurationHash, verifyCircleAttestationSigners, type CircleAttesterSnapshot,
  type CircleObservation, type CircleSourceProof } from "../../src/circle-v2-evm/protocol.js";
import { quoteCircleFastFee, assertCircleFeeQuote, verifyCircleDeployments, verifyCircleGasEnvelope, verifyCircleMintPreflight,
  verifyCircleSourceAccount, verifyCircleClosureFinality, type CircleDeploymentSnapshot } from "../../src/circle-v2-evm/preflight.js";
const hash = `0x${"11".repeat(32)}` as Hex, blockHash = `0x${"22".repeat(32)}` as Hex, nonce = `0x${"33".repeat(32)}` as Hex;
const n = (v: bigint, bytes: number) => v.toString(16).padStart(bytes * 2, "0"), q = (v: bigint) => `0x${v.toString(16)}`;
function message(chain: CircleDestinationChain, attested = false, fee = 6n, finality = 1000n, expiry = 1000n): Hex {
  return (`0x${n(1n,4)}${n(3n,4)}${n(BigInt(circleRoute(chain).domain),4)}${(attested ? nonce : CIRCLE_ZERO).slice(2)}` +
    `${circleWord(CIRCLE_MESSENGER).slice(2)}${circleWord(CIRCLE_MESSENGER).slice(2)}${CIRCLE_ZERO.slice(2)}` +
    `${n(1000n,4)}${n(attested ? finality : 0n,4)}${n(1n,4)}${circleWord(CIRCLE_SOURCE_TOKEN).slice(2)}` +
    `${circleWord(CIRCLE_RECIPIENT).slice(2)}${n(CIRCLE_AMOUNT,32)}${circleWord(CIRCLE_SOURCE_OWNER).slice(2)}${n(100n,32)}` +
    `${n(attested ? fee : 0n,32)}${n(attested ? expiry : 0n,32)}`) as Hex;
}
function event(name: string, address: Address, args: Record<string, unknown>, index: number) {
  const abi = CIRCLE_ABI.find(x => x.type === "event" && x.name === name)!;
  return { address, topics: encodeEventTopics({ abi: [abi], eventName: name as never, args: args as never }),
    data: encodeAbiParameters(abi.inputs.filter(x => !("indexed" in x && x.indexed)), abi.inputs.filter(x => !("indexed" in x && x.indexed)).map(x => args[x.name]) as never),
    blockHash, blockNumber: "0xa", transactionHash: hash, logIndex: q(BigInt(index)), removed: false };
}
function observation(chain: number, from: Address, to: Address, input: Hex, logs: unknown[]): CircleObservation {
  return { chainId: chain, finalityTag: chain === 42161 ? "included" : "safe",
    transaction: { hash, chainId: q(BigInt(chain)), from, to, input, value: "0x0", blockHash, blockNumber: "0xa",
      gas: "0x7a120", maxFeePerGas: chain === 143 ? "0x17bfac7c00" : "0x1312d00" },
    receipt: { transactionHash: hash, from, to, status: "0x1", blockHash, blockNumber: "0xa", gasUsed: "0x493e0",
      effectiveGasPrice: chain === 143 ? "0x17bfac7c00" : "0x1312d00", logs },
    canonicalBlock: { hash: blockHash, number: "0xa", transactions: [hash] }, recheckedBlock: { hash: blockHash, number: "0xa" },
    finalityHead: { hash: blockHash, number: "0xa" } };
}
function source(chain: CircleDestinationChain) {
  const m = message(chain);
  return observation(42161, CIRCLE_SOURCE_OWNER, CIRCLE_MESSENGER, encodeCircleBurn(chain), [
    event("MessageSent", CIRCLE_TRANSMITTER, { message: m }, 0),
    event("DepositForBurn", CIRCLE_MESSENGER, { burnToken: CIRCLE_SOURCE_TOKEN, amount: CIRCLE_AMOUNT, depositor: CIRCLE_SOURCE_OWNER,
      mintRecipient: circleWord(CIRCLE_RECIPIENT), destinationDomain: circleRoute(chain).domain,
      destinationTokenMessenger: circleWord(CIRCLE_MESSENGER), destinationCaller: CIRCLE_ZERO, maxFee: 100n, minFinalityThreshold: 1000, hookData: "0x" }, 1),
  ]);
}
const signers = [privateKeyToAccount(`0x${n(1n,32)}`), privateKeyToAccount(`0x${n(2n,32)}`)].sort((a,b) => BigInt(a.address) < BigInt(b.address) ? -1 : 1);
const snapshot = (chain: CircleDestinationChain): CircleAttesterSnapshot => ({ threshold: 2, enabledAttesters: signers.map(x => x.address),
  chainId: chain, transmitter: CIRCLE_TRANSMITTER, blockHash, blockNumberAtomic: "10", deploymentDigest: "a".repeat(64) });
async function iris(proof: CircleSourceProof, bytes = message(proof.destinationChain, true)) {
  const m = decodeCircleMessage(bytes, proof.destinationChain, true), sigs = await Promise.all(signers.map(x => x.sign({ hash: keccak256(bytes) })));
  return { sourceTxHash: proof.transactionHash, messages: [{ cctpVersion: 2, status: "complete", eventNonce: String(m.nonce),
    message: bytes, attestation: `0x${sigs.map(x => x.slice(2)).join("")}`,
    decodedMessage: { sourceDomain: "3", destinationDomain: String(circleRoute(proof.destinationChain).domain), nonce: String(m.nonce),
      sender: circleWord(CIRCLE_MESSENGER), recipient: circleWord(CIRCLE_MESSENGER), destinationCaller: CIRCLE_ZERO, messageBody: m.body,
      minFinalityThreshold: "1000", finalityThresholdExecuted: String(m.finalityExecuted), decodedMessageBody: {
        burnToken: circleWord(CIRCLE_SOURCE_TOKEN), mintRecipient: circleWord(CIRCLE_RECIPIENT), amount: "40100",
        messageSender: circleWord(CIRCLE_SOURCE_OWNER), maxFee: "100", feeExecuted: m.feeExecutedAtomic, expirationBlock: m.expirationBlock, hookData: "0x" } } }] };
}
for (const chain of [1329, 59144, 143] as const) test(`finite ${chain}: exact source bytes, enabled issuer attestation, canonical mint`, async () => {
  const proof = decodeCircleSource(source(chain), chain), attested = await bindCircleAttestation(proof, await iris(proof), snapshot(chain));
  assert.equal(attested.receivedAtomic, "40094"); assert.equal(proof.finalityTag, "included");
  const route = circleRoute(chain), logs = [event("Transfer", route.token, { from: getAddress(`0x${"0".repeat(40)}`), to: CIRCLE_RECIPIENT, value: 40094n }, 0),
    event("Transfer", route.token, { from: getAddress(`0x${"0".repeat(40)}`), to: issuerFeeRecipient, value: 6n }, 1),
    event("MintAndWithdraw", CIRCLE_MESSENGER, { mintRecipient: CIRCLE_RECIPIENT, amount: 40094n, mintToken: route.token, feeCollected: 6n }, 2),
    event("MessageReceived", CIRCLE_TRANSMITTER, { caller: route.gasPayer, sourceDomain: 3, nonce: attested.nonce,
      sender: circleWord(CIRCLE_MESSENGER), finalityThresholdExecuted: 1000, messageBody: attested.body }, 3)];
  const dst = observation(chain, route.gasPayer, CIRCLE_TRANSMITTER, encodeCircleMint(attested), logs);
  const minted = decodeCircleDestination(proof, attested, dst, "1", undefined, issuerFeeRecipient); assert.equal(minted.amountAtomic, "40094");
  if (chain === 143) assert.equal(minted.actualFeeAtomic, "51000000000000000");
  assert.throws(() => decodeCircleDestination(proof, attested, dst, "0", undefined, issuerFeeRecipient), /destination_mint_binding/);
  verifyCircleMintPreflight(proof, attested, { destinationBlockAtomic: "10", usedNonceAtomic: "0",
    attesterConfigurationHash: attested.attesterConfigurationHash, transactionSimulationResult: `0x${"0".repeat(63)}1` });
  assert.throws(() => verifyCircleMintPreflight(proof, attested, { destinationBlockAtomic: "1000", usedNonceAtomic: "0",
    attesterConfigurationHash: attested.attesterConfigurationHash, transactionSimulationResult: `0x${"0".repeat(63)}1` }), /expired/);
  assert.throws(() => verifyCircleMintPreflight(proof, attested, { destinationBlockAtomic: "10", usedNonceAtomic: "1",
    attesterConfigurationHash: attested.attesterConfigurationHash, transactionSimulationResult: `0x${"0".repeat(63)}1` }), /nonce/);
});
test("source guards reject receipt reorg, foreign transaction, duplicate event and noncanonical log membership", () => {
  for (const mutate of [(x: CircleObservation) => { (x.recheckedBlock as any).hash = nonce; },
    (x: CircleObservation) => { (x.transaction as any).input = encodeCircleBurn(1329); },
    (x: CircleObservation) => { (x.receipt as any).logs.push((x.receipt as any).logs[0]); },
    (x: CircleObservation) => { (x.receipt as any).logs[0].transactionHash = nonce; },
    (x: CircleObservation) => { const l=(x.receipt as any).logs[1]; l.topics[1]=`0xff${l.topics[1].slice(4)}`; },
    (x: CircleObservation) => { (x.canonicalBlock as any).transactions = []; },
    (x: CircleObservation) => { (x.receipt as any).status = "0x0"; }]) {
    const fixture = source(143); mutate(fixture); assert.throws(() => decodeCircleSource(fixture, 143));
  }
});
test("immutable header and burn body fields cannot be normalized", () => {
  for (const offset of [0,4,8,44,76,108,140,148,152,184,216,248,280]) {
    const m = message(143,true), at = 2 + offset * 2, changed = `${m.slice(0,at)}ff${m.slice(at+2)}`;
    assert.throws(() => decodeCircleMessage(changed,143,true), /binding/);
  }
  assert.throws(() => decodeCircleMessage(message(143,true,101n),143,true), /binding/);
  assert.throws(() => decodeCircleMessage(message(143,true,6n,500n),143,true), /finality/);
  assert.throws(() => decodeCircleMessage(`${message(143,true)}00`,143,true), /hex/);
});
test("enabled issuers, sorted canonical signatures and exact API/hash metadata are required", async () => {
  const proof = decodeCircleSource(source(143),143), response = await iris(proof);
  for (const mutate of [(r: any) => { r.sourceTxHash = nonce; }, (r: any) => { r.messages[0].status = "pending_confirmations"; },
    (r: any) => { r.messages.push(r.messages[0]); }, (r: any) => { r.messages[0].decodedMessage.decodedMessageBody.amount = "40000"; },
    (r: any) => { r.messages[0].attestation = r.messages[0].attestation.slice(0,-130); },
    (r: any) => { const sig=r.messages[0].attestation.slice(2,132); r.messages[0].attestation=`0x${sig}${sig}`; },
    (r: any) => { const s=r.messages[0].attestation; r.messages[0].attestation=`0x${s.slice(132)}${s.slice(2,132)}`; }]) {
    const copy = structuredClone(response); mutate(copy); await assert.rejects(bindCircleAttestation(proof,copy,snapshot(143)));
  }
  await assert.rejects(bindCircleAttestation(proof,response,{...snapshot(143), enabledAttesters:[CIRCLE_SOURCE_OWNER,CIRCLE_RECIPIENT]}), /signer/);
  await assert.rejects(bindCircleAttestation({...proof,sourceMessageHash:nonce},response,snapshot(143)), /integrity/);
  const finalized = await bindCircleAttestation(proof,await iris(proof,message(143,true,0n,2000n,0n)),snapshot(143));
  const advanced = {...snapshot(143), blockHash: nonce, blockNumberAtomic: "20", deploymentDigest: "b".repeat(64)};
  assert.equal(circleAttesterConfigurationHash(advanced), finalized.attesterConfigurationHash);
  assert.deepEqual(await verifyCircleAttestationSigners(finalized, finalized.attestation, advanced), finalized.signers);
  assert.equal(finalized.finalityExecuted,2000); assert.equal(finalized.receivedAtomic,"40100");
});
test("exact allowance approval/reset receipts and native source budget", () => {
  for (const reset of [false,true]) {
    const amount = reset ? 0n : CIRCLE_AMOUNT, obs = observation(42161,CIRCLE_SOURCE_OWNER,CIRCLE_SOURCE_TOKEN,encodeCircleApproval(reset),[
      event("Approval",CIRCLE_SOURCE_TOKEN,{owner:CIRCLE_SOURCE_OWNER,spender:CIRCLE_MESSENGER,value:amount},0)]);
    (obs.transaction as any).gas="0x10000"; (obs.receipt as any).gasUsed="0xc350";
    assert.ok(verifyCircleApproval(obs,reset,amount.toString())); assert.throws(() => verifyCircleApproval(obs,reset,"999"));
  }
  assert.throws(() => verifyCircleGasEnvelope({gasLimitAtomic:"600000",maxFeePerGasAtomic:"60000000",maxPriorityFeePerGasAtomic:"1",valueAtomic:"0",nonceAtomic:"1"},42161), /budget/);
  assert.throws(() => verifyCircleSourceAccount({chainId:42161,address:CIRCLE_SOURCE_OWNER,nativeBalanceAtomic:"30000000000000",usdcBalanceAtomic:"40100",allowanceAtomic:"40000",latestNonceAtomic:"1",pendingNonceAtomic:"1"}), /account/);
});
test("fast quote uses rational ceil and refuses unavailable, expired or over-cap fees", () => {
  const quote=quoteCircleFastFee(143,[{finalityThreshold:1000,minimumFee:1.4},{finalityThreshold:2000,minimumFee:0}],1000,1001);
  assert.equal(quote.quotedFeeAtomic,"6"); assertCircleFeeQuote(quote,143,1001);
  assert.throws(()=>assertCircleFeeQuote(quote,143,31000),/expired/);
  for(const value of [[{finalityThreshold:2000,minimumFee:0}],[{finalityThreshold:1000,minimumFee:25}],
    [{finalityThreshold:1000,minimumFee:1.4},{finalityThreshold:1000,minimumFee:1.4}],[{finalityThreshold:1000,minimumFee:NaN}]]) assert.throws(()=>quoteCircleFastFee(143,value,1000,1001));
});
function deployment(chain: 42161|CircleDestinationChain, peer: CircleDestinationChain): CircleDeploymentSnapshot {
  const destination=chain!==42161, route=circleRoute(peer);
  return {chainId:chain,domain:destination?circleRoute(chain).domain:3,blockHash,blockNumberAtomic:"10",contracts:CIRCLE_DEPLOYMENT_PINS[chain],
    remoteDomain:destination?3:route.domain,remoteMessenger:circleWord(CIRCLE_MESSENGER),pairedToken:destination?circleRoute(chain).token:CIRCLE_SOURCE_TOKEN,
    localMinter:CIRCLE_MINTER,localMessageTransmitter:CIRCLE_TRANSMITTER,localTokenMessenger:CIRCLE_MESSENGER,messageVersion:1,messageBodyVersion:1,
    tokenDecimals:6,transmitterPaused:false,minterPaused:false,tokenPaused:false};
}
test("deployment verification binds implementation plus proxy and reverse token pairs", () => {
  const src=deployment(42161,143),dst=deployment(143,143);assert.equal(verifyCircleDeployments(src,dst).length,64);
  for(const mutate of [(x:any)=>{x.contracts.messenger.implementationCodeHash=nonce;},(x:any)=>{x.pairedToken=CIRCLE_SOURCE_TOKEN;},
    (x:any)=>{x.remoteDomain=16;},(x:any)=>{x.transmitterPaused=true;}]){
    const changed=structuredClone(dst); mutate(changed);assert.throws(()=>verifyCircleDeployments(src,changed));
  }
});
test("fast issuer evidence does not turn source inclusion into finalized bridge closure", () => {
  const included=decodeCircleSource(source(143),143);assert.throws(()=>verifyCircleClosureFinality(included,included),/finality/);
  const obs=source(143),finalized=decodeCircleSource({...obs,finalityTag:"finalized"},143);verifyCircleClosureFinality(included,finalized);
  const changed={...finalized,blockHash:nonce};const {integrityHash:_,...body}=changed;
  assert.throws(()=>verifyCircleClosureFinality(included,{...body,integrityHash:hashObject(body)}),/finality/);
});

test("actual V2 issuer eventNonce is strict bytes32 and bound to the signed raw nonce", async () => {
  // Public actual Linea response, burn0xbe0d229c...1779, 2026-10-09. Its event/decoded/raw nonce words agree.
  const actualNonce = "0x61e1723eed95d9ff527f852541862ac14b5399f6be5d56ff029620d74e1d6384" as Hex;
  const proof = decodeCircleSource(source(143), 143), original = message(143, true);
  const bytes = (`${original.slice(0, 26)}${actualNonce.slice(2)}${original.slice(90)}`) as Hex, response = await iris(proof, bytes);
  assert.equal(response.messages[0]!.eventNonce, actualNonce); assert.equal(response.messages[0]!.decodedMessage.nonce, actualNonce);
  assert.equal((await bindCircleAttestation(proof, response, snapshot(143))).nonce, actualNonce);
  const upper = structuredClone(response); upper.messages[0]!.eventNonce = `0x${actualNonce.slice(2).toUpperCase()}`;
  assert.equal((await bindCircleAttestation(proof, upper, snapshot(143))).nonce, actualNonce);
  for (const eventNonce of ["", "123", "0x", `0x${"11".repeat(31)}`, `0x${"11".repeat(33)}`, `0x${"gg".repeat(32)}`, `0x${"11".repeat(32)}`]) {
    const wrong = structuredClone(response); wrong.messages[0]!.eventNonce = eventNonce; await assert.rejects(bindCircleAttestation(proof, wrong, snapshot(143)));
    const decodedWrong = structuredClone(response); decodedWrong.messages[0]!.decodedMessage.nonce = eventNonce; await assert.rejects(bindCircleAttestation(proof, decodedWrong, snapshot(143)));
  }
});
