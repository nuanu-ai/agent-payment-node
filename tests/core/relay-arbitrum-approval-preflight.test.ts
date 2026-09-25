import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import { sealAssetPolicyRegistry } from "../../src/asset-policy-registry.js";
import { EvmDirectRpcGuard } from "../../src/evm-direct-rpc-guard.js";
import { ApnError } from "../../src/errors.js";
import { RelayUnsignedOperationRepository } from "../../src/relay-unsigned-operation.js";
import { RelayArbitrumApprovalPreflightReader, preflightRelayArbitrumApproval } from
  "../../src/relay/arbitrum-approval-preflight.js";
import { RELAY_ARBITRUM_USDC } from "../../src/relay/arbitrum-usdc-ethereum-quote.js";
import { RELAY_ARBITRUM_SOURCE_DRAFT_REFERENCE } from "../../src/relay/arbitrum-usdc-source-draft.js";
import { RelayUnsignedPrepareService } from "../../src/relay/prepare.js";
import { StateStore } from "../../src/state.js";
import { temporaryState } from "./helpers.js";

const owner = "0x0B4Dd0C3dA001Fa146EEd3f80B01860BEF6B8a14";
const now = new Date(1790347296 * 1000);
const blockHash = `0x${"12".repeat(32)}`;
const head = { number: "0x100", hash: blockHash, baseFeePerGas: "0x1" };
const word = (value: bigint) => `0x${value.toString(16).padStart(64, "0")}`;
const quoteFile = resolve("tests/core/relay-fixtures/arbitrum-usdc-ethereum-usdc-quote-20260925.json");

function active() {
  const registry = sealAssetPolicyRegistry({ schemaVersion: "apn.asset-policy-registry.v2",
    registryVersion: "test.relay.arb.approval.1", publishedAt: "2026-09-25T00:00:00.000Z",
    effectiveDate: "2026-09-25", effectiveAt: "2026-09-25T00:00:00.000Z",
    expiresAt: "2026-10-03T00:00:00.000Z", chains: [{ chain: "eip155:42161", family: "evm",
      name: "Arbitrum One", assets: [{ kind: "token", identifier: RELAY_ARBITRUM_USDC, symbol: "USDC", decimals: 6,
        rails: { direct: false, gasless: false, x402: false, bridge: true, swap: false },
        railCaps: { bridge: { maximumPerTransferAtomic: "1000000", dailyLimitAtomic: "2000000" } },
        mechanismPins: { bridge: { provider: "relay", reference: RELAY_ARBITRUM_SOURCE_DRAFT_REFERENCE } } }] }] });
  return { profile: "default", registry, digest: registry.policyDigest, revision: 1,
    accounts: { evm: owner }, activationDigest: "a".repeat(64), activatedAt: now.toISOString() };
}

async function prepared() {
  const temporary = await temporaryState();
  const state = new StateStore(temporary.root);
  const service = new RelayUnsignedPrepareService(state, { now: () => now }, undefined,
    { activePolicy: async () => active(), dailyUsage: async () => "0" });
  const saved = await service.prepareArbitrum({ profile: "default", owner, amountAtomic: "500000",
    minOutputAtomic: "94065", maxProviderFeeAtomic: "401482", maxApprovalNetworkFeeWei: "2000000000000",
    maxDepositNetworkFeeWei: "2000000000000", quoteFile, idempotencyKey: "relay-arb-approval-preflight" });
  const operation = await new RelayUnsignedOperationRepository(temporary.root).loadOperation(
    state.profileHash("default"), saved.operationId);
  assert.ok(operation);
  return { temporary, state, operation };
}

function rows(allowance = 0n, baseFee = "0x1", pendingNonce = "0x7") {
  return [["0xa4b1", head], [head, "0x3a352944000", word(500_000n), word(allowance)],
    ["0xa4b1", { ...head, baseFeePerGas: baseFee }, "0x7", pendingNonce]] as const;
}

test("saved operation approval preflight pins balance, allowance, nonce and fee without admitting execution", async t => {
  const { temporary, operation } = await prepared(); t.after(temporary.cleanup);
  let index = 0;
  const result = await preflightRelayArbitrumApproval(operation, active(), owner, "0", now, {
    now: () => now, batch: async calls => {
      const current = index++;
      if (current === 2) {
        assert.deepEqual(calls.map(c => c.method), ["eth_chainId", "eth_getBlockByNumber",
          "eth_getTransactionCount", "eth_getTransactionCount"]);
        assert.deepEqual(calls[1]!.params, ["0x100", false]);
        assert.deepEqual(calls[2]!.params, [owner.toLowerCase(), { blockHash, requireCanonical: true }]);
        assert.deepEqual(calls[3]!.params, [owner.toLowerCase(), "pending"]);
      }
      return rows()[current]!;
    },
  });
  assert.equal(index, 3);
  assert.equal(result.readOnlyConditionsSatisfied, true);
  assert.equal(result.confirmedNonce, "7");
  assert.equal(result.approvalRequired, true);
  assert.equal(result.executionAdmitted, false);
  assert.deepEqual(result.nextActions, []);
  assert.ok(Object.isFrozen(result) && Object.isFrozen(result.reasons));
});

