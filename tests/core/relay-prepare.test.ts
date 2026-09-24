import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { sealAssetPolicyRegistry } from "../../src/asset-policy-registry.js";
import { OperationService } from "../../src/operation-service.js";
import { RelayUnsignedPrepareService, RELAY_ROUTE_REFERENCE } from "../../src/relay/prepare.js";
import { validateRelayQuote } from "../../src/relay/quote.js";
import { StateStore } from "../../src/state.js";
import { bindArgv } from "../../src/command-binder.js";
import { temporaryState } from "./helpers.js";

const payer = "0x0B4Dd0C3dA001Fa146EEd3f80B01860BEF6B8a14";
const recipient = "0x823A3a5BaB1186141b32fC65F8E25Ca24c679Ce7";
const instant = new Date(1790800000 * 1000);
const input = { profile: "default", recipient, amountAtomic: "2500000", minOutputAtomic: "3000000000000000",
  maxApprovalNetworkFeeWei: "30000000000000", maxDepositNetworkFeeWei: "30000000000000", idempotencyKey: "relay-prepare-0001" };
const quoteFixture = async (): Promise<unknown> => JSON.parse(await readFile("tests/core/relay-fixtures/ethereum-usdc-bnb-quote-20260925.json", "utf8"));
function policy(reference = RELAY_ROUTE_REFERENCE, expiresAt = "2026-10-02T00:00:00.000Z") {
  const registry = sealAssetPolicyRegistry({ schemaVersion: "apn.asset-policy-registry.v2", registryVersion: "test.1",
    publishedAt: "2026-09-29T00:00:00.000Z", effectiveDate: "2026-09-29", effectiveAt: "2026-09-29T00:00:00.000Z",
    expiresAt, chains: [{ chain: "eip155:1", family: "evm", name: "Ethereum", assets: [{ kind: "token",
      identifier: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", symbol: "USDC", decimals: 6,
      rails: { direct: false, gasless: false, x402: false, bridge: true, swap: false },
      railCaps: { bridge: { maximumPerTransferAtomic: "3000000", dailyLimitAtomic: "5000000" } },
      mechanismPins: { bridge: { provider: "relay", reference } } }] }] });
  return { profile: "default", registry, digest: registry.policyDigest, revision: 1, accounts: { evm: payer },
    activationDigest: "a".repeat(64), activatedAt: "2026-09-30T00:00:00.000Z" };
}

test("Relay prepare freezes one validated quote, replays without another quote, and survives restart", async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const state = new StateStore(temporary.root);
  let calls = 0;
  const service = new RelayUnsignedPrepareService(state, { now: () => instant }, undefined, {
    activePolicy: async () => policy(), publicAccount: async () => payer, dailyUsage: async () => "0",
    quote: async intent => { calls++; return await validateRelayQuote(await quoteFixture(), intent); },
  });
  const first = await service.prepare(input);
  assert.equal(first.state, "prepared"); assert.equal(first.executionAdmitted, false);
  assert.equal(first.quote?.approval.chainId, 1); assert.equal(first.policyDigest, policy().digest);
  assert.equal(first.approvalNetworkFeeCeilingWei, first.quote?.approval.maximumNetworkFeeWei);
  assert.deepEqual(await service.prepare(input), first); assert.equal(calls, 1);
  const reopened = new OperationService(new StateStore(temporary.root));
  assert.deepEqual(await reopened.status(first.operationId), first);
  await assert.rejects(service.prepare({ ...input, recipient: payer }), { code: "APN_IDEMPOTENCY_CONFLICT" });
  await assert.rejects(service.prepare({ ...input, idempotencyKey: "relay-prepare-0002" }), { code: "APN_OPERATION_BLOCKED" });
  assert.equal(calls, 1);
});

