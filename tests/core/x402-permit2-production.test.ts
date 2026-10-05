import assert from "node:assert/strict";
import test from "node:test";
import { readFile, writeFile, lstat, symlink } from "node:fs/promises";
import { join } from "node:path";
import { StateStore, sealWallet } from "../../src/state.js";
import { STATE_VERSION } from "../../src/constants.js";
import { hashObject, canonicalJson, domainHash } from "../../src/canonical.js";
import { AssetUsageLedger } from "../../src/asset-usage-ledger.js";
import { loadActiveAssetPolicyRegistry } from "../../src/allowlist-active-policy.js";
import { OperationService } from "../../src/operation-service.js";
import { checkPermit2Challenge } from "../../src/x402-permit2/checked-challenge.js";
import { hashChallenge } from "../../src/x402-permit2/prepare.js";
import { selectPermit2Offer } from "../../src/x402-permit2/offer.js";
import { Permit2ProductionPreparation } from "../../src/x402-permit2/production-prepare.js";
import { PERMIT2_PRODUCTION_SCHEMA, validatePermit2ProductionMaterial, reconstructPermit2ProductionMaterial } from "../../src/x402-permit2/production-material.js";
import { Permit2ProductionRepository, permit2ProductionId, publicPermit2Production, productionUsageIdentity,
  productionRecordBody, sealPermit2ProductionRecord } from "../../src/x402-permit2/production-repository.js";
import { PERMIT2_ADDRESS, PERMIT2_CODE_HASH, X402_EXACT_PERMIT2_PROXY, X402_PERMIT2_ASSETS, X402_PERMIT2_MECHANISM } from "../../src/x402-permit2/registry.js";
import type { X402PaymentRequired } from "../../src/x402-codec.js";
import { temporaryState } from "./helpers.js";
import { activateDirectPolicy, revokeDirectPolicy } from "./direct-allowlist-helpers.js";

const asset = X402_PERMIT2_ASSETS[0]!, payer = "0x5B38Da6a701c568545dCfcB03FcB875f56beddC4" as const;
const at = new Date("2026-09-23T04:00:00.000Z");
const declaration = { info: { description: "EIP-2612", version: "1" }, schema: {
  $schema: "https://json-schema.org/draft/2020-12/schema", type: "object",
  properties: Object.fromEntries(["from", "asset", "spender", "amount", "nonce", "deadline", "signature", "version"].map(name => [name, { type: "string", pattern: ".*" }])),
  required: ["from", "asset", "spender", "amount", "nonce", "deadline", "signature", "version"] } };
