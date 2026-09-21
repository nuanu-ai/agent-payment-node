import assert from "node:assert/strict";
import test from "node:test";
import { AssetUsageLedger } from "../../src/asset-usage-ledger.js";
import { bridgeMechanism } from "../../src/lifi/allowlist.js";
import { activateDirectPolicy } from "./direct-allowlist-helpers.js";
import { temporaryState } from "./helpers.js";
import { LIFI_SYNTHETIC_SENDER, lifiFixture } from "./lifi-helpers.js";

for (const [pair, tool] of [["base-arb", "across"], ["arb-eth", "stargateV2"]] as const) {
  test(`common owner policy gates and settles LI.FI ${tool} ${pair}`, async (t) => {
    const temporary = await temporaryState(); t.after(temporary.cleanup);
    const s = await lifiFixture(temporary.root, pair), prepared = await s.prepare(tool, `allowlist-${pair}-${tool}`);
    const binding = prepared.operation.intent.allowlist!;
    assert.deepEqual(binding.mechanism, bridgeMechanism(tool));
    assert.equal(binding.chain, `eip155:${s.request.fromChainId}`);
    assert.deepEqual(binding.asset, { kind: "token", identifier: s.request.fromToken });
    assert.equal(binding.amountAtomic, s.request.amountAtomic); assert.equal(binding.selfRecipient, s.request.recipient);
    const completed = await s.core.execute({ command: "bridge.approve", operationId: prepared.id });
    assert.equal(completed.ok, true, completed.error?.message);
    const record = (await s.core.bridges.records.findOperation(prepared.id))!;
    assert.equal(record.state, "completed"); assert.equal(s.source.submissions.length, 2);
    const lease = await new AssetUsageLedger(temporary.root).load({ account: binding.account, chain: binding.chain, asset: binding.asset }, record.usageLease!.reservationId);
    assert.equal(lease?.state, "finalized");
  });
}

test("common LI.FI preparation refuses absent, expired, over-cap and wrong-mechanism owner policies before materialization", async (t) => {
  const missingRoot = await temporaryState(); t.after(missingRoot.cleanup);
  const missing = await lifiFixture(missingRoot.root, "base-arb", { policy: false });
  const missingRoutes = await missing.core.execute({ command: "bridge.routes", profile: missing.profile, request: missing.request });
  const absent = await missing.core.execute({ command: "bridge.prepare", profile: missing.profile,
    quote: (missingRoutes.data as any).quote_hash, route: "route-across", idempotencyKey: "allowlist-absent-001" });
  assert.equal(absent.error?.details?.reason, "allowlist_policy_required"); assert.equal(missing.provider.materializeCalls, 0);

  const expiredRoot = await temporaryState(); t.after(expiredRoot.cleanup);
  const expired = await lifiFixture(expiredRoot.root, "base-arb", { policy: false });
  await activateDirectPolicy(expiredRoot.root, expired.profile, { accounts: { evm: LIFI_SYNTHETIC_SENDER }, now: expired.now,
    expiresAt: new Date(expired.now.getTime() + 1_000).toISOString(), admissions: [{ chain: `eip155:${expired.request.fromChainId}`,
      kind: "token", identifier: expired.request.fromToken, rail: "bridge", maximumPerTransferAtomic: expired.request.amountAtomic,
      dailyLimitAtomic: expired.request.amountAtomic, mechanism: bridgeMechanism("across") }] });
  expired.now.setTime(expired.now.getTime() + 2_000);
  const expiredRoutes = await expired.core.execute({ command: "bridge.routes", profile: expired.profile, request: expired.request });
  const stale = await expired.core.execute({ command: "bridge.prepare", profile: expired.profile,
    quote: (expiredRoutes.data as any).quote_hash, route: "route-across", idempotencyKey: "allowlist-expired-001" });
  assert.equal(stale.error?.details?.reason, "allowlist_policy_expired"); assert.equal(expired.provider.materializeCalls, 0);

  const capRoot = await temporaryState(); t.after(capRoot.cleanup);
  const capped = await lifiFixture(capRoot.root, "base-arb", { policy: { maximumPerTransferAtomic: "9999999", dailyLimitAtomic: "9999999" } });
  const capRoutes = await capped.core.execute({ command: "bridge.routes", profile: capped.profile, request: capped.request });
  const over = await capped.core.execute({ command: "bridge.prepare", profile: capped.profile,
    quote: (capRoutes.data as any).quote_hash, route: "route-across", idempotencyKey: "allowlist-cap-001" });
  assert.equal(over.error?.details?.reason, "allowlist_per_transfer_cap_exceeded"); assert.equal(capped.provider.materializeCalls, 0);

  const pinRoot = await temporaryState(); t.after(pinRoot.cleanup);
  const pinned = await lifiFixture(pinRoot.root, "arb-eth", { policy: { provider: "lifi", reference: "across-v4" } });
  const pinRoutes = await pinned.core.execute({ command: "bridge.routes", profile: pinned.profile, request: pinned.request });
  const wrong = await pinned.core.execute({ command: "bridge.prepare", profile: pinned.profile,
    quote: (pinRoutes.data as any).quote_hash, route: "route-stargateV2", idempotencyKey: "allowlist-pin-001" });
  assert.equal(wrong.error?.details?.reason, "bridge_mechanism_mismatch"); assert.equal(pinned.provider.materializeCalls, 0);
});

test("common LI.FI allowlist admission cannot authorize a mutated materialized route", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const s = await lifiFixture(temporary.root, "base-arb");
  s.provider.mutateMaterialization = (step) => { step.includedSteps[1].tool = "stargateV2"; };
  const routes = await s.core.execute({ command: "bridge.routes", profile: s.profile, request: s.request });
  const result = await s.core.execute({ command: "bridge.prepare", profile: s.profile,
    quote: (routes.data as any).quote_hash, route: "route-across", idempotencyKey: "allowlist-route-mutation-001" });
  assert.equal(result.ok, false); assert.equal(result.error?.code, "APN_PROVIDER_PROTOCOL");
  assert.equal((await s.core.bridges.records.listAllOperations()).length, 0);
});

test("common LI.FI finalized usage enforces the shared daily cap before another materialization", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const s = await lifiFixture(temporary.root, "base-arb", { policy: { maximumPerTransferAtomic: "10000000", dailyLimitAtomic: "10000000" } });
  const first = await s.prepare("across", "allowlist-daily-first-001");
  assert.equal((await s.core.execute({ command: "bridge.approve", operationId: first.id })).ok, true);
  const routes = await s.core.execute({ command: "bridge.routes", profile: s.profile, request: s.request });
  const materializations = s.provider.materializeCalls;
  const refused = await s.core.execute({ command: "bridge.prepare", profile: s.profile,
    quote: (routes.data as any).quote_hash, route: "route-across", idempotencyKey: "allowlist-daily-second-001" });
  assert.equal(refused.error?.details?.reason, "allowlist_daily_cap_exceeded");
  assert.equal(s.provider.materializeCalls, materializations);
});
