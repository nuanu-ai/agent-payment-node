import assert from "node:assert/strict";
import test from "node:test";
import { getAddress } from "viem";
import type { ActiveAssetPolicy } from "../../src/allowlist-active-policy.js";
import { sealAssetPolicyRegistry } from "../../src/asset-policy-registry.js";
import { AssetUsageLedger } from "../../src/asset-usage-ledger.js";
import { COINBASE_GASLESS_MECHANISM, CoinbaseGaslessPolicy } from "../../src/coinbase-gasless-policy.js";
import { FACILITATOR_GASLESS_MECHANISM, FacilitatorGaslessPolicy } from "../../src/facilitator-gasless/policy.js";
import { AVALANCHE_FACILITATOR as R } from "../../src/facilitator-gasless/registry.js";
import { localGaslessMechanism } from "../../src/gasless/asset-policy.js";
import { gaslessDeployment } from "../../src/gasless/registry.js";
import { USDT_GASLESS } from "../../src/gasless-usdt/model.js";
import { requirePolicy } from "../../src/gasless-usdt/policy-prepare.js";
import { activateDirectPolicy } from "./direct-allowlist-helpers.js";
import { GASLESS_TEST_RECIPIENT, gaslessFixture } from "./gasless-helpers.js";
import { savedGaslessOperations, temporaryState } from "./helpers.js";

const NOW = new Date("2026-09-20T10:00:00.000Z");
const OWNER = getAddress("0x1111111111111111111111111111111111111111");
const RECIPIENT = getAddress("0x2222222222222222222222222222222222222222");
const OTHER = getAddress("0x5555555555555555555555555555555555555555");
const STRAY = getAddress("0x6666666666666666666666666666666666666666");
const pinned = (error: any) => error?.code === "APN_ALLOWLIST_REFUSED" && error.details?.reason === "allowlist_recipient_not_admitted";
const gaslessRow = (chain: string, identifier: string, mechanism: { readonly provider: string; readonly reference: string }, recipients: readonly string[]) => ({ chain, kind: "token" as const,
  identifier, rail: "gasless" as const, maximumPerTransferAtomic: "100000000", dailyLimitAtomic: "1000000000", mechanism, recipients });

// Before 0.5.98 only Ethereum and Base local rows could pin, and only one recipient. Arbitrum stands for the other chains.
test("local gasless on Arbitrum: a recipient list refuses an unlisted recipient before any RPC; a listed one passes every check", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const s = await gaslessFixture(temporary.root, 42161, { now: NOW, activatePolicy: false });
  const row = (recipients: readonly string[]) => gaslessRow("eip155:42161", gaslessDeployment(42161).token, localGaslessMechanism(42161), recipients);
  await activateDirectPolicy(temporary.root, s.profile, { accounts: { evm: s.account.address }, admissions: [row([OTHER])], now: NOW });
  const denied = await s.core.execute({ command: "gasless.transfer.prepare", profile: s.profile, request: s.request,
    idempotencyKey: "arbitrum-pinned-0001" });
  assert.equal(denied.ok, false);
  assert.equal(denied.error?.code, "APN_ALLOWLIST_REFUSED"); assert.equal(denied.error?.details?.reason, "allowlist_recipient_not_admitted");
  assert.equal(s.rpc.calls.length, 0); assert.equal(s.rpc.sends.length, 0);
  assert.equal((await savedGaslessOperations(s.core.gasless.records)).length, 0);

  await activateDirectPolicy(temporary.root, s.profile, { accounts: { evm: s.account.address }, admissions: [row([OTHER, GASLESS_TEST_RECIPIENT])], now: NOW });
  const { operation } = await s.prepare("arbitrum-pinned-0002");
  await s.core.gasless.policy.assert(operation, false);
  // Approval, reservation and first send run the same admission: an operation whose recipient the list lacks never gets a hold.
  const stray = { ...operation, intent: { ...operation.intent, request: { ...operation.intent.request, recipient: STRAY } } };
  await assert.rejects(s.core.gasless.policy.assert(stray, false), pinned);
  await assert.rejects(s.core.gasless.policy.reserve(stray), pinned);
  const usage = await new AssetUsageLedger(temporary.root).usage({ account: s.account.address, chain: "eip155:42161",
    asset: { kind: "token", identifier: gaslessDeployment(42161).token } }, NOW);
  assert.equal(usage.amountAtomic, "0"); assert.equal(s.rpc.sends.length, 0);
});

