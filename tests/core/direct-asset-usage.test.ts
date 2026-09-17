import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  AssetUsageLedger,
  DirectAssetUsageAdapter,
  sealAssetPolicyRegistry,
  validateDirectAssetUsageLease,
  type DirectAssetUsageInput,
  type UnsignedAssetPolicyRegistry,
} from "../../src/core.js";
import { temporaryState } from "./helpers.js";

const ACCOUNT = "0x1a642f0E3c3aF545E7AcBD38b07251B3990914F1";
const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const IDENTITY = { account: ACCOUNT, chain: "eip155:1", asset: { kind: "token" as const, identifier: USDC } };
const NOW = new Date("2026-09-17T10:00:00.000Z");

function registry(dailyLimitAtomic = "100") {
  const allRails = { direct: true, gasless: false, x402: false, bridge: false, swap: false } as const;
  const value: UnsignedAssetPolicyRegistry = {
    schemaVersion: "apn.asset-policy-registry.v1",
    registryVersion: "2026-09-17.direct-test.1",
    publishedAt: "2026-09-17T00:00:00.000Z",
    effectiveDate: "2026-09-17",
    chains: [{
      chain: "eip155:1",
      family: "evm",
      name: "Ethereum",
      assets: [
        { kind: "native", identifier: null, symbol: "ETH", decimals: 18, rails: allRails,
          caps: { maximumPerTransferAtomic: "1000000000000000000", dailyLimitAtomic: "3000000000000000000" } },
        { kind: "token", identifier: USDC, symbol: "USDC", decimals: 6, rails: allRails,
          caps: { maximumPerTransferAtomic: dailyLimitAtomic, dailyLimitAtomic } },
      ],
    }],
  };
  return sealAssetPolicyRegistry(value);
}

function input(idempotencyKey: string, amountAtomic: string, policy: unknown = registry(), now = NOW): DirectAssetUsageInput {
  return { ...IDENTITY, registry: policy, profile: "direct-test", rail: "direct", amountAtomic, idempotencyKey, now };
}

test("direct effect callbacks run only after a durable reservation and cumulative cap refusal never reaches signing", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const ledger = new AssetUsageLedger(temporary.root);
  const adapter = new DirectAssetUsageAdapter(ledger);
  let signed = 0;
  const first = await adapter.withReservationBeforeEffect(input("direct-call-first-0001", "60"), async (lease) => {
    signed += 1;
    assert.equal((await ledger.load(IDENTITY, lease.reservation.reservationId))?.state, "reserved");
    return "first-effect";
  });
  assert.equal(first.result, "first-effect");
  const second = await adapter.withReservationBeforeEffect(input("direct-call-second-001", "40"), async () => {
    signed += 1;
    return "second-effect";
  });
  assert.equal(second.result, "second-effect");
  await assert.rejects(adapter.withReservationBeforeEffect(input("direct-call-over-cap-01", "1"), async () => {
    signed += 1;
  }), { code: "APN_OPERATION_BLOCKED" });
  assert.equal(signed, 2);
  assert.equal((await ledger.usage(IDENTITY, NOW)).amountAtomic, "100");
});

test("the checked-in identity-only dataset fails closed before a direct effect callback", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const adapter = new DirectAssetUsageAdapter(new AssetUsageLedger(temporary.root));
  const dataset = JSON.parse(await readFile("data/allowlist/2026-09-17/dataset.json", "utf8"));
  let signed = false;
  await assert.rejects(adapter.withReservationBeforeEffect(input("candidate-dataset-refusal", "1", dataset), async () => {
    signed = true;
  }), { code: "APN_INVALID_INPUT" });
  assert.equal(signed, false);
});

