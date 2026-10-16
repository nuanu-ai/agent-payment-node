import assert from "node:assert/strict";
import test from "node:test";
import { AssetUsageLedger } from "../../src/asset-usage-ledger.js";
import { gaslessPolicyChain, localGaslessMechanism } from "../../src/gasless/asset-policy.js";
import { gaslessDeployment } from "../../src/gasless/registry.js";
import { activateDirectPolicy } from "./direct-allowlist-helpers.js";
import { gaslessFixture } from "./gasless-helpers.js";
import { temporaryState } from "./helpers.js";

for (const chainId of [10, 130, 137, 42161] as const) {
  const row = gaslessDeployment(chainId), chain = `eip155:${chainId}`;
  test(`${row.network} local gasless moves USDC only under the owner's allowlist and caps`, async t => {
    assert.equal(gaslessPolicyChain(chainId), chain);
    assert.deepEqual(localGaslessMechanism(chainId), { provider: "local", reference: `${chain}:${row.paymaster}` });

    const none = await temporaryState(); t.after(none.cleanup);
    const unadmitted = await gaslessFixture(none.root, chainId, { activatePolicy: false });
    const refused = await unadmitted.core.execute({ command: "gasless.transfer.prepare", profile: unadmitted.profile,
      request: unadmitted.request, idempotencyKey: "chain-policy-none" });
    assert.equal(refused.ok, false); assert.equal(refused.error?.code, "APN_ALLOWLIST_REFUSED");
    assert.deepEqual(unadmitted.rpc.calls, [], "no chain read before owner admission");

    const small = await temporaryState(); t.after(small.cleanup);
    const capped = await gaslessFixture(small.root, chainId, { activatePolicy: false });
    await activateDirectPolicy(small.root, capped.profile, { now: capped.now, accounts: { evm: capped.account.address },
      admissions: [{ chain, kind: "token", identifier: row.token, rail: "gasless", maximumPerTransferAtomic: "1000000",
        dailyLimitAtomic: "1000000", mechanism: localGaslessMechanism(chainId) }] });
    const over = await capped.core.execute({ command: "gasless.transfer.prepare", profile: capped.profile,
      request: capped.request, idempotencyKey: "chain-policy-cap" });
    // The shared asset-policy evaluation refuses an amount above the per-transfer cap before any chain read.
    assert.equal(over.ok, false); assert.equal(over.error?.code, "APN_OPERATION_BLOCKED");
    assert.deepEqual(capped.rpc.calls, []); assert.equal((await capped.core.gasless.records.listAllOperations()).length, 0);

    const admitted = await temporaryState(); t.after(admitted.cleanup);
    const s = await gaslessFixture(admitted.root, chainId), { id, operation } = await s.prepare();
    assert.equal(operation.intent.allowlist?.chain, chain);
    assert.deepEqual(operation.intent.allowlist?.mechanism, localGaslessMechanism(chainId));
    const approved = await s.core.execute({ command: "gasless.transfer.approve", operationId: id });
    assert.equal(approved.ok, true, approved.error?.message);
    const identity = { account: s.account.address, chain, asset: { kind: "token" as const, identifier: row.token } };
    const lease = await new AssetUsageLedger(admitted.root).load(identity, operation.intent.allowlist!.reservationId);
    assert.equal(lease?.amountAtomic, s.request.grossAtomic);
    assert.equal((await new AssetUsageLedger(admitted.root).usage(identity, s.now)).amountAtomic, s.request.grossAtomic);
  });
}
