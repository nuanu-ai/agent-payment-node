import { storedOperationDomains } from "../../src/operation-conflict-domain.js";
import { OperationService } from "../../src/operation-service.js";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { test } from "node:test";
import { ApnCore } from "../../src/core.js";
import type { CommandRequest } from "../../src/commands.js";
import type { BridgeDependencies } from "../../src/lifi/service.js";
import type { BridgeCustodyPort, LifiProviderPort } from "../../src/lifi/ports.js";
import type { ProviderAdapterBundle, ProviderPermissionLifecyclePort } from "../../src/provider-ports.js";
import { ProviderRegistry } from "../../src/provider-registry.js";
import { AWAL_PROVIDER_ID } from "../../src/awal-process-adapter.js";
import {
  accountBindingHash,
  capabilityHash,
  coinbaseDirectCapabilitySnapshot,
  metamaskDirectCapabilitySnapshot,
  type ProviderProfileRecord,
} from "../../src/provider-profile.js";
import { StateProfileRepository } from "../../src/profile-repository.js";
import { StateStore } from "../../src/state.js";
import { mmPrivateHash, mmWalletIdentityHash } from "../../src/metamask-gasless/identity.js";
import type { MetaMaskGaslessBinding, MetaMaskGaslessRequest } from "../../src/metamask-gasless/model.js";
import { ensureWallet, makeCore, TestClock, TestNative, TestProfilePolicy, TestRpc, temporaryState } from "./helpers.js";
import { gaslessFixture } from "./gasless-helpers.js";
import { lifiFixture } from "./lifi-helpers.js";
import { solanaFixture } from "./solana-helpers.js";
import {
  MM_TEST_OWNER,
  MM_TEST_RECIPIENT,
  MmTestApproval,
  MmTestProvider,
  MmTestRpc,
  mmFixture,
} from "./metamask-gasless-helpers.js";
import { TestHttp } from "./x402-helpers.js";
import { X402_URL } from "./x402-vectors.js";

const MM_PROVIDER = "metamask-agent-wallet";
const BRIDGE_QUOTE = "a".repeat(64);

