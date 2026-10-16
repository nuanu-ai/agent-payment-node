/**
 * SYNTHETIC: R4 exit for an ambiguous v2 send. An approval or burn whose broadcast was lost after its submission fence is
 * `unknown`; it ends only when the chain proves it can never land (nonce consumed at safe depth by another transaction,
 * no transaction and no receipt for its hash). The real v2 lifecycle runs with test ports; no RPC, no custody, no funds.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Hex } from "viem";
import { getAddress } from "viem";
import { seal as sealUsage, reservationIdFor, idempotency } from "../../src/asset-usage-ledger-record.js";
import { CIRCLE_SOURCE_TOKEN, circleRoute } from "../../src/circle-v2-evm/catalog.js";
import { circleFundingBinding, quoteCircleFundingFee } from "../../src/circle-v2-evm/funding-binding.js";
import { advanceCircleFundingOperation, circleFundingFingerprint, sealCircleFundingOperation, validateCircleFundingOperation, type CircleFundingOperationV2 } from "../../src/circle-v2-evm/funding-operation.js";
import { approveCircleFundingSource, assertCircleFundingEffectGuard, cleanupCircleFunding, type CircleFundingLifecyclePorts } from "../../src/circle-v2-evm/funding-lifecycle.js";
import type { CircleFundingMaterial } from "../../src/circle-v2-evm/funding-custody.js";
import { circleEnvelope, type CircleEffect } from "../../src/circle-v2-evm/operation-model.js";
import { encodeCircleApproval, encodeCircleBurn } from "../../src/circle-v2-evm/protocol.js";
import { validateCircleFundingAdvance } from "../../src/circle-v2-evm/repository.js";
import { evmSentOutcome, type EvmUnsentOutcome } from "../../src/evm-unsent-outcome.js";
import { at, fundingIdentity, initial } from "./circle-v2-evm-nonce-runtime-fixtures.js";

const params = { recipient: getAddress(`0x${"55".repeat(20)}`), amountAtomic: "1000000", maxFeeAtomic: "1000", minMintAtomic: "999000" };
const tx = `0x${"11".repeat(32)}` as Hex, burnTx = `0x${"22".repeat(32)}` as Hex;
type Target = "reserved" | "unknown_finality" | "finalized" | "failed_before_effect" | "failed_confirmed_revert" | "released_unsubmitted";
function holds(op: CircleFundingOperationV2, target: Target) {
  return ["usdc", "approval", "burn", "cleanup", "mint"].map((key, i) => {
    const identity = { account: i === 4 ? op.funding.gasPayer : op.funding.sourceOwner, chain: i === 4 ? `eip155:${op.destinationChain}` : "eip155:42161",
      asset: i === 0 ? { kind: "token" as const, identifier: CIRCLE_SOURCE_TOKEN } : { kind: "native" as const, identifier: null } }, ih = idempotency(`${op.operationId}:${key}`);
    const terminal = !["reserved", "unknown_finality"].includes(target);
    return sealUsage({ schemaVersion: "apn.asset-usage-reservation.v1", reservationId: reservationIdFor(identity, ih), idempotencyHash: ih,
      policyDigest: op.policies.find(x => x.profileHash === (i === 4 ? op.destinationProfileHash : op.profileHash))!.policyDigest, registryVersion: "synthetic-never-landed", ...identity, rail: "bridge",
      amountAtomic: i === 0 ? op.funding.amountAtomic : i === 4 ? circleRoute(op.destinationChain).destinationNativeCap : i === 3 ? "15000000000000" : "30000000000000", state: target,
      reservedAt: new Date(at).toISOString(), updatedAt: new Date(at).toISOString(), effectAt: null, outcomeDigest: terminal ? "8".repeat(64) : null });
  });
}
function reserved(): CircleFundingOperationV2 {
  const legacy = initial(join(tmpdir(), "never-landed-synthetic"), 59144), b = circleFundingBinding(59144, fundingIdentity(legacy), params);
  const feeQuote = quoteCircleFundingFee(b, [{ finalityThreshold: 1000, minimumFee: 1 }], at, at);
  const { schemaVersion: _v, integrityHash: _h, transitions: _t, externalFulfillment: _e, nonceRetirement: _n, ...rest } = legacy;
  const effects = rest.effects.map(e => { const { envelopeHash: _old, ...envelope } = e.envelope; return { ...e, envelope: circleEnvelope({ ...envelope, data: e.role === "burn" ? encodeCircleBurn(59144, b) : encodeCircleApproval(false, b) }) }; });
  let op = sealCircleFundingOperation({ ...rest, schemaVersion: "apn.circle-v2-evm-operation.v2", funding: b, feeQuote, feeQuoteAtomic: feeQuote.quotedFeeAtomic, state: "awaiting_source",
    policies: rest.policies.map(p => ({ ...p, activationDigest: "a".repeat(64) })), expiresAt: new Date(at + 900_000).toISOString(), effects, transitions: [] });
  op = sealCircleFundingOperation({ ...op, fingerprint: circleFundingFingerprint(op) }); op = advanceCircleFundingOperation(op, {}, "prepared", at);
  return advanceCircleFundingOperation(op, { usage: holds(op, "reserved") }, "reserved", at);
}
const receipt = (hash: Hex) => ({ transactionHash: hash, blockHash: hash, blockNumberAtomic: "10", receiptHash: "a".repeat(64), actualFeeAtomic: "1", finalityBlockHash: hash,
  finalityBlockNumberAtomic: "10", transactionHashBinding: "a".repeat(64), logsHash: "b".repeat(64), finalityTag: "included" as const });

/** The real v2 lifecycle; the broadcast of `lost` fails after its submission fence (a lost RPC answer). */
function harness(lost: "approval" | "burn", outcome: EvmUnsentOutcome) {
  let current = reserved(), sends = 0, discarded = 0, outcomes = 0;
  const material = (o: CircleFundingOperationV2, e: CircleEffect): CircleFundingMaterial => ({ schemaVersion: "apn.circle-v2-evm-effect.v2", operationId: o.operationId, role: e.role, fingerprint: o.fingerprint,
    envelopeHash: e.envelope.envelopeHash, rawTransaction: "0x02", transactionHash: e.role === "burn" ? burnTx : tx, materialHash: "9".repeat(64) });
  const ports: CircleFundingLifecyclePorts = { now: () => at + 1, save: async o => { validateCircleFundingAdvance(current, o); current = o; },
    assertOwnerPolicyAndConflicts: async () => {}, authorizationDeadline: async () => new Date(at + 900_000).toISOString(), approve: async () => {}, preflight: async () => {},
    seal: async (o, e, g) => { assertCircleFundingEffectGuard(o, e, g); return material(o, e); }, loadMaterial: async (o, e) => material(o, e),
    broadcast: async e => { sends++; if (e.role === lost) throw new Error("TEST lost RPC answer after the submission fence"); return e.role === "burn" ? burnTx : tx; },
    // Only the approval has a receipt; the lost effect is never observed.
    observeEffect: async (_o, e) => e.role === "approval" && lost === "burn" ? receipt(tx) : null,
    observeSource: async () => null, observeDestination: async () => null, allowance: async () => "0", attestation: async () => null,
    mintEnvelope: async () => { throw new Error("no mint"); },
    cleanupEnvelope: async o => circleEnvelope({ chainId: 42161, from: o.funding.sourceOwner, to: CIRCLE_SOURCE_TOKEN, data: encodeCircleApproval(true, o.funding), valueAtomic: "0", nonceAtomic: "3",
      gasLimitAtomic: "50000", maxFeePerGasAtomic: "20000000", maxPriorityFeePerGasAtomic: "0" }),
    usage: async (o, t) => holds(o, t),
    unsent: { outcome: async () => "nonce_not_consumed", sentOutcome: async (_o, e) => { outcomes++; assert.equal(e.role, lost); assert.equal(e.phase, "unknown"); return outcome; },
      discard: async (_o, e) => { discarded++; assert.equal(e.phase, "abandoned_unsent"); } } };
  return { ports, start: () => current, sends: () => sends, discarded: () => discarded, outcomes: () => outcomes };
}