const word = (n: bigint) => `0x${n.toString(16).padStart(64, "0")}`;
function challenge(sponsor = false, hints = sponsor): X402PaymentRequired {
  return { x402Version: 2, resource: { url: "https://seller.example/data?private=hidden" },
    accepts: [{ scheme: "exact", network: asset.chain, asset: asset.token, amount: "10000",
      payTo: "0x2222222222222222222222222222222222222222", maxTimeoutSeconds: 60,
      extra: { assetTransferMethod: "permit2", ...(hints ? asset.tokenDomain : {}) } }],
    ...(sponsor ? { extensions: { eip2612GasSponsoring: declaration } } : {}) };
}
function input(key = "production-test-key-001", ch = challenge()) {
  const selection = selectPermit2Offer(ch.accepts, payer);
  return { profile: "owner", idempotencyKey: key,
    checked: checkPermit2Challenge(ch, { schemaVersion: "apn.http-request.v1", url: ch.resource.url,
      method: "POST", headers: { "content-type": "application/json" }, bodyBase64: Buffer.from("private-body").toString("base64") }),
    expected: { index: selection.index, requirement: selection.requirement, challengeHash: hashChallenge(ch) } };
}
async function setup(t: test.TestContext, options: { allowance?: bigint; sponsor?: boolean; badDomain?: boolean; badProxy?: boolean } = {}) {
  const temp = await temporaryState(); t.after(temp.cleanup);
  const state = new StateStore(temp.root); await state.initialize();
  const bindingHash = hashObject({ profile: "owner", address: payer, createdAt: at.toISOString() });
  await state.writeWallet(sealWallet({ schemaVersion: STATE_VERSION, profile: "owner", profileHash: state.profileHash("owner"),
    address: payer, createdAt: at.toISOString(), bindingHash }));
  await state.writeEncryptedWalletEnvelope("owner", { schemaVersion: "apn.wallet-envelope.v1",
    identity: { profile: "owner", address: payer, chainId: 8453, createdAt: at.toISOString(), bindingHash },
    kdf: { name: "HKDF-SHA-256", salt: "fixture" }, cipher: { name: "AES-256-GCM", nonce: "fixture", ciphertext: "fixture", tag: "fixture" } });
  async function activate(cap = "10000", daily = "10000") {
    await activateDirectPolicy(temp.root, "owner", { accounts: { evm: payer }, now: at,
      admissions: [{ chain: asset.chain, kind: "token", identifier: asset.token, rail: "x402",
        maximumPerTransferAtomic: cap, dailyLimitAtomic: daily, mechanism: X402_PERMIT2_MECHANISM }] });
  }
  await activate();
  let clock = new Date(at), calls: string[] = [], ethCalls = 0, httpCalls = 0;
  const service = new Permit2ProductionPreparation(temp.root, { now: () => clock,
    rpc: { call: async (method, params) => {
      calls.push(method);
      if (method === "eth_chainId") return "0xa86a";
      if (method === "eth_getBlockByNumber") return { number: "0x12", hash: `0x${"1".repeat(64)}`, timestamp: `0x${Math.floor(clock.getTime() / 1000).toString(16)}` };
      if (method === "eth_call") return [word(20000n), word(options.allowance ?? 10000n), options.badDomain ? word(0n) : asset.tokenDomainSeparator,
        word(9n), word(0n)][ethCalls++ % 5];
      if (method === "eth_getProof") return { address: params[0], codeHash: params[0] === PERMIT2_ADDRESS ? PERMIT2_CODE_HASH : options.badProxy ? word(0n) : asset.proxyCodeHash };
      throw new Error(`Unexpected ${method}`);
    } }, transport: { request: async (url, method, body) => {
      httpCalls++; assert.equal(url, "https://facilitator.payai.network/supported"); assert.equal(method, "GET"); assert.equal(body, null);
      return { status: 200, body: JSON.stringify({ kinds: [{ x402Version: 2, network: asset.chain, scheme: "exact" }],
        extensions: options.sponsor ? ["eip2612GasSponsoring"] : [] }) };
    } } });
  return { ...temp, state, service, calls, activate, httpCount: () => httpCalls, advance: (seconds: number) => { clock = new Date(at.getTime() + seconds * 1000); } };
}

test("durable exact private preparation replays immutable nonce before reads; changed request/challenge conflicts", async t => {
  const f = await setup(t), request = input();
  const [a, b] = await Promise.all([f.service.prepare(request), f.service.prepare(request)]);
  assert.deepEqual(a, b); assert.equal(f.calls.length, 10); assert.equal(f.httpCount(), 1);
  assert.equal(a.operationId, permit2ProductionId("owner", request.idempotencyKey));
  assert.notEqual(a.operationId, f.state.operationId("owner", request.idempotencyKey));
  assert.equal(a.material.checked.request.method, "POST"); assert.equal(a.material.checked.request.bodyBase64, request.checked.request.bodyBase64);
  assert.equal((await lstat(join(f.root, "permit2-production", `${a.operationId}.json`))).mode & 0o777, 0o600);
  assert.equal((await lstat(join(f.root, "permit2-production"))).mode & 0o777, 0o700);
  const publicValue = JSON.stringify(publicPermit2Production(a));
  for (const secret of ["hidden", "private-body", "content-type", "bodyBase64"]) assert.equal(publicValue.includes(secret), false);
  assert.equal(publicPermit2Production(a).capability, "execution_blocked");
  f.advance(120); assert.deepEqual(await f.service.prepare(request), a); assert.equal(f.calls.length, 10);
  for (const change of [{ method: "GET" }, { headers: { accept: "application/json" } }, { bodyBase64: null }]) {
    const changed = { ...request, checked: checkPermit2Challenge(request.checked.challenge, { ...request.checked.request, ...change }) };
    await assert.rejects(f.service.prepare(changed), { code: "APN_IDEMPOTENCY_CONFLICT" });
  }
  const ch = challenge(); ch.accepts[0]!.amount = "9999";
  await assert.rejects(f.service.prepare(input(request.idempotencyKey, ch)), { code: "APN_IDEMPOTENCY_CONFLICT" });
});

