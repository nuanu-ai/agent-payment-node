import assert from "node:assert/strict";
import test from "node:test";
import type { ProfilePolicyBinding, ProfilePolicyPort, ProfilePolicyRecord, ProfilePolicySetInput } from "../../src/profile-policy.js";
import { TestNative, TestProfilePolicy, TestRpc, ensureWallet, makeCore, temporaryState } from "./helpers.js";

const REDUCE = "Reduce excess manually only to an independently verified address; APN does not sweep or refund automatically.";
const RERUN = "Re-run apn wallet balance";

class AbsentProfilePolicy implements ProfilePolicyPort {
  async load(_binding: ProfilePolicyBinding): Promise<null> { return null; }
  async set(_binding: ProfilePolicyBinding, _input: ProfilePolicySetInput): Promise<ProfilePolicyRecord> {
    throw new Error("unexpected policy set");
  }
}

interface BalanceAdvice {
  readonly action: string;
  readonly posture: { readonly classification: string; readonly next_actions: readonly string[] };
  readonly dataActions: readonly string[];
  readonly envelopeActions: readonly string[];
}

async function balanceAdvice(
  t: { after(fn: () => Promise<void>): void },
  balances: { readonly usdcAtomic: string; readonly ethAtomic: string },
  policy: ProfilePolicyPort,
): Promise<BalanceAdvice> {
  const temporary = await temporaryState();
  t.after(temporary.cleanup);
  await ensureWallet(makeCore({ root: temporary.root, native: new TestNative(), policy: new TestProfilePolicy() }));
  const rpc = new TestRpc();
  rpc.balances = { ...rpc.balances, ...balances };
  const result = await makeCore({ root: temporary.root, rpc, policy }).execute({ command: "wallet.balance", profile: "default" });
  assert.equal(result.ok, true);
  const data = result.data as {
    funding_guidance: { action: string; warning: string };
    funding_posture: BalanceAdvice["posture"];
    next_actions: string[];
  };
  assert.match(data.funding_guidance.warning, /afford to lose/u);
  return {
    action: data.funding_guidance.action,
    posture: data.funding_posture,
    dataActions: data.next_actions,
    envelopeActions: result.next_actions,
  };
}

function assertNoLimitRaiseOrSweep(advice: BalanceAdvice): void {
  const text = JSON.stringify([advice.action, advice.dataActions]);
  assert.doesNotMatch(text, /policy set|raise|increase|APN (?:will )?sweeps/iu);
}

test("unconfigured policy guidance asks for owner limits before unattended x402", async (t) => {
  const advice = await balanceAdvice(t, { usdcAtomic: "69000", ethAtomic: "1000000000000" }, new AbsentProfilePolicy());
  assert.equal(advice.posture.classification, "policy_unconfigured");
  assert.match(advice.action, /^No owner profile policy is configured/u);
  assert.match(advice.action, /unattended x402 is blocked/u);
  assert.deepEqual(advice.dataActions, [
    "Configure the profile policy before unattended x402.",
    "Fund with low value only",
    RERUN,
  ]);
  assert.deepEqual(advice.envelopeActions, advice.dataActions);
});

test("within-limit guidance names the remaining room per asset", async (t) => {
  const advice = await balanceAdvice(t, { usdcAtomic: "4000", ethAtomic: "400000000000" }, new TestProfilePolicy({
    maxBalanceUsdcAtomic: "10000",
    maxX402AmountAtomic: "1000",
    maxBalanceEthWei: "1000000000000",
  }));
  assert.equal(advice.posture.classification, "within_limit");
  assert.equal(advice.action,
    "Fund Base USDC for payments manually with a small amount only: at most 6000 atomic units (0.006 USDC) more keeps it within the owner limit of 10000 atomic units. " +
    "Fund Base ETH for gas manually with a small amount only: at most 600000000000 wei (0.0000006 ETH) more keeps it within the owner limit of 1000000000000 wei.");
  assert.deepEqual(advice.dataActions, ["Fund with low value only", RERUN]);
  assert.deepEqual(advice.envelopeActions, advice.dataActions);
  assertNoLimitRaiseOrSweep(advice);
});

