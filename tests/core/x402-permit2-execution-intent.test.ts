import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readdir, lstat, readFile, writeFile, mkdir, symlink, chmod, access, rename } from "node:fs/promises";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { runCli } from "../../src/cli.js";
import { createMcpServer } from "../../src/mcp-server.js";
import { readPermit2IntentStatus } from "../../src/x402-permit2/status.js";
import { StateStore } from "../../src/state.js";
import { AssetUsageLedger as UsageLedger } from "../../src/asset-usage-ledger.js";
import { join } from "node:path";
import test from "node:test";
import type { PaymentRequired } from "@x402/core/types";
import { sealAssetPolicyRegistry, type UnsignedAssetPolicyRegistry } from "../../src/asset-policy-registry.js";
import { AssetUsageLedger, type AssetUsageReservation } from "../../src/asset-usage-ledger.js";
import { canonicalJson, domainHash, sha256 } from "../../src/canonical.js";
import { ApnError } from "../../src/errors.js";
import { SecureStateStore } from "../../src/secure-state-store.js";
import { temporaryState } from "./helpers.js";
import { Permit2ExecutionIntentJournal, type Permit2IntentInput, type Permit2IntentReadPort } from
  "../../src/x402-permit2/execution-intent.js";
import { Permit2ExposureLifecycle, permit2UsageIdentity, permit2UsageKey, permit2UsageReservationId,
  type Permit2EffectBinding, type Permit2EffectPorts } from
  "../../src/x402-permit2/exposure-lifecycle.js";
import { selectPermit2Offer } from "../../src/x402-permit2/offer.js";
import { hashChallenge, preparePermit2Payment, type Permit2PrepareInput } from "../../src/x402-permit2/prepare.js";
import { PERMIT2_ADDRESS, X402_EXACT_PERMIT2_PROXY, X402_PERMIT2_ASSETS, X402_PERMIT2_MECHANISM } from
  "../../src/x402-permit2/registry.js";

const accepts = (JSON.parse(readFileSync("tests/fixtures/x402-permit2/payment-required-accepts.json", "utf8")) as
  { accepts: unknown[] }).accepts;
const asset = X402_PERMIT2_ASSETS[0]!;
const payer = "0x5B38Da6a701c568545dCfcB03FcB875f56beddC4" as `0x${string}`;
const registry = sealAssetPolicyRegistry({
  schemaVersion: "apn.asset-policy-registry.v1", registryVersion: "permit2-test-v1",
  publishedAt: "2026-09-17T00:00:00.000Z", effectiveDate: "2026-09-17",
  chains: [{ chain: asset.chain, family: "evm", name: "Avalanche C-Chain", assets: [{
    kind: "token", identifier: asset.token, symbol: "USDT", decimals: 6,
    rails: { direct: false, gasless: false, x402: true, bridge: false, swap: false },
    caps: { maximumPerTransferAtomic: "20000", dailyLimitAtomic: "30000" },
    mechanismPins: { x402: X402_PERMIT2_MECHANISM },
  }] }],
} satisfies UnsignedAssetPolicyRegistry);
const challenge: PaymentRequired = { x402Version: 2, resource: { url: "https://seller.example/data" },
  accepts: accepts as PaymentRequired["accepts"] };
