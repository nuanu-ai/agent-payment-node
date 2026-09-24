import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { sealAssetPolicyRegistry } from "../../src/asset-policy-registry.js";
import { OperationService } from "../../src/operation-service.js";
import { RelayUnsignedPrepareService, RELAY_ROUTE_REFERENCE } from "../../src/relay/prepare.js";
import { RelayReadOnlyPreflightService, type RelayReadCall } from "../../src/relay/preflight.js";
import { validateRelayQuote } from "../../src/relay/quote.js";
import { StateStore } from "../../src/state.js";
import { bindArgv } from "../../src/command-binder.js";
import { temporaryState } from "./helpers.js";

const payer = "0x0B4Dd0C3dA001Fa146EEd3f80B01860BEF6B8a14";
const recipient = "0x823A3a5BaB1186141b32fC65F8E25Ca24c679Ce7";
const instant = new Date(1790800000 * 1000);
const input = { profile: "default", recipient, amountAtomic: "2500000", minOutputAtomic: "3000000000000000",
  maxApprovalNetworkFeeWei: "30000000000000", maxDepositNetworkFeeWei: "30000000000000", idempotencyKey: "relay-preflight-0001" };
const word = (value: bigint) => `0x${value.toString(16).padStart(64, "0")}`;
const fixture = async (): Promise<unknown> => JSON.parse(await readFile("tests/core/relay-fixtures/ethereum-usdc-bnb-quote-20260925.json", "utf8"));
function policy(expiresAt = "2026-10-02T00:00:00.000Z") {
  const registry = sealAssetPolicyRegistry({ schemaVersion: "apn.asset-policy-registry.v2", registryVersion: "test.1",
    publishedAt: "2026-09-29T00:00:00.000Z", effectiveDate: "2026-09-29", effectiveAt: "2026-09-29T00:00:00.000Z",
    expiresAt, chains: [{ chain: "eip155:1", family: "evm", name: "Ethereum", assets: [{ kind: "token",
      identifier: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", symbol: "USDC", decimals: 6,
      rails: { direct: false, gasless: false, x402: false, bridge: true, swap: false },
      railCaps: { bridge: { maximumPerTransferAtomic: "3000000", dailyLimitAtomic: "5000000" } },
      mechanismPins: { bridge: { provider: "relay", reference: RELAY_ROUTE_REFERENCE } } }] }] });
  return { profile: "default", registry, digest: registry.policyDigest, revision: 1, accounts: { evm: payer },
    activationDigest: "a".repeat(64), activatedAt: "2026-09-30T00:00:00.000Z" };
}

async function setup(t: { after: (fn: () => Promise<void>) => void }) {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const state = new StateStore(temporary.root);
  const prepared = await new RelayUnsignedPrepareService(state, { now: () => instant }, undefined, {
    activePolicy: async () => policy(), publicAccount: async () => payer, dailyUsage: async () => "0",
    quote: async intent => validateRelayQuote(await fixture(), intent),
  }).prepare(input);
  assert.equal((await new OperationService(state).required(prepared.operationId)).kind, "relay_unsigned");
  return { state, prepared };
}

test("Relay preflight reports balances, fee sum and approval_required from one read-only batch", async t => {
  const { state, prepared } = await setup(t);
  const requiredNative = BigInt(prepared.approvalNetworkFeeCeilingWei!) + BigInt(prepared.depositNetworkFeeCeilingWei!);
  let batches = 0;
  const service = new RelayReadOnlyPreflightService(state, { now: () => instant }, {
    activePolicy: async () => policy(), publicAccount: async () => payer, dailyUsage: async () => "0",
    batch: async (calls: readonly RelayReadCall[]) => {
      batches++;
      assert.deepEqual(calls.map(call => call.method), ["eth_chainId", "eth_getBlockByNumber", "eth_getBalance", "eth_call", "eth_call"]);
      assert.equal((calls[4]!.params[0] as { data: string }).data.slice(0, 10), "0xdd62ed3e");
      return ["0x1", { number: "0x10", hash: `0x${"1".repeat(64)}` }, `0x${requiredNative.toString(16)}`,
        word(2_500_000n), word(0n)];
    },
  });
  const result = await service.preflight({ profile: "default", operationId: prepared.operationId });
  assert.equal(batches, 1); assert.equal(result.executionAdmitted, false);
  assert.equal(result.fundingObserved, true); assert.equal(result.approvalRequired, true);
  assert.equal(result.requiredNativeWei, requiredNative.toString());
  assert.deepEqual(result.fundingReasons, []);
  assert.deepEqual(bindArgv(["relay", "preflight", "--profile", "default", "--operation", prepared.operationId,
    "--rpc-url", "https://example.org"]).request, { command: "relay.preflight", profile: "default", operationId: prepared.operationId });
});

test("Relay preflight classifies insufficient USDC, native funds, and allowance independently", async t => {
  const { state, prepared } = await setup(t);
  const service = new RelayReadOnlyPreflightService(state, { now: () => instant }, {
    activePolicy: async () => policy(), publicAccount: async () => payer, dailyUsage: async () => "0",
    batch: async () => ["0x1", { number: "0x10", hash: `0x${"1".repeat(64)}` }, "0x0", word(1n), word(0n)],
  });
  const result = await service.preflight({ profile: "default", operationId: prepared.operationId });
  assert.equal(result.approvalRequired, true); assert.equal(result.fundingObserved, false);
  assert.deepEqual(result.fundingReasons, ["insufficient_usdc_balance", "insufficient_native_fee_balance"]);
});

test("Relay preflight fails closed on wrong chain, malformed batch, expired quote and policy before RPC", async t => {
  const { state, prepared } = await setup(t);
  let batches = 0;
  const ports = { activePolicy: async () => policy(), publicAccount: async () => payer, dailyUsage: async () => "0",
    batch: async () => { batches++; return ["0x38", { number: "0x10" }, "0x1", word(3_000_000n), word(3_000_000n)]; } };
  await assert.rejects(new RelayReadOnlyPreflightService(state, { now: () => instant }, ports)
    .preflight({ profile: "default", operationId: prepared.operationId }), { code: "APN_OPERATION_BLOCKED" });
  assert.equal(batches, 1);
  await assert.rejects(new RelayReadOnlyPreflightService(state, { now: () => new Date(prepared.deadline) }, ports)
    .preflight({ profile: "default", operationId: prepared.operationId }), { code: "APN_OPERATION_BLOCKED" });
  await assert.rejects(new RelayReadOnlyPreflightService(state, { now: () => instant }, {
    ...ports, activePolicy: async () => policy("2026-09-30T00:00:00.000Z"),
  }).preflight({ profile: "default", operationId: prepared.operationId }), { code: "APN_OPERATION_BLOCKED" });
  assert.equal(batches, 1);
  await assert.rejects(new RelayReadOnlyPreflightService(state, { now: () => instant }, {
    ...ports, batch: async () => { batches++; return ["0x1"]; },
  }).preflight({ profile: "default", operationId: prepared.operationId }), { code: "APN_RPC_PROTOCOL" });
  assert.equal(batches, 2);
});
