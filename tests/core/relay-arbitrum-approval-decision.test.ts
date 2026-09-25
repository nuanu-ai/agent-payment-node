import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { sealAssetPolicyRegistry } from "../../src/asset-policy-registry.js";
import { bindArgv } from "../../src/command-binder.js";
import { EvmDirectRpcGuard } from "../../src/evm-direct-rpc-guard.js";
import { ApnError } from "../../src/errors.js";
import { RelayUnsignedOperationRepository } from "../../src/relay-unsigned-operation.js";
import { RelayArbitrumApprovalDecisionService } from "../../src/relay/arbitrum-approval-decision.js";
import { RelayArbitrumApprovalPreflightReader } from "../../src/relay/arbitrum-approval-preflight.js";
import { ArbitrumSourceEffectJournalRepository } from "../../src/relay/arbitrum-source-effect-journal.js";
import { RELAY_ARBITRUM_USDC } from "../../src/relay/arbitrum-usdc-ethereum-quote.js";
import { RELAY_ARBITRUM_SOURCE_DRAFT_REFERENCE } from "../../src/relay/arbitrum-usdc-source-draft.js";
import { RelayUnsignedPrepareService } from "../../src/relay/prepare.js";
import { createApnCore } from "../../src/runtime-factory.js";
import { StateStore } from "../../src/state.js";
import { temporaryState } from "./helpers.js";

const owner = "0x0B4Dd0C3dA001Fa146EEd3f80B01860BEF6B8a14";
const now = new Date(1790347296 * 1000);
const blockHash = `0x${"12".repeat(32)}`;
const head = { number: "0x100", hash: blockHash, baseFeePerGas: "0x1" };
const word = (value: bigint) => `0x${value.toString(16).padStart(64, "0")}`;
const quoteFile = resolve("tests/core/relay-fixtures/arbitrum-usdc-ethereum-usdc-quote-20260925.json");
function active(revision = 1) {
  const registry = sealAssetPolicyRegistry({ schemaVersion: "apn.asset-policy-registry.v2",
    registryVersion: "test.relay.arb.decision.1", publishedAt: "2026-09-25T00:00:00.000Z",
    effectiveDate: "2026-09-25", effectiveAt: "2026-09-25T00:00:00.000Z",
    expiresAt: "2026-10-03T00:00:00.000Z", chains: [{ chain: "eip155:42161", family: "evm",
      name: "Arbitrum One", assets: [{ kind: "token", identifier: RELAY_ARBITRUM_USDC, symbol: "USDC", decimals: 6,
        rails: { direct: false, gasless: false, x402: false, bridge: true, swap: false },
        railCaps: { bridge: { maximumPerTransferAtomic: "1000000", dailyLimitAtomic: "2000000" } },
        mechanismPins: { bridge: { provider: "relay", reference: RELAY_ARBITRUM_SOURCE_DRAFT_REFERENCE } } }] }] });
  return { profile: "default", registry, digest: registry.policyDigest, revision,
    accounts: { evm: owner }, activationDigest: "a".repeat(64), activatedAt: now.toISOString() };
}
async function prepared() {
  const temporary = await temporaryState();
  const state = new StateStore(temporary.root);
  const service = new RelayUnsignedPrepareService(state, { now: () => now }, undefined,
    { activePolicy: async () => active(), dailyUsage: async () => "0" });
  const saved = await service.prepareArbitrum({ profile: "default", owner, amountAtomic: "500000",
    minOutputAtomic: "94065", maxProviderFeeAtomic: "401482", maxApprovalNetworkFeeWei: "2000000000000",
    maxDepositNetworkFeeWei: "2000000000000", quoteFile, idempotencyKey: "relay-arb-approval-decision" });
  const operation = await new RelayUnsignedOperationRepository(temporary.root).loadOperation(
    state.profileHash("default"), saved.operationId);
  assert.ok(operation);
  return { temporary, state, operation };
}
function responses(allowance: bigint, hash = blockHash) {
  const canonical = { ...head, hash };
  return [["0xa4b1", head], [canonical, "0x3a352944000", word(500_000n), word(allowance)],
    ["0xa4b1", canonical, "0x7", "0x7"]] as const;
}
let providerTick = 1000;
function service(state: StateStore, allowances: readonly bigint[], options: {
  readonly secondHash?: string; readonly policyRevision?: number; readonly onBatch?: (index: number) => void;
  readonly rateLimitAt?: number;
} = {}) {
  let calls = 0;
  const starts: number[] = [];
  const guard = new EvmDirectRpcGuard(state, 24, () => providerTick,
    async milliseconds => { providerTick += milliseconds; });
  const reader = new RelayArbitrumApprovalPreflightReader("https://arb-rpc.example", state,
    { batchCall: async batch => {
      const index = calls++;
      starts.push(providerTick);
      options.onBatch?.(index);
      if (options.rateLimitAt === index)
        throw new ApnError("APN_RPC_RATE_LIMITED", "429", { httpStatus: 429 });
      if (index % 3 === 2) {
        assert.deepEqual(batch[2]!.params[1], { blockHash: index >= 3 && options.secondHash ? options.secondHash : blockHash,
          requireCanonical: true });
      }
      return responses(allowances[Math.floor(index / 3)]!, index >= 3 && options.secondHash ? options.secondHash : blockHash)[index % 3]!;
    } }, () => guard, async () => {});
  const decision = new RelayArbitrumApprovalDecisionService(state, reader,
    { activePolicy: async () => active(options.policyRevision), dailyUsage: async () => "0", now: () => now });
  return { decision, calls: () => calls, starts, guard };
}