const selection = selectPermit2Offer(accepts, payer);
const original: Permit2PrepareInput = {
  payer, localWallet: true, challenge,
  expected: { index: selection.index, requirement: selection.requirement, challengeHash: hashChallenge(challenge) },
  owner: { active: true, account: payer, chain: asset.chain, token: asset.token, rail: "x402",
    mechanism: X402_PERMIT2_MECHANISM, maximumPerTransferAtomic: "20000", dailyLimitAtomic: "30000",
    usedTodayAtomic: "5000", policyDigest: registry.policyDigest },
  evidence: { chainId: 43114, account: payer, observedAtSeconds: 1_789_719_995,
    balanceAtomic: "20000", allowanceAtomic: "10000", tokenDomainSeparator: asset.tokenDomainSeparator,
    proxyCodeHash: asset.proxyCodeHash, permit2Deployed: true, nonceBitmapWordIndex: "0",
    nonceBitmapWord: `0x${"0".repeat(64)}`, eip2612Nonce: null,
    facilitator: { available: true, network: asset.chain, scheme: "exact", asset: asset.token,
      assetTransferMethod: "permit2", permit2Address: PERMIT2_ADDRESS, exactProxy: X402_EXACT_PERMIT2_PROXY,
      eip2612GasSponsoring: false } }, nowSeconds: 1_789_720_000, nonce: 7n,
};
const prepared = preparePermit2Payment(original);
const request: Permit2IntentInput = { profile: "owner", idempotencyKey: "permit2-test-key-001", prepared,
  challenge, merchantOrigin: "https://seller.example", resourceUrl: "https://seller.example/data",
  facilitatorEndpoint: "https://facilitator.payai.network", minimumGasAtomic: "100", nowSeconds: 1_789_720_005 };
const port = (changes: Partial<Awaited<ReturnType<Permit2IntentReadPort["read"]>>> = {}): Permit2IntentReadPort =>
  ({ read: async () => ({ owner: original.owner,
    evidence: { ...original.evidence, observedAtSeconds: request.nowSeconds }, gasBalanceAtomic: "1000",
    binding: { walletProfile: "owner", walletAccount: payer, policyProfile: "owner",
      policyDigest: original.owner.policyDigest },
    facilitatorEndpoint: request.facilitatorEndpoint, ...changes }) });
const errorCode = (code: string) => (error: unknown) => error instanceof ApnError && error.code === code;

test("concurrent identical intent is one durable blocked operation with an intended reservation", async (t) => {
  const state = await temporaryState(); t.after(state.cleanup);
  const a = new Permit2ExecutionIntentJournal(state.root), b = new Permit2ExecutionIntentJournal(state.root);
  const [first, second] = await Promise.all([a.create(request, port()), b.create(request, port())]);
  assert.deepEqual(first, second);
  assert.equal(first.capability, "execution_blocked");
  assert.equal(first.reservationState, "intended");
  assert.equal(first.token, asset.token);
  assert.equal(first.merchantOrigin, request.merchantOrigin);
  assert.match(first.typedDataDigest, /^0x[0-9a-f]{64}$/u);
  assert.deepEqual(await b.load(first.operationId), first);
});

test("changed material conflicts and tampered chain, recipient, digest, domain or merchant refuse", async (t) => {
  const state = await temporaryState(); t.after(state.cleanup);
  const journal = new Permit2ExecutionIntentJournal(state.root);
  const first = await journal.create(request, port());
  await assert.rejects(journal.create({ ...request, minimumGasAtomic: "101" }, port()), errorCode("APN_IDEMPOTENCY_CONFLICT"));
  for (const altered of [
    { ...prepared, chain: "eip155:1" as typeof prepared.chain },
    { ...prepared, payTo: payer },
    { ...prepared, plan: { ...prepared.plan, permit2: { ...prepared.plan.permit2,
      domain: { ...prepared.plan.permit2.domain, chainId: 1 } } } },
    { ...prepared, plan: { ...prepared.plan, authorization: { ...prepared.plan.authorization, nonce: "8" } } },
  ]) await assert.rejects(journal.create({ ...request, idempotencyKey: "permit2-tamper-key-002", prepared: altered }, port()),
    errorCode("APN_OPERATION_BLOCKED"));
  await assert.rejects(journal.create({ ...request, merchantOrigin: "https://attacker.example" }, port()),
    errorCode("APN_OPERATION_BLOCKED"));
  await assert.rejects(journal.create({ ...request, idempotencyKey: "permit2-facilitator-003" },
    port({ facilitatorEndpoint: "https://other.example" })), errorCode("APN_OPERATION_BLOCKED"));
  assert.deepEqual(await journal.load(first.operationId), first);
});

