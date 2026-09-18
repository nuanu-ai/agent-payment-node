import assert from "node:assert/strict";
import test from "node:test";
import { AssetUsageLedger } from "../../src/asset-usage-ledger.js";
import { ApnError } from "../../src/errors.js";
import type { Address } from "../../src/model.js";
import { X402Permit2AllowlistGate, type X402Permit2AllowlistSubject } from "../../src/x402-permit2/policy.js";
import { X402_PERMIT2_ASSETS, X402_PERMIT2_MECHANISM } from "../../src/x402-permit2/registry.js";
import { activateDirectPolicy, directAdmission } from "./direct-allowlist-helpers.js";
import { temporaryState } from "./helpers.js";

const NOW = new Date("2026-09-18T08:00:00.000Z");
const OWNER = "0x5B38Da6a701c568545dCfcB03FcB875f56beddC4" as Address;
const AVAX = X402_PERMIT2_ASSETS[0]!;
const CAPS = { maximumPerTransferAtomic: "3000000", dailyLimitAtomic: "10000000" };
const refused = (reason: string) => (error: unknown) => error instanceof ApnError && error.code === "APN_ALLOWLIST_REFUSED" &&
  error.details?.reason === reason && error.details?.rail === "x402";
const x402Admission = (mechanism: Readonly<{ provider: string; reference: string }> = X402_PERMIT2_MECHANISM, caps = CAPS) =>
  ({ chain: AVAX.chain, kind: "token" as const, identifier: AVAX.token, rail: "x402" as const, ...caps, mechanism: { ...mechanism } });
const subject = (operationId: string, amountAtomic: string, patch: Partial<X402Permit2AllowlistSubject> = {}): X402Permit2AllowlistSubject =>
  ({ profile: "default", operationId, account: OWNER, chain: AVAX.chain, token: AVAX.token, amountAtomic, ...patch });

async function withGate(run: (gate: X402Permit2AllowlistGate, root: string) => Promise<void>): Promise<void> {
  const temporary = await temporaryState();
  try { await run(new X402Permit2AllowlistGate({ state: { root: temporary.root }, clock: { now: () => new Date(NOW) } }), temporary.root); }
  finally { await temporary.cleanup(); }
}

test("rail x402 admits only an owner-activated list token with the exact Permit2 mechanism pin", async () => withGate(async (gate, root) => {
  await assert.rejects(gate.admit(subject("op-a", "1000000")), refused("allowlist_policy_required"));
  await activateDirectPolicy(root, "default", { accounts: { evm: OWNER }, now: NOW, admissions: [directAdmission(AVAX.chain, AVAX.token)] });
  await assert.rejects(gate.admit(subject("op-a", "1000000")), refused("allowlist_x402_not_admitted"));
  await activateDirectPolicy(root, "default", { accounts: { evm: OWNER }, now: NOW,
    admissions: [x402Admission({ provider: "x402-exact-permit2", reference: "0x4020A4f3b7b90ccA423B9fabCc0CE57C6C240002" })] });
  await assert.rejects(gate.admit(subject("op-a", "1000000")), refused("allowlist_x402_mechanism_mismatch"));
  await activateDirectPolicy(root, "default", { accounts: { evm: OWNER }, now: NOW, admissions: [x402Admission()] });
  await assert.rejects(gate.admit(subject("op-a", "1000000", { account: "0x209693Bc6afc0C5328bA36FaF03C514EF312287C" })), refused("allowlist_account_mismatch"));
  await assert.rejects(gate.admit(subject("op-a", "1000000", { token: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E" })), refused("allowlist_x402_not_admitted"));
  await assert.rejects(gate.admit(subject("op-a", "1000000", { chain: "eip155:1", token: "0x1111111111111111111111111111111111111111" })),
    refused("allowlist_asset_unlisted"));
  await assert.rejects(gate.admit(subject("op-a", "3000001")), refused("allowlist_per_transfer_cap_exceeded"));
  const binding = await gate.admit(subject("op-a", "3000000"));
  assert.equal(binding.schemaVersion, "apn.x402-permit2-allowlist.v1");
  assert.equal(binding.policyRevision, 3);
}));

test("reservations use the shared daily ledger, replay idempotently and follow the operation forward", async () => withGate(async (gate, root) => {
  await activateDirectPolicy(root, "default", { accounts: { evm: OWNER }, now: NOW, admissions: [x402Admission()] });
  const ledger = new AssetUsageLedger(root), identity = { account: OWNER, chain: AVAX.chain, asset: { kind: "token" as const, identifier: AVAX.token } };
  for (const id of ["op-1", "op-2", "op-3"]) {
    const binding = await gate.admit(subject(id, "3000000"));
    const reservation = await gate.reserve(subject(id, "3000000"), binding);
    assert.equal(reservation.rail, "x402");
    assert.equal(reservation.state, "reserved");
    assert.deepEqual(await gate.reserve(subject(id, "3000000"), binding), reservation);
  }
  assert.equal((await ledger.usage(identity, NOW)).amountAtomic, "9000000");
  await assert.rejects(gate.admit(subject("op-4", "1000001")), refused("allowlist_daily_cap_exceeded"));
  const binding = await gate.admit(subject("op-4", "1000000"));
  await gate.follow(subject("op-1", "3000000"), "submitted", "a".repeat(64));
  await gate.follow(subject("op-1", "3000000"), "finalized", "b".repeat(64));
  await gate.follow(subject("op-1", "3000000"), "finalized", "b".repeat(64));
  await assert.rejects(gate.follow(subject("op-1", "3000000"), "failed_before_effect", "c".repeat(64)),
    (error: unknown) => error instanceof ApnError && error.code === "APN_STATE_CORRUPT");
  await gate.follow(subject("op-2", "3000000"), "failed_before_effect", "d".repeat(64));
  await gate.follow(subject("op-never", "1"), "failed_before_effect", "e".repeat(64));
  await assert.rejects(gate.follow(subject("op-never", "1"), "finalized", "e".repeat(64)),
    (error: unknown) => error instanceof ApnError && error.code === "APN_STATE_CORRUPT");
  assert.equal((await ledger.usage(identity, NOW)).amountAtomic, "6000000");
  await activateDirectPolicy(root, "default", { accounts: { evm: OWNER }, now: NOW, admissions: [x402Admission()] });
  await assert.rejects(gate.reserve(subject("op-4", "1000000"), binding), refused("allowlist_policy_changed"));
  await assert.rejects(gate.reserve(subject("op-4", "1000000"), { ...binding, schemaVersion: "other" }),
    (error: unknown) => error instanceof ApnError && error.code === "APN_STATE_CORRUPT");
}));
