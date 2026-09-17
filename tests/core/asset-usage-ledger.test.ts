import assert from "node:assert/strict";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { sealAssetPolicyRegistry, type UnsignedAssetPolicyRegistry } from "../../src/asset-policy-registry.js";
import { AssetUsageLedger, type AssetUsageIdentity } from "../../src/asset-usage-ledger.js";
import { temporaryState } from "./helpers.js";

const EVM_USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const ACCOUNT = "0x1a642f0E3c3aF545E7AcBD38b07251B3990914F1";
const identity: AssetUsageIdentity = {
  account: ACCOUNT,
  chain: "eip155:1",
  asset: { kind: "token", identifier: EVM_USDC },
};
const nativeCaps = { maximumPerTransferAtomic: "1000000000000000000", dailyLimitAtomic: "3000000000000000000" };
const allRails = { direct: true, gasless: true, x402: true, bridge: true, swap: true } as const;

function registry(version = "2026-09-17.ledger.1", dailyLimitAtomic = "100"): ReturnType<typeof sealAssetPolicyRegistry> {
  const value: UnsignedAssetPolicyRegistry = {
    schemaVersion: "apn.asset-policy-registry.v1",
    registryVersion: version,
    publishedAt: "2026-09-17T00:00:00.000Z",
    effectiveDate: "2026-09-17",
    chains: [{
      chain: "eip155:1", family: "evm", name: "Ethereum", assets: [
        { kind: "native", identifier: null, symbol: "ETH", decimals: 18, rails: allRails, caps: nativeCaps },
        { kind: "token", identifier: EVM_USDC, symbol: "USDC", decimals: 6, rails: allRails,
          caps: { maximumPerTransferAtomic: dailyLimitAtomic, dailyLimitAtomic } },
      ],
    }],
  };
  return sealAssetPolicyRegistry(value);
}

function reserve(ledger: AssetUsageLedger, key: string, amountAtomic: string, rail: "direct" | "gasless" | "x402" | "bridge" | "swap", now = new Date("2026-09-17T10:00:00.000Z"), policy = registry()) {
  return ledger.reserve({ ...identity, registry: policy, rail, amountAtomic, idempotencyKey: key, now });
}

test("one account-network-asset daily cap aggregates reservations across every rail label", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const ledger = new AssetUsageLedger(temporary.root);
  await reserve(ledger, "cross-rail-direct-0001", "30", "direct");
  await reserve(ledger, "cross-rail-gasless-01", "20", "gasless");
  await reserve(ledger, "cross-rail-x402-00001", "20", "x402");
  await reserve(ledger, "cross-rail-bridge-001", "20", "bridge");
  await reserve(ledger, "cross-rail-swap-00001", "10", "swap");
  assert.equal((await ledger.usage(identity, new Date("2026-09-17T23:59:59.999Z"))).amountAtomic, "100");
  await assert.rejects(reserve(ledger, "cross-rail-over-cap1", "1", "gasless"), { code: "APN_OPERATION_BLOCKED" });
});

test("UTC boundary resets finalized usage but unresolved and unknown-finality reservations carry forward", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const ledger = new AssetUsageLedger(temporary.root);
  const finalized = await reserve(ledger, "boundary-finalized-001", "70", "direct", new Date("2026-09-17T23:59:00.000Z"));
  await ledger.transition({ ...identity, reservationId: finalized.reservationId, policyDigest: finalized.policyDigest,
    state: "finalized", now: new Date("2026-09-17T23:59:59.000Z"), outcomeDigest: "a".repeat(64) });
  assert.equal((await ledger.usage(identity, new Date("2026-09-18T00:00:00.000Z"))).amountAtomic, "0");
  const unresolved = await reserve(ledger, "boundary-unresolved-01", "30", "bridge", new Date("2026-09-17T23:59:59.500Z"));
  await ledger.transition({ ...identity, reservationId: unresolved.reservationId, policyDigest: unresolved.policyDigest,
    state: "unknown_finality", now: new Date("2026-09-18T00:00:01.000Z") });
  assert.equal((await ledger.usage(identity, new Date("2026-09-19T12:00:00.000Z"))).amountAtomic, "30");
  await assert.rejects(reserve(ledger, "boundary-next-day-cap", "71", "x402", new Date("2026-09-19T12:00:00.000Z")),
    { code: "APN_OPERATION_BLOCKED" });
});