test("insufficient token or gas and stale policy leave no partial intent or reservation", async (t) => {
  const state = await temporaryState(); t.after(state.cleanup);
  const journal = new Permit2ExecutionIntentJournal(state.root);
  await assert.rejects(journal.create(request, port({ evidence: { ...original.evidence,
    observedAtSeconds: request.nowSeconds, balanceAtomic: "9999" } })), errorCode("APN_X402_UNSUPPORTED_OFFER"));
  await assert.rejects(journal.create(request, port({ gasBalanceAtomic: "99" })), errorCode("APN_INSUFFICIENT_GAS"));
  await assert.rejects(journal.create(request, port({ owner: { ...original.owner, policyDigest: "b".repeat(64) } })),
    errorCode("APN_OPERATION_BLOCKED"));
  assert.equal(await journal.load(journal.operationId("owner", request.idempotencyKey)), null);
});

test("two profiles cannot journal owner A material under profile B", async (t) => {
  const state = await temporaryState(); t.after(state.cleanup);
  const journal = new Permit2ExecutionIntentJournal(state.root);
  const other = { ...request, profile: "other-owner" };
  await assert.rejects(journal.create(other, port()), errorCode("APN_OPERATION_BLOCKED"));
  assert.equal(await journal.load(journal.operationId("other-owner", request.idempotencyKey)), null);
  // A forged label for the other profile still fails when its authenticated wallet is distinct.
  await assert.rejects(journal.create(other, port({ binding: { walletProfile: "other-owner",
    walletAccount: "0x1111111111111111111111111111111111111111", policyProfile: "other-owner",
    policyDigest: original.owner.policyDigest } })), errorCode("APN_OPERATION_BLOCKED"));
  assert.equal(await journal.load(journal.operationId("other-owner", request.idempotencyKey)), null);
});

test("first use syncs the journal parent before publication and retries after a failed sync", async (t) => {
  const state = await temporaryState(); t.after(state.cleanup);
  class FailingFirstSync extends Permit2ExecutionIntentJournal {
    attempts = 0;
    protected override async syncIntentDirectoryParent(): Promise<void> {
      this.attempts++;
      if (this.attempts === 1) throw new Error("directory fsync unavailable");
      await super.syncIntentDirectoryParent();
    }
  }
  const journal = new FailingFirstSync(state.root);
  let reads = 0;
  const reader: Permit2IntentReadPort = { read: async (input) => {
    reads++;
    return port().read(input);
  } };
  await assert.rejects(journal.create(request, reader), errorCode("APN_STATE_SECURITY"));
  assert.equal(reads, 0);
  assert.deepEqual(await readdir(join(state.root, "permit2-intents")), []);
  const result = await journal.create(request, reader);
  assert.equal(result.capability, "execution_blocked");
  assert.ok(journal.attempts >= 2);
  assert.equal(reads, 1);
});

test("read only prepare creates no operation and has no paid outcome", async (t) => {
  const state = await temporaryState(); t.after(state.cleanup);
  const journal = new Permit2ExecutionIntentJournal(state.root);
  assert.equal(preparePermit2Payment(original).prepareHash, prepared.prepareHash);
  assert.equal(await journal.load(journal.operationId("owner", request.idempotencyKey)), null);
  const intent = await journal.create(request, port());
  assert.equal("paid" in intent, false);
  assert.equal("signature" in intent, false);
  assert.equal("transactionHash" in intent, false);
});

