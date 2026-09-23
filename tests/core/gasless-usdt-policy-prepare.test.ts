import assert from "node:assert/strict";
import { lstat, readFile, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { decodeFunctionData, getAddress, parseAbi } from "viem";
import { hashObject } from "../../src/canonical.js";
import { sealAssetPolicyRegistry, type UnsignedAssetPolicyRegistry } from "../../src/asset-policy-registry.js";
import type { ActiveAssetPolicy } from "../../src/allowlist-active-policy.js";
import { USDT_GASLESS } from "../../src/gasless-usdt/model.js";
import { preparePolicyBoundUsdt, type UsdtPolicyPrepareRequest, type UsdtPreparePort } from "../../src/gasless-usdt/policy-prepare.js";
import type { UsdtSponsorPort } from "../../src/gasless-usdt/engine.js";
import type { UsdtUserOperation } from "../../src/gasless-usdt/userop.js";
import type { Hex } from "../../src/model.js";
import { GaslessUsdtOperationService } from "../../src/gasless-usdt/service.js";
import { UsdtOperationRepository } from "../../src/gasless-usdt/operation.js";
import { USDT_BOUND_OPERATION_SCHEMA, UsdtBoundOperationRepository, validateUsdtBoundOperation } from "../../src/gasless-usdt/bound-operation.js";
import { temporaryState } from "./helpers.js";

const OWNER = getAddress("0x823A3a5BaB1186141b32fC65F8E25Ca24c679Ce7");
const RECIPIENT = getAddress("0x000000000000000000000000000000000000dEaD");
const NOW = new Date((0x6aacecdb - 300) * 1000);
const QUOTE = { quotes: [{ paymaster: USDT_GASLESS.paymaster, token: USDT_GASLESS.token, postOpGas: "0x4c2c",
  exchangeRate: "0xa38ca6e3", exchangeRateNativeToUsd: "0x948f68af", balanceSlot: "0x2", allowanceSlot: "0x5" }] };
const PRICE = { slow: { maxFeePerGas: "0x10ef719d", maxPriorityFeePerGas: "0xbb0de7a" },
  standard: { maxFeePerGas: "0x11c8374b", maxPriorityFeePerGas: "0xc468333" },
  fast: { maxFeePerGas: "0x12a0fcf9", maxPriorityFeePerGas: "0xcdc27ec" } };
const SIGNED_RAW = { paymaster: USDT_GASLESS.paymaster, paymasterData: "0x020000006aacecdb000000000000dac17f958d2ee523a2206206994597c13d831ec700000000000000000000000000004c2c00000000000000000000000000000000000000000000000000000000a380509a000000000000000000000000000138804337ff05c84b9a80ea0a78dbe7b8e102f66d4c08972391719016554aea7ecb13e50f38e455f67da2908c40238d37d162d3f3dc686067c76c198b6239400746330724b6191afa40a35538022086b0288210f55e1c1c" };
const SIGNED = { ...SIGNED_RAW, paymasterData: SIGNED_RAW.paymasterData.replace("a380509a", "a38ca6e3") };
const request = (): UsdtPolicyPrepareRequest => ({ profile: "owner", chain: "eip155:1", token: USDT_GASLESS.token,
  sponsorUrl: USDT_GASLESS.bundlerUrl, sender: OWNER, recipient: RECIPIENT, grossAtomic: 1_000_000n,
  maxFeeAtomic: 500_000n, minReceivedAtomic: 500_000n });
function active(options: { per?: string; daily?: string; mechanism?: { provider: string; reference: string }; owner?: typeof OWNER; expiresAt?: string } = {}): ActiveAssetPolicy {
  const unsigned: UnsignedAssetPolicyRegistry = { schemaVersion: "apn.asset-policy-registry.v2", registryVersion: "owner.1",
    publishedAt: "2026-09-18T00:00:00.000Z", effectiveDate: "2026-09-18", effectiveAt: "2026-09-18T00:00:00.000Z",
    ...(options.expiresAt === undefined ? {} : { expiresAt: options.expiresAt }), chains: [{ chain: "eip155:1", family: "evm", name: "Ethereum", assets: [{ kind: "token", identifier: USDT_GASLESS.token,
      symbol: "USDT", decimals: 6, rails: { direct: false, gasless: true, x402: false, bridge: false, swap: false },
      railCaps: { gasless: { maximumPerTransferAtomic: options.per ?? "1000000", dailyLimitAtomic: options.daily ?? "2000000" } },
      mechanismPins: { gasless: options.mechanism ?? USDT_GASLESS.mechanism } }] }] };
  const registry = sealAssetPolicyRegistry(unsigned);
  return { profile: "owner", registry, digest: registry.policyDigest, revision: 1, activationDigest: "a".repeat(64),
    accounts: { evm: options.owner ?? OWNER }, activatedAt: "2026-09-18T00:00:00.000Z" };
}
function fixture() {
  let current: ActiveAssetPolicy | null = active(), usage = "0", quote = QUOTE, price = PRICE;
  const offered: UsdtUserOperation[] = [];
  const prepare: UsdtPreparePort = { now: () => NOW, activePolicy: async () => current, dailyUsage: async () => usage,
    safeSnapshot: async () => ({ chainId: 1n, blockNumber: 26_002_950n, blockHash: `0x${"12".repeat(32)}`,
      account: { usdtBalanceAtomic: 1_000_000n, entryPointNonce: 7n, eoaNonce: 31n, delegation: "empty" } }) };
  const sponsor: Pick<UsdtSponsorPort, "tokenQuote" | "gasPrice" | "paymasterData"> = { tokenQuote: async () => quote,
    gasPrice: async () => price, paymasterData: async op => { offered.push(op); return SIGNED; } };
  return { ports: { prepare, sponsor }, offered, setPolicy: (value: ActiveAssetPolicy | null) => { current = value; },
    setUsage: (value: string) => { usage = value; }, setQuote: (value: typeof QUOTE) => { quote = value; },
    setPrice: (value: typeof PRICE) => { price = value; } };
}

test("policy prepare freezes owner, safe block, exact approval sequence and sponsored unsigned operation", async () => {
  const f = fixture();
  const result = await preparePolicyBoundUsdt(f.ports, request());
  assert.equal(result.policyDigest, active().digest);
  assert.equal(result.safeBlockNumber, "26002950");
  assert.match(result.bindingHash, /^[a-f0-9]{64}$/u);
  assert.equal(result.plan.feeCapAtomic, 500_000n);
  assert.equal(result.plan.netAtomic, 500_000n);
  assert.equal(result.unsignedOperation.callData, result.callData);
  assert.equal(f.offered.length, 1);
  assert.equal(f.offered[0]?.callData, result.callData);
  assert.equal(f.offered[0]?.nonce, "0x7");
  const batch = decodeFunctionData({ abi: parseAbi(["function executeBatch((address target,uint256 value,bytes data)[] calls)"]), data: result.callData });
  assert.equal(batch.functionName, "executeBatch");
  const calls = batch.args![0];
  assert.equal(calls.length, 3);
  assert.deepEqual(calls.map(call => call.target), [USDT_GASLESS.token, USDT_GASLESS.token, USDT_GASLESS.token]);
  assert.deepEqual(calls.map(call => call.value), [0n, 0n, 0n]);
  const abi = parseAbi(["function approve(address spender,uint256 value) returns (bool)", "function transfer(address to,uint256 value) returns (bool)"]);
  assert.deepEqual(calls.map(call => decodeFunctionData({ abi, data: call.data }).args),
    [[USDT_GASLESS.paymaster, 0n], [USDT_GASLESS.paymaster, 500_000n], [RECIPIENT, 500_000n]]);
});

test("policy prepare refuses missing policy, wrong owner or mechanism, and both owner caps before sponsor reads", async () => {
  for (const policy of [null, active({ owner: RECIPIENT }), active({ mechanism: { ...USDT_GASLESS.mechanism, provider: "other" } }),
    active({ per: "999999" }), active({ daily: "1000000" })]) {
    const f = fixture(); f.setPolicy(policy);
    if (policy !== null && policy.registry.chains[0]!.assets[0]!.railCaps?.gasless?.dailyLimitAtomic === "1000000") f.setUsage("1");
    await assert.rejects(() => preparePolicyBoundUsdt(f.ports, request()));
    assert.equal(f.offered.length, 0);
  }
});

test("policy prepare rejects wrong route and quote drift, and rechecks revoked policy after sponsor data", async () => {
  const route = fixture();
  await assert.rejects(() => preparePolicyBoundUsdt(route.ports, { ...request(), sponsorUrl: "https://other.invalid" }),
    { code: "APN_INVALID_INPUT" });
  assert.equal(route.offered.length, 0);
  const drift = fixture();
  let quoteReads = 0;
  drift.ports.sponsor.tokenQuote = async () => ++quoteReads === 1 ? QUOTE : { quotes: [{ ...QUOTE.quotes[0], exchangeRate: "0xa38ca6e4" }] };
  await assert.rejects(() => preparePolicyBoundUsdt(drift.ports, request()), /quote_drift/u);
  const revoked = fixture();
  revoked.ports.sponsor.paymasterData = async op => { revoked.offered.push(op); revoked.setPolicy(null); return SIGNED; };
  await assert.rejects(() => preparePolicyBoundUsdt(revoked.ports, request()), { code: "APN_ALLOWLIST_REFUSED" });
});

test("policy prepare captures the safe account before sponsor callbacks and returns an immutable binding", async () => {
  const f = fixture();
  const account = { usdtBalanceAtomic: 1_000_000n, entryPointNonce: 7n, eoaNonce: 31n, delegation: "empty" as const };
  const snapshot = { chainId: 1n, blockNumber: 26_002_950n, blockHash: `0x${"12".repeat(32)}` as Hex, account };
  f.ports.prepare.safeSnapshot = async () => snapshot;
  f.ports.sponsor.paymasterData = async op => {
    assert.equal(op.nonce, "0x7");
    account.entryPointNonce = 99n;
    account.eoaNonce = 100n;
    account.usdtBalanceAtomic = 0n;
    snapshot.blockNumber = 99n;
    snapshot.blockHash = `0x${"34".repeat(32)}`;
    return SIGNED;
  };
  const prepared = await preparePolicyBoundUsdt(f.ports, request());
  assert.equal(prepared.account.entryPointNonce, 7n);
  assert.equal(prepared.account.eoaNonce, 31n);
  assert.equal(prepared.account.usdtBalanceAtomic, 1_000_000n);
  assert.equal(prepared.safeBlockNumber, "26002950");
  assert.equal(prepared.safeBlockHash, `0x${"12".repeat(32)}`);
  assert.equal(prepared.unsignedOperation.nonce, "0x7");
  assert.equal(prepared.unsignedOperation.eip7702Auth?.nonce, "0x1f");
  account.entryPointNonce = 123n;
  assert.equal(prepared.account.entryPointNonce, 7n);
  assert.throws(() => { (prepared.account as { entryPointNonce: bigint }).entryPointNonce = 555n; }, TypeError);
  assert.throws(() => { (prepared.plan.request as { grossAtomic: bigint }).grossAtomic = 2n; }, TypeError);
  assert.equal(prepared.account.entryPointNonce, 7n);
  assert.equal(prepared.plan.request.grossAtomic, 1_000_000n);
  const { bindingHash, ...body } = prepared;
  assert.equal(bindingHash, hashObject(JSON.parse(JSON.stringify(body, (_key, value: unknown) =>
    typeof value === "bigint" ? value.toString() : value))));
});

test("policy prepare refuses a signed rate that differs from the quote, expired policy, and wrong safe chain", async () => {
  const mismatchedRate = fixture();
  mismatchedRate.ports.sponsor.paymasterData = async () => SIGNED_RAW;
  await assert.rejects(() => preparePolicyBoundUsdt(mismatchedRate.ports, request()), /signed_quote_rate_mismatch/u);
  const expired = fixture();
  expired.setPolicy(active({ expiresAt: new Date(NOW.getTime() - 1).toISOString() }));
  await assert.rejects(() => preparePolicyBoundUsdt(expired.ports, request()));
  assert.equal(expired.offered.length, 0);
  const wrongChain = fixture();
  wrongChain.ports.prepare.safeSnapshot = async () => ({ chainId: 2n, blockNumber: 26_002_950n,
    blockHash: `0x${"12".repeat(32)}`, account: { usdtBalanceAtomic: 1_000_000n, entryPointNonce: 7n,
      eoaNonce: 31n, delegation: "empty" } });
  await assert.rejects(() => preparePolicyBoundUsdt(wrongChain.ports, request()), /gasless_usdt_safe_block/u);
  assert.equal(wrongChain.offered.length, 0);
});

test("bound journal persists the complete preparation and classifies revocation and nonce drift without effects", async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const f = fixture();
  const binding = await preparePolicyBoundUsdt(f.ports, request());
  const service = new GaslessUsdtOperationService(new UsdtOperationRepository(temporary.root)).forProfile("a".repeat(64));
  const saved = await service.prepareBound(binding, "bound-001", NOW);
  const path = join(temporary.root, "gasless-usdt-bound-operations", "a".repeat(64), `${saved.operationId}.json`);
  const bytes = await readFile(path, "utf8");
  assert.equal(saved.binding.bindingHash, binding.bindingHash);
  assert.equal(saved.binding.paymasterData, binding.paymasterData);
  assert.equal(saved.binding.unsignedOperation.callData, binding.callData);
  assert.equal(saved.binding.account.entryPointNonce, "7");
  assert.equal((await service.statusBound(saved.operationId)).integrityHash, saved.integrityHash);
  assert.deepEqual(await service.resumeBound(saved.operationId, f.ports.prepare), { state: "prepared", operation: saved });
  const alternate = fixture();
  alternate.ports.prepare.safeSnapshot = async () => ({ chainId: 1n, blockNumber: 26_002_950n,
    blockHash: `0x${"14".repeat(32)}`, account: { usdtBalanceAtomic: 1_000_000n, entryPointNonce: 7n,
      eoaNonce: 31n, delegation: "empty" } });
  const alternateBinding = await preparePolicyBoundUsdt(alternate.ports, request());
  await assert.rejects(() => service.prepareBound(alternateBinding, "bound-001", NOW),
    { code: "APN_IDEMPOTENCY_CONFLICT" });
  f.setPolicy(null);
  assert.equal((await service.resumeBound(saved.operationId, f.ports.prepare)).state, "capability_unavailable");
  f.setPolicy(active());
  f.ports.prepare.safeSnapshot = async () => ({ chainId: 1n, blockNumber: 26_002_951n,
    blockHash: `0x${"13".repeat(32)}`, account: { usdtBalanceAtomic: 1_000_000n, entryPointNonce: 8n,
      eoaNonce: 31n, delegation: "empty" } });
  assert.equal((await service.resumeBound(saved.operationId, f.ports.prepare)).state, "capability_unavailable");
  assert.equal(await readFile(path, "utf8"), bytes);
  assert.equal(f.offered.length, 1);
  const resealed = JSON.parse(bytes) as Record<string, unknown>;
  const resealedBinding = resealed.binding as Record<string, unknown>;
  (resealedBinding.account as Record<string, unknown>).entryPointNonce = "8";
  const { bindingHash: _oldBindingHash, ...bindingBody } = resealedBinding;
  resealedBinding.bindingHash = hashObject(bindingBody);
  resealed.operationId = hashObject({ schemaVersion: USDT_BOUND_OPERATION_SCHEMA, profileHash: resealed.profileHash,
    idempotencyKey: resealed.idempotencyKey, bindingHash: resealedBinding.bindingHash });
  const { integrityHash: _oldIntegrityHash, ...resealedBody } = resealed;
  resealed.integrityHash = hashObject(resealedBody);
  assert.throws(() => validateUsdtBoundOperation(resealed), { code: "APN_STATE_CORRUPT" });
  const forged = JSON.parse(bytes) as Record<string, unknown>;
  const forgedBinding = forged.binding as Record<string, unknown>;
  forgedBinding.safeBlockHash = `0x${"99".repeat(32)}`;
  await writeFile(path, JSON.stringify(forged));
  await assert.rejects(() => service.statusBound(saved.operationId), { code: "APN_STATE_CORRUPT" });
});