test("exact-limit guidance tells the owner not to add either asset", async (t) => {
  const advice = await balanceAdvice(t, { usdcAtomic: "10000", ethAtomic: "1000000000000" }, new TestProfilePolicy({
    maxBalanceUsdcAtomic: "10000",
    maxX402AmountAtomic: "1000",
    maxBalanceEthWei: "1000000000000",
  }));
  assert.equal(advice.posture.classification, "within_limit");
  assert.equal(advice.action,
    "Do not add Base USDC: the balance is exactly at the owner limit of 10000 atomic units; any further inbound USDC blocks new unattended x402. " +
    "Do not add Base ETH: the balance is exactly at the owner limit of 1000000000000 wei.");
  assert.deepEqual(advice.dataActions, [RERUN]);
  assert.deepEqual(advice.envelopeActions, [RERUN]);
  assertNoLimitRaiseOrSweep(advice);
});

test("over-limit guidance names asset, excess and unattended x402 effect and never asks to fund", async (t) => {
  const policy = { maxBalanceUsdcAtomic: "10000", maxX402AmountAtomic: "1000", maxBalanceEthWei: "1000000000000" };
  const reported = await balanceAdvice(t, { usdcAtomic: "69000", ethAtomic: "1000000000000" }, new TestProfilePolicy(policy));
  assert.equal(reported.posture.classification, "overfunded");
  assert.equal(reported.action,
    "Do not add Base USDC: the balance exceeds the owner limit of 10000 atomic units by 59000 atomic units (0.059 USDC); " +
    "new unattended x402 is blocked until the owner reduces the excess manually. " +
    "Do not add Base ETH: the balance is exactly at the owner limit of 1000000000000 wei.");
  assert.deepEqual(reported.posture.next_actions, [REDUCE]);
  assert.deepEqual(reported.dataActions, [REDUCE, RERUN]);
  assert.deepEqual(reported.envelopeActions, [REDUCE, RERUN]);
  assertNoLimitRaiseOrSweep(reported);

  const plusOne = await balanceAdvice(t, { usdcAtomic: "10001", ethAtomic: "1000000000001" }, new TestProfilePolicy(policy));
  assert.equal(plusOne.posture.classification, "overfunded");
  assert.match(plusOne.action, /Do not add Base USDC: the balance exceeds the owner limit of 10000 atomic units by 1 atomic units \(0\.000001 USDC\); new unattended x402 is blocked/u);
  assert.match(plusOne.action, /Do not add Base ETH: the balance exceeds the owner limit of 1000000000000 wei by 1 wei \(0\.000000000000000001 ETH\); unattended x402 is gated by the USDC limit only/u);
  assert.deepEqual(plusOne.dataActions, [REDUCE, RERUN]);
  assertNoLimitRaiseOrSweep(plusOne);
});

test("mixed postures fund only the asset that still has room", async (t) => {
  const usdcOver = await balanceAdvice(t, { usdcAtomic: "10001", ethAtomic: "1" }, new TestProfilePolicy({
    maxBalanceUsdcAtomic: "10000",
    maxX402AmountAtomic: "1000",
  }));
  assert.match(usdcOver.action, /^Do not add Base USDC: .* Fund Base ETH for gas manually with a small amount only; no owner ETH balance limit is configured\.$/u);
  assert.deepEqual(usdcOver.dataActions, [REDUCE, "Fund only Base ETH for gas, with low value only", RERUN]);

  const ethAtLimit = await balanceAdvice(t, { usdcAtomic: "0", ethAtomic: "5" }, new TestProfilePolicy({
    maxBalanceUsdcAtomic: "10000",
    maxX402AmountAtomic: "1000",
    maxBalanceEthWei: "5",
  }));
  assert.match(ethAtLimit.action, /^Fund Base USDC for payments .* Do not add Base ETH: the balance is exactly at the owner limit of 5 wei\.$/u);
  assert.deepEqual(ethAtLimit.dataActions, ["Fund only Base USDC, with low value only", RERUN]);
});