function fakeEffects(changes: Partial<Permit2EffectPorts> = {}) {
  const calls = { reserve: 0, sign: 0, submit: 0, observe: 0 };
  const reservations = new Map<string, AssetUsageReservation>();
  const time = { nowSeconds: request.nowSeconds };
  const ports: Permit2EffectPorts = {
    nowSeconds: () => time.nowSeconds,
    reserve: async binding => { calls.reserve++; const id = permit2UsageReservationId(binding);
      const prior = reservations.get(id);
      if (prior !== undefined) return prior;
      const body = { schemaVersion: "apn.asset-usage-reservation.v1" as const,
        ...permit2UsageIdentity(binding), reservationId: id,
        idempotencyHash: sha256(`asset-usage-idempotency\0${permit2UsageKey(binding)}`),
        policyDigest: binding.policyDigest, registryVersion: registry.registryVersion, rail: "x402" as const,
        amountAtomic: binding.amountAtomic, state: "reserved" as const,
        reservedAt: new Date(time.nowSeconds * 1000).toISOString(),
        updatedAt: new Date(time.nowSeconds * 1000).toISOString(), effectAt: null, outcomeDigest: null };
      const record = { ...body, reservationDigest: domainHash(body.schemaVersion, canonicalJson(body)) };
      reservations.set(id, record); return record; },
    lookup: async binding => reservations.get(permit2UsageReservationId(binding)) ?? null,
    sign: async () => { calls.sign++; return "fake-authorization"; },
    submit: async (_binding, authorization) => { calls.submit++; assert.equal(authorization, "fake-authorization");
      return { reference: "fake-reference" }; },
    observe: async () => { calls.observe++; return null; },
    ...changes,
  };
  return { ports, calls, reservations, time };
}

test("reservation crash before and after the port call reuses the exact reservation", async (t) => {
  const state = await temporaryState(); t.after(state.cleanup);
  const intent = await new Permit2ExecutionIntentJournal(state.root).create(request, port());
  class CrashAtReserved extends Permit2ExposureLifecycle {
    fail = true;
    protected override async writeJson(path: string, value: unknown, createOnly = false): Promise<void> {
      if (this.fail && path.startsWith("permit2-exposures/") &&
          (value as { state?: string }).state === "reserved") { this.fail = false; throw new Error("crash after reserve"); }
      await super.writeJson(path, value, createOnly);
    }
  }
  const effects = fakeEffects();
  const crash = new CrashAtReserved(state.root);
  await assert.rejects(crash.resume(intent.operationId, prepared, effects.ports), /crash after reserve/u);
  assert.equal((await crash.load(intent.operationId))?.state, "reserving");
  assert.deepEqual(effects.calls, { reserve: 1, sign: 0, submit: 0, observe: 0 });
  const resumed = await new Permit2ExposureLifecycle(state.root).resume(intent.operationId, prepared, effects.ports);
  assert.equal(resumed.state, "submitted_pending");
  assert.deepEqual(effects.calls, { reserve: 2, sign: 1, submit: 1, observe: 0 });
  assert.equal(effects.reservations.size, 1);
  await new Permit2ExposureLifecycle(state.root).resume(intent.operationId, prepared, effects.ports);
  assert.deepEqual(effects.calls, { reserve: 2, sign: 1, submit: 1, observe: 0 });
});

test("reservation port failure before persistence cannot reach signer or submitter", async (t) => {
  const state = await temporaryState(); t.after(state.cleanup);
  const intent = await new Permit2ExecutionIntentJournal(state.root).create(request, port());
  const failed = fakeEffects({ reserve: async () => { throw new Error("reservation unavailable"); } });
  const lifecycle = new Permit2ExposureLifecycle(state.root);
  await assert.rejects(lifecycle.resume(intent.operationId, prepared, failed.ports),
    /reservation unavailable/u);
  assert.equal((await lifecycle.load(intent.operationId))?.state, "reserving");
  assert.deepEqual(failed.calls, { reserve: 0, sign: 0, submit: 0, observe: 0 });
  const retry = fakeEffects();
  assert.equal((await new Permit2ExposureLifecycle(state.root).resume(intent.operationId, prepared,
    retry.ports)).state, "submitted_pending");
  assert.deepEqual(retry.calls, { reserve: 1, sign: 1, submit: 1, observe: 0 });
});