test("a lost approval whose nonce another transaction consumed, with no transaction or receipt, ends the route and releases every hold", async () => {
  const h = harness("approval", "never_lands"), op = await approveCircleFundingSource(h.start(), h.ports);
  assert.equal(op.state, "cancelled_unsubmitted"); assert.equal(op.terminal, true); assert.equal(op.usageFinalized, true);
  assert.equal(op.effects[0]!.phase, "abandoned_unsent"); assert.equal(op.effects[0]!.transactionHash, tx); assert.equal(op.effects[1]!.phase, "prepared");
  assert.ok(op.usage.every(u => u.state === "released_unsubmitted")); assert.deepEqual([h.sends(), h.discarded(), h.outcomes()], [1, 1, 1]);
  assert.ok(op.transitions.some(t => t.reason === "approval_sent_bytes_never_land")); validateCircleFundingOperation(op);
  // Terminal: nothing is resent, observed or released twice.
  assert.deepEqual(await approveCircleFundingSource(op, h.ports), op); assert.deepEqual([h.sends(), h.outcomes()], [1, 1]);
});

for (const outcome of ["own_transaction_known", "nonce_not_consumed"] as const)
test(`a lost approval stays unknown and observe-only when the proof says ${outcome}`, async () => {
  const h = harness("approval", outcome), op = await approveCircleFundingSource(h.start(), h.ports);
  assert.equal(op.state, "source_unknown"); assert.equal(op.terminal, false); assert.equal(op.effects[0]!.phase, "unknown"); assert.equal(op.effects[1]!.phase, "prepared");
  assert.ok(op.usage.every(u => u.state === "unknown_finality")); assert.deepEqual([h.sends(), h.discarded(), h.outcomes()], [1, 0, 1]);
  // Observing again re-reads the proof but never signs, sends or releases.
  const again = await approveCircleFundingSource(op, h.ports); assert.equal(again.state, "source_unknown"); assert.deepEqual([h.sends(), h.discarded(), h.outcomes()], [1, 0, 2]);
});

