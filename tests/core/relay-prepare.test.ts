import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import test from "node:test";
import { sealAssetPolicyRegistry } from "../../src/asset-policy-registry.js";
import { OperationService } from "../../src/operation-service.js";
import { RelayUnsignedPrepareService, RELAY_ROUTE_REFERENCE } from "../../src/relay/prepare.js";
import { validateRelayQuote } from "../../src/relay/quote.js";
import { StateStore, sealWallet } from "../../src/state.js";
import { hashObject } from "../../src/canonical.js";
import { STATE_VERSION } from "../../src/constants.js";
import { accountBindingHash, capabilityHash, metamaskDirectCapabilitySnapshot, type ProviderProfileRecord } from "../../src/provider-profile.js";
import { StateProfileRepository } from "../../src/profile-repository.js";
import { evmAddressLock } from "../../src/evm-address-ownership.js";
import { bindArgv } from "../../src/command-binder.js";
import { temporaryState, TestNative } from "./helpers.js";
import { ApnCore } from "../../src/core.js";
import { RelayRetireService } from "../../src/relay/retire.js";
import { RelayEffectJournalRepository } from "../../src/relay/effect-journal.js";
import { RelayReadOnlyPreflightService } from "../../src/relay/preflight.js";
import { AssetUsageLedger } from "../../src/asset-usage-ledger.js";
import { freezeRelayUnsignedOperation, RelayUnsignedOperationRepository } from "../../src/relay-unsigned-operation.js";
import { join } from "node:path";
import { keccak256 } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { canonicalJson, domainHash } from "../../src/canonical.js";
import { EncryptedWalletStore } from "../../src/encrypted-wallet-store.js";

const payer = "0x0B4Dd0C3dA001Fa146EEd3f80B01860BEF6B8a14";
const recipient = "0x823A3a5BaB1186141b32fC65F8E25Ca24c679Ce7";
const instant = new Date(1790800000 * 1000);
const input = { profile: "default", recipient, amountAtomic: "2500000", minOutputAtomic: "3000000000000000",
  maxApprovalNetworkFeeWei: "30000000000000", maxDepositNetworkFeeWei: "30000000000000", idempotencyKey: "relay-prepare-0001" };
const quoteFixture = async (): Promise<unknown> => JSON.parse(await readFile("tests/core/relay-fixtures/ethereum-usdc-bnb-quote-20260925.json", "utf8"));
function policy(reference = RELAY_ROUTE_REFERENCE, expiresAt = "2026-10-02T00:00:00.000Z") {
  const registry = sealAssetPolicyRegistry({ schemaVersion: "apn.asset-policy-registry.v2", registryVersion: "test.1",
    publishedAt: "2026-09-29T00:00:00.000Z", effectiveDate: "2026-09-29", effectiveAt: "2026-09-29T00:00:00.000Z",
    expiresAt, chains: [{ chain: "eip155:1", family: "evm", name: "Ethereum", assets: [{ kind: "token",
      identifier: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", symbol: "USDC", decimals: 6,
      rails: { direct: false, gasless: false, x402: false, bridge: true, swap: false },
      railCaps: { bridge: { maximumPerTransferAtomic: "3000000", dailyLimitAtomic: "5000000" } },
      mechanismPins: { bridge: { provider: "relay", reference } } }] }] });
  return { profile: "default", registry, digest: registry.policyDigest, revision: 1, accounts: { evm: payer },
    activationDigest: "a".repeat(64), activatedAt: "2026-09-30T00:00:00.000Z" };
}

function providerProfile(state: StateStore, profile: string, address = payer): ProviderProfileRecord {
  const provider_id = "metamask-agent-wallet", capability_snapshot = metamaskDirectCapabilitySnapshot();
  return { schema_version: "apn.provider-profile.v1", profile, profile_hash: state.profileHash(profile), provider_id,
    public_address: address as `0x${string}`, account_binding_hash: accountBindingHash(provider_id, address as `0x${string}`),
    capability_snapshot, capability_hash: capabilityHash(capability_snapshot), revision: 1,
    trust_class: "provider_managed_non_custodial_signer", observed_at: instant.toISOString(), drift: { state: "bound", reason: "none" } };
}

