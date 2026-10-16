/**
 * SYNTHETIC: the owner's optional x402 payee pin in the profile x402 policy (absent = payees not restricted) for local
 * EIP-3009 x402. It is checked at prepare (before offer selection), before signing and before the first paid request, on
 * Base and on the other networks; a real encrypted signer and policy store run against in-process seller and RPC fakes.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { getAddress } from "viem";
import { bindArgv } from "../../src/command-binder.js";
import { assertX402PayeeAdmitted, policyIncrease, sealProfilePolicy, validateProfilePolicy, x402PayeeList, type ProfilePolicyRecord } from "../../src/profile-policy.js";
import type { EvmChainId } from "../../src/evm-asset.js";
import { temporaryState } from "./helpers.js";
import { networkChallenge, networkFixture, NETWORK_LIMITS } from "./evm-x402-helpers.js";
import { X402_PAYEE, X402_URL } from "./x402-vectors.js";

const OTHER = "0x5555555555555555555555555555555555555555", LOWER = "0xabcdef0123456789abcdef0123456789abcdef01", CANONICAL = getAddress(LOWER);
const LIMITS = { maxBalanceUsdcAtomic: "100000000", maxX402AmountAtomic: "10000000" };

test("a payee pin lists 1 to 16 unique non-zero EVM addresses, canonical when stored", () => {
  assert.deepEqual(x402PayeeList([LOWER, X402_PAYEE]), [CANONICAL, X402_PAYEE]);
  for (const bad of [[], [OTHER, OTHER.toUpperCase().replace("0X", "0x")], ["0x0000000000000000000000000000000000000000"], ["not-an-address"],
    Array.from({ length: 17 }, (_, i) => `0x${(i + 1).toString(16).padStart(40, "0")}`)]) assert.equal(x402PayeeList(bad), null);
  assert.equal(x402PayeeList([LOWER], true), null, "a stored pin must already be canonical");
  const binding = { profile: "default", profileHash: "a".repeat(64), walletAddress: `0x${"1".repeat(40)}` as const, walletBindingHash: "b".repeat(64) };
  const base = { schemaVersion: "apn.profile-policy.v1" as const, ...binding, ...LIMITS, approvedAt: "2026-10-17T00:00:00.000Z", updatedAt: "2026-10-17T00:00:00.000Z" };
  // Without a pin the record (and its hash) is exactly what earlier versions wrote.
  assert.equal("x402Payees" in validateProfilePolicy(sealProfilePolicy(base)), false);
  assert.deepEqual(validateProfilePolicy(sealProfilePolicy({ ...base, x402Payees: [X402_PAYEE] })).x402Payees, [X402_PAYEE]);
  assert.throws(() => validateProfilePolicy(sealProfilePolicy({ ...base, x402Payees: [LOWER as `0x${string}`] })), { code: "APN_STATE_CORRUPT" });
  assertX402PayeeAdmitted({}, OTHER);
  assert.throws(() => assertX402PayeeAdmitted({ x402Payees: [X402_PAYEE] }, OTHER), (e: unknown) => (e as { details?: { reason?: string } }).details?.reason === "x402_payee_not_admitted");
});

test("removing the pin or adding a payee widens and needs foreground approval; pinning or narrowing does not", () => {
  const current = { ...LIMITS, x402Payees: [X402_PAYEE] } as unknown as ProfilePolicyRecord, unpinned = { ...LIMITS } as unknown as ProfilePolicyRecord;
  assert.equal(policyIncrease(unpinned, { ...LIMITS, x402Payees: [X402_PAYEE] }), false);
  assert.equal(policyIncrease(current, { ...LIMITS, x402Payees: [X402_PAYEE] }), false);
  assert.equal(policyIncrease({ ...current, x402Payees: [X402_PAYEE, OTHER] } as unknown as ProfilePolicyRecord, { ...LIMITS, x402Payees: [OTHER] }), false);
  assert.equal(policyIncrease(current, { ...LIMITS, x402Payees: [X402_PAYEE, OTHER] }), true);
  assert.equal(policyIncrease(current, { ...LIMITS }), true);
  assert.equal(policyIncrease(current, { ...LIMITS, x402Payees: null }), true);
});

test("CLI binds --x402-payees as a comma list, 'unrestricted' as removal, and omission as keep", () => {
  const set = (extra: readonly string[]) => bindArgv(["wallet", "policy", "set", "--profile", "default", "--max-balance-usdc-atomic", "1", "--max-x402-amount-atomic", "1", ...extra]).request;
  assert.deepEqual((set(["--x402-payees", `${X402_PAYEE},${OTHER}`]) as { x402Payees?: unknown }).x402Payees, [X402_PAYEE, OTHER]);
  assert.equal((set(["--x402-payees", "unrestricted"]) as { x402Payees?: unknown }).x402Payees, null);
  assert.equal("x402Payees" in set([]), false);
});

for (const chainId of [8453, 1] as const) {
  const name = chainId === 8453 ? "Base" : "Ethereum";
  async function setup(t: test.TestContext, x402Payees?: readonly string[]) {
    const temporary = await temporaryState(); t.after(temporary.cleanup);
    const fixture = networkFixture(temporary.root, chainId); fixture.http.outcomes.splice(0, fixture.http.outcomes.length, networkChallenge(chainId));
    await fixture.core.wallet.ensure("default");
    const network = chainId === 8453 ? {} : { chainId: chainId as EvmChainId };
    const setPolicy = async (payees?: readonly string[] | null) => await fixture.core.wallet.policySet({ command: "wallet.policy.set", profile: "default", ...network, ...NETWORK_LIMITS,
      ...(payees === undefined ? {} : { x402Payees: payees }) });
    await setPolicy(x402Payees);
    const request = { command: "x402.fetch.prepare" as const, profile: "default", ...network, url: X402_URL, idempotencyKey: `payee-pin-${chainId}` };
    return { fixture, setPolicy, prepare: async () => await fixture.core.execute(request) };
  }
  const signs = (f: Awaited<ReturnType<typeof setup>>["fixture"]) => f.nativeCalls.filter((call) => call.operation.includes("Authorize")).length;

  test(`${name}: a pin without the seller's payee refuses at prepare; a pin listing it admits`, async (t) => {
    const refused = await setup(t, [OTHER]);
    const result = await refused.prepare();
    assert.equal(result.ok, false); assert.equal(result.error?.details?.reason, "x402_payee_not_admitted", JSON.stringify(result.error));
    assert.equal(signs(refused.fixture), 0);
    const admitted = await setup(t, [OTHER, X402_PAYEE]);
    const prepared = await admitted.prepare();
    assert.equal(prepared.ok, true, JSON.stringify(prepared));
  });

  test(`${name}: a pin set after prepare stops signing, and after approval stops the first paid request`, async (t) => {
    const f = await setup(t);
    const prepared = await f.prepare(); assert.equal(prepared.ok, true, JSON.stringify(prepared));
    const operationId = (prepared.operation as { operationId: string }).operationId;
    // Pinning narrows: no foreground approval is asked for.
    const approvalsBefore = f.fixture.policyApprovals.length;
    await f.setPolicy([OTHER]); assert.equal(f.fixture.policyApprovals.length, approvalsBefore);
    const blocked = await f.fixture.core.execute({ command: "x402.fetch.approve", operationId });
    assert.equal(blocked.error?.details?.reason, "x402_payee_not_admitted", JSON.stringify(blocked.error)); assert.equal(signs(f.fixture), 0);
    // Widening back needs the owner's approval (recorded by the fixture's approval port), then signing proceeds.
    await f.setPolicy(null); assert.equal(f.fixture.policyApprovals.length, approvalsBefore + 1);
    assert.equal((await f.fixture.core.execute({ command: "x402.fetch.approve", operationId })).ok, true);
    assert.equal(signs(f.fixture), 1);
    await f.setPolicy([OTHER]);
    const unsent = await f.fixture.core.execute({ command: "operation.resume", operationId });
    assert.equal(unsent.error?.details?.reason, "x402_payee_not_admitted", JSON.stringify(unsent.error));
    assert.equal(f.fixture.http.calls.filter((call) => call.paymentSignature !== undefined).length, 0);
  });
}

test("omitting the pin keeps it, and the policy shows the pin it enforces", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const fixture = networkFixture(temporary.root, 1); await fixture.core.wallet.ensure("default");
  await fixture.core.wallet.policySet({ command: "wallet.policy.set", profile: "default", chainId: 1, ...NETWORK_LIMITS, x402Payees: [LOWER] });
  const kept = await fixture.core.wallet.policySet({ command: "wallet.policy.set", profile: "default", chainId: 1, ...NETWORK_LIMITS, maxX402AmountAtomic: "5000000" }) as { x402_payees: unknown };
  assert.deepEqual(kept.x402_payees, [CANONICAL]);
  const removed = await fixture.core.wallet.policySet({ command: "wallet.policy.set", profile: "default", chainId: 1, ...NETWORK_LIMITS, maxX402AmountAtomic: "5000000", x402Payees: null }) as { x402_payees: unknown };
  assert.equal(removed.x402_payees, null);
  assert.equal(fixture.policyApprovals.at(-1)?.x402Payees, undefined);
});