test("a lost burn that can never land leaves the confirmed approval to the explicit approve-zero cleanup; its holds stay until then", async () => {
  const h = harness("burn", "never_lands"), op = await approveCircleFundingSource(h.start(), h.ports);
  assert.equal(op.effects[0]!.phase, "confirmed"); assert.equal(op.effects[1]!.phase, "abandoned_unsent"); assert.equal(op.state, "cleanup_required"); assert.equal(op.terminal, false);
  assert.ok(op.usage.every(u => u.state === "unknown_finality")); assert.deepEqual([h.sends(), h.discarded(), h.outcomes()], [2, 1, 1]);
  await assert.rejects(approveCircleFundingSource(op, h.ports), /explicit_cleanup_required/);
  const cleaned = await cleanupCircleFunding(op, { ...h.ports, observeEffect: async (_o, e) => e.role === "cleanup" ? { ...receipt(tx), finalityTag: "finalized" } : null });
  assert.equal(cleaned.effects.find(e => e.role === "cleanup")!.phase, "confirmed"); assert.equal(cleaned.state, "cleaned"); assert.equal(cleaned.terminal, true);
});

test("the RPC proof: nonce past at safe, no transaction and no receipt; any known transaction or receipt means observe only", async () => {
  const account = getAddress(`0x${"aa".repeat(20)}`), input = { account, nonce: 7n, transactionHash: tx };
  const reader = (safeNonce: bigint, transaction: unknown, rcpt: unknown, calls: string[] = []) => async (method: string, params: readonly unknown[]) => {
    calls.push(method); if (method === "eth_getTransactionCount") { assert.deepEqual(params, [account, "safe"]); return `0x${safeNonce.toString(16)}`; }
    assert.deepEqual(params, [tx]); return method === "eth_getTransactionByHash" ? transaction : rcpt; };
  const calls: string[] = [];
  assert.equal(await evmSentOutcome(reader(8n, null, null, calls), input), "never_lands"); assert.deepEqual(calls, ["eth_getTransactionCount", "eth_getTransactionByHash", "eth_getTransactionReceipt"]);
  assert.equal(await evmSentOutcome(reader(7n, null, null), input), "nonce_not_consumed");
  assert.equal(await evmSentOutcome(reader(8n, { hash: tx }, null), input), "own_transaction_known");
  assert.equal(await evmSentOutcome(reader(8n, null, { transactionHash: tx }), input), "own_transaction_known");
});