test("Avalanche facilitator: a recipient list applies at prepare, approval, reservation and before the authorization leaves", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const row = (recipients: readonly string[]) => gaslessRow("eip155:43114", getAddress(R.token), FACILITATOR_GASLESS_MECHANISM, recipients);
  await activateDirectPolicy(temporary.root, "avalanche", { accounts: { evm: OWNER }, admissions: [row([OTHER])], now: NOW });
  const policy = new FacilitatorGaslessPolicy(temporary.root, () => NOW.getTime()), operationId = "1".repeat(64);
  const intent = { profile: "avalanche", owner: { address: OWNER }, request: { recipient: RECIPIENT, grossAtomic: "1500000" } } as any;
  await assert.rejects(policy.prepare(intent, operationId), pinned);

  await activateDirectPolicy(temporary.root, "avalanche", { accounts: { evm: OWNER }, admissions: [row([OTHER, RECIPIENT])], now: NOW });
  const op = { operationId, intent: { ...intent, allowlist: await policy.prepare(intent, operationId) } } as any;
  await policy.assert(op, false);
  const stray = { ...op, intent: { ...op.intent, request: { ...intent.request, recipient: STRAY } } };
  await assert.rejects(policy.reserve(stray), pinned);
  await policy.reserve(op); await policy.assert(op, true);
  await assert.rejects(policy.assert(stray, true), pinned);
  const usage = await new AssetUsageLedger(temporary.root).usage({ account: OWNER, chain: "eip155:43114",
    asset: { kind: "token", identifier: getAddress(R.token) } }, NOW);
  assert.equal(usage.amountAtomic, "1500000");
});

test("Coinbase gasless: a recipient list satisfies the required pin and applies at prepare, approval and reservation", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const row = (recipients: readonly string[]) => gaslessRow("eip155:8453", gaslessDeployment(8453).token, COINBASE_GASLESS_MECHANISM, recipients);
  await activateDirectPolicy(temporary.root, "coinbase", { accounts: { evm: OWNER }, admissions: [row([OTHER])], now: NOW });
  const policy = new CoinbaseGaslessPolicy({ state: { root: temporary.root }, clock: { now: () => NOW } } as any);
  const op = { profile: "coinbase", walletAddress: OWNER, recipient: RECIPIENT, amountAtomic: "1000", operationId: "3".repeat(64) } as any;
  await assert.rejects(policy.prepare(op), pinned);

  await activateDirectPolicy(temporary.root, "coinbase", { accounts: { evm: OWNER }, admissions: [row([RECIPIENT, OTHER])], now: NOW });
  const bound = { ...op, providerDirect: { coinbaseGasless: { allowlist: await policy.prepare(op) } } };
  await policy.assert(bound); await policy.reserve(bound);
  await assert.rejects(policy.assert({ ...bound, recipient: STRAY }), pinned);
});

test("USDT gasless: the prepare admission (run before sponsor reads, after them and last) refuses an unlisted recipient", () => {
  const active = (recipients: readonly string[]): ActiveAssetPolicy => {
    const registry = sealAssetPolicyRegistry({ schemaVersion: "apn.asset-policy-registry.v2", registryVersion: "usdt-pins.1",
      publishedAt: "2026-09-18T00:00:00.000Z", effectiveDate: "2026-09-18", effectiveAt: "2026-09-18T00:00:00.000Z",
      chains: [{ chain: "eip155:1", family: "evm", name: "Ethereum", assets: [{ kind: "token", identifier: USDT_GASLESS.token, symbol: "USDT",
        decimals: 6, rails: { direct: false, gasless: true, x402: false, bridge: false, swap: false },
        railCaps: { gasless: { maximumPerTransferAtomic: "1000000", dailyLimitAtomic: "2000000" } },
        mechanismPins: { gasless: USDT_GASLESS.mechanism }, recipients: { gasless: [...recipients] } }] }] });
    return { profile: "owner", registry, digest: registry.policyDigest, revision: 1, activationDigest: "a".repeat(64),
      accounts: { evm: OWNER }, activatedAt: "2026-09-18T00:00:00.000Z" };
  };
  const request = { profile: "owner", chain: "eip155:1" as const, token: USDT_GASLESS.token, sponsorUrl: USDT_GASLESS.bundlerUrl,
    sender: OWNER, recipient: RECIPIENT, grossAtomic: 1_000_000n, maxFeeAtomic: 500_000n, minReceivedAtomic: 500_000n };
  assert.throws(() => requirePolicy(active([OTHER]), request, "0", NOW), pinned);
  assert.equal(requirePolicy(active([OTHER, RECIPIENT]), request, "0", NOW).revision, 1);
});
