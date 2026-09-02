import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { parseArgv } from "../../src/cli.js";
import { ApnCore } from "../../src/core.js";
import { EncryptedProfilePolicy } from "../../src/encrypted-profile-policy.js";
import { ApnError } from "../../src/errors.js";
import type { WrappingSecretPort } from "../../src/macos-keychain.js";
import type { ProfilePolicyApprovalIntent, ProfilePolicyApprovalPort } from "../../src/policy-approval.js";
import { TtyProfilePolicyApproval } from "../../src/policy-approval.js";
import { StateStore } from "../../src/state.js";
import type { ProfilePolicyBinding, ProfilePolicyPort, ProfilePolicyRecord, ProfilePolicySetInput } from "../../src/profile-policy.js";
import {
  TestClock,
  TestNative,
  TestProfilePolicy,
  TestRpc,
  ensureWallet,
  makeCore,
  temporaryState,
} from "./helpers.js";
import { TestHttp } from "./x402-helpers.js";
import { X402_URL } from "./x402-vectors.js";

const MASTER = Buffer.from("33".repeat(32), "hex");

class TestWrappingSecret implements WrappingSecretPort {
  async load(): Promise<Buffer> { return Buffer.from(MASTER); }
  async create(): Promise<Buffer> { return Buffer.from(MASTER); }
}

class LazyWrappingSecret implements WrappingSecretPort {
  private value: Buffer | null = null;
  createCalls = 0;
  async load(): Promise<Buffer | null> { return this.value === null ? null : Buffer.from(this.value); }
  async create(): Promise<Buffer> {
    this.createCalls += 1;
    this.value ??= Buffer.from(MASTER);
    return Buffer.from(this.value);
  }
}

class RecordingPolicyApproval implements ProfilePolicyApprovalPort {
  readonly intents: ProfilePolicyApprovalIntent[] = [];
  async approve(intent: ProfilePolicyApprovalIntent): Promise<void> { this.intents.push(intent); }
}

class AbsentProfilePolicy implements ProfilePolicyPort {
  async load(_binding: ProfilePolicyBinding): Promise<null> { return null; }
  async set(_binding: ProfilePolicyBinding, _input: ProfilePolicySetInput): Promise<ProfilePolicyRecord> {
    throw new Error("unexpected policy set");
  }
}

test("encrypted owner policy requires approval for creation/increase, preserves omitted ETH, and survives restart", async (t) => {
  const temporary = await temporaryState();
  t.after(temporary.cleanup);
  const state = new StateStore(temporary.root);
  const approval = new RecordingPolicyApproval();
  const clock = new TestClock();
  const policy = new EncryptedProfilePolicy(state, new TestWrappingSecret(), approval, clock);
  const core = new ApnCore({ state, native: new TestNative(), policy, clock });
  await ensureWallet(core);

  const absent = await core.execute({ command: "wallet.policy.show", profile: "default" });
  assert.equal(absent.ok, true);
  assert.equal((absent.data as { configured: boolean }).configured, false);

  const created = await core.execute({
    command: "wallet.policy.set",
    profile: "default",
    maxBalanceUsdcAtomic: "60000000",
    maxX402AmountAtomic: "2000000",
    maxBalanceEthWei: "2000000000000000000",
  });
  assert.equal(created.ok, true, JSON.stringify(created));
  assert.equal(approval.intents.length, 1);
  assert.equal(approval.intents[0]?.change, "create");

  const envelope = await readFile(join(temporary.root, "policies", "default.json"), "utf8");
  assert.equal(envelope.includes("60000000"), false, "monetary policy must not be plaintext under ~/.apn");
  assert.equal(envelope.includes("2000000"), false, "x402 policy must not be plaintext under ~/.apn");

  clock.advance(1_000);
  const decreased = await core.execute({
    command: "wallet.policy.set",
    profile: "default",
    maxBalanceUsdcAtomic: "40000000",
    maxX402AmountAtomic: "1000000",
  });
  assert.equal(decreased.ok, true, JSON.stringify(decreased));
  assert.equal(approval.intents.length, 1, "a pure decrease must not prompt");
  assert.equal((decreased.data as { limits: { max_balance_eth_wei: string } }).limits.max_balance_eth_wei, "2000000000000000000");

  clock.advance(1_000);
  const increased = await core.execute({
    command: "wallet.policy.set",
    profile: "default",
    maxBalanceUsdcAtomic: "40000000",
    maxX402AmountAtomic: "1500000",
  });
  assert.equal(increased.ok, true, JSON.stringify(increased));
  assert.equal(approval.intents.length, 2);
  assert.equal(approval.intents[1]?.change, "increase");

  const restartedState = new StateStore(temporary.root);
  const restarted = new ApnCore({
    state: restartedState,
    policy: new EncryptedProfilePolicy(restartedState, new TestWrappingSecret(), approval, clock),
  });
  const shown = await restarted.execute({ command: "wallet.policy.show", profile: "default" });
  assert.equal(shown.ok, true, JSON.stringify(shown));
  assert.deepEqual((shown.data as { limits: unknown }).limits, {
    max_balance_usdc_atomic: "40000000",
    max_x402_amount_atomic: "1500000",
    max_balance_eth_wei: "2000000000000000000",
  });
  assert.equal((shown.data as { integrity_status: string }).integrity_status, "authenticated");
});