test("reconstructed frozen material rejects rehashed plan, nonce, domain, checkpoint and unknown fields", async t => {
  const f = await setup(t), record = await f.service.prepare(input());
  assert.equal(reconstructPermit2ProductionMaterial(record.material).amountAtomic, "10000");
  for (const changes of [{ nonce: "01" }, { preparedCanonicalJson: "{}" },
    { checkpoint: { ...record.material.checkpoint, blockHash: "invalid" } },
    { wallet: { ...record.material.wallet, bindingHash: "invalid" } }, { extra: true }]) {
    const { materialHash: _hash, ...body } = { ...record.material, ...changes };
    await assert.rejects(async () => validatePermit2ProductionMaterial({ ...body,
      materialHash: domainHash(`${PERMIT2_PRODUCTION_SCHEMA}.material`, canonicalJson(body)) }), { code: "APN_STATE_CORRUPT" });
  }
  await assert.rejects(async () => checkPermit2Challenge(challenge(), { ...input().checked.request, headers: { authorization: "Bearer secret" } }), { code: "APN_INVALID_INPUT" });
  await assert.rejects(async () => checkPermit2Challenge(challenge(), { ...input().checked.request, url: "https://seller.example/other" }));
});

test("sponsored branch accepts zero-native route only with matching merchant domain and exact checked contracts", async t => {
  const f = await setup(t, { allowance: 0n, sponsor: true });
  const record = await f.service.prepare(input("sponsored-valid-key-001", challenge(true)));
  assert.notEqual(reconstructPermit2ProductionMaterial(record.material).plan.eip2612, null);
  assert.equal(f.calls.includes("eth_getBalance"), false);
  const bad = await setup(t, { allowance: 0n, sponsor: true });
  await assert.rejects(bad.service.prepare(input("sponsored-missing-hints", challenge(true, false))));
  const noSponsor = await setup(t, { allowance: 0n }); await assert.rejects(noSponsor.service.prepare(input()));
  const badDomain = await setup(t, { badDomain: true }); await assert.rejects(badDomain.service.prepare(input()));
  const badProxy = await setup(t, { badProxy: true }); await assert.rejects(badProxy.service.prepare(input()));
});

test("real common lease recovers reserving crash, own hold counts once and unsigned expiry repairs terminal release", async t => {
  const f = await setup(t), a = await f.service.prepare(input());
  const records = f.service.records;
  const original = records.persistLocked.bind(records); let crash = true;
  records.persistLocked = async (record, createOnly) => { if (record.state === "reserved" && crash) { crash = false; throw new Error("crash after ledger reserve"); } return original(record, createOnly); };
  await assert.rejects(f.service.reserve(a.operationId), /crash/);
  assert.equal((await records.findOperation(a.operationId))!.state, "reserving");
  const reserved = await f.service.reserve(a.operationId);
  assert.equal(reserved.state, "reserved"); await f.service.assertCurrentOwner(a.operationId);
  const ledger = new AssetUsageLedger(f.root);
  assert.equal((await ledger.usage(productionUsageIdentity(a), at)).amountAtomic, "10000");
  f.advance(61);
  records.persistLocked = async (record, createOnly) => { if (record.state === "released_unsubmitted" && !crash) { crash = true; throw new Error("crash after ledger release"); } return original(record, createOnly); };
  await assert.rejects(f.service.releaseExpired(a.operationId), /crash/);
  assert.equal((await records.findOperation(a.operationId))!.state, "release_pending");
  const released = await f.service.releaseExpired(a.operationId); assert.equal(released.terminal, true);
  assert.equal((await ledger.usage(productionUsageIdentity(a), new Date(at.getTime() + 61000))).amountAtomic, "0");
  await assert.rejects(f.service.reserve(a.operationId), { code: "APN_OPERATION_BLOCKED" });
});