test("bound journal replays the first complete record after time advances and repairs claim-only publication", async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const f = fixture(), binding = await preparePolicyBoundUsdt(f.ports, request());
  const service = new GaslessUsdtOperationService(new UsdtOperationRepository(temporary.root)).forProfile("a".repeat(64));
  const first = await service.prepareBound(binding, "replay-001", NOW);
  const profile = join(temporary.root, "gasless-usdt-bound-operations", "a".repeat(64));
  const path = join(profile, `${first.operationId}.json`);
  await rm(path); // Simulate interruption after the atomic key claim but before final publication.
  assert.deepEqual(await service.statusBound(first.operationId), first);
  assert.equal((await readdir(profile)).includes(`${first.operationId}.json`), false);
  const claims = join(temporary.root, "gasless-usdt-bound-operations", "claims");
  const orphan = join(claims, ".pending-00000000-0000-4000-8000-000000000001");
  await writeFile(orphan, "{ partial", { mode: 0o600 });
  const old = new Date(Date.now() - 10 * 60_000);
  await utimes(orphan, old, old);
  const replay = await service.prepareBound(binding, "replay-001", new Date(NOW.getTime() + 86_400_000));
  assert.deepEqual(replay, first);
  assert.deepEqual(await service.statusBound(first.operationId), first);
  assert.equal((await readdir(profile)).includes(`${first.operationId}.json`), true);
  assert.equal((await readdir(claims)).includes(".pending-00000000-0000-4000-8000-000000000001"), false);
  assert.equal(f.offered.length, 1);
});