test("provider rebind invalidates the old encrypted policy and requires a newly approved policy", async (t) => {
  const temporary = await temporaryState();
  t.after(temporary.cleanup);
  const state = new StateStore(temporary.root);
  await state.initialize();
  const approval = new RecordingPolicyApproval();
  const clock = new TestClock();
  const policy = new EncryptedProfilePolicy(state, new TestWrappingSecret(), approval, clock);
  const first: ProfilePolicyBinding = {
    profile: "provider-one",
    profileHash: state.profileHash("provider-one"),
    walletAddress: `0x${"1".repeat(40)}`,
    walletBindingHash: "a".repeat(64),
  };
  const rebound: ProfilePolicyBinding = {
    ...first,
    walletAddress: `0x${"2".repeat(40)}`,
    walletBindingHash: "b".repeat(64),
  };
  const limits = { maxBalanceUsdcAtomic: "50000000", maxX402AmountAtomic: "2000000" };
  await policy.set(first, limits);
  clock.advance(1_000);
  await policy.set(rebound, limits);
  assert.deepEqual(approval.intents.map((intent) => intent.change), ["create", "create"]);
  assert.equal((await policy.load(rebound))?.walletBindingHash, rebound.walletBindingHash);
  await assert.rejects(policy.load(first), (error: unknown) => error instanceof ApnError && error.code === "APN_STATE_CORRUPT");
});

test("a provider-only profile can create its encrypted policy wrapping secret without a local wallet", async (t) => {
  const temporary = await temporaryState();
  t.after(temporary.cleanup);
  const state = new StateStore(temporary.root);
  await state.initialize();
  const wrapping = new LazyWrappingSecret();
  const approval = new RecordingPolicyApproval();
  const policy = new EncryptedProfilePolicy(state, wrapping, approval, new TestClock());
  const binding: ProfilePolicyBinding = {
    profile: "provider-only",
    profileHash: state.profileHash("provider-only"),
    walletAddress: `0x${"4".repeat(40)}`,
    walletBindingHash: "c".repeat(64),
  };
  const created = await policy.set(binding, {
    maxBalanceUsdcAtomic: "5000000",
    maxX402AmountAtomic: "1000000",
  });
  assert.equal(wrapping.createCalls, 1);
  assert.equal(created.walletAddress, binding.walletAddress);
  assert.equal((await policy.load(binding))?.maxX402AmountAtomic, "1000000");
});