test("current owner revision/activation/revocation and same-account new plans fail closed", async t => {
  const f = await setup(t), a = await f.service.prepare(input());
  await assert.rejects(f.service.prepare(input("second-permit-nonce-key")), { code: "APN_OPERATION_BLOCKED" });
  await assert.rejects(new OperationService(f.state).assertEvmAccountAvailable(a.profileHash, 43114, payer), { code: "APN_OPERATION_BLOCKED" });
  await new OperationService(f.state).assertEvmAccountAvailable(a.profileHash, 8453, payer);
  await f.activate(); await assert.rejects(f.service.assertCurrentOwner(a.operationId), { code: "APN_OPERATION_BLOCKED" });
  await revokeDirectPolicy(f.root, "owner", at); await assert.rejects(f.service.reserve(a.operationId), { code: "APN_OPERATION_BLOCKED" });
});

test("unknown exposure remains held and cannot be released via expiry or caller proof; unsafe paths reject", async t => {
  const f = await setup(t), a = await f.service.reserve((await f.service.prepare(input())).operationId);
  const body = productionRecordBody(a);
  const unknown = sealPermit2ProductionRecord({ ...body, state: "exposure_unknown", exposureAt: at.toISOString() });
  await writeFile(join(f.root, "permit2-production", `${a.operationId}.json`), canonicalJson(unknown), { mode: 0o600 });
  f.advance(120); await assert.rejects(f.service.releaseExpired(a.operationId), { code: "APN_OPERATION_BLOCKED" });
  assert.equal((await new AssetUsageLedger(f.root).usage(productionUsageIdentity(a), new Date(at.getTime() + 120000))).amountAtomic, "10000");
  const repo = new Permit2ProductionRepository(f.root); await assert.rejects(repo.findOperation("../escape"), { code: "APN_STATE_CORRUPT" });
  const linkId = "f".repeat(64); await symlink(join(f.root, "permit2-production", `${a.operationId}.json`), join(f.root, "permit2-production", `${linkId}.json`));
  await assert.rejects(repo.findOperation(linkId), { code: "APN_STATE_SECURITY" });
});

test("atomic unsigned cancellation before delayed reserve prevents a late hold and exact changed replay fails", async t => {
  const f = await setup(t), a = await f.service.prepare(input()), ledger = new AssetUsageLedger(f.root);
  const active = await loadActiveAssetPolicyRegistry(f.root, "owner", at); assert.ok(active);
  const identity = productionUsageIdentity(a), key = `x402-permit2-production.v2:${a.operationId}` as const;
  const cancel = { ...identity, idempotencyKey: key, policyDigest: active.digest, registryVersion: active.registry.registryVersion,
    rail: "x402" as const, amountAtomic: "10000", outcomeDigest: "a".repeat(64), now: at };
  let proceed!: () => void;
  const barrier = new Promise<void>(resolve => { proceed = resolve; });
  const delayedReserve = (async () => { await barrier; return ledger.reserve({ ...identity, registry: active.registry,
    rail: "x402", mechanism: X402_PERMIT2_MECHANISM, amountAtomic: "10000", idempotencyKey: key, now: at }); })();
  const cancelled = await ledger.cancelUnsubmittedReservation(cancel); proceed();
  assert.equal((await delayedReserve).state, "released_unsubmitted");
  assert.deepEqual(await ledger.cancelUnsubmittedReservation(cancel), cancelled);
  assert.equal((await ledger.usage(identity, at)).amountAtomic, "0");
  for (const change of [{ amountAtomic: "9999" }, { outcomeDigest: "b".repeat(64) }, { policyDigest: "c".repeat(64) }]) {
    await assert.rejects(ledger.cancelUnsubmittedReservation({ ...cancel, ...change }), { code: "APN_OPERATION_BLOCKED" });
  }
});