test("pending MM preparation blocks every guarded wallet lifecycle command before effects or profile upgrade", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const f = await mmFixture(temporary.root);
  const { id } = await f.prepare("mm-lifecycle-pending-0001");
  const profileBefore = await f.state.loadProviderProfile(f.state.profileHash(f.profile));
  const operationBefore = await f.record(id);
  const providerCallsBefore = [...f.provider.calls], mmRpcCallsBefore = [...f.rpc.calls];
  const effects: string[] = [];
  const forbidden = (name: string): never => { effects.push(name); throw new Error(`forbidden ${name}`); };
  const permissions: ProviderPermissionLifecyclePort = {
    async connect() { return forbidden("permission.connect"); },
    async activate() { return forbidden("permission.activate"); },
    async read() { return forbidden("permission.read"); },
    async readPending() { return forbidden("permission.readPending"); },
    async sync() { return forbidden("permission.sync"); },
    async disable() { return forbidden("permission.disable"); },
    async forget() { return forbidden("permission.forget"); },
  };
  const adapter: ProviderAdapterBundle = {
    provider_id: MM_PROVIDER,
    trust_class: f.publicProfile.trust_class,
    capabilities: metamaskDirectCapabilitySnapshot(),
    lifecycle: {
      authenticationMethods: ["browser"],
      async connect() { return forbidden("provider.connect"); },
      async probeStatus() { return forbidden("provider.status"); },
      async logout() { return forbidden("provider.logout"); },
    },
    reads: {
      async observeBalance() { return forbidden("provider.balance"); },
      async crossCheckAddress() { return forbidden("provider.crossCheck"); },
    },
    permissions,
    profileMigration: { async upgrade() { return forbidden("profile.upgrade"); } },
  };
  const registry = new ProviderRegistry([{ provider_id: MM_PROVIDER, create: () => {
    effects.push("provider.resolve"); return adapter;
  } }]);
  const native = new TestNative(), rpc = new TestRpc(), http = new TestHttp();
  const bridge = forbiddenBridge(effects);
  const core = new ApnCore({
    state: f.state,
    metaMaskGasless: f.dependencies,
    profileRepository: new StateProfileRepository(f.state),
    providerRegistry: registry,
    foregroundAuthentication: {
      async readIdentity() { return forbidden("auth.identity"); },
      async readChallengeResponse() { return forbidden("auth.challenge"); },
      async confirmRebind() { return forbidden("auth.rebind"); },
    },
    native,
    rpc,
    http,
    bridge,
    rpcUrl: "https://rpc.example",
    clock: f.clock,
  });
  const requests: CommandRequest[] = [
    { command: "wallet.ensure", profile: f.profile },
    { command: "wallet.connect", profile: f.profile, providerId: MM_PROVIDER, authenticationMethod: "browser" },
    { command: "wallet.ensure-solana", profile: f.profile, provider: "local", acceptRisk: true },
    { command: "wallet.ensure-tron", profile: f.profile, provider: "local", acceptRisk: true },
    { command: "wallet.permission.list", profile: f.profile },
    { command: "wallet.permission.sync", profile: f.profile, expectedRevision: 1 },
    { command: "wallet.permission.disable", profile: f.profile, expectedRevision: 1 },
    { command: "wallet.permission.forget", profile: f.profile, expectedRevision: 1 },
    { command: "wallet.status", profile: f.profile },
    { command: "wallet.balance", profile: f.profile },
  ];
  for (const request of requests) {
    const result = await core.execute(request);
    assert.equal(result.error?.code, "APN_OPERATION_BLOCKED", request.command);
    assert.deepEqual(result.error?.details, { blockingOperationId: id, blockingState: "awaiting_approval" }, request.command);
  }
  assert.deepEqual(effects, []);
  assert.equal(native.calls.length, 0);
  assert.deepEqual([rpc.balanceCalls, rpc.nonceCalls, rpc.x402PrepareCalls, rpc.submissions.length], [0, 0, 0, 0]);
  assert.equal(http.calls.length, 0);
  assert.deepEqual(f.provider.calls, providerCallsBefore);
  assert.deepEqual(f.rpc.calls, mmRpcCallsBefore);
  assert.deepEqual(await f.state.loadProviderProfile(f.state.profileHash(f.profile)), profileBefore);
  assert.deepEqual(await f.record(id), operationBefore);
});

test("pending MM operation preserves identical prepare and rejects competing prepare paths before effects", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const f = await mmFixture(temporary.root);
  const key = "mm-global-boundary-0001";
  const { id, input } = await f.prepare(key);
  const profileBefore = await f.state.loadProviderProfile(f.state.profileHash(f.profile));
  const operationBefore = await f.record(id);
  const providerCallsBefore = [...f.provider.calls], mmRpcCallsBefore = [...f.rpc.calls];
  const effects: string[] = [];
  const native = new TestNative(), rpc = new TestRpc(), http = new TestHttp();
  const core = new ApnCore({
    state: f.state,
    metaMaskGasless: f.dependencies,
    profileRepository: new StateProfileRepository(f.state),
    native,
    rpc,
    http,
    bridge: forbiddenBridge(effects),
    rpcUrl: "https://rpc.example",
    clock: f.clock,
  });

  const repeated = await core.execute(input);
  assert.equal(repeated.ok, true, repeated.error?.message);
  assert.equal((repeated.operation as { operation_id: string }).operation_id, id);
  const changed = await core.execute({ ...input, request: { ...input.request, grossAtomic: "10000001" } });
  assert.equal(changed.error?.code, "APN_IDEMPOTENCY_CONFLICT");

  const newFamilyRequests: CommandRequest[] = [
    { command: "transfer.prepare", profile: f.profile, recipient: f.request.recipient, amount: "1", idempotencyKey: "mm-direct-new-0001" },
    { command: "x402.fetch.prepare", profile: f.profile, url: "https://seller.example/resource", maxAmountAtomic: "1000000", idempotencyKey: "mm-x402-new-0001" },
    { command: "bridge.prepare", profile: f.profile, quote: BRIDGE_QUOTE, route: "route-across", idempotencyKey: "mm-bridge-new-0001" },
  ];
  const sameAccount = { blockingOperationId: id, blockingState: "awaiting_approval",
    blockingNetwork: `evm:${operationBefore.intent.request.chainId}`, blockingAccount: operationBefore.intent.binding.address.toLowerCase() };
  for (const request of newFamilyRequests) {
    const result = await core.execute(request);
    // The bridge quote is not owned by the profile, which is refused before its source chain and account are known.
    if (request.command === "bridge.prepare") { assert.equal(result.error?.code, "APN_INVALID_INPUT", request.command); continue; }
    assert.equal(result.error?.code, "APN_OPERATION_BLOCKED", request.command);
    assert.deepEqual(result.error?.details, sameAccount, request.command);
  }
  const collidingFamilyRequests: CommandRequest[] = [
    { command: "transfer.prepare", profile: f.profile, recipient: f.request.recipient, amount: "1", idempotencyKey: key },
    { command: "x402.fetch.prepare", profile: f.profile, url: "https://seller.example/resource", maxAmountAtomic: "1000000", idempotencyKey: key },
    { command: "bridge.prepare", profile: f.profile, quote: BRIDGE_QUOTE, route: "route-across", idempotencyKey: key },
  ];
  for (const request of collidingFamilyRequests) {
    const result = await core.execute(request);
    assert.equal(result.error?.code, "APN_IDEMPOTENCY_CONFLICT", request.command);
  }
  assert.deepEqual(effects, []);
  assert.equal(native.calls.length, 0);
  assert.deepEqual([rpc.balanceCalls, rpc.nonceCalls, rpc.x402PrepareCalls, rpc.submissions.length], [0, 0, 0, 0]);
  assert.equal(http.calls.length, 0);
  assert.deepEqual(f.provider.calls, providerCallsBefore);
  assert.deepEqual(f.rpc.calls, mmRpcCallsBefore);
  assert.deepEqual(await f.state.loadProviderProfile(f.state.profileHash(f.profile)), profileBefore);
  assert.deepEqual(await f.record(id), operationBefore);
});