test("same chain balance is classified from owner values and never from a compiled monetary default", async (t) => {
  const temporary = await temporaryState();
  t.after(temporary.cleanup);
  const rpc = new TestRpc();
  const withinPolicy = new TestProfilePolicy({
    maxBalanceUsdcAtomic: "60000000",
    maxX402AmountAtomic: "2000000",
  });
  await ensureWallet(makeCore({ root: temporary.root, native: new TestNative(), policy: withinPolicy }));
  const within = await makeCore({ root: temporary.root, rpc, policy: withinPolicy }).execute({
    command: "wallet.balance",
    profile: "default",
  });
  assert.equal((within.data as { funding_posture: { classification: string } }).funding_posture.classification, "within_limit");

  const lowerPolicy = new TestProfilePolicy({
    maxBalanceUsdcAtomic: "40000000",
    maxX402AmountAtomic: "1000000",
  });
  const over = await makeCore({ root: temporary.root, rpc, policy: lowerPolicy }).execute({
    command: "wallet.balance",
    profile: "default",
  });
  const posture = (over.data as { funding_posture: {
    classification: string;
    inbound_balance_capped_by_apn: boolean;
    assets: { base_usdc: { excess_atomic: string } };
  } }).funding_posture;
  assert.equal(posture.classification, "overfunded");
  assert.equal(posture.assets.base_usdc.excess_atomic, "10000000");
  assert.equal(posture.inbound_balance_capped_by_apn, false);

  const ethPolicy = new TestProfilePolicy({
    maxBalanceUsdcAtomic: "60000000",
    maxX402AmountAtomic: "2000000",
    maxBalanceEthWei: "500000000000000000",
  });
  const ethOver = await makeCore({ root: temporary.root, rpc, policy: ethPolicy }).execute({
    command: "wallet.balance",
    profile: "default",
  });
  const ethPosture = (ethOver.data as { funding_posture: {
    classification: string;
    assets: { base_eth: { classification: string; excess_wei: string } };
  } }).funding_posture;
  assert.equal(ethPosture.classification, "overfunded");
  assert.deepEqual(ethPosture.assets.base_eth, {
    classification: "overfunded",
    configured_limit_wei: "500000000000000000",
    excess_wei: "500000000000000000",
  });

  const unconfigured = await makeCore({ root: temporary.root, rpc, policy: new AbsentProfilePolicy() }).execute({
    command: "wallet.balance",
    profile: "default",
  });
  assert.equal(unconfigured.ok, true);
  assert.equal((unconfigured.data as { funding_posture: { classification: string } }).funding_posture.classification, "policy_unconfigured");
});

test("new unattended x402 fails before payment effects for missing policy, overfunding, or caller escalation", async (t) => {
  const missing = await temporaryState();
  t.after(missing.cleanup);
  await ensureWallet(makeCore({ root: missing.root, native: new TestNative() }));
  const missingHttp = new TestHttp();
  const missingRpc = new TestRpc();
  const missingResult = await makeCore({ root: missing.root, rpc: missingRpc, http: missingHttp, policy: new AbsentProfilePolicy() }).execute({
    command: "x402.fetch.prepare",
    profile: "default",
    url: X402_URL,
    idempotencyKey: "missing-policy-001",
  });
  assert.equal(missingResult.error?.code, "APN_WALLET_POLICY_REQUIRED");
  assert.equal(missingHttp.calls.length, 0);
  assert.equal(missingRpc.x402PrepareCalls, 0);

  const overfunded = await temporaryState();
  t.after(overfunded.cleanup);
  const policy = new TestProfilePolicy({
    maxBalanceUsdcAtomic: "40000000",
    maxX402AmountAtomic: "2000000",
  });
  await ensureWallet(makeCore({ root: overfunded.root, native: new TestNative(), policy }));
  const overHttp = new TestHttp();
  const overRpc = new TestRpc();
  const overResult = await makeCore({ root: overfunded.root, rpc: overRpc, http: overHttp, policy }).execute({
    command: "x402.fetch.prepare",
    profile: "default",
    url: X402_URL,
    idempotencyKey: "overfunded-policy-001",
  });
  assert.equal(overResult.error?.code, "APN_WALLET_OVERFUNDED_FOR_UNATTENDED_X402");
  assert.equal(overHttp.calls.length, 1, "only the unpaid challenge is allowed");
  assert.equal((await new StateStore(overfunded.root).listAllX402Operations()).length, 0);

  const escalatedHttp = new TestHttp();
  const escalatedRpc = new TestRpc();
  const escalated = await makeCore({ root: overfunded.root, rpc: escalatedRpc, http: escalatedHttp, policy }).execute({
    command: "x402.fetch.prepare",
    profile: "default",
    url: X402_URL,
    maxAmountAtomic: "2000001",
    idempotencyKey: "escalated-policy-001",
  });
  assert.equal(escalated.error?.code, "APN_X402_PROFILE_LIMIT_EXCEEDED");
  assert.equal(escalatedHttp.calls.length, 0);
  assert.equal(escalatedRpc.x402PrepareCalls, 0);

  const rpcFailure = await temporaryState();
  t.after(rpcFailure.cleanup);
  const rpcFailurePolicy = new TestProfilePolicy({
    maxBalanceUsdcAtomic: "60000000",
    maxX402AmountAtomic: "2000000",
  });
  await ensureWallet(makeCore({ root: rpcFailure.root, native: new TestNative(), policy: rpcFailurePolicy }));
  class FailingPrepareRpc extends TestRpc {
    override async getX402PrepareEvidence(): Promise<never> {
      this.x402PrepareCalls += 1;
      throw new ApnError("APN_RPC_AMBIGUOUS", "RPC failed safely.");
    }
  }
  const failedRpc = new FailingPrepareRpc();
  const failedHttp = new TestHttp();
  const failed = await makeCore({
    root: rpcFailure.root,
    rpc: failedRpc,
    http: failedHttp,
    policy: rpcFailurePolicy,
  }).execute({
    command: "x402.fetch.prepare",
    profile: "default",
    url: X402_URL,
    idempotencyKey: "rpc-failure-policy-001",
  });
  assert.equal(failed.error?.code, "APN_RPC_AMBIGUOUS");
  assert.equal(failedHttp.calls.length, 1, "only the unpaid challenge may precede the fresh balance failure");
  const failedState = new StateStore(rpcFailure.root);
  assert.equal((await failedState.listAllX402Operations()).length, 0);
  assert.equal((await failedState.listX402Receipts(failedState.profileHash("default"))).length, 0);
});

