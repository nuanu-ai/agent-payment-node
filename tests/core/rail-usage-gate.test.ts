import assert from "node:assert/strict";
import test from "node:test";
import { hashObject } from "../../src/canonical.js";
import { AllowlistPolicyStore } from "../../src/allowlist-policy-store.js";
import { RailUsageGate, type RailUsageSubject } from "../../src/rail-usage-gate.js";
import { TestClock, temporaryState } from "./helpers.js";

const OWNER = "0x1a642f0E3c3aF545E7AcBD38b07251B3990914F1";
const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const MECHANISM = { provider: "x402-exact-eip3009", reference: "base-usdc-transfer-with-authorization" } as const;

async function activePolicy(root: string, at: Date): Promise<void> {
  const store = new AllowlistPolicyStore(root);
  const record = await store.stage({ profile: "agent", now: at, policy: { schemaVersion: "apn.allowlist-policy-file.v1", overlayVersion: "x402.1",
    accounts: { evm: OWNER }, effectiveAt: "2026-10-16T00:00:00.000Z", expiresAt: "2026-11-16T00:00:00.000Z",
    admissions: [{ chain: "eip155:8453", kind: "token", identifier: BASE_USDC, rail: "x402", maximumPerTransferAtomic: "1000",
      dailyLimitAtomic: "1500", mechanism: MECHANISM }] } });
  await store.appendDecision("agent", null, { status: "active", revision: record.revision, stagedRecordDigest: record.recordDigest,
    policyDigest: record.registry.policyDigest, registry: record.registry, approvalFingerprint: hashObject("agent"), decidedAt: at.toISOString() });
}

function subject(operationId: string, amountAtomic: string, overrides: Partial<RailUsageSubject> = {}): RailUsageSubject {
  return { profile: "agent", family: "evm", rail: "x402", account: OWNER, chain: "eip155:8453",
    asset: { kind: "token", identifier: BASE_USDC }, operationId, amountAtomic, mechanism: MECHANISM, ...overrides };
}

test("local-rail payments reserve shared daily usage once per operation and release it when proven unspent", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const clock = new TestClock(); clock.value = new Date("2026-10-16T12:00:00.000Z");
  await activePolicy(temporary.root, clock.now());
  const gate = new RailUsageGate({ state: { root: temporary.root }, clock });

  const first = await gate.reserveBeforeEffect(subject("a".repeat(64), "1000"));
  assert.equal(first.state, "reserved");
  assert.deepEqual(await gate.reserveBeforeEffect(subject("a".repeat(64), "1000")), first);
  await assert.rejects(gate.reserveBeforeEffect(subject("b".repeat(64), "600")),
    (error: Error & { code?: string; details?: Record<string, unknown> }) =>
      error.code === "APN_ALLOWLIST_REFUSED" && error.details?.reason === "allowlist_daily_cap_exceeded");
  await assert.rejects(gate.reserveBeforeEffect(subject("c".repeat(64), "1001")),
    (error: Error & { details?: Record<string, unknown> }) => error.details?.reason === "allowlist_per_transfer_cap_exceeded");

  await gate.follow(subject("a".repeat(64), "1000"), "submitted", "e".repeat(64));
  await assert.rejects(gate.reserveBeforeEffect(subject("a".repeat(64), "1000")), { code: "APN_OPERATION_BLOCKED" });
  await gate.follow(subject("a".repeat(64), "1000"), "unknown_finality", "e".repeat(64));
  await gate.follow(subject("a".repeat(64), "1000"), "released_unsubmitted", "f".repeat(64));
  assert.equal((await gate.reservation(subject("a".repeat(64), "1000")))?.state, "released_unsubmitted");
  assert.equal((await gate.reserveBeforeEffect(subject("b".repeat(64), "600"))).state, "reserved");
  await gate.follow(subject("b".repeat(64), "600"), "finalized", "d".repeat(64));
  await gate.follow(subject("b".repeat(64), "600"), "finalized", "d".repeat(64));
  await assert.rejects(gate.reserveBeforeEffect(subject("c".repeat(64), "901")),
    (error: Error & { details?: Record<string, unknown> }) => error.details?.reason === "allowlist_daily_cap_exceeded");
});

test("a payment outside the owner's policy is refused before any reservation", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const clock = new TestClock(); clock.value = new Date("2026-10-16T12:00:00.000Z");
  const gate = new RailUsageGate({ state: { root: temporary.root }, clock });
  const reason = (expected: string) => (error: Error & { code?: string; details?: Record<string, unknown> }) =>
    error.code === "APN_ALLOWLIST_REFUSED" && error.details?.reason === expected;
  await assert.rejects(gate.reserveBeforeEffect(subject("a".repeat(64), "1")), reason("allowlist_policy_required"));
  await activePolicy(temporary.root, clock.now());
  await assert.rejects(gate.reserveBeforeEffect(subject("a".repeat(64), "1", { mechanism: { provider: "other", reference: "x" } })),
    reason("allowlist_rail_not_admitted"));
  await assert.rejects(gate.reserveBeforeEffect(subject("a".repeat(64), "1", { rail: "gasless" })), reason("allowlist_rail_not_admitted"));
  await assert.rejects(gate.reserveBeforeEffect(subject("a".repeat(64), "1", { account: "0x2222222222222222222222222222222222222222" })),
    reason("allowlist_account_mismatch"));
  assert.equal(await gate.reservation(subject("a".repeat(64), "1")), null);
  await gate.follow(subject("a".repeat(64), "1"), "failed_before_effect", "e".repeat(64));
  await assert.rejects(gate.follow(subject("a".repeat(64), "1"), "finalized", "e".repeat(64)), { code: "APN_STATE_CORRUPT" });
});