test("unsupported provider and chain pairs fail before private identity or RPC", async (t) => {
  for (const chainId of [130, 43114] as const) {
    const temporary = await temporaryState(); t.after(temporary.cleanup);
    const f = await mmFixture(temporary.root);
    const result = await f.core.execute({ command: "gasless.transfer.prepare", profile: f.profile,
      request: { ...f.request, chainId }, idempotencyKey: `mm-unsupported-chain-${chainId}` });
    assert.equal(result.error?.code, "APN_PROVIDER_CAPABILITY_UNAVAILABLE");
    assert.equal(result.error?.details?.reason, "mm_gasless_unsupported_chain");
    assert.deepEqual(f.provider.calls, []); assert.deepEqual(f.rpc.calls, []);
    assert.equal((await f.core.metaMaskGasless.records.listAllOperations()).length, 0);
  }

  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const f = await mmFixture(temporary.root);
  const capabilities = coinbaseDirectCapabilitySnapshot();
  const incompatible = {
    ...f.publicProfile,
    provider_id: AWAL_PROVIDER_ID,
    account_binding_hash: accountBindingHash(AWAL_PROVIDER_ID, f.publicProfile.public_address),
    capability_snapshot: capabilities,
    capability_hash: capabilityHash(capabilities),
    trust_class: "provider_managed_non_custodial_tee" as const,
  };
  await f.state.writeProviderProfile(incompatible);
  const result = await f.core.execute({ command: "gasless.transfer.prepare", profile: f.profile,
    request: { ...f.request, chainId: 1 }, idempotencyKey: "coinbase-unsupported-chain-0001" });
  assert.equal(result.error?.code, "APN_PROVIDER_CAPABILITY_UNAVAILABLE");
  assert.deepEqual(f.provider.calls, []); assert.deepEqual(f.rpc.calls, []);
  assert.deepEqual(await f.state.loadProviderProfile(f.state.profileHash(f.profile)), incompatible);
  assert.equal((await f.core.metaMaskGasless.records.listAllOperations()).length, 0);
});

