import { advanceCircle, circleMechanism, saveCircleV1 } from "./circle-v1-journal.js";
import { AssetUsageLedger } from "../../src/asset-usage-ledger.js";
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
for (const [chain, profile] of [[143,"default"], [59144,"evm-live-buyer"], [1329,"evm-live-buyer"], [1329,"evm-live-seller"]] as const) test(`v2 ${chain}/${profile}: exact burn, signed issuer, SAFE beneficiary and gas owner stay separate`, async () => {
  const op = funding(join(tmpdir(), "unused-funding-fixture"), chain, profile), b = op.funding;
  validateCircleFundingOperation(op); assert.throws(() => validateCircle(op));
  const raw = source(op), proof = decodeCircleSource(raw, chain, b);
  assert.throws(() => decodeCircleSource(raw, chain));
  const response = await issuer(op, proof), attested = await bindCircleAttestation(proof, response, snapshot(chain), b);
  assert.equal(attested.receivedAtomic, "999900");
  verifyCircleMintPreflight(proof, attested, { destinationBlockAtomic: "10", usedNonceAtomic: "0", attesterConfigurationHash: attested.attesterConfigurationHash, transactionSimulationResult: `0x${"0".repeat(63)}1` }, b);
  const finalized = decodeCircleSource({ ...raw, finalityTag: "finalized" }, chain, b); verifyCircleClosureFinality(proof, finalized, b);
  const dest = observation(chain, b.gasPayer, CIRCLE_TRANSMITTER, encodeCircleMint(attested), [
    event("MessageReceived", CIRCLE_TRANSMITTER, { caller: b.gasPayer, sourceDomain: 3, nonce: attested.nonce, sender: circleWord(CIRCLE_MESSENGER), finalityThresholdExecuted: 1000, messageBody: attested.body }, 0),
    event("Transfer", b.destinationToken, { from: getAddress(`0x${"0".repeat(40)}`), to: recipient, value: 999900n }, 1),
    event("Transfer", b.destinationToken, { from: getAddress(`0x${"0".repeat(40)}`), to: feeRecipient, value: 100n }, 2),
    event("MintAndWithdraw", CIRCLE_MESSENGER, { mintRecipient: recipient, amount: 999900n, mintToken: b.destinationToken, feeCollected: 100n }, 3) ]);
  const delivered = decodeCircleDestination(proof, attested, dest, "1", profile, feeRecipient, b);
  assert.equal(delivered.recipient, recipient); assert.notEqual(delivered.recipient, b.gasPayer);
  assert.throws(() => decodeCircleDestination(proof, attested, dest, "0", profile, feeRecipient, b));
  assert.throws(() => decodeCircleDestination(proof, attested, { ...dest, transaction: { ...dest.transaction as object, from: recipient } }, "1", profile, feeRecipient, b));
  const changed = structuredClone(response); changed.messages[0]!.decodedMessage.decodedMessageBody.mintRecipient = circleWord(b.gasPayer);
  await assert.rejects(bindCircleAttestation(proof, changed, snapshot(chain), b));
  assert.throws(() => decodeCircleMessage(fundingMessage(op, true, 1001n), chain, true, b));
  const approval = observation(42161, CIRCLE_SOURCE_OWNER, CIRCLE_SOURCE_TOKEN, encodeCircleApproval(false, b), [event("Approval", CIRCLE_SOURCE_TOKEN, { owner: CIRCLE_SOURCE_OWNER, spender: CIRCLE_MESSENGER, value: BigInt(b.amountAtomic) }, 0)]);
  const approvalTx = { ...approval.transaction as object, gas: "0x10000" };
  verifyCircleApproval({ ...approval, transaction: approvalTx, receipt: { ...approval.receipt as object, gasUsed: "0x10000" } }, false, b.amountAtomic, b);
  assert.throws(() => verifyCircleApproval({ ...approval, transaction: approvalTx }, false, "40100", b));
});
test("v2 codec and immutable continuation reject rehashed tuple, context, schema and expiry substitution", () => {
  const op = funding(join(tmpdir(), "unused-funding-codec"), 1329);
  for (const patch of [{ funding: { ...op.funding, recipient: op.funding.gasPayer } }, { expiresAt: new Date(at+900001).toISOString() }, { fingerprint: "f".repeat(64) }, { profile: "default" }, { destinationProfile: "evm-live-seller" }])
    assert.throws(() => validateCircleFundingOperation(sealCircleFundingOperation({ ...op, ...patch })));
  assert.throws(() => validateKnownCircle({ ...op, schemaVersion: "unknown" }));
  const changed = advanceCircleFundingOperation(op, { requestHash: "f".repeat(64) }, "changed", at);
  assert.throws(() => validateCircleFundingAdvance(op, changed), /continuity/);
  assert.throws(() => validateCircleFundingOperation({ ...op, externalFulfillment: {} }));
});
for (const first of ["v1", "v2"] as const) for (const [chain, profile] of [[143,"default"], [59144,"evm-live-buyer"], [1329,"evm-live-buyer"], [1329,"evm-live-seller"]] as const) test(`pending and UNKNOWN ${first} ${chain}/${profile} are visible to both schema conflict/admission paths`, async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "circle-v2-domains-"))); t.after(() => rm(root, { recursive: true, force: true }));
  const repo = new CircleRepository(root), state = new StateStore(root), service = new OperationService(state);
  const old = initial(root, chain, profile), fresh = funding(root, chain, profile);
  const held = first === "v1" ? old : fresh;
  if (held.schemaVersion === "apn.circle-v2-evm-operation.v1") await saveCircleV1(root, held); else await repo.saveFunding(held);
  const attempted = { ...held.effects[0]!, phase: "signing_started" as const };
  const unknown = held.schemaVersion === "apn.circle-v2-evm-operation.v1" ? advanceCircle(held, { effects: [attempted, held.effects[1]!], state: "source_unknown" }, "fence", at) : advanceCircleFundingOperation(held, { effects: [attempted, held.effects[1]!], state: "source_unknown" }, "fence", at);
  if (unknown.schemaVersion === "apn.circle-v2-evm-operation.v1") await saveCircleV1(root, unknown); else await repo.saveFunding(unknown);
  for (const candidate of [old, fresh]) await assert.rejects(service.assertCircleAccountsAvailable({ ...candidate, operationId: "e".repeat(64) }), { code: "APN_OPERATION_BLOCKED" });
  await assert.rejects(service.assertEvmAccountAvailable(held.profileHash, 42161, CIRCLE_SOURCE_OWNER), { code: "APN_OPERATION_BLOCKED" });
  await assert.rejects(service.assertEvmAccountAvailable(held.destinationProfileHash, held.destinationChain, held.destinationCustody.walletAddress), { code: "APN_OPERATION_BLOCKED" });
  await service.assertEvmAccountAvailable(held.profileHash, 1, CIRCLE_SOURCE_OWNER);
  const found = (await service.findIdempotency(held.idempotencyHash))!; assert.equal(found.kind, "circle_route"); if (found.kind !== "circle_route") throw new Error("wrong kind"); assert.equal(found.record.integrityHash, unknown.integrityHash);
  assert.equal((await repo.listAllAny()).length, 1);
  if (first === "v2") assert.equal((await repo.listAllAny()).filter(op => op.schemaVersion === "apn.circle-v2-evm-operation.v1").length, 0);
  // A v2 save never replaces a stored v1 journal (nothing writes v1 any more).
  const before = await repo.loadAny(held.operationId); if (first === "v1") await assert.rejects(repo.saveFunding(fresh)); assert.equal(canonicalJson(await repo.loadAny(held.operationId)), canonicalJson(before));
  await writeFile(join(root,"circle-v2-evm",`${"a".repeat(64)}.json`), `${canonicalJson({ ...fresh, schemaVersion: "unknown" })}\n`, { mode: 0o600 });
  await assert.rejects(repo.listAllAny(), /unsupported_operation_schema/); await assert.rejects(service.assertEvmAccountAvailable(held.profileHash, 1, CIRCLE_SOURCE_OWNER));
});
test("held v1 ledger reservations still count against a new v2 operation's caps", async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "circle-v2-ledger-"))); t.after(() => rm(root, { recursive: true, force: true }));
  const state = new StateStore(root), store = new AllowlistPolicyStore(root); await state.initialize();
  const newer = funding(root,1329), older = initial(root,1329), b = newer.funding;
  const alternatives = (cap: string) => [circleMechanism(1329), b.mechanism].map(x => ({ ...x, maximumPerTransferAtomic: cap }));
  const record = await store.stage({ profile: "evm-live-buyer", now: new Date(at), policy: { schemaVersion: "apn.allowlist-policy-file.v1", overlayVersion: "synthetic-funding-v2.1", accounts: { evm: CIRCLE_SOURCE_OWNER }, effectiveAt: new Date(at-1000).toISOString(), expiresAt: new Date(at+900000).toISOString(), admissions: [
    { chain:"eip155:42161", kind:"token", identifier:CIRCLE_SOURCE_TOKEN, rail:"bridge", mechanisms:alternatives("1000000"), dailyLimitAtomic:"1010000" },
    { chain:"eip155:42161", kind:"native", rail:"bridge", mechanisms:alternatives("75000000000000"), dailyLimitAtomic:"150000000000000" },
    { chain:"eip155:1329", kind:"native", rail:"bridge", mechanisms:alternatives(b.destinationChain === 1329 ? "50000000000000000":"0"), dailyLimitAtomic:"100000000000000000" } ] } });
  await store.appendDecision("evm-live-buyer",null,{ status:"active",revision:record.revision,stagedRecordDigest:record.recordDigest,policyDigest:record.registry.policyDigest,registry:record.registry,approvalFingerprint:hashObject("fixture"),decidedAt:new Date(at).toISOString() });
  // The USDC hold the deleted v1 writer reserved for `older`: its namespace, mechanism and amount.
  await new AssetUsageLedger(root).reserve({ account: CIRCLE_SOURCE_OWNER, chain: "eip155:42161", asset: { kind: "token", identifier: CIRCLE_SOURCE_TOKEN }, registry: record.registry, rail: "bridge",
    mechanism: circleMechanism(1329), amountAtomic: "40100", idempotencyKey: `circle-v2-evm.v1:${older.operationId}:usdc`, now: new Date(at) });
  const u = new CircleUsage(state,()=>at);
  await u.withPolicyLocks(["evm-live-buyer"], async () => { await assert.rejects(u.policies(newer), { code: "APN_OPERATION_BLOCKED" }); });
});