test("direct transition mapping and unresolved usage survive an adapter and ledger restart", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const initial = new DirectAssetUsageAdapter(new AssetUsageLedger(temporary.root));
  let lease = await initial.reserve(input("direct-restart-finality", "70"));
  lease = await initial.submitted(lease, new Date("2026-09-17T10:01:00.000Z"));
  lease = await initial.unknownFinality(lease, new Date("2026-09-17T10:02:00.000Z"));

  const restartedLedger = new AssetUsageLedger(temporary.root);
  const restarted = new DirectAssetUsageAdapter(restartedLedger);
  assert.equal((await restartedLedger.usage(IDENTITY, new Date("2026-09-19T00:00:00.000Z"))).amountAtomic, "70");
  lease = await restarted.finalized(lease, new Date("2026-09-19T00:01:00.000Z"), "a".repeat(64));
  assert.equal(lease.reservation.state, "finalized");
  assert.equal((await restartedLedger.load(IDENTITY, lease.reservation.reservationId))?.state, "finalized");

  let released = await restarted.reserve(input("direct-pre-effect-release", "30", registry(), new Date("2026-09-19T00:01:30.000Z")));
  released = await restarted.failedBeforeEffect(released, new Date("2026-09-19T00:02:00.000Z"), "b".repeat(64));
  assert.equal(released.reservation.state, "failed_before_effect");
  assert.equal((await restartedLedger.usage(IDENTITY, new Date("2026-09-19T00:03:00.000Z"))).amountAtomic, "70");
});

test("a lease seals its exact profile and direct reservation binding", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const adapter = new DirectAssetUsageAdapter(new AssetUsageLedger(temporary.root));
  const lease = await adapter.reserve(input("direct-lease-profile-001", "1"));
  assert.equal(validateDirectAssetUsageLease(lease).profile, "direct-test");
  await assert.rejects(adapter.submitted({ ...lease, profile: "other-profile" }, new Date("2026-09-17T10:01:00.000Z")),
    { code: "APN_STATE_CORRUPT" });
  assert.equal(lease.reservation.state, "reserved");
});

test("direct input snapshots cannot be widened while the durable ledger lock is pending", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const adapter = new DirectAssetUsageAdapter(new AssetUsageLedger(temporary.root));
  await adapter.reserve(input("direct-snapshot-prior-01", "90"));

  const policy = registry("100") as unknown as Record<string, unknown>;
  const now = new Date(NOW);
  const pending = adapter.reserve(input("direct-snapshot-pending1", "20", policy, now));
  Object.assign(policy, registry("1000"));
  now.setUTCDate(now.getUTCDate() + 1);

  await assert.rejects(pending, { code: "APN_OPERATION_BLOCKED" });
});

test("replayed transitioned reservations cannot repeat a direct effect callback", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const adapter = new DirectAssetUsageAdapter(new AssetUsageLedger(temporary.root));
  let calls = 0;
  const first = await adapter.withReservationBeforeEffect(input("direct-effect-replay-01", "10"), async (lease) => {
    (lease as unknown as { profile: string }).profile = "mutated-callback-copy";
    return ++calls;
  });
  assert.equal(validateDirectAssetUsageLease(first.lease).profile, "direct-test");
  const submitted = await adapter.submitted(first.lease, new Date("2026-09-17T10:01:00.000Z"));

  await assert.rejects(adapter.withReservationBeforeEffect(input("direct-effect-replay-01", "10"), async () => ++calls),
    { code: "APN_OPERATION_BLOCKED" });
  assert.equal(calls, 1);
  assert.equal(submitted.reservation.state, "submitted");
});

test("callback failure stays charged and unknown finality cannot be relabeled as pre-effect failure", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const ledger = new AssetUsageLedger(temporary.root);
  const adapter = new DirectAssetUsageAdapter(ledger);
  let callbackLease: ReturnType<typeof validateDirectAssetUsageLease> | undefined;
  await assert.rejects(adapter.withReservationBeforeEffect(input("direct-effect-failure-01", "25"), async (lease) => {
    callbackLease = validateDirectAssetUsageLease(lease);
    throw new Error("provider outcome unavailable");
  }), /provider outcome unavailable/u);
  assert.equal((await ledger.usage(IDENTITY, NOW)).amountAtomic, "25");

  await adapter.unknownFinality(callbackLease, new Date("2026-09-17T10:01:00.000Z"));
  await assert.rejects(adapter.failedBeforeEffect(callbackLease, new Date("2026-09-17T10:02:00.000Z"), "c".repeat(64)),
    { code: "APN_OPERATION_BLOCKED" });
  assert.equal((await ledger.usage(IDENTITY, new Date("2026-09-18T00:00:00.000Z"))).amountAtomic, "25");
});