test("unresolved non-MM money journals block MM preparation only on the same network and account and keep their bytes", async (t) => {
  const cases: ReadonlyArray<{
    readonly name: string;
    readonly build: (root: string) => Promise<{ readonly state: StateStore; readonly profile: string;
      readonly idempotencyKey: string; readonly operationId: string }>;
  }> = [
    { name: "local-direct", build: localDirectOperation },
    { name: "provider-direct", build: providerDirectOperation },
    { name: "local-x402", build: localX402Operation },
    { name: "provider-x402", build: providerX402Operation },
    // Solana and TRON operations share the same RailOperationRepository schema and guard path.
    { name: "solana-rail", build: async root => {
      const fixture = await solanaFixture(root); const idempotencyKey = "compat-solana-rail-0001";
      const operationId = await fixture.prepare("usdc", idempotencyKey);
      return { state: new StateStore(root), profile: fixture.account.profile, idempotencyKey, operationId };
    } },
    { name: "lifi", build: async root => {
      const fixture = await lifiFixture(root); const prepared = await fixture.prepare("across", "compat-lifi-0001");
      return { state: fixture.state, profile: fixture.profile, idempotencyKey: prepared.input.idempotencyKey, operationId: prepared.id };
    } },
    { name: "local-gasless", build: async root => {
      const fixture = await gaslessFixture(root); const prepared = await fixture.prepare("compat-local-gasless-0001");
      return { state: fixture.state, profile: fixture.profile, idempotencyKey: prepared.input.idempotencyKey, operationId: prepared.id };
    } },
  ];
  for (const item of cases) await t.test(item.name, async (sub) => {
    const temporary = await temporaryState(); sub.after(temporary.cleanup);
    const old = await item.build(temporary.root);
    const mm = await mmCoreFor(old.state, old.profile);
    const before = await regularFileBytes(temporary.root);
    assert.ok([...before.keys()].some(path => path.includes(old.operationId)), "old operation is in byte snapshot");
    assert.ok([...before.keys()].some(path => path.includes(old.state.profileHash(old.profile))), "profile is in byte snapshot");
    const held = storedOperationDomains(await new OperationService(old.state).required(old.operationId));
    assert.ok(held !== null && held.length > 0, "old journal exposes its network and account");
    const mmAccount = MM_TEST_OWNER.toLowerCase(), mmNetwork = String(mm.request.chainId);
    const shared = held.some(domain => domain.family === "evm" && domain.network === mmNetwork && domain.account === mmAccount);
    const conflict = await mm.core.execute({ command: "gasless.transfer.prepare", profile: old.profile,
      request: mm.request, idempotencyKey: old.idempotencyKey });
    assert.equal(conflict.error?.code, "APN_IDEMPOTENCY_CONFLICT", JSON.stringify(conflict));
    assert.deepEqual(await regularFileBytes(temporary.root), before);
    const next = await mm.core.execute({ command: "gasless.transfer.prepare", profile: old.profile,
      request: mm.request, idempotencyKey: `compat-mm-after-${item.name}-0001` });
    if (shared) {
      assert.equal(next.error?.code, "APN_OPERATION_BLOCKED", JSON.stringify(next));
      assert.deepEqual(next.error?.details, { blockingOperationId: old.operationId, blockingState: "awaiting_approval",
        blockingNetwork: `evm:${mmNetwork}`, blockingAccount: mmAccount });
      assert.deepEqual(mm.provider.calls, []); assert.deepEqual(mm.rpc.calls, []);
      assert.deepEqual(await regularFileBytes(temporary.root), before);
    } else {
      // A journal on another network or account no longer blocks MetaMask, and its own bytes stay unchanged.
      assert.notEqual(next.error?.code, "APN_OPERATION_BLOCKED", JSON.stringify(next));
      const after = await regularFileBytes(temporary.root);
      for (const [path, bytes] of before) if (path.includes(old.operationId)) assert.deepEqual(after.get(path), bytes, path);
    }
  });
});