test("reservation port can acquire the exposure lock and concurrent resumes sign once", async (t) => {
  const state = await temporaryState(); t.after(state.cleanup);
  const intent = await new Permit2ExecutionIntentJournal(state.root).create(request, port());
  const probe = new SecureStateStore(state.root);
  const effects = fakeEffects();
  const reserve = effects.ports.reserve;
  let arrivals = 0;
  let release!: () => void;
  const bothReserved = new Promise<void>(resolve => { release = resolve; });
  effects.ports.reserve = async binding => {
    const result = await probe.withLocks([`permit2-exposure:${intent.operationId}`],
      async () => await reserve(binding), { waitMs: 100 });
    if (++arrivals === 2) release();
    await bothReserved;
    return result;
  };
  const [a, b] = await Promise.all([
    new Permit2ExposureLifecycle(state.root).resume(intent.operationId, prepared, effects.ports),
    new Permit2ExposureLifecycle(state.root).resume(intent.operationId, prepared, effects.ports),
  ]);
  assert.equal(arrivals, 2);
  assert.equal(a.state, "submitted_pending");
  assert.equal(b.state, "submitted_pending");
  assert.deepEqual(effects.calls, { reserve: 2, sign: 1, submit: 1, observe: 0 });
  assert.equal(effects.reservations.size, 1);
});

test("real common usage ledger computes and persists a distinct exact lease ID", async (t) => {
  const state = await temporaryState(); t.after(state.cleanup);
  const intent = await new Permit2ExecutionIntentJournal(state.root).create(request, port());
  const ledger = new AssetUsageLedger(state.root);
  const effects = fakeEffects({
    reserve: async binding => await ledger.reserve({ ...permit2UsageIdentity(binding), registry, rail: "x402",
      amountAtomic: binding.amountAtomic, idempotencyKey: permit2UsageKey(binding),
      now: new Date(request.nowSeconds * 1000) }),
    lookup: async binding => await ledger.load(permit2UsageIdentity(binding), permit2UsageReservationId(binding)),
  });
  const lifecycle = new Permit2ExposureLifecycle(state.root);
  const result = await lifecycle.resume(intent.operationId, prepared, effects.ports);
  const actualId = permit2UsageReservationId(intent);
  assert.notEqual(actualId, intent.reservationId);
  assert.equal(result.usageReservationId, actualId);
  const lease = await ledger.load(permit2UsageIdentity(intent), actualId);
  assert.equal(result.usageReservationDigest, lease?.reservationDigest);
  assert.equal(lease?.policyDigest, intent.policyDigest);
  assert.equal(lease?.state, "reserved");
  assert.equal((await new Permit2ExposureLifecycle(state.root).resume(intent.operationId, prepared,
    effects.ports)).integrityHash, result.integrityHash);
});

test("expired reserving retry only looks up an existing lease and never creates a new cap hold", async (t) => {
  const state = await temporaryState(); t.after(state.cleanup);
  const intent = await new Permit2ExecutionIntentJournal(state.root).create(request, port());
  const effects = fakeEffects();
  let reserveCalls = 0;
  effects.ports.reserve = async () => { reserveCalls++; throw new Error("reserve failed before lease"); };
  const lifecycle = new Permit2ExposureLifecycle(state.root);
  await assert.rejects(lifecycle.resume(intent.operationId, prepared, effects.ports), /reserve failed before lease/u);
  effects.time.nowSeconds = Number(intent.deadline) + 1;
  assert.equal((await new Permit2ExposureLifecycle(state.root).resume(intent.operationId, prepared,
    effects.ports)).state, "reserving");
  assert.equal(reserveCalls, 1);
  assert.equal(effects.reservations.size, 0);
  assert.equal(effects.calls.sign, 0);
});