test("Relay prepare uses the checksummed owner for ledger usage before quoting and replays without quoting", async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const state = new StateStore(temporary.root);
  let quotes = 0;
  const service = new RelayUnsignedPrepareService(state, { now: () => instant }, undefined, {
    activePolicy: async () => policy(), publicAccount: async () => payer,
    quote: async intent => { quotes++; return validateRelayQuote(await quoteFixture(), intent); },
  });
  const first = await service.prepare(input);
  assert.equal(first.sourceAccount, payer.toLowerCase());
  assert.equal(quotes, 1);
  assert.deepEqual(await service.prepare(input), first);
  assert.equal(quotes, 1);
});

test("Relay prepare refuses a noncanonical policy owner before the quote", async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  let quotes = 0;
  const service = new RelayUnsignedPrepareService(new StateStore(temporary.root), { now: () => instant }, undefined, {
    activePolicy: async () => ({ ...policy(), accounts: { evm: payer.toLowerCase() } }),
    publicAccount: async () => payer,
    quote: async intent => { quotes++; return validateRelayQuote(await quoteFixture(), intent); },
  });
  await assert.rejects(service.prepare(input), { code: "APN_INVALID_INPUT" });
  assert.equal(quotes, 0);
});

test("Relay policy and fee caps refuse before or after exactly one quote", async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const state = new StateStore(temporary.root);
  let calls = 0;
  const run = (active: ReturnType<typeof policy> | null) => new RelayUnsignedPrepareService(state, { now: () => instant }, undefined, {
    activePolicy: async () => active, publicAccount: async () => payer, dailyUsage: async () => "0",
    quote: async intent => { calls++; return await validateRelayQuote(await quoteFixture(), intent); },
  });
  await assert.rejects(run(null).prepare(input), { code: "APN_ALLOWLIST_REFUSED" });
  await assert.rejects(run(policy("wrong-route")).prepare(input), { code: "APN_ALLOWLIST_REFUSED" });
  await assert.rejects(new RelayUnsignedPrepareService(state, { now: () => instant }, undefined, {
    activePolicy: async () => policy(), publicAccount: async () => recipient, dailyUsage: async () => "0",
    quote: async () => { calls++; throw new Error("quote must not run"); },
  }).prepare(input), { code: "APN_ALLOWLIST_REFUSED" });
  await assert.rejects(run(policy(RELAY_ROUTE_REFERENCE, "2026-09-30T00:00:00.000Z")).prepare(input), { code: "APN_ALLOWLIST_REFUSED" });
  await assert.rejects(run(policy()).prepare({ ...input, amountAtomic: "3000001" }), { code: "APN_OPERATION_BLOCKED" });
  assert.equal(calls, 0);
  await assert.rejects(run(policy()).prepare({ ...input, maxApprovalNetworkFeeWei: "1" }), { code: "APN_OPERATION_BLOCKED" });
  assert.equal(calls, 1);
  await assert.rejects(new OperationService(state).required(state.operationId("default", input.idempotencyKey)), { code: "APN_OPERATION_NOT_FOUND" });
});

test("Relay rejects changed quote digest and CLI binds the finite prepare inputs", async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const state = new StateStore(temporary.root);
  const bound = bindArgv(["relay", "prepare", "--profile", "default", "--recipient", recipient,
    "--amount-atomic", input.amountAtomic, "--min-output-atomic", input.minOutputAtomic,
    "--max-approval-network-fee-wei", input.maxApprovalNetworkFeeWei,
    "--max-deposit-network-fee-wei", input.maxDepositNetworkFeeWei, "--idempotency-key", input.idempotencyKey]);
  assert.deepEqual(bound.request, { command: "relay.prepare", ...input });
  const service = new RelayUnsignedPrepareService(state, { now: () => instant }, undefined, {
    activePolicy: async () => policy(), publicAccount: async () => payer, dailyUsage: async () => "0",
    quote: async intent => ({ ...await validateRelayQuote(await quoteFixture(), intent), quoteDigest: "0".repeat(64) }),
  });
  await assert.rejects(service.prepare(input), { code: "APN_OPERATION_BLOCKED" });
  await assert.rejects(new OperationService(state).required(state.operationId("default", input.idempotencyKey)), { code: "APN_OPERATION_NOT_FOUND" });
});