test("profile maximum and stricter per-call ceiling both authorize only the exact seller offer", async (t) => {
  for (const item of [
    { key: "policy-cap-default", maxAmountAtomic: undefined, expectedCap: "2000000" },
    { key: "policy-cap-stricter", maxAmountAtomic: "1500000", expectedCap: "1500000" },
  ] as const) {
    const temporary = await temporaryState();
    t.after(temporary.cleanup);
    const policy = new TestProfilePolicy({
      maxBalanceUsdcAtomic: "60000000",
      maxX402AmountAtomic: "2000000",
    });
    await ensureWallet(makeCore({ root: temporary.root, native: new TestNative(), policy }));
    const request = {
      command: "x402.fetch.prepare" as const,
      profile: "default",
      url: X402_URL,
      idempotencyKey: item.key,
      ...(item.maxAmountAtomic === undefined ? {} : { maxAmountAtomic: item.maxAmountAtomic }),
    };
    const prepared = await makeCore({
      root: temporary.root,
      rpc: new TestRpc(),
      http: new TestHttp(),
      policy,
    }).execute(request);
    assert.equal(prepared.ok, true, JSON.stringify(prepared));
    const operationId = (prepared.operation as { operationId: string }).operationId;
    const operation = await new StateStore(temporary.root).findX402Operation(operationId);
    assert.equal(operation?.capAtomic, item.expectedCap);
    assert.equal(operation?.amountAtomic, "1250000");
    assert.equal(operation?.authorization.value, "1250000");
  }
});

test("policy CLI is explicit and production approval refuses a non-TTY before persistence", async (t) => {
  assert.deepEqual(parseArgv([
    "wallet", "policy", "set",
    "--profile", "agent",
    "--max-balance-usdc-atomic", "5000000",
    "--max-x402-amount-atomic", "1000000",
  ]), {
    request: {
      command: "wallet.policy.set",
      profile: "agent",
      maxBalanceUsdcAtomic: "5000000",
      maxX402AmountAtomic: "1000000",
    },
  });
  assert.deepEqual(parseArgv(["wallet", "policy", "show", "--profile", "agent"]), {
    request: { command: "wallet.policy.show", profile: "agent" },
  });

  const temporary = await temporaryState();
  t.after(temporary.cleanup);
  const state = new StateStore(temporary.root);
  const policy = new EncryptedProfilePolicy(
    state,
    new TestWrappingSecret(),
    new TtyProfilePolicyApproval({ openTerminal: async () => { throw new Error("no tty"); } }),
  );
  const core = new ApnCore({ state, native: new TestNative(), policy });
  await ensureWallet(core);
  for (const limits of [
    { maxBalanceUsdcAtomic: "0", maxX402AmountAtomic: "1" },
    { maxBalanceUsdcAtomic: "01", maxX402AmountAtomic: "1" },
    { maxBalanceUsdcAtomic: "100", maxX402AmountAtomic: "101" },
  ]) {
    const invalid = await core.execute({
      command: "wallet.policy.set",
      profile: "default",
      ...limits,
    });
    assert.equal(invalid.error?.code, "APN_INVALID_INPUT");
  }
  assert.throws(() => parseArgv([
    "wallet", "policy", "set", "--profile", "default",
    "--max-balance-usdc-atomic", "5000000",
  ]), ApnError);
  const result = await core.execute({
    command: "wallet.policy.set",
    profile: "default",
    maxBalanceUsdcAtomic: "5000000",
    maxX402AmountAtomic: "1000000",
  });
  assert.equal(result.error?.code, "APN_NATIVE_REJECTED");
  assert.equal(result.error?.details?.nativeCode, "APN_TTY_UNAVAILABLE");
  await assert.rejects(access(join(temporary.root, "policies", "default.json")));
});