test("independent services serialize competing same-key bindings through one atomic claim", async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const firstFixture = fixture(), secondFixture = fixture();
  secondFixture.ports.prepare.safeSnapshot = async () => ({ chainId: 1n, blockNumber: 26_002_950n,
    blockHash: `0x${"14".repeat(32)}`, account: { usdtBalanceAtomic: 1_000_000n, entryPointNonce: 7n,
      eoaNonce: 31n, delegation: "empty" } });
  const [firstBinding, secondBinding] = await Promise.all([
    preparePolicyBoundUsdt(firstFixture.ports, request()), preparePolicyBoundUsdt(secondFixture.ports, request()),
  ]);
  const services = Array.from({ length: 12 }, () => new GaslessUsdtOperationService(
    new UsdtOperationRepository(temporary.root)).forProfile("a".repeat(64)));
  const outcomes = await Promise.allSettled(services.map((service, index) => service.prepareBound(
    index % 2 === 0 ? firstBinding : secondBinding, "race-001", NOW)));
  const winners = outcomes.filter(result => result.status === "fulfilled").map(result => result.value);
  const losers = outcomes.filter(result => result.status === "rejected").map(result => result.reason as { code?: string });
  assert.ok(winners.length > 0);
  assert.ok(losers.length > 0);
  assert.equal(new Set(winners.map(record => record.operationId)).size, 1);
  assert.ok(losers.every(error => error.code === "APN_IDEMPOTENCY_CONFLICT"));
  const profile = join(temporary.root, "gasless-usdt-bound-operations", "a".repeat(64));
  assert.equal((await readdir(join(temporary.root, "gasless-usdt-bound-operations", "claims"))).filter(name => name.endsWith(".json")).length, 1);
  assert.equal((await readdir(profile)).filter(name => name.endsWith(".json")).length, 1);
  await assert.rejects(() => new GaslessUsdtOperationService(new UsdtOperationRepository(temporary.root))
    .forProfile("b".repeat(64)).prepareBound(firstBinding, "race-001", NOW), { code: "APN_IDEMPOTENCY_CONFLICT" });
});