test("sufficient allowance only produces a read-only skip candidate", async t => {
  const { temporary, operation } = await prepared(); t.after(temporary.cleanup);
  let index = 0;
  const result = await preflightRelayArbitrumApproval(operation, active(), owner, "0", now,
    { now: () => now, batch: async () => rows(500_000n)[index++]! });
  assert.equal(result.approvalRequired, false);
  assert.equal(result.requiredNativeWei, operation.arbitrumDraft!.maxDepositNetworkFeeWei);
  assert.equal(result.readOnlyConditionsSatisfied, true);
  assert.equal(result.executionAdmitted, false);
});

test("third batch rejects reorg, malformed nonce and fee; pending conflict and fee drift stay blocked", async t => {
  const { temporary, operation } = await prepared(); t.after(temporary.cleanup);
  for (const [name, third, code] of [
    ["reorg", ["0xa4b1", { ...head, hash: `0x${"34".repeat(32)}` }, "0x7", "0x7"], "APN_OPERATION_BLOCKED"],
    ["nonce error", ["0xa4b1", head, { error: { code: -32000 } }, "0x7"], "APN_RPC_PROTOCOL"],
    ["base fee error", ["0xa4b1", { ...head, baseFeePerGas: null }, "0x7", "0x7"], "APN_RPC_PROTOCOL"],
  ] as const) {
    let index = 0;
    await assert.rejects(preflightRelayArbitrumApproval(operation, active(), owner, "0", now,
      { now: () => now, batch: async () => index++ < 2 ? rows()[index - 1]! : third }), { code }, name);
    assert.equal(index, 3);
  }
  for (const [third, reason] of [
    [["0xa4b1", head, "0x7", "0x8"], "pending_nonce_conflict"],
    [["0xa4b1", { ...head, baseFeePerGas: "0x174876e800" }, "0x7", "0x7"], "approval_base_fee_exceeds_quote"],
  ] as const) {
    let index = 0;
    const result = await preflightRelayArbitrumApproval(operation, active(), owner, "0", now,
      { now: () => now, batch: async () => index++ < 2 ? rows()[index - 1]! : third });
    assert.equal(result.readOnlyConditionsSatisfied, false);
    assert.deepEqual(result.reasons, [reason]);
  }
});

test("saved operation and active policy drift stop before RPC or before returning evidence", async t => {
  const { temporary, operation } = await prepared(); t.after(temporary.cleanup);
  let batches = 0;
  const ports = { now: () => now, batch: async () => { batches++; throw new Error("RPC must not be reached"); } };
  await assert.rejects(preflightRelayArbitrumApproval({ ...operation, operationId: "a".repeat(64) },
    active(), owner, "0", now, ports), { code: "APN_STATE_CORRUPT" });
  await assert.rejects(preflightRelayArbitrumApproval(operation, { ...active(), revision: 2 },
    owner, "0", now, ports), { code: "APN_OPERATION_BLOCKED" });
  assert.equal(batches, 0);
  const current = active();
  let index = 0;
  await assert.rejects(preflightRelayArbitrumApproval(operation, current, owner, "0", now,
    { now: () => { current.revision = 2; return now; }, batch: async () => rows()[index++]! }),
  { code: "APN_OPERATION_BLOCKED", details: { reason: "expired_or_policy_changed_during_read" } });
  assert.equal(index, 3);
});

test("guarded reader uses three physical POSTs and treats 429 as terminal", async t => {
  const { temporary, state, operation } = await prepared(); t.after(temporary.cleanup);
  let index = 0;
  let tick = 1000;
  const guard = new EvmDirectRpcGuard(state, 24, () => tick, async milliseconds => { tick += milliseconds; });
  const reader = new RelayArbitrumApprovalPreflightReader("https://arb-rpc.example", state,
    { batchCall: async () => rows()[index++]! }, () => guard, async () => {});
  const result = await reader.read(operation, active(), owner, "0", now, () => now);
  assert.equal(result.readOnlyConditionsSatisfied, true);
  assert.equal(guard.physicalRequests, 3);
  assert.equal(index, 3);
  const rateLimited = new RelayArbitrumApprovalPreflightReader("https://arb-rpc-429.example", state,
    { batchCall: async () => { throw new ApnError("APN_RPC_RATE_LIMITED", "rate limit", { httpStatus: 429 }); } },
    () => new EvmDirectRpcGuard(state, 24, () => 3000, async () => {}), async () => {});
  await assert.rejects(rateLimited.read(operation, active(), owner, "0", now, () => now),
    { code: "APN_RPC_RATE_LIMITED" });
});