test("a durable MM dispatch marker keeps wallet lifecycle blocked with the saved locator", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const f = await mmFixture(temporary.root); f.rpc.phase = "pending";
  const { id } = await f.prepare("mm-dispatched-lifecycle-0001");
  const dispatched = await f.core.execute({ command: "gasless.transfer.approve", operationId: id });
  assert.equal(dispatched.ok, true, JSON.stringify(dispatched));
  assert.equal((dispatched.operation as { state: string }).state, "submitted_pending");
  const record = await f.record(id);
  assert.equal(record.submissionAttempts, 1); assert.notEqual(record.dispatchStartedAt, null);
  assert.equal(f.provider.submissions.length, 1);
  const native = new TestNative();
  const core = new ApnCore({ state: f.state, metaMaskGasless: f.dependencies,
    profileRepository: new StateProfileRepository(f.state), native, clock: f.clock });
  for (const request of [
    { command: "wallet.ensure", profile: f.profile },
    { command: "wallet.status", profile: f.profile },
  ] as const) {
    const result = await core.execute(request);
    assert.equal(result.error?.code, "APN_OPERATION_BLOCKED", request.command);
    assert.deepEqual(result.error?.details, { blockingOperationId: id, blockingState: "submitted_pending" }, request.command);
  }
  assert.equal(native.calls.length, 0); assert.equal(f.provider.submissions.length, 1);
  assert.deepEqual(await f.record(id), record);
});

async function localDirectOperation(root: string) {
  const state = new StateStore(root), profile = "compat-local-direct", idempotencyKey = "compat-local-direct-0001";
  const core = new ApnCore({ state, native: new TestNative(), rpc: new TestRpc(), clock: new TestClock() });
  assert.equal((await core.execute({ command: "wallet.ensure", profile })).ok, true);
  const result = await core.execute({ command: "transfer.prepare", profile, recipient: MM_TEST_RECIPIENT,
    amount: "1", idempotencyKey });
  assert.equal(result.ok, true, JSON.stringify(result));
  return { state, profile, idempotencyKey, operationId: outputOperationId(result.operation) };
}

async function providerDirectOperation(root: string) {
  const fixture = await providerFixture(root, "compat-provider-direct");
  const idempotencyKey = "compat-provider-direct-0001";
  const result = await fixture.core.execute({ command: "transfer.prepare", profile: fixture.profile,
    recipient: MM_TEST_RECIPIENT, amount: "1", idempotencyKey });
  assert.equal(result.ok, true, JSON.stringify(result));
  return { state: fixture.state, profile: fixture.profile, idempotencyKey, operationId: outputOperationId(result.operation) };
}

async function providerX402Operation(root: string) {
  const fixture = await providerFixture(root, "compat-provider-x402");
  const idempotencyKey = "compat-provider-x402-0001";
  const result = await fixture.core.execute({ command: "x402.fetch.prepare", profile: fixture.profile,
    url: X402_URL, maxAmountAtomic: "2000000", idempotencyKey });
  assert.equal(result.ok, true, JSON.stringify(result));
  return { state: fixture.state, profile: fixture.profile, idempotencyKey, operationId: outputOperationId(result.operation) };
}

