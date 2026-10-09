import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { keccak256, type Hex } from "viem";
import { hashObject } from "../../src/canonical.js";
import { ApnError } from "../../src/errors.js";
import { evmNativeCustody } from "../../src/evm-native-custody.js";
import { circleEnvelope } from "../../src/circle-v2-evm/operation-model.js";
import { Cleanup85RecoveryStore } from "../../src/circle-v2-evm/cleanup85-recovery-store.js";
import { Cleanup86Store } from "../../src/circle-v2-evm/cleanup86-store.js";
import { executeCleanup86, assertCleanup86Grant, type Cleanup86Ports, type Cleanup86Grant } from "../../src/circle-v2-evm/cleanup86-controller.js";
import { Cleanup86Custody } from "../../src/circle-v2-evm/cleanup86-custody.js";
import { installCleanup85PublicFixture } from "./circle-cleanup85-public-fixture.js";
/** Controller tests deliberately stub custody/transport; no authentic Buyer key is available. */
for (const variant of ["once", "reentrant_custody", "mutate_envelope", "cancelled", "delayed_tty", "post_tty_delay", "post_sign_http", "send_lost", "queued_expiry", "restored", "cross_root", "cross_intent", "disposed", "wrong_material"] as const) test(`cleanup86 controller with fake ports ${variant}`, async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "cleanup86-controller-"))); t.after(() => rm(root, { recursive: true, force: true }));
  const { state, op, parent, write } = await installCleanup85PublicFixture(root), store = new Cleanup86Store(root); let clock = Date.parse("2026-10-09T12:00:00.000Z");
  const recovery = await new Cleanup85RecoveryStore(root).start(op, parent, { sourceCustody: op.sourceCustody, destinationCustody: op.destinationCustody, recipientCustody: await evmNativeCustody(state, "default"), policies: op.policies, windowEndsAt: "2026-10-09T15:42:16.098Z", capturedAt: new Date(clock).toISOString(), evidence: parent.consumedBurn! });
  const { envelopeHash: _hash, ...old } = op.effects[2]!.envelope, envelope = circleEnvelope({ ...old, nonceAtomic: "86" });
  const intent = await store.start(op, recovery, { cancellationProofHash: "a".repeat(64), envelope, policies: recovery.policies, capturedAt: new Date(clock).toISOString(), windowEndsAt: recovery.windowEndsAt });
  let prompts = 0, signs = 0, sends = 0, reads = 0, token: Cleanup86Grant | undefined;
  const rawTransaction = "0x02" as Hex;
  const ports: Cleanup86Ports = { now: () => clock,
    confirm: async (_i, deadline) => { assert.equal(deadline, new Date(clock + 60_000).toISOString()); prompts++; if (variant === "mutate_envelope") Object.assign(_i.envelope, { data: "0x1234" }); if (variant === "delayed_tty") clock += 60_001; if (variant === "cancelled") throw new ApnError("APN_NATIVE_REJECTED", "cancelled"); },
    preflight: async (_i, grant) => { reads++; if (variant === "post_tty_delay" && reads === 2) clock += 60_001; if (variant === "post_sign_http" && reads === 3) throw new ApnError("APN_RPC_CONFIG", "read HTTP", { method: "eth_call", origin: "https://example.org", status: 503, stage: "response", private: "excluded" }); if (grant !== undefined && variant === "cross_root") assert.throws(() => assertCleanup86Grant(grant, root + "x", op, intent)); if (grant !== undefined && variant === "cross_intent") assert.throws(() => assertCleanup86Grant(grant, root, op, { ...intent, intentHash: "f".repeat(64) })); },
    seal: async (i, grant) => { token = grant; assertCleanup86Grant(grant, root, op, i); signs++; if (variant === "reentrant_custody") { let entries = 0, loads = 0; const custody = new Cleanup86Custody(state, { load: async () => { loads++; throw new Error("key forbidden"); }, create: async () => { throw new Error("key forbidden"); } }); const results = await Promise.allSettled([1, 2].map(() => custody.seal(op, i, grant, async () => { entries++; throw new Error("test stops before wallet/private entry"); }))); assert.equal(entries, 1); assert.equal(loads, 0); assert.equal(results.filter(x => x.status === "rejected").length, 2); assert.ok(results.some(x => x.status === "rejected" && /custody_already_claimed/u.test(String(x.reason)))); } const body = { version: "apn.circle-cleanup86-material.v1" as const, intentHash: i.intentHash, recoveryBinding: i.recoveryBinding, envelopeHash: i.envelope.envelopeHash, rawTransaction, transactionHash: keccak256(rawTransaction) }; return { ...body, materialHash: variant === "wrong_material" ? "f".repeat(64) : hashObject(body) }; },
    send: async (material, grant) => { if (variant === "queued_expiry") clock += 60_001; assertCleanup86Grant(grant, root, op, intent); sends++; if (variant === "send_lost") throw new ApnError("APN_RPC_AMBIGUOUS", "lost reply"); return material.transactionHash; } };
  const fails = ["mutate_envelope", "cancelled", "delayed_tty", "post_tty_delay", "post_sign_http", "send_lost", "queued_expiry", "wrong_material"].includes(variant);
  if (fails) await assert.rejects(executeCleanup86(root, op, intent, store, ports)); else await executeCleanup86(root, op, intent, store, ports);
  assert.equal(prompts, 1); assert.equal(signs, ["mutate_envelope", "cancelled", "delayed_tty", "post_tty_delay"].includes(variant) ? 0 : 1);
  assert.equal(sends, ["mutate_envelope", "cancelled", "delayed_tty", "post_tty_delay", "post_sign_http", "queued_expiry", "wrong_material"].includes(variant) ? 0 : 1);
  const saved = await store.effect(op, intent); assert.equal(saved?.phase, signs === 0 ? "prepared" : "unknown");
  if (signs > 0) {
    assert.equal(await store.claimed(op, intent, "sign"), true);
    assert.equal(await store.claimed(op, intent, "send"), !["post_sign_http", "wrong_material"].includes(variant));
    if (variant === "restored") { const body = { version: "apn.circle-cleanup86-effect.v1", intentHash: intent.intentHash, phase: "prepared", transactionHash: null, materialHash: null, sequence: 0, previousHash: null }; await write("circle-cleanup85-recovery", `${op.operationId}-cleanup86-effect.json`, { ...body, effectHash: hashObject(body) }); }
    await assert.rejects(executeCleanup86(root, op, intent, store, ports), /claimed_observe_only/); assert.equal(prompts, 1); assert.equal(signs, 1);
    assert.throws(() => assertCleanup86Grant(token!, root, op, intent), /foreground_authority/);
  }
  if (variant === "post_sign_http") {
    const failure = await new Cleanup85RecoveryStore(root).publicRecord(op, "cleanup86-first-failure") as Record<string, unknown>;
    assert.equal(failure.method, "eth_call"); assert.equal(failure.status, 503); assert.equal(Object.hasOwn(failure, "private"), false);
  }
  // Forged persisted metadata cannot authorize private key access.
  let wrappingLoads = 0; const custody = new Cleanup86Custody(state, { load: async () => { wrappingLoads++; return Buffer.alloc(32); } } as never);
  await assert.rejects(custody.seal(op, intent, { kind: "cleanup86-foreground-grant" }, async () => {}), /foreground_authority/); assert.equal(wrappingLoads, 0);
});