function serviceFor(state: StateStore, quoteCalled: () => void) {
  return new RelayUnsignedPrepareService(state, { now: () => instant }, undefined, {
    activePolicy: async () => policy(), publicAccount: async () => payer, dailyUsage: async () => "0",
    quote: async intent => { quoteCalled(); return await validateRelayQuote(await quoteFixture(), intent); },
  });
}

test("Relay owner guard blocks another provider profile before quote, ignoring provider ID and address case", async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const state = new StateStore(temporary.root); await state.initialize();
  const other = providerProfile(state, "other", payer.toLowerCase());
  await state.writeProviderProfile({ ...other, provider_id: "coinbase-agentic-wallet",
    account_binding_hash: accountBindingHash("coinbase-agentic-wallet", other.public_address) });
  let quotes = 0;
  await assert.rejects(serviceFor(state, () => quotes++).prepare(input), { code: "APN_OPERATION_BLOCKED" });
  assert.equal(quotes, 0);
});

test("Relay owner guard admits its own provider profile", async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const state = new StateStore(temporary.root); await state.initialize();
  await state.writeProviderProfile(providerProfile(state, "default", payer.toLowerCase()));
  let quotes = 0;
  const prepared = await serviceFor(state, () => quotes++).prepare(input);
  assert.equal(prepared.state, "prepared"); assert.equal(quotes, 1);
});

test("Relay owner guard fails closed on corrupt profile identity before quote", async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const state = new StateStore(temporary.root); await state.initialize();
  await state.writeProviderProfile(providerProfile(state, "other"));
  const { writeFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  await writeFile(join(temporary.root, "profiles", state.profileHash("other"), "profile.json"), "{broken", { mode: 0o600 });
  let quotes = 0;
  await assert.rejects(serviceFor(state, () => quotes++).prepare(input));
  assert.equal(quotes, 0);
});

test("Relay owner guard scans legacy local wallets and unreadable encrypted identities", async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const state = new StateStore(temporary.root); await state.initialize();
  const profile = "legacy", createdAt = instant.toISOString();
  await state.writeWallet(sealWallet({ schemaVersion: STATE_VERSION, profile, profileHash: state.profileHash(profile),
    address: payer, createdAt, bindingHash: hashObject({ profile, address: payer, createdAt }) }));
  let quotes = 0;
  await assert.rejects(serviceFor(state, () => quotes++).prepare(input), { code: "APN_OPERATION_BLOCKED" });
  assert.equal(quotes, 0);
  const { rm } = await import("node:fs/promises");
  const { join } = await import("node:path");
  await rm(join(temporary.root, "wallets", state.profileHash(profile)), { recursive: true });
  await state.writeEncryptedWalletEnvelope("legacy", { malformed: true });
  await assert.rejects(serviceFor(state, () => quotes++).prepare(input));
  assert.equal(quotes, 0);
});

test("provider rebind waits for both old and new owner locks", async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const state = new StateStore(temporary.root); await state.initialize();
  const repository = new StateProfileRepository(state), old = providerProfile(state, "other", recipient);
  await repository.save(old);
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const held = new Promise<void>(resolve => { entered = resolve; });
  const lock = state.withLocks([evmAddressLock(recipient)], async () => { entered(); await gate; });
  await held;
  let saved = false;
  const pending = repository.save({ ...old, public_address: payer,
    account_binding_hash: accountBindingHash(old.provider_id, payer), revision: 2 }).then(() => { saved = true; });
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(saved, false);
  release(); await Promise.all([lock, pending]);
  assert.equal((await repository.load(old.profile_hash))?.public_address, payer);
});

test("Relay releases its owner lock during quote so rebind can finish, then refuses the changed owner", async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const state = new StateStore(temporary.root); await state.initialize();
  const repository = new StateProfileRepository(state), old = providerProfile(state, "other", recipient);
  await repository.save(old);
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const quoting = new Promise<void>(resolve => { entered = resolve; });
  const service = new RelayUnsignedPrepareService(state, { now: () => instant }, undefined, {
    activePolicy: async () => policy(), publicAccount: async () => payer, dailyUsage: async () => "0",
    quote: async intent => { entered(); await gate; return validateRelayQuote(await quoteFixture(), intent); },
  });
  const pending = service.prepare(input); await quoting;
  try {
    await repository.save({ ...old, public_address: payer,
      account_binding_hash: accountBindingHash(old.provider_id, payer), revision: 2 });
  } finally { release(); }
  await assert.rejects(pending, { code: "APN_OPERATION_BLOCKED" });
});

