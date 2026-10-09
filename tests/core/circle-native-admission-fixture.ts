import { circleRuntimeBytecode } from "../../src/circle-v2-evm/rpc.js";
import { verifyCircleFinalizedRevert } from "../../src/circle-v2-evm/revert-proof.js";
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, realpath, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getAddress, type Hex } from "viem";
import { StateStore } from "../../src/state.js";
import { canonicalJson, hashObject } from "../../src/canonical.js";
import { seal as sealUsage, reservationIdFor, idempotency } from "../../src/asset-usage-ledger-record.js";
import { CircleRepository, validateCircleAdvance } from "../../src/circle-v2-evm/repository.js";
import { advanceCircle, circleEnvelope, sealCircle, validateCircle, type CircleOperationV1, type CircleEffect, type CircleRole } from "../../src/circle-v2-evm/operation-model.js";
import { approveCircleSource, approveCircleMint, executeCircleEffect, observeCircle, cleanupCircle, type CircleLifecyclePorts } from "../../src/circle-v2-evm/lifecycle.js";
import { CIRCLE_SOURCE_OWNER, CIRCLE_SOURCE_TOKEN, CIRCLE_MESSENGER, CIRCLE_TRANSMITTER, CIRCLE_RECIPIENT, circleRoute } from "../../src/circle-v2-evm/catalog.js";
import { decodeCircleSource, bindCircleAttestation, decodeCircleDestination, encodeCircleApproval, encodeCircleBurn, encodeCircleMint, circleWord, circleHex } from "../../src/circle-v2-evm/protocol.js";
import { OperationService } from "../../src/operation-service.js";
import { storedOperationDomains } from "../../src/operation-conflict-domain.js";
import { source, iris, snapshot, event, observation } from "./circle-v2-evm-runtime-fixtures.js";
const at = Date.parse("2026-10-09T01:00:00.000Z"), route = circleRoute(143), tx = `0x${"11".repeat(32)}` as Hex;
function initial(root = join(tmpdir(), "circle-fixture"), chain: 143 | 1329 | 59144 = 143): CircleOperationV1 {
  const selected = circleRoute(chain);
  const state = new StateStore(root), profileHash = state.profileHash("evm-live-buyer"), destinationProfileHash = state.profileHash(selected.gasPayerProfile);
  const custody = (profileHash: string, walletAddress: typeof CIRCLE_SOURCE_OWNER) => ({ schemaVersion: "apn.evm-native-custody.v1" as const, profileHash, walletAddress, walletBindingHash: "a".repeat(64), walletCreatedAt: new Date(at).toISOString(), providerId: "local" as const, providerAccountBindingHash: "a".repeat(64), providerCapabilityHash: "b".repeat(64), providerRevision: 1 });
  const envelope = (role: "approval" | "burn") => circleEnvelope({ chainId: 42161, from: CIRCLE_SOURCE_OWNER, to: role === "approval" ? CIRCLE_SOURCE_TOKEN : CIRCLE_MESSENGER, data: role === "approval" ? encodeCircleApproval() : encodeCircleBurn(chain), valueAtomic: "0", nonceAtomic: role === "approval" ? "1" : "2", gasLimitAtomic: role === "approval" ? "65536" : "500000", maxFeePerGasAtomic: "20000000", maxPriorityFeePerGasAtomic: "0" });
  const effects = (["approval", "burn"] as const).map(role => ({ role, phase: "prepared" as const, envelope: envelope(role), transactionHash: null, materialHash: null, proof: null }));
  const body = sealCircle({ schemaVersion: "apn.circle-v2-evm-operation.v1", operationId: "1".repeat(64), profile: "evm-live-buyer", profileHash, destinationProfile: selected.gasPayerProfile, destinationProfileHash, idempotencyHash: "2".repeat(64), requestHash: "3".repeat(64), fingerprint: "4".repeat(64), destinationChain: chain,
    sourceCustody: custody(profileHash, CIRCLE_SOURCE_OWNER), destinationCustody: custody(destinationProfileHash, selected.gasPayer), policies: [{ profile: "evm-live-buyer", profileHash, policyDigest: "5".repeat(64), revision: 1 }, { profile: selected.gasPayerProfile, profileHash: destinationProfileHash, policyDigest: selected.gasPayerProfile === "evm-live-buyer" ? "5".repeat(64) : "6".repeat(64), revision: 1 }].filter((p, i, all) => all.findIndex(x => x.profileHash === p.profileHash) === i),
    preparedAt: new Date(at).toISOString(), expiresAt: new Date(at + 600_000).toISOString(), deploymentDigest: "7".repeat(64), feeQuoteAtomic: "6", state: "awaiting_source", terminal: false, effects, source: null, attestation: null, destination: null, residualAllowanceAtomic: "0", usage: [], usageFinalized: false, transitions: [] });
  return advanceCircle(body, {}, "prepared", at);
}
function usage(op: CircleOperationV1, target: "reserved" | "unknown_finality" | "finalized" = "reserved") {
  const route = circleRoute(op.destinationChain);
  return ["usdc", "approval-native", "burn-native", "cleanup-native", "mint-native"].map((key, i) => {
    const identity = { account: i === 4 ? route.gasPayer : CIRCLE_SOURCE_OWNER, chain: i === 4 ? `eip155:${op.destinationChain}` : "eip155:42161", asset: i === 0 ? { kind: "token" as const, identifier: CIRCLE_SOURCE_TOKEN } : { kind: "native" as const, identifier: null } }, idempotencyHash = idempotency(`${op.operationId}:${key}`);
    return sealUsage({ schemaVersion: "apn.asset-usage-reservation.v1", reservationId: reservationIdFor(identity, idempotencyHash), idempotencyHash, policyDigest: op.policies.find(p => p.profileHash === (i === 4 ? op.destinationProfileHash : op.profileHash))!.policyDigest, registryVersion: "circle-fixture", ...identity, rail: "bridge", amountAtomic: i === 0 ? "40100" : i === 4 ? route.destinationNativeCap : i === 3 ? "15000000000000" : "30000000000000", state: target,
      reservedAt: new Date(at).toISOString(), updatedAt: new Date(at).toISOString(), effectAt: target === "finalized" ? new Date(at).toISOString() : null, outcomeDigest: target === "finalized" ? "8".repeat(64) : null });
  });
}
export async function sourceReady(finalized = false, chain: 143 | 1329 | 59144 = 143) {
  let op = initial(undefined, chain); op = advanceCircle(op, { usage: usage(op, "unknown_finality") }, "reserved", at);
  const raw = source(chain), proof = decodeCircleSource(finalized ? { ...raw, finalityTag: "finalized" } : raw, chain), attestation = await bindCircleAttestation(proof, await iris(proof), snapshot(chain));
  op = advanceCircle(op, { source: proof, attestation, effects: op.effects.map(e => ({ ...e, phase: "confirmed", transactionHash: tx, materialHash: "9".repeat(64), proof })), state: "awaiting_mint" }, "source_confirmed", at);
  return op;
}