test("expired reserving retry recovers a lease created before crash without signing", async (t) => {
  const state = await temporaryState(); t.after(state.cleanup);
  const intent = await new Permit2ExecutionIntentJournal(state.root).create(request, port());
  class CrashAfterReserve extends Permit2ExposureLifecycle {
    protected override async writeJson(path: string, value: unknown, createOnly = false): Promise<void> {
      if (path.startsWith("permit2-exposures/") && (value as { state?: string }).state === "reserved") {
        throw new Error("crash after ledger reserve");
      }
      await super.writeJson(path, value, createOnly);
    }
  }
  const effects = fakeEffects();
  await assert.rejects(new CrashAfterReserve(state.root).resume(intent.operationId, prepared,
    effects.ports), /crash after ledger reserve/u);
  assert.equal(effects.reservations.size, 1);
  effects.time.nowSeconds = Number(intent.deadline) + 1;
  const recovered = await new Permit2ExposureLifecycle(state.root).resume(intent.operationId, prepared, effects.ports);
  assert.equal(recovered.state, "reserved");
  assert.equal(recovered.usageReservationId, permit2UsageReservationId(intent));
  assert.deepEqual(effects.calls, { reserve: 1, sign: 0, submit: 0, observe: 0 });
});

test("crash before exposure publication cannot reach signer; after signer handoff never signs again", async (t) => {
  const state = await temporaryState(); t.after(state.cleanup);
  const intent = await new Permit2ExecutionIntentJournal(state.root).create(request, port());
  class CrashAtExposure extends Permit2ExposureLifecycle {
    fail = true;
    protected override async writeJson(path: string, value: unknown, createOnly = false): Promise<void> {
      if (this.fail && path.startsWith("permit2-exposures/") &&
          (value as { state?: string }).state === "exposure_unknown") { this.fail = false; throw new Error("crash before handoff"); }
      await super.writeJson(path, value, createOnly);
    }
  }
  const effects = fakeEffects();
  const crash = new CrashAtExposure(state.root);
  await assert.rejects(crash.resume(intent.operationId, prepared, effects.ports), /crash before handoff/u);
  assert.equal((await crash.load(intent.operationId))?.state, "reserved");
  assert.equal(effects.calls.sign, 0);
  const signing = fakeEffects({ sign: async () => { effects.calls.sign++; throw new Error("signer handoff lost"); } });
  await assert.rejects(new Permit2ExposureLifecycle(state.root).resume(intent.operationId, prepared,
    signing.ports), /signer handoff lost/u);
  assert.equal((await crash.load(intent.operationId))?.state, "exposure_unknown");
  const retry = fakeEffects();
  await new Permit2ExposureLifecycle(state.root).resume(intent.operationId, prepared, retry.ports);
  assert.deepEqual(retry.calls, { reserve: 0, sign: 0, submit: 0, observe: 0 });
  assert.equal(effects.calls.sign, 1);
});

test("ambiguous submission, 429, not-found and repeated resume retain unknown exposure", async (t) => {
  const state = await temporaryState(); t.after(state.cleanup);
  const intent = await new Permit2ExecutionIntentJournal(state.root).create(request, port());
  const effects = fakeEffects({ submit: async () => { throw new Error("submission timed out"); } });
  await assert.rejects(new Permit2ExposureLifecycle(state.root).resume(intent.operationId, prepared,
    effects.ports), /submission timed out/u);
  const lifecycle = new Permit2ExposureLifecycle(state.root);
  assert.equal((await lifecycle.load(intent.operationId))?.state, "exposure_unknown");
  const read = fakeEffects({ observe: async () => { throw new Error("429"); } });
  assert.equal((await lifecycle.reconcile(intent.operationId, read.ports)).state, "exposure_unknown");
  assert.equal((await lifecycle.reconcile(intent.operationId, { observe: async () => null })).state, "exposure_unknown");
  await lifecycle.resume(intent.operationId, prepared, read.ports);
  assert.deepEqual(read.calls, { reserve: 0, sign: 0, submit: 0, observe: 0 });
  assert.equal((await lifecycle.load(intent.operationId))?.proofDigest, null);
});