test("unsigned no-lease expiry releases conflict; submitted common lease refuses cancellation", async t => {
  const f = await setup(t), a = await f.service.prepare(input());
  f.advance(61); const released = await f.service.releaseExpired(a.operationId); assert.equal(released.terminal, true);
  await new OperationService(f.state).assertEvmAccountAvailable(a.profileHash, 43114, payer);
  const next = await f.service.prepare(input("after-expiry-new-key-001")); assert.notEqual(next.material.nonce, a.material.nonce);
  const reserved = await f.service.reserve(next.operationId), ledger = new AssetUsageLedger(f.root);
  await ledger.transition({ ...productionUsageIdentity(reserved), reservationId: reserved.usageReservationId,
    policyDigest: reserved.material.owner.policyDigest, state: "submitted", now: new Date(at.getTime() + 61000) });
  f.advance(122); await assert.rejects(f.service.releaseExpired(reserved.operationId), { code: "APN_OPERATION_BLOCKED" });
  assert.equal((await f.service.records.findOperation(reserved.operationId))!.state, "release_pending");
  assert.equal((await ledger.usage(productionUsageIdentity(reserved), new Date(at.getTime() + 122000))).amountAtomic, "10000");
});

test("same local EVM owner cannot bypass admission through a different imported profile", async t => {
  const f = await setup(t);
  const bindingHash = hashObject({ profile: "alias", address: payer, createdAt: at.toISOString() });
  await f.state.writeWallet(sealWallet({ schemaVersion: STATE_VERSION, profile: "alias", profileHash: f.state.profileHash("alias"),
    address: payer, createdAt: at.toISOString(), bindingHash }));
  await assert.rejects(f.service.prepare(input()), { code: "APN_OPERATION_BLOCKED" });
  assert.equal(f.calls.length, 0);
});

test("shared rail usage cap is authoritative before unsigned preparation", async t => {
  const f = await setup(t);
  await activateDirectPolicy(f.root, "owner", { accounts: { evm: payer }, now: at, admissions: [
    { chain: asset.chain, kind: "token", identifier: asset.token, rail: "x402", maximumPerTransferAtomic: "10000", dailyLimitAtomic: "10000", mechanism: X402_PERMIT2_MECHANISM },
    { chain: asset.chain, kind: "token", identifier: asset.token, rail: "direct", maximumPerTransferAtomic: "10000", dailyLimitAtomic: "10000" },
  ] });
  const active = await loadActiveAssetPolicyRegistry(f.root, "owner", at); assert.ok(active);
  await new AssetUsageLedger(f.root).reserve({ account: payer, chain: asset.chain, asset: { kind: "token", identifier: asset.token },
    registry: active.registry, rail: "direct", amountAtomic: "1", idempotencyKey: "different-direct-rail", now: at });
  await assert.rejects(f.service.prepare(input()), { code: "APN_OPERATION_BLOCKED" }); assert.equal(f.calls.length, 0);
});

test("private checked inspection binds the actual unsigned request and preserves existing transport refusal", async () => {
  const { inspectCheckedPermit2Challenge } = await import("../../src/x402-permit2/checked-inspection.js");
  const { encodePaymentRequiredHeader } = await import("../../src/x402-codec.js");
  const { challengeObservation } = await import("./x402-helpers.js");
  const request = input().checked.request, ch = challenge(); let calls = 0;
  const checked = await inspectCheckedPermit2Challenge({ get: async sent => {
    calls++; assert.equal(sent.paymentSignature, undefined); assert.deepEqual(sent.httpRequest, request);
    return challengeObservation({ finalUrl: request.url, header: encodePaymentRequiredHeader(ch) });
  } }, request, payer);
  assert.equal(calls, 1); assert.deepEqual(checked, input().checked);
  await assert.rejects(inspectCheckedPermit2Challenge({ get: async () => challengeObservation({
    finalUrl: "https://other.example/data", header: encodePaymentRequiredHeader(ch) }) }, request, payer), { code: "APN_HTTP_PROTOCOL" });
});