test("Relay releases its owner lock during quote so wallet ensure can finish", async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const state = new StateStore(temporary.root); await state.initialize();
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const quoting = new Promise<void>(resolve => { entered = resolve; });
  const service = new RelayUnsignedPrepareService(state, { now: () => instant }, undefined, {
    activePolicy: async () => policy(), publicAccount: async () => payer, dailyUsage: async () => "0",
    quote: async intent => { entered(); await gate; return validateRelayQuote(await quoteFixture(), intent); },
  });
  const pending = service.prepare(input); await quoting;
  const native = new TestNative(); native.walletAddress = payer;
  const core = new ApnCore({ state, native });
  try {
    const ensured = await core.wallet.ensure("default") as { readonly address: string };
    assert.equal(ensured.address, payer);
  } finally { release(); }
  assert.equal((await pending).state, "prepared");
});

test("rebind at the final owner-lock boundary prevents stale unsigned persistence", async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  let release!: () => void, reached!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const boundary = new Promise<void>(resolve => { reached = resolve; });
  class BoundaryState extends StateStore {
    private ownerAcquisitions = 0;
    protected override async beforeLockAcquire(key: string): Promise<void> {
      if (key === evmAddressLock(payer) && ++this.ownerAcquisitions === 2) { reached(); await gate; }
    }
  }
  const state = new BoundaryState(temporary.root); await state.initialize();
  const repository = new StateProfileRepository(state), old = providerProfile(state, "other", recipient);
  await repository.save(old);
  const pending = serviceFor(state, () => {}).prepare(input);
  await boundary;
  try {
    await repository.save({ ...old, public_address: payer,
      account_binding_hash: accountBindingHash(old.provider_id, payer), revision: 2 });
  } finally { release(); }
  await assert.rejects(pending, { code: "APN_OPERATION_BLOCKED" });
  await assert.rejects(new OperationService(state).required(state.operationId("default", input.idempotencyKey)),
    { code: "APN_OPERATION_NOT_FOUND" });
});

test("Relay waiting for profile lock does not hold the owner lock needed by provider rebind", async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  let waiting!: () => void;
  const attempted = new Promise<void>(resolve => { waiting = resolve; });
  class WatchedState extends StateStore {
    watchProfile = false;
    protected override async beforeLockAcquire(key: string): Promise<void> {
      if (this.watchProfile && key === `profile:${this.profileHash("default")}`) waiting();
    }
  }
  const state = new WatchedState(temporary.root); await state.initialize();
  const repository = new StateProfileRepository(state), old = providerProfile(state, "other", recipient);
  await repository.save(old);
  let release!: () => void, held!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const acquired = new Promise<void>(resolve => { held = resolve; });
  const profileLock = state.withLocks([`profile:${state.profileHash("default")}`], async () => { held(); await gate; });
  await acquired; state.watchProfile = true;
  const pending = serviceFor(state, () => {}).prepare(input);
  await attempted;
  try {
    await repository.save({ ...old, public_address: payer,
      account_binding_hash: accountBindingHash(old.provider_id, payer), revision: 2 });
  } finally { release(); }
  await profileLock;
  await assert.rejects(pending, { code: "APN_OPERATION_BLOCKED" });
});

test("Relay prepare freezes one validated quote, replays without another quote, and survives restart", async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const state = new StateStore(temporary.root);
  let calls = 0;
  const service = new RelayUnsignedPrepareService(state, { now: () => instant }, undefined, {
    activePolicy: async () => policy(), publicAccount: async () => payer, dailyUsage: async () => "0",
    quote: async intent => { calls++; return await validateRelayQuote(await quoteFixture(), intent); },
  });
  const first = await service.prepare(input);
  assert.equal(first.state, "prepared"); assert.equal(first.executionAdmitted, false);
  assert.equal(first.statusObservable, false);
  assert.equal(first.quote?.approval.chainId, 1); assert.equal(first.policyDigest, policy().digest);
  assert.equal(first.approvalNetworkFeeCeilingWei, first.quote?.approval.maximumNetworkFeeWei);
  assert.deepEqual(await service.prepare(input), first); assert.equal(calls, 1);
  const reopened = new OperationService(new StateStore(temporary.root));
  assert.deepEqual(await reopened.status(first.operationId), first);
  await assert.rejects(service.prepare({ ...input, recipient: payer }), { code: "APN_IDEMPOTENCY_CONFLICT" });
  await assert.rejects(service.prepare({ ...input, idempotencyKey: "relay-prepare-0002" }), { code: "APN_OPERATION_BLOCKED" });
  assert.equal(calls, 1);
});

