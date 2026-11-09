import assert from "node:assert/strict";
import test from "node:test";
import { AssetUsageLedger } from "../../src/asset-usage-ledger.js";
import { executeStargateV2NativeEth, prepareStargateV2NativeEth } from "../../src/stargate-v2/native-execution.js";
import { STARGATE_NATIVE_MECHANISM } from "../../src/stargate-v2/native-record.js";
import { StargateNativeUsage } from "../../src/stargate-v2/native-usage.js";
import { StateStore } from "../../src/state.js";
import { activateDirectPolicy } from "./direct-allowlist-helpers.js";
import { temporaryState } from "./helpers.js";
import { OWNER, request, setup } from "./stargate-native-support.js";

// Between the usage hold and the attempt marker nothing was sent: any refusal there releases the hold at once.

test("a signer identity changed after the hold refuses, releases the hold and never signs or sends", async () => {
  const s = setup(), prepared = await prepareStargateV2NativeEth(request({ idempotencyKey: "native-pre-marker-identity" }), s.ports, s.journal);
  (s.ports as any).signerIdentity = async () => ({ profile: "other", address: OWNER });
  await assert.rejects(executeStargateV2NativeEth(prepared.operationId, s.ports, s.journal),
    (error: any) => error.code === "APN_REPREPARE_REQUIRED" && error.details.reason === "signer_identity_changed");
  assert.deepEqual(s.usage, ["admit", "reserve", "failed_before_effect"]); assert.deepEqual(s.counts(), { sends: 0, signs: 0, approvals: 1 });
  assert.equal(s.journal.value?.phase, "approved"); assert.equal(s.journal.value?.transactionHash, undefined);
});

test("a signer that fails after the hold surfaces its own error, releases the hold and never sends", async () => {
  const s = setup(), prepared = await prepareStargateV2NativeEth(request({ idempotencyKey: "native-pre-marker-signing" }), s.ports, s.journal);
  (s.ports as any).signer = { ...s.ports.signer, signTransaction: async () => { throw new Error("custody unavailable"); } };
  await assert.rejects(executeStargateV2NativeEth(prepared.operationId, s.ports, s.journal), /custody unavailable/u);
  assert.deepEqual(s.usage, ["admit", "reserve", "identity", "failed_before_effect"]); assert.deepEqual(s.counts(), { sends: 0, signs: 0, approvals: 1 });
  assert.equal(s.journal.value?.phase, "approved");
});

test("a release that fails still surfaces the original refusal; the expiry path releases the hold later", async () => {
  const s = setup(), prepared = await prepareStargateV2NativeEth(request({ idempotencyKey: "native-pre-marker-release" }), s.ports, s.journal);
  (s.ports as any).signerIdentity = async () => ({ profile: "other", address: OWNER });
  (s.ports as any).followUsage = async () => { throw new Error("ledger busy"); };
  await assert.rejects(executeStargateV2NativeEth(prepared.operationId, s.ports, s.journal),
    (error: any) => error.code === "APN_REPREPARE_REQUIRED" && error.details.reason === "signer_identity_changed");
  assert.deepEqual(s.counts(), { sends: 0, signs: 0, approvals: 1 });
});

test("a hold released before any send refuses a retry of the same operation: it must be prepared again", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const now = new Date("2026-09-20T10:00:00.000Z");
  await activateDirectPolicy(temporary.root, "owner", { accounts: { evm: OWNER }, admissions: [{ chain: "eip155:1", kind: "native", rail: "bridge",
    maximumPerTransferAtomic: "150", dailyLimitAtomic: "150", mechanism: STARGATE_NATIVE_MECHANISM }], now });
  const state = new StateStore(temporary.root); await state.initialize(); const usage = new StargateNativeUsage(state, () => now.getTime());
  const policy = await usage.admitPolicy({ profile: "owner", owner: OWNER, recipient: OWNER, amountAtomic: "100" });
  const op = { operationId: "8".repeat(64), profile: "owner", owner: OWNER, recipient: OWNER, amountAtomic: "100", policy, integrityHash: "b".repeat(64) } as any;
  await usage.reserve(op); await usage.follow(op, "failed_before_effect");
  await assert.rejects(usage.reserve(op), (error: any) => error.code === "APN_REPREPARE_REQUIRED" && error.details.reason === "usage_released_before_send");
  const identity = { account: OWNER, chain: "eip155:1", asset: { kind: "native" as const, identifier: null } };
  assert.equal((await new AssetUsageLedger(temporary.root).usage(identity, now)).amountAtomic, "0");
});