test("expiry cancellation races a delayed production reserve without resurrecting a lease", async t => {
  const f = await setup(t), a = await f.service.prepare(input());
  const original = AssetUsageLedger.prototype.reserve;
  let entered!: () => void, proceed!: () => void;
  const atReserve = new Promise<void>(resolve => { entered = resolve; });
  const barrier = new Promise<void>(resolve => { proceed = resolve; });
  AssetUsageLedger.prototype.reserve = async function(value) {
    if (value.idempotencyKey === `x402-permit2-production.v2:${a.operationId}`) { entered(); await barrier; }
    return original.call(this, value);
  };
  t.after(() => { AssetUsageLedger.prototype.reserve = original; });
  const reserving = f.service.reserve(a.operationId);
  await atReserve; assert.equal((await f.service.records.findOperation(a.operationId))!.state, "reserving");
  f.advance(61); assert.equal((await f.service.releaseExpired(a.operationId)).terminal, true);
  proceed(); await assert.rejects(reserving, { code: "APN_OPERATION_BLOCKED" });
  assert.equal((await new AssetUsageLedger(f.root).load(productionUsageIdentity(a), a.usageReservationId))!.state, "released_unsubmitted");
  assert.equal((await new AssetUsageLedger(f.root).usage(productionUsageIdentity(a), new Date(at.getTime() + 61000))).amountAtomic, "0");
  await new OperationService(f.state).assertEvmAccountAvailable(a.profileHash, 43114, payer);
});

test("release_pending crash before cancellation restarts from frozen policy even after revocation", async t => {
  const f = await setup(t), a = await f.service.prepare(input());
  const original = AssetUsageLedger.prototype.cancelUnsubmittedReservation; let fail = true;
  AssetUsageLedger.prototype.cancelUnsubmittedReservation = async function(value) {
    if (fail) { fail = false; throw new Error("crash before cancellation"); } return original.call(this, value);
  };
  t.after(() => { AssetUsageLedger.prototype.cancelUnsubmittedReservation = original; });
  f.advance(61); await assert.rejects(f.service.releaseExpired(a.operationId), /crash before cancellation/);
  assert.equal((await f.service.records.findOperation(a.operationId))!.state, "release_pending");
  await revokeDirectPolicy(f.root, "owner", new Date(at.getTime() + 61000));
  const released = await f.service.releaseExpired(a.operationId); assert.equal(released.terminal, true);
  assert.equal((await new AssetUsageLedger(f.root).load(productionUsageIdentity(a), a.usageReservationId))!.registryVersion,
    a.material.checkpoint.registryVersion);
});

test("rehashed frozen registry version cannot substitute the active owner or common lease version", async t => {
  const f = await setup(t), record = await f.service.prepare(input());
  const { createPermit2ProductionMaterial } = await import("../../src/x402-permit2/production-material.js");
  const m = record.material;
  const material = createPermit2ProductionMaterial({ checked: m.checked, wallet: m.wallet, owner: m.owner, evidence: m.evidence,
    signingSecond: m.signingSecond, nonce: m.nonce, checkpoint: { ...m.checkpoint, registryVersion: "forged-version" } });
  const changed = sealPermit2ProductionRecord({ ...productionRecordBody(record), material });
  await writeFile(join(f.root, "permit2-production", `${record.operationId}.json`), canonicalJson(changed), { mode: 0o600 });
  await assert.rejects(f.service.reserve(record.operationId), { code: "APN_OPERATION_BLOCKED" });
  assert.equal((await new AssetUsageLedger(f.root).usage(productionUsageIdentity(record), at)).amountAtomic, "0");
});

test("unsigned reserved expiry closes the historical lease after active registry replacement", async t => {
  const f = await setup(t), record = await f.service.reserve((await f.service.prepare(input())).operationId);
  await f.activate("9999", "9999");
  const current = await loadActiveAssetPolicyRegistry(f.root, "owner", at); assert.ok(current);
  assert.notEqual(current.registry.registryVersion, record.material.checkpoint.registryVersion);
  await assert.rejects(f.service.assertCurrentOwner(record.operationId), { code: "APN_OPERATION_BLOCKED" });
  f.advance(61); assert.equal((await f.service.releaseExpired(record.operationId)).terminal, true);
  const ledger = new AssetUsageLedger(f.root), lease = await ledger.load(productionUsageIdentity(record), record.usageReservationId); assert.ok(lease);
  assert.equal(lease.state, "released_unsubmitted"); assert.equal(lease.policyDigest, record.material.owner.policyDigest);
  assert.equal(lease.registryVersion, record.material.checkpoint.registryVersion);
  assert.equal((await ledger.usage(productionUsageIdentity(record), new Date(at.getTime() + 61000))).amountAtomic, "0");
});