test("Relay prepare persists a quote-bound status locator and rejects locator tampering", async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const state = new StateStore(temporary.root);
  const requestId = `0x${"ab".repeat(32)}`;
  const service = new RelayUnsignedPrepareService(state, { now: () => instant }, undefined, {
    activePolicy: async () => policy(), publicAccount: async () => payer, dailyUsage: async () => "0",
    quote: async intent => {
      const source = await quoteFixture() as any;
      source.requestId = requestId;
      source.steps[1].items[0].check = { method: "GET", endpoint: `/intents/status/v3?requestId=${requestId}` };
      return validateRelayQuote(source, intent);
    },
  });
  const first = await service.prepare(input);
  assert.equal(first.statusObservable, true);
  assert.equal(first.executionAdmitted, false);
  assert.equal(first.statusLocator?.requestId, requestId);
  assert.deepEqual((await new OperationService(new StateStore(temporary.root)).status(first.operationId)), first);
  const { validateRelayUnsignedOperation } = await import("../../src/relay-unsigned-operation.js");
  const { join } = await import("node:path");
  const saved = JSON.parse(await readFile(join(temporary.root, "relay-unsigned-operations",
    state.profileHash("default"), `${first.operationId}.json`), "utf8")) as Record<string, unknown>;
  const { integrityHash: _integrityHash, ...fields } = saved;
  const changed = { ...fields, statusLocator: { requestId: `0x${"cd".repeat(32)}`,
    endpoint: `https://api.relay.link/intents/status/v3?requestId=0x${"cd".repeat(32)}` } };
  assert.throws(() => validateRelayUnsignedOperation({ ...changed, integrityHash: hashObject(changed) }),
    { code: "APN_STATE_CORRUPT" });
});

test("Relay retirement preserves quote, unblocks a fresh key, and never calls a network port", async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const state = new StateStore(temporary.root);
  let quotes = 0;
  const prepare = serviceFor(state, () => quotes++);
  const first = await prepare.prepare(input);
  const beforeBytes = await readFile(join(temporary.root, "relay-unsigned-operations", first.profileHash, `${first.operationId}.json`));
  await assert.rejects(prepare.prepare({ ...input, idempotencyKey: "relay-prepare-0002" }), { code: "APN_OPERATION_BLOCKED" });
  assert.equal(quotes, 1);
  const retire = new RelayRetireService(state, { now: () => instant }, {
    load: async () => { throw new Error("unexpected wallet secret read"); },
    create: async () => { throw new Error("unexpected wallet secret creation"); },
  });
  const bound = bindArgv(["relay", "retire", "--profile", "default", "--operation", first.operationId]);
  assert.deepEqual(bound.request, { command: "relay.retire", profile: "default", operationId: first.operationId });
  const retired = await retire.retire({ profile: "default", operationId: first.operationId });
  assert.equal(retired.state, "retired"); assert.equal(retired.terminal, true);
  assert.equal(retired.executionAdmitted, false);
  assert.deepEqual(await retire.retire({ profile: "default", operationId: first.operationId }), retired);
  assert.deepEqual(await new OperationService(new StateStore(temporary.root)).status(first.operationId), retired);
  assert.deepEqual(await prepare.prepare(input), retired);
  assert.deepEqual(await readFile(join(temporary.root, "relay-unsigned-operations", first.profileHash, `${first.operationId}.json`)), beforeBytes);
  const fresh = await prepare.prepare({ ...input, idempotencyKey: "relay-prepare-0002" });
  assert.equal(fresh.state, "prepared"); assert.notEqual(fresh.operationId, first.operationId); assert.equal(quotes, 2);
  let rpcCalls = 0;
  await assert.rejects(new RelayReadOnlyPreflightService(state, { now: () => instant },
    { batch: async () => { rpcCalls++; return []; } }).preflight({ profile: "default", operationId: first.operationId }),
  { code: "APN_OPERATION_BLOCKED" });
  assert.equal(rpcCalls, 0);
});