test("pre-effect terminal failure releases its reservation and terminal retries are exact", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const ledger = new AssetUsageLedger(temporary.root);
  const held = await reserve(ledger, "release-before-effect", "100", "gasless");
  const released = await ledger.transition({ ...identity, reservationId: held.reservationId, policyDigest: held.policyDigest,
    state: "failed_before_effect", now: new Date("2026-09-17T10:01:00.000Z"), outcomeDigest: "b".repeat(64) });
  const replay = await ledger.transition({ ...identity, reservationId: held.reservationId, policyDigest: held.policyDigest,
    state: "failed_before_effect", now: new Date("2026-09-17T10:02:00.000Z"), outcomeDigest: "b".repeat(64) });
  assert.deepEqual(replay, released);
  await assert.rejects(ledger.transition({ ...identity, reservationId: held.reservationId, policyDigest: held.policyDigest,
    state: "failed_before_effect", now: new Date("2026-09-17T10:03:00.000Z"), outcomeDigest: "c".repeat(64) }),
  { code: "APN_OPERATION_BLOCKED" });
  assert.equal((await reserve(ledger, "replacement-after-fail", "100", "direct")).amountAtomic, "100");
});

test("concurrent duplicate reservation is idempotent and concurrent distinct reservations cannot race past the cap", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const first = new AssetUsageLedger(temporary.root);
  const second = new AssetUsageLedger(temporary.root);
  const duplicates = await Promise.all([
    reserve(first, "concurrent-duplicate-1", "60", "x402"),
    reserve(second, "concurrent-duplicate-1", "60", "x402"),
  ]);
  assert.equal(duplicates[0].reservationId, duplicates[1].reservationId);
  assert.equal((await first.usage(identity, new Date("2026-09-17T11:00:00.000Z"))).amountAtomic, "60");
  const raced = await Promise.allSettled([
    reserve(first, "concurrent-distinct-01", "40", "direct"),
    reserve(second, "concurrent-distinct-02", "40", "bridge"),
  ]);
  assert.equal(raced.filter((result) => result.status === "fulfilled").length, 1);
  const rejected = raced.find((result): result is PromiseRejectedResult => result.status === "rejected");
  assert.equal(rejected?.reason?.code, "APN_OPERATION_BLOCKED");
  assert.equal((await second.usage(identity, new Date("2026-09-17T11:00:00.000Z"))).amountAtomic, "100");
});

test("reservations and unresolved usage survive a new store instance", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const original = new AssetUsageLedger(temporary.root);
  const record = await reserve(original, "restart-persistence-01", "80", "swap");
  await original.transition({ ...identity, reservationId: record.reservationId, policyDigest: record.policyDigest,
    state: "submitted", now: new Date("2026-09-17T10:05:00.000Z") });
  const restarted = new AssetUsageLedger(temporary.root);
  assert.equal((await restarted.load(identity, record.reservationId))?.state, "submitted");
  assert.equal((await restarted.usage(identity, new Date("2026-09-20T00:00:00.000Z"))).amountAtomic, "80");
  await assert.rejects(reserve(restarted, "restart-over-cap-001", "21", "direct", new Date("2026-09-20T00:00:00.000Z")),
    { code: "APN_OPERATION_BLOCKED" });
});

test("policy rebinding, asset confusion, altered state and invalid terminal claims fail closed", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const ledger = new AssetUsageLedger(temporary.root);
  const record = await reserve(ledger, "tamper-and-binding-001", "10", "direct");
  await assert.rejects(ledger.reserve({ ...identity, account: ACCOUNT.toLowerCase(), registry: registry(), rail: "direct",
    amountAtomic: "1", idempotencyKey: "noncanonical-account-01", now: new Date("2026-09-17T10:00:00.000Z") }),
    { code: "APN_INVALID_INPUT" });
  await assert.rejects(reserve(ledger, "tamper-and-binding-001", "10", "direct", new Date("2026-09-17T10:01:00.000Z"), registry("2026-09-17.ledger.2")),
    { code: "APN_OPERATION_BLOCKED" });
  await assert.rejects(ledger.transition({ ...identity, asset: { kind: "native", identifier: null }, reservationId: record.reservationId,
    policyDigest: record.policyDigest, state: "submitted", now: new Date("2026-09-17T10:02:00.000Z") }),
    { code: "APN_OPERATION_BLOCKED" });
  await assert.rejects(ledger.transition({ ...identity, reservationId: record.reservationId, policyDigest: record.policyDigest,
    state: "finalized", now: new Date("2026-09-17T10:02:00.000Z") }), { code: "APN_INVALID_INPUT" });
  const buckets = await readdir(join(temporary.root, "asset-usage"));
  const files = await readdir(join(temporary.root, "asset-usage", buckets[0]!));
  const path = join(temporary.root, "asset-usage", buckets[0]!, files[0]!);
  const stored = JSON.parse(await readFile(path, "utf8")); stored.amountAtomic = "11";
  await writeFile(path, `${JSON.stringify(stored)}\n`, { mode: 0o600 });
  await assert.rejects(ledger.load(identity, record.reservationId), { code: "APN_STATE_CORRUPT" });
});