test("acknowledged submission settles only through observation; no production signer or sender is wired", async (t) => {
  const state = await temporaryState(); t.after(state.cleanup);
  const intent = await new Permit2ExecutionIntentJournal(state.root).create(request, port());
  const effects = fakeEffects();
  assert.equal((await new Permit2ExecutionIntentJournal(state.root).load(intent.operationId))?.capability, "execution_blocked");
  assert.deepEqual(effects.calls, { reserve: 0, sign: 0, submit: 0, observe: 0 });
  const lifecycle = new Permit2ExposureLifecycle(state.root);
  assert.equal((await lifecycle.resume(intent.operationId, prepared, effects.ports)).state, "submitted_pending");
  assert.equal((await lifecycle.reconcile(intent.operationId, { observe: async () => ({ kind: "pending" }) })).state,
    "submitted_pending");
  const settled = await lifecycle.reconcile(intent.operationId,
    { observe: async () => ({ kind: "settled", proofDigest: "b".repeat(64) }) });
  assert.equal(settled.state, "settled");
  assert.equal((await lifecycle.reconcile(intent.operationId, readOnlyObserve())).integrityHash, settled.integrityHash);
  assert.equal(readFileSync("src/runtime-factory.ts", "utf8").includes("Permit2ExposureLifecycle"), false);
  assert.equal(readFileSync("src/x402-permit2/exposure-lifecycle.ts", "utf8").includes("createPermit2Production"), false);
});

test("forged prepared signing data cannot reach reservation or signer", async (t) => {
  const state = await temporaryState(); t.after(state.cleanup);
  const intent = await new Permit2ExecutionIntentJournal(state.root).create(request, port());
  const effects = fakeEffects();
  const forged = { ...prepared, plan: { ...prepared.plan, permit2: { ...prepared.plan.permit2,
    message: { ...prepared.plan.permit2.message, nonce: 8n } } } };
  await assert.rejects(new Permit2ExposureLifecycle(state.root).resume(intent.operationId, forged, effects.ports), errorCode("APN_OPERATION_BLOCKED"));
  assert.deepEqual(effects.calls, { reserve: 0, sign: 0, submit: 0, observe: 0 });
  assert.equal(await new Permit2ExposureLifecycle(state.root).load(intent.operationId), null);
});

function readOnlyObserve(): Pick<Permit2EffectPorts, "observe"> {
  return { observe: async () => { throw new Error("settled replay must not observe"); } };
}

async function statusTree(root: string): Promise<unknown[]> {
  const result: unknown[] = [];
  async function visit(path: string): Promise<void> {
    const info = await lstat(path);
    result.push([path, info.mode, info.ino, info.size, info.mtimeMs, info.ctimeMs,
      info.isFile() ? await readFile(path, "utf8") : null]);
    if (info.isDirectory()) for (const name of (await readdir(path)).sort()) await visit(join(path, name));
  }
  await visit(root); return result;
}

test("Permit2 existing status is redacted CLI/MCP parity with no state or effect access", async (t) => {
  const state = await temporaryState(); t.after(state.cleanup);
  const intent = await new Permit2ExecutionIntentJournal(state.root).create(request, port());
  const before = await statusTree(state.root);
  const forbidden = () => { throw new Error("status attempted a forbidden effect"); };
  t.mock.method(Permit2ExecutionIntentJournal.prototype, "load", forbidden);
  t.mock.method(Permit2ExecutionIntentJournal.prototype, "create", forbidden);
  t.mock.method(SecureStateStore.prototype, "initialize", forbidden);
  t.mock.method(StateStore.prototype, "initialize", forbidden);
  t.mock.method(UsageLedger.prototype, "reserve", forbidden);
  t.mock.method(globalThis, "fetch", forbidden);
  const options = { stateRoot: state.root, native: { request: async () => forbidden() },
    wrappingSecret: { load: async () => forbidden(), create: async () => forbidden() } };
  const cli = await runCli(["x402", "permit2", "status", "--profile", "owner", "--operation", intent.operationId], {}, options);
  assert.equal(cli.ok, true);
  const server = createMcpServer(options);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "permit2-status-test", version: "1" });
  await client.connect(clientTransport);
  try {
    const result = await client.callTool({ name: "apn_x402_permit2_status", arguments: { profile: "owner", operation: intent.operationId } });
    const mcp = result.structuredContent as typeof cli;
    assert.equal(mcp?.ok, true);
    assert.deepEqual(mcp?.data, cli.data);
    assert.deepEqual(Object.keys(cli.data as object).sort(), ["blockerCodes", "capability", "chain", "operationId", "owner", "profile", "recipient", "state", "token"].sort());
    assert.equal((cli.data as { state: string }).state, "execution_blocked");
    assert.equal(JSON.stringify(cli.data).includes(intent.typedDataDigest), false);
  } finally { await client.close(); await server.close(); }
  await assert.rejects(readPermit2IntentStatus(state.root, "other", intent.operationId), errorCode("APN_OPERATION_BLOCKED"));
  assert.deepEqual(await statusTree(state.root), before);
});