test("Relay retirement refuses existing effects and corrupted marker; parallel retirement is idempotent", async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const state = new StateStore(temporary.root), prepare = serviceFor(state, () => {});
  const first = await prepare.prepare(input);
  const retire = new RelayRetireService(state, { now: () => instant });
  const results = await Promise.all([retire.retire({ profile: "default", operationId: first.operationId }),
    retire.retire({ profile: "default", operationId: first.operationId })]);
  assert.deepEqual(results[0], results[1]);
  await assert.rejects(new RelayEffectJournalRepository(temporary.root).create(first.profileHash, first.operationId, instant.toISOString()),
    { code: "APN_OPERATION_BLOCKED" });
  const marker = join(temporary.root, "relay-retirements", first.profileHash, `${first.operationId}.json`);
  await writeFile(marker, JSON.stringify({ ...JSON.parse(await readFile(marker, "utf8")), retiredAt: "2026-09-30T00:00:00.000Z" }));
  await assert.rejects(new OperationService(state).assertProfileAvailable(first.profileHash), { code: "APN_STATE_CORRUPT" });
  await assert.rejects(retire.retire({ profile: "default", operationId: first.operationId }), { code: "APN_STATE_CORRUPT" });
});

test("Relay retirement refuses even an unattempted effect journal", async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const state = new StateStore(temporary.root), first = await serviceFor(state, () => {}).prepare(input);
  await new RelayEffectJournalRepository(temporary.root).create(first.profileHash, first.operationId, instant.toISOString());
  await assert.rejects(new RelayRetireService(state, { now: () => instant }).retire({ profile: "default", operationId: first.operationId }),
    { code: "APN_OPERATION_BLOCKED" });
  await assert.rejects(new OperationService(state).assertProfileAvailable(first.profileHash), { code: "APN_OPERATION_BLOCKED" });
});

test("Relay retirement refuses a matching usage reservation", async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const state = new StateStore(temporary.root), first = await serviceFor(state, () => {}).prepare(input);
  await new AssetUsageLedger(temporary.root).reserve({ account: payer, chain: "eip155:1",
    asset: { kind: "token", identifier: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" },
    registry: policy().registry, rail: "bridge", amountAtomic: input.amountAtomic,
    idempotencyKey: input.idempotencyKey, now: instant });
  await assert.rejects(new RelayRetireService(state, { now: () => instant }).retire({ profile: "default", operationId: first.operationId }),
    { code: "APN_OPERATION_BLOCKED" });
});

test("Relay retirement refuses orphan encrypted approval custody without a journal", async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const state = new StateStore(temporary.root), first = await serviceFor(state, () => {}).prepare(input);
  const key = `0x${"1".repeat(64)}` as const;
  const wrapping = { load: async () => Buffer.alloc(32, 7), create: async () => Buffer.alloc(32, 7) };
  const wallets = new EncryptedWalletStore(state, wrapping);
  await wallets.importNew("default", key, privateKeyToAccount(key).address);
  const wallet = await wallets.describe("default"); assert.ok(wallet);
  const slot = domainHash("apn.relay-approval-custody.v1", canonicalJson({ operationId: first.operationId }));
  const rawTransaction = "0x0102" as const, transactionHash = keccak256(rawTransaction);
  wallet.secret.directEffects[slot] = { payloadHash: "a".repeat(64), transactionHash,
    rawTransaction, rawTransactionHash: transactionHash };
  await wallets.save(wallet.identity, wallet.secret); wallets.clear(wallet.secret);
  assert.equal(await new RelayEffectJournalRepository(temporary.root).load(first.profileHash, first.operationId), null);
  await assert.rejects(new RelayRetireService(state, { now: () => instant }, wrapping).retire({ profile: "default", operationId: first.operationId }),
    { code: "APN_OPERATION_BLOCKED" });
  const status = await new OperationService(state).status(first.operationId) as { state: string };
  assert.equal(status.state, "prepared");
});