test("saved operation command persists only a fresh canonical skip, with six guarded POSTs", async t => {
  const { temporary, state, operation } = await prepared(); t.after(temporary.cleanup);
  const { decision, calls, starts, guard } = service(state, [500_000n, 500_000n]);
  const bound = bindArgv(["relay", "arbitrum", "approval-check", "--profile", "default",
    "--operation", operation.operationId, "--rpc-url", "https://arb-rpc.example"]);
  assert.deepEqual(bound.request, { command: "relay.arbitrum.approval-check", profile: "default",
    operationId: operation.operationId });
  const result = await decision.decide("default", operation.operationId);
  assert.equal(result.state, "approval_skipped");
  assert.equal(result.executionAdmitted, false);
  assert.deepEqual(result.nextActions, []);
  assert.equal(calls(), 6);
  assert.equal(guard.physicalRequests, 6);
  assert.ok(starts.slice(1).every((start, index) => start - starts[index]! >= 750));
  const j = await new ArbitrumSourceEffectJournalRepository(temporary.root).load(operation.profileHash, operation.operationId);
  assert.equal(j?.effects[0].phase, "approval_skipped");
  assert.equal(j.effects[0].skipProof?.allowanceAtomic, "500000");
  assert.equal(j.effects[1].phase, "pending");
  await assert.rejects(decision.decide("default", operation.operationId), { code: "APN_OPERATION_BLOCKED" });
  assert.equal(calls(), 6);
});

test("production locked policy read returns without recursively acquiring its profile lock", async t => {
  const { temporary, operation } = await prepared(); t.after(temporary.cleanup);
  const repository = new ArbitrumSourceEffectJournalRepository(temporary.root, undefined, undefined, () => now);
  await assert.rejects(repository.skipApprovalIfVerified(operation.profileHash, operation.operationId, null,
    async () => { throw new Error("verifier must not run without active policy"); }),
  { code: "APN_OPERATION_BLOCKED", details: { reason: "active_owner_policy_required" } });
  assert.equal(await repository.load(operation.profileHash, operation.operationId), null);
});

test("insufficient allowance and allowance drop return required without journal mutation", async t => {
  const { temporary, state, operation } = await prepared(); t.after(temporary.cleanup);
  for (const allowances of [[499_999n], [500_000n, 499_999n]]) {
    const { decision, calls } = service(state, allowances);
    const result = await decision.decide("default", operation.operationId);
    assert.equal(result.state, "approval_required");
    assert.equal(calls(), allowances.length * 3);
    assert.equal(await new ArbitrumSourceEffectJournalRepository(temporary.root).load(
      operation.profileHash, operation.operationId), null);
  }
});

test("reorg, stale policy, 429, forged saved operation and cross-profile access fail closed", async t => {
  const { temporary, state, operation } = await prepared(); t.after(temporary.cleanup);
  const wrong = service(state, [500_000n, 500_000n], { secondHash: `0x${"34".repeat(32)}` });
  await assert.rejects(wrong.decision.decide("default", operation.operationId), { code: "APN_OPERATION_BLOCKED" });
  assert.equal(await new ArbitrumSourceEffectJournalRepository(temporary.root).load(
    operation.profileHash, operation.operationId), null);
  const stale = service(state, [500_000n, 500_000n], { policyRevision: 2 });
  await assert.rejects(stale.decision.decide("default", operation.operationId), { code: "APN_OPERATION_BLOCKED" });
  assert.equal(stale.calls(), 0);
  const limited = service(state, [500_000n], { rateLimitAt: 1 });
  await assert.rejects(limited.decision.decide("default", operation.operationId), { code: "APN_RPC_RATE_LIMITED" });
  assert.equal(limited.calls(), 2);
  await assert.rejects(service(state, [500_000n]).decision.decide("other", operation.operationId),
    { code: "APN_INVALID_INPUT" });
  const path = join(temporary.root, "relay-unsigned-operations", operation.profileHash, `${operation.operationId}.json`);
  const saved = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  await writeFile(path, JSON.stringify({ ...saved, amountAtomic: "1" }), { mode: 0o600 });
  const forged = service(state, [500_000n]);
  await assert.rejects(forged.decision.decide("default", operation.operationId), { code: "APN_STATE_CORRUPT" });
  assert.equal(forged.calls(), 0);
});

test("installed command leaves signing and sending unavailable", async t => {
  const { temporary, operation } = await prepared(); t.after(temporary.cleanup);
  const bound = bindArgv(["relay", "arbitrum", "approval-check", "--profile", "default",
    "--operation", operation.operationId, "--rpc-url", "https://arb-rpc.example"]);
  const core = createApnCore(bound, { stateRoot: temporary.root,
    relayArbitrumApprovalDecision: service(new StateStore(temporary.root), [0n]).decision });
  const result = await core.execute(bound.request);
  assert.equal(result.ok, true);
  assert.equal((result.data as { state: string }).state, "approval_required");
  assert.equal(await new ArbitrumSourceEffectJournalRepository(temporary.root).load(
    operation.profileHash, operation.operationId), null);
});