test("Permit2 missing roots stay absent and invalid IDs fail closed", async (t) => {
  const state = await temporaryState(); t.after(state.cleanup);
  const missing = join(state.base, "missing-status-root");
  const status = await readPermit2IntentStatus(missing, "owner", "a".repeat(64));
  assert.equal(status.state, "not_found");
  await assert.rejects(access(missing));
  for (const id of ["../escape", "A".repeat(64), "a".repeat(63)]) {
    await assert.rejects(readPermit2IntentStatus(missing, "owner", id), errorCode("APN_INVALID_INPUT"));
  }
  await assert.rejects(access(missing));
  await mkdir(state.root, { mode: 0o700 });
  const before = await statusTree(state.root);
  assert.equal((await readPermit2IntentStatus(state.root, "owner", "a".repeat(64))).state, "not_found");
  assert.deepEqual(await statusTree(state.root), before);
});

test("Permit2 status rejects malformed, corrupt, insecure and symlink records without repair", async (t) => {
  const state = await temporaryState(); t.after(state.cleanup);
  const intent = await new Permit2ExecutionIntentJournal(state.root).create(request, port());
  const path = join(state.root, "permit2-intents", `${intent.operationId}.json`);
  const { integrityHash: _hash, ...body } = intent;
  const malformed = { ...body, owner: "secret", profileHash: 12 };
  for (const bytes of ["{", canonicalJson({ ...intent, recipient: payer }), canonicalJson({ ...intent, unexpected: "signature" }),
    canonicalJson({ ...malformed, integrityHash: domainHash("apn.x402-permit2.execution-intent.v1", canonicalJson(malformed)) })]) {
    await writeFile(path, bytes, { mode: 0o600 });
    const before = await statusTree(state.root);
    await assert.rejects(readPermit2IntentStatus(state.root, "owner", intent.operationId), errorCode("APN_STATE_CORRUPT"));
    assert.deepEqual(await statusTree(state.root), before);
  }
  await writeFile(path, canonicalJson(intent)); await chmod(path, 0o644);
  await assert.rejects(readPermit2IntentStatus(state.root, "owner", intent.operationId), errorCode("APN_STATE_SECURITY"));
  const other = join(state.base, "status-link-root"); await symlink(state.root, other);
  await assert.rejects(readPermit2IntentStatus(other, "owner", intent.operationId), errorCode("APN_STATE_SECURITY"));
  await chmod(path, 0o600);
  const linkId = "b".repeat(64); await symlink(path, join(state.root, "permit2-intents", `${linkId}.json`));
  await assert.rejects(readPermit2IntentStatus(state.root, "owner", linkId), errorCode("APN_STATE_SECURITY"));
  const directory = join(state.root, "permit2-intents");
  const moved = join(state.root, "moved-intents"); await rename(directory, moved); await symlink(moved, directory);
  await assert.rejects(readPermit2IntentStatus(state.root, "owner", intent.operationId), errorCode("APN_STATE_SECURITY"));
});