test("Relay retirement fails closed on corrupt encrypted custody metadata", async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const state = new StateStore(temporary.root), first = await serviceFor(state, () => {}).prepare(input);
  const key = `0x${"1".repeat(64)}` as const;
  const wrapping = { load: async () => Buffer.alloc(32, 7), create: async () => Buffer.alloc(32, 7) };
  const wallets = new EncryptedWalletStore(state, wrapping);
  await wallets.importNew("default", key, privateKeyToAccount(key).address);
  const wallet = await wallets.describe("default"); assert.ok(wallet);
  const slot = domainHash("apn.relay-approval-custody.v1", canonicalJson({ operationId: first.operationId }));
  const rawTransaction = "0x0102" as const, transactionHash = keccak256(rawTransaction);
  wallet.secret.directEffects[slot] = { payloadHash: "invalid", transactionHash,
    rawTransaction, rawTransactionHash: transactionHash };
  await wallets.save(wallet.identity, wallet.secret); wallets.clear(wallet.secret);
  await assert.rejects(new RelayRetireService(state, { now: () => instant }, wrapping).retire({ profile: "default", operationId: first.operationId }),
    { code: "APN_STATE_CORRUPT" });
});

test("Relay usage bucket stays locked from reservation check through retirement write", async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  let entered!: () => void, release!: () => void;
  const inside = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const held = new AssetUsageLedger(temporary.root).withNoMatchingRelayReservation(payer, policy().digest,
    input.amountAtomic, async () => { entered(); await gate; });
  await inside;
  const reservation = { account: payer, chain: "eip155:1", asset: {
    kind: "token" as const, identifier: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" },
    registry: policy().registry, rail: "bridge" as const, amountAtomic: input.amountAtomic,
    idempotencyKey: input.idempotencyKey, now: instant };
  try {
    await assert.rejects(new AssetUsageLedger(temporary.root, { lockWaitMs: 60 }).reserve(reservation),
      { code: "APN_STATE_BUSY" });
  } finally { release(); await held; }
  const saved = await new AssetUsageLedger(temporary.root).reserve(reservation);
  assert.equal(saved.state, "reserved");
  await assert.rejects(new AssetUsageLedger(temporary.root).withNoMatchingRelayReservation(payer,
    policy().digest, input.amountAtomic, async () => {}), { code: "APN_OPERATION_BLOCKED" });
});

test("Relay retirement rejects foreign IDs, profile mismatch, and malformed prepared records", async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const state = new StateStore(temporary.root), first = await serviceFor(state, () => {}).prepare(input);
  const retire = new RelayRetireService(state, { now: () => instant });
  await assert.rejects(retire.retire({ profile: "other", operationId: first.operationId }), { code: "APN_INVALID_INPUT" });
  await assert.rejects(retire.retire({ profile: "default", operationId: "f".repeat(64) }), { code: "APN_OPERATION_NOT_FOUND" });
  const repo = new RelayUnsignedOperationRepository(temporary.root);
  const original = await repo.loadOperation(first.profileHash, first.operationId);
  assert.ok(original);
  const { integrityHash: _integrityHash, ...fields } = original;
  const foreign = freezeRelayUnsignedOperation({ ...fields, profileHash: state.profileHash("other"),
    operationId: "c".repeat(64), idempotencyHash: "d".repeat(64) });
  await repo.persistLocked(foreign);
  await assert.rejects(retire.retire({ profile: "default", operationId: foreign.operationId }), { code: "APN_OPERATION_BLOCKED" });
  await writeFile(join(temporary.root, "relay-unsigned-operations", first.profileHash, `${first.operationId}.json`), "{}");
  await assert.rejects(retire.retire({ profile: "default", operationId: first.operationId }), { code: "APN_STATE_CORRUPT" });
});

test("Relay retire and fresh prepare serialize without losing the new operation", async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const state = new StateStore(temporary.root), prepare = serviceFor(state, () => {});
  const first = await prepare.prepare(input);
  const nextInput = { ...input, idempotencyKey: "relay-prepare-0002" };
  const [retired, concurrent] = await Promise.allSettled([
    new RelayRetireService(state, { now: () => instant }).retire({ profile: "default", operationId: first.operationId }),
    prepare.prepare(nextInput),
  ]);
  assert.equal(retired.status, "fulfilled");
  if (concurrent.status === "rejected") {
    assert.equal((concurrent.reason as { code?: string }).code, "APN_OPERATION_BLOCKED");
    await prepare.prepare(nextInput);
  }
  const status = await new OperationService(state).status(state.operationId("default", nextInput.idempotencyKey)) as { state: string };
  assert.equal(status.state, "prepared");
  await assert.rejects(new OperationService(state).assertProfileAvailable(first.profileHash), { code: "APN_OPERATION_BLOCKED" });
});

