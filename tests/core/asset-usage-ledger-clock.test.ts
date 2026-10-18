import assert from "node:assert/strict";
import test from "node:test";
import { sealAssetPolicyRegistry } from "../../src/asset-policy-registry.js";
import { AssetUsageLedger, type AssetUsageIdentity } from "../../src/asset-usage-ledger.js";
import { temporaryState } from "./helpers.js";

/**
 * The machine clock moving back (NTP correction, manual change) below the newest stamp of a bucket: every write is
 * stamped max(clock, newest stored stamp) and is never refused for it; usage reads count spends stamped after the clock.
 * R9: a payment made while the clock is behind can never be backdated out of the next day's cap.
 */
const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const identity: AssetUsageIdentity = { account: "0x1a642f0E3c3aF545E7AcBD38b07251B3990914F1", chain: "eip155:1", asset: { kind: "token", identifier: USDC } };
const registry = sealAssetPolicyRegistry({ schemaVersion: "apn.asset-policy-registry.v1", registryVersion: "2026-09-17.clock.1",
  publishedAt: "2026-09-17T00:00:00.000Z", effectiveDate: "2026-09-17", chains: [{ chain: "eip155:1", family: "evm", name: "Ethereum", assets: [
    { kind: "token", identifier: USDC, symbol: "USDC", decimals: 6, rails: { direct: true, gasless: true, x402: true, bridge: true, swap: false },
      caps: { maximumPerTransferAtomic: "100", dailyLimitAtomic: "100" } }] }] });
const at = (iso: string) => new Date(iso);
const reserve = (ledger: AssetUsageLedger, key: string, amountAtomic: string, now: Date) =>
  ledger.reserve({ ...identity, registry, rail: "direct", amountAtomic, idempotencyKey: key, now });
const finalize = (ledger: AssetUsageLedger, held: { reservationId: string; policyDigest: string }, now: Date) =>
  ledger.transition({ ...identity, reservationId: held.reservationId, policyDigest: held.policyDigest, state: "finalized", now, outcomeDigest: "a".repeat(64) });
const usage = async (ledger: AssetUsageLedger, now: Date) => (await ledger.usage(identity, now)).amountAtomic;

test("the clock moved back by minutes: nothing is refused, writes keep the newest stamp, the cap still holds", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const ledger = new AssetUsageLedger(temporary.root);
  const first = await reserve(ledger, "clock-minutes-first-01", "60", at("2026-09-17T10:00:00.000Z"));
  await finalize(ledger, first, at("2026-09-17T10:05:00.000Z"));
  const behind = at("2026-09-17T10:01:00.000Z");
  const second = await reserve(ledger, "clock-minutes-second-1", "30", behind);
  assert.deepEqual([second.reservedAt, second.updatedAt], ["2026-09-17T10:05:00.000Z", "2026-09-17T10:05:00.000Z"]);
  assert.equal((await finalize(ledger, second, at("2026-09-17T10:00:30.000Z"))).effectAt, "2026-09-17T10:05:00.000Z");
  assert.equal(await usage(ledger, behind), "90");
  await assert.rejects(reserve(ledger, "clock-minutes-over-cap", "11", behind), { code: "APN_OPERATION_BLOCKED" });
  assert.equal((await reserve(ledger, "clock-minutes-fits-cap", "10", behind)).amountAtomic, "10");
});

test("the clock moved back by a day: future-stamped spends count, and a payment made meanwhile stays in the next day's cap", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const ledger = new AssetUsageLedger(temporary.root);
  const spent = await reserve(ledger, "clock-day-spent-000001", "70", at("2026-09-18T10:00:00.000Z"));
  await finalize(ledger, spent, at("2026-09-18T10:00:00.000Z"));
  // The clock now reads a day earlier: the 18th's spend is in the future, and still counts.
  const behind = at("2026-09-17T10:00:00.000Z");
  assert.equal(await usage(ledger, behind), "70");
  await assert.rejects(reserve(ledger, "clock-day-over-cap-001", "31", behind), { code: "APN_OPERATION_BLOCKED" });
  const late = await reserve(ledger, "clock-day-late-payment", "30", behind);
  assert.equal(late.reservedAt, "2026-09-18T10:00:00.000Z", "never stamped before the bucket's newest record");
  assert.equal((await finalize(ledger, late, at("2026-09-17T10:30:00.000Z"))).effectAt, "2026-09-18T10:00:00.000Z");
  // When the clock reaches the 18th the late payment has not fallen out of the window: the 18th's cap is full.
  assert.equal(await usage(ledger, at("2026-09-18T12:00:00.000Z")), "100");
  await assert.rejects(reserve(ledger, "clock-day-next-day-cap", "1", at("2026-09-18T12:00:00.000Z")), { code: "APN_OPERATION_BLOCKED" });
  // Only the next UTC day after every stamp opens a new window.
  assert.equal(await usage(ledger, at("2026-09-19T00:00:00.000Z")), "0");
  assert.equal((await reserve(ledger, "clock-day-new-window-1", "100", at("2026-09-19T00:00:00.000Z"))).amountAtomic, "100");
});

test("an open hold and the x402 owner-cap reserve follow the same stamp when the clock is behind", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const ledger = new AssetUsageLedger(temporary.root);
  const held = await reserve(ledger, "clock-open-hold-000001", "40", at("2026-09-18T10:00:00.000Z"));
  const behind = at("2026-09-17T09:00:00.000Z");
  const exposed = await ledger.transition({ ...identity, reservationId: held.reservationId, policyDigest: held.policyDigest, state: "unknown_finality", now: behind });
  assert.equal(exposed.updatedAt, "2026-09-18T10:00:00.000Z");
  const x402 = await ledger.reserveWithinOwnerCap({ ...identity, rail: "x402", amountAtomic: "5", maximumAtomic: "10", policyDigest: held.policyDigest,
    registryVersion: "x402-profile-policy", idempotencyKey: "clock-x402-owner-cap-1", now: behind });
  assert.equal(x402.reservedAt, "2026-09-18T10:00:00.000Z");
  assert.equal(await usage(ledger, behind), "45");
});