async function localX402Operation(root: string) {
  const profile = "default", idempotencyKey = "compat-local-x402-0001", native = new TestNative();
  await ensureWallet(makeCore({ root, native }));
  const result = await makeCore({ root, rpc: new TestRpc(), http: new TestHttp() }).execute({
    command: "x402.fetch.prepare", profile, url: X402_URL, maxAmountAtomic: "2000000", idempotencyKey,
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  return { state: new StateStore(root), profile, idempotencyKey, operationId: outputOperationId(result.operation) };
}

async function providerFixture(root: string, profile: string) {
  const state = new StateStore(root); await state.initialize();
  const capabilities = coinbaseDirectCapabilitySnapshot();
  const stored: ProviderProfileRecord = { schema_version: "apn.provider-profile.v1", profile,
    profile_hash: state.profileHash(profile), provider_id: AWAL_PROVIDER_ID, public_address: MM_TEST_OWNER,
    account_binding_hash: accountBindingHash(AWAL_PROVIDER_ID, MM_TEST_OWNER), trust_class: "provider_managed_non_custodial_tee",
    revision: 1, capability_snapshot: capabilities, capability_hash: capabilityHash(capabilities),
    observed_at: "2026-08-26T00:00:00.000Z", drift: { state: "bound", reason: "none" } };
  await state.writeProviderProfile(stored);
  const reads = {
    async connect() {}, async probeStatus() {}, async logout() {}, async crossCheckAddress() {},
    async observeBalance() { return { address: MM_TEST_OWNER, account_binding_hash: stored.account_binding_hash,
      chain: "base" as const, asset: "USDC" as const, raw: "50000000", formatted: "50 USDC",
      decimals: 6 as const, observed_at: stored.observed_at }; },
  };
  const adapter: ProviderAdapterBundle = { provider_id: stored.provider_id, trust_class: stored.trust_class,
    capabilities, lifecycle: reads, reads, direct: { mode: "provider_atomic_send" },
    x402: { mode: "provider_atomic_paid_fetch", assertCompatibleIntent() {}, async prime() {},
      async execute() { throw new Error("not called during prepare"); } }, evidence: { owner: "apn" } };
  const registry = new ProviderRegistry([{ provider_id: stored.provider_id, create: () => adapter }]);
  const core = new ApnCore({ state, profileRepository: new StateProfileRepository(state), providerRegistry: registry,
    policy: new TestProfilePolicy(), rpc: new TestRpc(), http: new TestHttp(), rpcUrl: "https://rpc.example",
    clock: new TestClock() });
  return { state, profile, core };
}

async function mmCoreFor(state: StateStore, profile: string) {
  const now = new Date("2026-09-09T00:00:00.000Z"), capabilities = metamaskDirectCapabilitySnapshot();
  // Test-only public rebind seeds a historical cross-family boundary; it is not an authorized production rebind.
  const stored: ProviderProfileRecord = { schema_version: "apn.provider-profile.v1", profile,
    profile_hash: state.profileHash(profile), provider_id: MM_PROVIDER, public_address: MM_TEST_OWNER,
    account_binding_hash: accountBindingHash(MM_PROVIDER, MM_TEST_OWNER), trust_class: "provider_managed_non_custodial_signer",
    revision: 1, capability_snapshot: capabilities, capability_hash: capabilityHash(capabilities),
    observed_at: now.toISOString(), drift: { state: "bound", reason: "none" } };
  await state.writeProviderProfile(stored);
  const binding: MetaMaskGaslessBinding = { providerId: MM_PROVIDER, address: MM_TEST_OWNER,
    accountBindingHash: stored.account_binding_hash, capabilityHash: stored.capability_hash, revision: 1,
    projectHash: mmPrivateHash("project", "synthetic-project"),
    walletReferenceHash: mmPrivateHash("wallet-reference", "synthetic-wallet", "name"),
    walletIdHash: mmWalletIdentityHash(MM_TEST_OWNER), namespace: "eip155", mode: "server", environment: "prod" };
  const provider = new MmTestProvider(binding, now), rpc = new MmTestRpc(8453, now), approval = new MmTestApproval();
  const dependencies = { rpcFor: () => rpc, provider, approval };
  const core = new ApnCore({ state, metaMaskGasless: dependencies, clock: { now: () => new Date(now) } });
  const request: MetaMaskGaslessRequest = { chainId: 8453, recipient: MM_TEST_RECIPIENT,
    grossAtomic: "10000000", maxFeeAtomic: "50000", minReceivedAtomic: "9950000" };
  return { core, provider, rpc, request };
}

function outputOperationId(value: unknown): string {
  const operation = value as { readonly operation_id?: unknown; readonly operationId?: unknown } | null;
  const result = operation?.operation_id ?? operation?.operationId;
  assert.equal(typeof result, "string"); return result as string;
}

async function regularFileBytes(root: string): Promise<Map<string, Buffer>> {
  const result = new Map<string, Buffer>();
  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(directory, entry.name);
      if (entry.isDirectory() && relative(root, path) === "locks") continue;
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) result.set(relative(root, path), await readFile(path));
    }
  }
  await visit(root); return result;
}

function forbiddenBridge(effects: string[]): BridgeDependencies {
  const proxy = new Proxy({}, { get: (_target, property) => async () => {
    effects.push(`bridge.${String(property)}`); throw new Error(`forbidden bridge.${String(property)}`);
  } });
  return {
    provider: proxy as LifiProviderPort,
    rpcFor: () => { effects.push("bridge.rpcFor"); throw new Error("forbidden bridge.rpcFor"); },
    custody: proxy as BridgeCustodyPort,
  };
}