test("first-use directory entries are parent-synced and unsupported fsync refuses before publication", async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const f = fixture(), binding = await preparePolicyBoundUsdt(f.ports, request());
  class TrackingRepository extends UsdtBoundOperationRepository {
    readonly synced: string[] = [];
    failAt: string | undefined;
    protected override async fsyncDirectory(path: string): Promise<void> {
      this.synced.push(path);
      if (path === this.failAt) throw Object.assign(new Error("directory fsync unsupported"), { code: "EINVAL" });
      await super.fsyncDirectory(path);
    }
  }
  const root = join(temporary.base, "fresh-root"), repository = new TrackingRepository(root);
  await repository.create("a".repeat(64), binding, "first-use-001", NOW);
  const rail = join(root, "gasless-usdt-bound-operations");
  assert.deepEqual(repository.synced.slice(0, 4), [temporary.base, root, rail, rail]);
  for (const directory of [root, rail, join(rail, "a".repeat(64)), join(rail, "claims")]) {
    assert.equal((await lstat(directory)).mode & 0o777, 0o700);
  }
  const refusedRoot = join(temporary.base, "sync-refused"), refused = new TrackingRepository(refusedRoot);
  refused.failAt = temporary.base;
  await assert.rejects(() => refused.create("a".repeat(64), binding, "sync-refused-001", NOW),
    { code: "APN_STATE_SECURITY" });
  await assert.rejects(() => lstat(join(refusedRoot, "gasless-usdt-bound-operations")), { code: "ENOENT" });
  refused.failAt = undefined;
  await refused.create("a".repeat(64), binding, "sync-refused-001", NOW);
  assert.equal(refused.synced.filter(path => path === temporary.base).length, 2);
  await assert.rejects(() => new UsdtBoundOperationRepository(join(temporary.base, "missing-parent", "state"))
    .create("a".repeat(64), binding, "missing-parent-001", NOW), { code: "APN_STATE_SECURITY" });
});