test("Relay prepare uses the checksummed owner for ledger usage before quoting and replays without quoting", async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const state = new StateStore(temporary.root);
  let quotes = 0;
  const service = new RelayUnsignedPrepareService(state, { now: () => instant }, undefined, {
    activePolicy: async () => policy(), publicAccount: async () => payer,
    quote: async intent => { quotes++; return validateRelayQuote(await quoteFixture(), intent); },
  });
  const first = await service.prepare(input);
  assert.equal(first.sourceAccount, payer.toLowerCase());
  assert.equal(quotes, 1);
  assert.deepEqual(await service.prepare(input), first);
  assert.equal(quotes, 1);
});

test("Relay prepare refuses a noncanonical policy owner before the quote", async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  let quotes = 0;
  const service = new RelayUnsignedPrepareService(new StateStore(temporary.root), { now: () => instant }, undefined, {
    activePolicy: async () => ({ ...policy(), accounts: { evm: payer.toLowerCase() } }),
    publicAccount: async () => payer,
    quote: async intent => { quotes++; return validateRelayQuote(await quoteFixture(), intent); },
  });
  await assert.rejects(service.prepare(input), { code: "APN_INVALID_INPUT" });
  assert.equal(quotes, 0);
});

test("Relay policy and fee caps refuse before or after exactly one quote", async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const state = new StateStore(temporary.root);
  let calls = 0;
  const run = (active: ReturnType<typeof policy> | null) => new RelayUnsignedPrepareService(state, { now: () => instant }, undefined, {
    activePolicy: async () => active, publicAccount: async () => payer, dailyUsage: async () => "0",
    quote: async intent => { calls++; return await validateRelayQuote(await quoteFixture(), intent); },
  });
  await assert.rejects(run(null).prepare(input), { code: "APN_ALLOWLIST_REFUSED" });
  await assert.rejects(run(policy("wrong-route")).prepare(input), { code: "APN_ALLOWLIST_REFUSED" });
  await assert.rejects(new RelayUnsignedPrepareService(state, { now: () => instant }, undefined, {
    activePolicy: async () => policy(), publicAccount: async () => recipient, dailyUsage: async () => "0",
    quote: async () => { calls++; throw new Error("quote must not run"); },
  }).prepare(input), { code: "APN_ALLOWLIST_REFUSED" });
  await assert.rejects(run(policy(RELAY_ROUTE_REFERENCE, "2026-09-30T00:00:00.000Z")).prepare(input), { code: "APN_ALLOWLIST_REFUSED" });
  await assert.rejects(run(policy()).prepare({ ...input, amountAtomic: "3000001" }), { code: "APN_OPERATION_BLOCKED" });
  assert.equal(calls, 0);
  await assert.rejects(run(policy()).prepare({ ...input, maxApprovalNetworkFeeWei: "1" }), { code: "APN_OPERATION_BLOCKED" });
  assert.equal(calls, 1);
  await assert.rejects(new OperationService(state).required(state.operationId("default", input.idempotencyKey)), { code: "APN_OPERATION_NOT_FOUND" });
});

test("Relay rejects changed quote digest and CLI binds the finite prepare inputs", async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const state = new StateStore(temporary.root);
  const bound = bindArgv(["relay", "prepare", "--profile", "default", "--recipient", recipient,
    "--amount-atomic", input.amountAtomic, "--min-output-atomic", input.minOutputAtomic,
    "--max-approval-network-fee-wei", input.maxApprovalNetworkFeeWei,
    "--max-deposit-network-fee-wei", input.maxDepositNetworkFeeWei, "--idempotency-key", input.idempotencyKey]);
  assert.deepEqual(bound.request, { command: "relay.prepare", ...input });
  const service = new RelayUnsignedPrepareService(state, { now: () => instant }, undefined, {
    activePolicy: async () => policy(), publicAccount: async () => payer, dailyUsage: async () => "0",
    quote: async intent => ({ ...await validateRelayQuote(await quoteFixture(), intent), quoteDigest: "0".repeat(64) }),
  });
  await assert.rejects(service.prepare(input), { code: "APN_OPERATION_BLOCKED" });
  await assert.rejects(new OperationService(state).required(state.operationId("default", input.idempotencyKey)), { code: "APN_OPERATION_NOT_FOUND" });
});
