import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { createErc20TokenAllowanceCaveats } from "@metamask/7715-permission-types";
import { ROOT_AUTHORITY } from "@metamask/smart-accounts-kit";
import { decodeDelegations, encodeDelegations } from "@metamask/smart-accounts-kit/utils";
import { encodePacked } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ApnCore } from "../../src/core.js";
import { runCli } from "../../src/cli.js";
import { BASE_USDC } from "../../src/constants.js";
import { EncryptedSmartAccountPermissionStore } from "../../src/encrypted-smart-account-permission-store.js";
import type { WrappingSecretPort } from "../../src/macos-keychain.js";
import {
  METAMASK_SMART_ACCOUNT_PROVIDER_ID,
  MetaMaskSmartAccountAdapter,
  type SessionKeyFactoryPort,
} from "../../src/metamask-smart-account-adapter.js";
import type {
  SmartAccountConsentPort,
  SmartAccountConsentRequest,
  SmartAccountConsentSync,
} from "../../src/metamask-smart-account-consent.js";
import {
  assertMetaMaskSmartAccountPackageIdentity,
  METAMASK_PERMISSION_TYPES_INTEGRITY,
  METAMASK_PERMISSION_TYPES_VERSION,
  METAMASK_SMART_ACCOUNTS_KIT_INTEGRITY,
  METAMASK_SMART_ACCOUNTS_KIT_VERSION,
} from "../../src/metamask-smart-account-package.js";
import { smartAccountEnvironment, validateSmartAccountObservation } from "../../src/metamask-smart-account-grant.js";
import type { Address, Hex } from "../../src/model.js";
import { createMcpServer } from "../../src/mcp-server.js";
import type { ProviderProfileRepositoryPort } from "../../src/provider-ports.js";
import { ProviderRegistry } from "../../src/provider-registry.js";
import { StateProfileRepository } from "../../src/profile-repository.js";
import { StateStore } from "../../src/state.js";
import { accountBindingHash, lifecycleReadOnlyCapabilitySnapshot } from "../../src/provider-profile.js";
import { TestRpc, temporaryState } from "./helpers.js";

const OWNER = privateKeyToAccount(`0x${"1".repeat(64)}` as Hex).address;
const SESSION_PRIVATE_KEY = `0x${"2".repeat(64)}` as Hex;
const SESSION = privateKeyToAccount(SESSION_PRIVATE_KEY).address;
const NOW = 1_788_393_600;
const EXPIRY = NOW + 3_600;
const CAP = "2000000";
const IDEMPOTENCY_KEY = "smart-account-connect-0001";
const PROFILE = "smart-account";

class TestWrappingSecret implements WrappingSecretPort {
  private secret: Buffer | null = Buffer.from("33".repeat(32), "hex");
  async load(): Promise<Buffer | null> { return this.secret === null ? null : Buffer.from(this.secret); }
  async create(): Promise<Buffer> {
    this.secret ??= Buffer.from("33".repeat(32), "hex");
    return Buffer.from(this.secret);
  }
}

class FixedSessionFactory implements SessionKeyFactoryPort {
  calls = 0;
  create(): { readonly address: Address; readonly privateKey: Hex } {
    this.calls += 1;
    return { address: SESSION, privateKey: SESSION_PRIVATE_KEY };
  }
}

class FixtureConsent implements SmartAccountConsentPort {
  requestCalls = 0;
  syncCalls = 0;
  lastResponse: Record<string, unknown> | null = null;
  syncMode: "present" | "absent" | "drift" | "throw" = "present";

  async request(input: SmartAccountConsentRequest): Promise<unknown> {
    this.requestCalls += 1;
    const observation = validObservation(input);
    this.lastResponse = structuredClone(observation.permission_responses[0]) as Record<string, unknown>;
    return observation;
  }

  async sync(_input: SmartAccountConsentSync): Promise<unknown> {
    this.syncCalls += 1;
    if (this.syncMode === "throw") throw new Error("provider unavailable");
    const permissionResponses = this.syncMode === "absent" ? [] : [structuredClone(this.lastResponse)];
    if (this.syncMode === "drift") {
      const response = permissionResponses[0] as Record<string, unknown>;
      const permission = response.permission as Record<string, unknown>;
      permission.data = { ...(permission.data as Record<string, unknown>), justification: "changed by provider" };
    }
    return preflight(permissionResponses);
  }
}

class FailingOnceRepository implements ProviderProfileRepositoryPort {
  private failed = false;
  constructor(private readonly inner: ProviderProfileRepositoryPort) {}
  async load(profileHash: string) { return await this.inner.load(profileHash); }
  async save(profile: Parameters<ProviderProfileRepositoryPort["save"]>[0]): Promise<void> {
    if (!this.failed) { this.failed = true; throw new Error("simulated lost profile response"); }
    await this.inner.save(profile);
  }
  async remove(profileHash: string): Promise<void> { await this.inner.remove(profileHash); }
}

class FailingOnceRemoveRepository implements ProviderProfileRepositoryPort {
  private failed = false;
  constructor(private readonly inner: ProviderProfileRepositoryPort) {}
  async load(profileHash: string) { return await this.inner.load(profileHash); }
  async save(profile: Parameters<ProviderProfileRepositoryPort["save"]>[0]): Promise<void> { await this.inner.save(profile); }
  async remove(profileHash: string): Promise<void> {
    if (!this.failed) { this.failed = true; throw new Error("simulated lost profile removal response"); }
    await this.inner.remove(profileHash);
  }
}

test("pinned official MetaMask packages and no-money capability bundle are exact", async () => {
  await assertMetaMaskSmartAccountPackageIdentity();
  const lock = JSON.parse(await readFile("npm-shrinkwrap.json", "utf8")) as Record<string, any>;
  assert.equal(lock.packages["node_modules/@metamask/smart-accounts-kit"].version, METAMASK_SMART_ACCOUNTS_KIT_VERSION);
  assert.equal(lock.packages["node_modules/@metamask/smart-accounts-kit"].integrity, METAMASK_SMART_ACCOUNTS_KIT_INTEGRITY);
  assert.equal(lock.packages["node_modules/@metamask/7715-permission-types"].version, METAMASK_PERMISSION_TYPES_VERSION);
  assert.equal(lock.packages["node_modules/@metamask/7715-permission-types"].integrity, METAMASK_PERMISSION_TYPES_INTEGRITY);
  const fixture = await makeFixture();
  try {
    const bundle = fixture.adapter.bundle();
    assert.equal(bundle.provider_id, METAMASK_SMART_ACCOUNT_PROVIDER_ID);
    assert.equal(bundle.capabilities.direct.available, false);
    assert.equal(bundle.capabilities.x402.available, false);
    assert.equal(bundle.capabilities.permission?.protocol, "erc7715");
  } finally { await fixture.temporary.cleanup(); }
});

test("connect is idempotent, encrypted, restart-safe and exposes only safe permission facts", async () => {
  const fixture = await makeFixture();
  try {
    const first = await fixture.core.execute(connectCommand());
    assert.equal(first.ok, true);
    assert.equal((first.data as any).status, "active");
    assert.equal((first.data as any).address, OWNER);
    assert.equal((first.data as any).permission.session_account, SESSION);
    assert.equal((first.data as any).permission.granted_cap_usdc_atomic, CAP);
    const serialized = JSON.stringify(first);
    assert.equal(serialized.includes(IDEMPOTENCY_KEY), false);
    assert.equal(serialized.includes(SESSION_PRIVATE_KEY), false);
    assert.equal(serialized.includes(String(fixture.consent.lastResponse?.context)), false);

    const second = await fixture.core.execute(connectCommand());
    assert.equal(second.ok, true);
    assert.equal((second.data as any).reused, true);
    assert.equal(fixture.consent.requestCalls, 1);
    assert.equal(fixture.sessions.calls, 1);

    const profileHash = fixture.state.profileHash(PROFILE);
    const disk = await readFile(join(fixture.temporary.root, "smart-account-permissions", `${profileHash}.json`), "utf8");
    assert.equal(disk.includes(SESSION_PRIVATE_KEY.slice(2)), false);
    assert.equal(disk.includes(String(fixture.consent.lastResponse?.context)), false);

    const restarted = fixture.restart();
    const status = await restarted.execute({ command: "wallet.status", profile: PROFILE });
    const listed = await restarted.execute({ command: "wallet.permission.list", profile: PROFILE });
    assert.equal(status.ok, true);
    assert.equal(listed.ok, true);
    assert.equal((status.data as any).permission.grant_fingerprint, (first.data as any).permission.grant_fingerprint);
    assert.equal(fixture.consent.requestCalls, 1);
  } finally { await fixture.temporary.cleanup(); }
});

test("authenticated protected state rejects a session-to-key binding change", async () => {
  const fixture = await makeFixture();
  try {
    assert.equal((await fixture.core.execute(connectCommand())).ok, true);
    const profileHash = fixture.state.profileHash(PROFILE);
    const store = new EncryptedSmartAccountPermissionStore(fixture.state, new TestWrappingSecret());
    const record = await store.load(profileHash);
    assert.ok(record !== null);
    await assert.rejects(store.save({ ...record, session_address: OWNER }), /session key binding/);
  } finally { await fixture.temporary.cleanup(); }
});

test("a lost common-profile write retries the committed grant without new consent or session", async () => {
  const fixture = await makeFixture({ failFirstProfileSave: true });
  try {
    const lost = await fixture.core.execute(connectCommand());
    assert.equal(lost.ok, false);
    const recovered = await fixture.core.execute(connectCommand());
    assert.equal(recovered.ok, true);
    assert.equal((recovered.data as any).status, "active");
    assert.equal(fixture.consent.requestCalls, 1);
    assert.equal(fixture.sessions.calls, 1);
  } finally { await fixture.temporary.cleanup(); }
});

test("provider-inapplicable or changed permission intents fail before a second provider effect", async () => {
  const fixture = await makeFixture();
  try {
    const wrongProvider = await fixture.core.execute({ ...connectCommand(), providerId: "read-only" });
    assert.equal(wrongProvider.ok, false);
    assert.equal(wrongProvider.error?.code, "APN_INVALID_INPUT");
    assert.equal(fixture.consent.requestCalls, 0);

    assert.equal((await fixture.core.execute(connectCommand())).ok, true);
    const conflict = await fixture.core.execute({ ...connectCommand(), permissionCapUsdcAtomic: "3000000" });
    assert.equal(conflict.ok, false);
    assert.equal(conflict.error?.code, "APN_IDEMPOTENCY_CONFLICT");
    assert.equal(fixture.consent.requestCalls, 1);
  } finally { await fixture.temporary.cleanup(); }
});

test("strict grant validation rejects widened cap, dependencies and inactive Smart Accounts", () => {
  const request = { sessionAddress: SESSION, capAtomic: CAP, startsAtUnix: NOW, expiresAtUnix: EXPIRY, nowUnix: NOW };
  const valid = validObservation({ sessionAddress: SESSION, capAtomic: CAP, startsAtUnix: NOW, expiresAtUnix: EXPIRY });
  assert.equal(validateSmartAccountObservation(valid, request).ownerAddress, OWNER);
  const wider = structuredClone(valid);
  (wider.permission_responses[0] as any).permission.data.allowanceAmount = "0x2dc6c0";
  assert.throws(() => validateSmartAccountObservation(wider, request), /outside the requested/);
  const dependencies = structuredClone(valid);
  (dependencies.permission_responses[0] as any).dependencies = [{ factory: OWNER, factoryData: "0x01" }];
  assert.throws(() => validateSmartAccountObservation(dependencies, request), /dependencies/);
  const runtimeArgs = structuredClone(valid);
  (runtimeArgs.permission_responses[0] as any).context = mutateFirstCaveatArgs(
    String((runtimeArgs.permission_responses[0] as any).context) as Hex,
  );
  assert.throws(() => validateSmartAccountObservation(runtimeArgs, request), /caveat set/);
  const inactive = structuredClone(valid);
  inactive.account_code = "0x";
  assert.throws(() => validateSmartAccountObservation(inactive, request), /Enable the official MetaMask Smart Account/);
  const unsupportedRules = structuredClone(valid);
  (unsupportedRules.supported_permissions as any)["erc20-token-allowance"].ruleTypes = [];
  assert.throws(() => validateSmartAccountObservation(unsupportedRules, request), /does not advertise/);
});

test("Slice 1 advertises no payment effects and blocks direct or x402 before adjacent I/O", async () => {
  const rpc = new TestRpc();
  const fixture = await makeFixture({ rpc });
  try {
    assert.equal((await fixture.core.execute(connectCommand())).ok, true);
    const direct = await fixture.core.execute({
      command: "transfer.prepare", profile: PROFILE, idempotencyKey: "smart-direct-blocked-001",
      recipient: SESSION, amount: "0.01",
    });
    const x402 = await fixture.core.execute({
      command: "x402.fetch.prepare", profile: PROFILE, idempotencyKey: "smart-x402-blocked-001",
      url: "https://example.com/paid", maxAmountAtomic: "10000",
    });
    assert.equal(direct.error?.code, "APN_PROVIDER_EFFECT_UNAVAILABLE");
    assert.equal(x402.error?.code, "APN_PROVIDER_EFFECT_UNAVAILABLE");
    assert.equal(rpc.balanceCalls, 0);
    assert.equal(fixture.consent.requestCalls, 1);
  } finally { await fixture.temporary.cleanup(); }
});

test("sync, disable, forget and durable expiry are revision guarded", async () => {
  const fixture = await makeFixture();
  try {
    assert.equal((await fixture.core.execute(connectCommand())).ok, true);
    const stale = await fixture.core.execute({ command: "wallet.permission.disable", profile: PROFILE, expectedRevision: 2 });
    assert.equal(stale.error?.code, "APN_PROFILE_REVISION_CONFLICT");
    const synced = await fixture.core.execute({ command: "wallet.permission.sync", profile: PROFILE, expectedRevision: 1 });
    assert.equal(synced.ok, true);
    assert.equal((synced.data as any).permission.revocation_freshness, "confirmed_present");
    assert.equal((synced.data as any).revision, 2);
    const disabled = await fixture.core.execute({ command: "wallet.permission.disable", profile: PROFILE, expectedRevision: 2 });
    assert.equal((disabled.data as any).status, "disabled");
    const forgotten = await fixture.core.execute({ command: "wallet.permission.forget", profile: PROFILE, expectedRevision: 3 });
    assert.equal(forgotten.ok, true);
    assert.equal((forgotten.data as any).provider_revoke, "not_performed");
    assert.match((forgotten.data as any).warning, /may still exist/);
  } finally { await fixture.temporary.cleanup(); }

  const expiryFixture = await makeFixture();
  try {
    assert.equal((await expiryFixture.core.execute(connectCommand())).ok, true);
    expiryFixture.setNow(EXPIRY + 1);
    const expired = await expiryFixture.core.execute({ command: "wallet.permission.list", profile: PROFILE });
    assert.equal((expired.data as any).status, "expired");
    assert.equal((expired.data as any).revision, 2);
    expiryFixture.setNow(NOW - 100);
    const rolledBack = await expiryFixture.restart().execute({ command: "wallet.permission.list", profile: PROFILE });
    assert.equal((rolledBack.data as any).status, "expired");
    assert.equal((rolledBack.data as any).revision, 2);
  } finally { await expiryFixture.temporary.cleanup(); }
});

test("forget recovers the same revision after local secret deletion but lost common-profile removal", async () => {
  const fixture = await makeFixture({ failFirstProfileRemove: true });
  try {
    assert.equal((await fixture.core.execute(connectCommand())).ok, true);
    const first = await fixture.core.execute({ command: "wallet.permission.forget", profile: PROFILE, expectedRevision: 1 });
    assert.equal(first.ok, false);
    const reconnect = await fixture.core.execute(connectCommand());
    assert.equal(reconnect.error?.code, "APN_STATE_CORRUPT");
    assert.equal(fixture.sessions.calls, 1);
    assert.equal(fixture.consent.requestCalls, 1);
    const recovered = await fixture.core.execute({ command: "wallet.permission.forget", profile: PROFILE, expectedRevision: 1 });
    assert.equal(recovered.ok, true);
    assert.equal((recovered.data as any).status, "forgotten");
    assert.equal(fixture.consent.requestCalls, 1);
  } finally { await fixture.temporary.cleanup(); }
});

test("status preserves a mismatched profile binding and records the permission as observed drift", async () => {
  const fixture = await makeFixture();
  try {
    assert.equal((await fixture.core.execute(connectCommand())).ok, true);
    const profileHash = fixture.state.profileHash(PROFILE);
    const profile = await fixture.state.loadProviderProfile(profileHash);
    assert.ok(profile !== null);
    await fixture.state.writeProviderProfile({
      ...profile,
      public_address: SESSION,
      account_binding_hash: accountBindingHash(METAMASK_SMART_ACCOUNT_PROVIDER_ID, SESSION),
    });
    const status = await fixture.core.execute({ command: "wallet.status", profile: PROFILE });
    assert.equal((status.data as any).status, "drift_blocked");
    const durable = await fixture.state.loadProviderProfile(profileHash);
    assert.equal(durable?.public_address, SESSION);
    assert.equal(durable?.drift.reason, "identity_changed");
    assert.equal(durable?.drift.observed_address, OWNER);
  } finally { await fixture.temporary.cleanup(); }
});

test("foreground sync distinguishes revoked, drifted and unverified remote state", async () => {
  for (const [mode, expectedState, expectedOk] of [
    ["absent", "revoked", true], ["drift", "drift_blocked", true], ["throw", "active", false],
  ] as const) {
    const fixture = await makeFixture();
    try {
      assert.equal((await fixture.core.execute(connectCommand())).ok, true);
      fixture.consent.syncMode = mode;
      const result = await fixture.core.execute({ command: "wallet.permission.sync", profile: PROFILE, expectedRevision: 1 });
      assert.equal(result.ok, expectedOk);
      const listed = await fixture.core.execute({ command: "wallet.permission.list", profile: PROFILE });
      assert.equal((listed.data as any).status, expectedState);
      assert.equal((listed.data as any).permission.revocation_freshness, mode === "absent" ? "confirmed_absent" : "unverified");
    } finally { await fixture.temporary.cleanup(); }
  }
});

test("balance separates the owner Smart Account from the local session gas account", async () => {
  const rpc = new TestRpc();
  rpc.balances = { ...rpc.balances, ethAtomic: "0" };
  const fixture = await makeFixture({ rpc });
  try {
    assert.equal((await fixture.core.execute(connectCommand())).ok, true);
    const balance = await fixture.core.execute({ command: "wallet.balance", profile: PROFILE });
    assert.equal(balance.ok, true);
    assert.equal((balance.data as any).accounts.owner_smart_account.address, OWNER);
    assert.equal((balance.data as any).accounts.session_execution_account.address, SESSION);
    assert.equal((balance.data as any).accounts.session_execution_account.gas_readiness, "not_ready_zero_balance");
    assert.equal(rpc.balanceCalls, 2);
  } finally { await fixture.temporary.cleanup(); }
});

test("actual CLI and MCP surfaces share lifecycle state while foreground consent stays a safe CLI handoff", async () => {
  const temporary = await temporaryState();
  const wrappingSecret = new TestWrappingSecret();
  const consent = new FixtureConsent();
  const sessions = new FixedSessionFactory();
  const options = {
    stateRoot: temporary.root,
    wrappingSecret,
    smartAccountConsent: consent,
    smartAccountSessionKeys: sessions,
    clock: { now: () => new Date(NOW * 1_000) },
  } as const;
  const argv = [
    "wallet", "connect", "--profile", PROFILE,
    "--provider", METAMASK_SMART_ACCOUNT_PROVIDER_ID,
    "--auth-method", "browser",
    "--permission-cap-usdc-atomic", CAP,
    "--permission-expires-at", String(EXPIRY),
    "--idempotency-key", IDEMPOTENCY_KEY,
  ];
  try {
    for (const [option, missingProfile] of [
      ["--permission-cap-usdc-atomic", "missing-cap"],
      ["--permission-expires-at", "missing-expiry"],
      ["--idempotency-key", "missing-idempotency"],
    ] as const) {
      const missing = await runCli(argv.filter((value, index) =>
        value !== option && argv[index - 1] !== option
      ).map((value) => value === PROFILE ? missingProfile : value), {}, options);
      assert.equal(missing.error?.code, "APN_INVALID_INPUT");
    }
    assert.equal(consent.requestCalls, 0);
    const connected = await runCli(argv, {}, options);
    assert.equal(connected.ok, true, JSON.stringify(connected));
    const server = createMcpServer(options);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: "smart-account-parity", version: "1.0.0" });
    await client.connect(clientTransport);
    try {
      const handoff = mcpEnvelope(await client.callTool({
        name: "apn_wallet_connect",
        arguments: {
          profile: PROFILE,
          provider: METAMASK_SMART_ACCOUNT_PROVIDER_ID,
          auth_method: "browser",
          permission_cap_usdc_atomic: CAP,
          permission_expires_at: String(EXPIRY),
          idempotency_key: IDEMPOTENCY_KEY,
        },
      }));
      assert.equal(handoff.error?.code, "APN_FOREGROUND_AUTH_REQUIRED");
      assert.match(String(handoff.error?.details?.cli_handoff), /--idempotency-key <same-idempotency-key>$/u);
      assert.equal(JSON.stringify(handoff).includes(IDEMPOTENCY_KEY), false);
      assert.equal(consent.requestCalls, 1);

      const listed = mcpEnvelope(await client.callTool({
        name: "apn_wallet_permission_list", arguments: { profile: PROFILE },
      }));
      const cliListed = await runCli(["wallet", "permission", "list", "--profile", PROFILE], {}, options);
      assert.deepEqual(listed.data, cliListed.data);

      const syncHandoff = mcpEnvelope(await client.callTool({
        name: "apn_wallet_permission_sync", arguments: { profile: PROFILE, expected_revision: "1" },
      }));
      assert.equal(syncHandoff.error?.code, "APN_FOREGROUND_AUTH_REQUIRED");
      assert.equal(consent.syncCalls, 0);

      const disabled = mcpEnvelope(await client.callTool({
        name: "apn_wallet_permission_disable", arguments: { profile: PROFILE, expected_revision: "1" },
      }));
      assert.equal((disabled.data as any).status, "disabled");
      const forgotten = mcpEnvelope(await client.callTool({
        name: "apn_wallet_permission_forget", arguments: { profile: PROFILE, expected_revision: "2" },
      }));
      assert.equal((forgotten.data as any).status, "forgotten");
    } finally {
      await client.close();
      await server.close();
    }
  } finally { await temporary.cleanup(); }
});

function connectCommand() {
  return {
    command: "wallet.connect" as const,
    profile: PROFILE,
    providerId: METAMASK_SMART_ACCOUNT_PROVIDER_ID,
    authenticationMethod: "browser",
    permissionCapUsdcAtomic: CAP,
    permissionExpiresAt: EXPIRY,
    idempotencyKey: IDEMPOTENCY_KEY,
  };
}

async function makeFixture(options: {
  readonly failFirstProfileSave?: boolean;
  readonly failFirstProfileRemove?: boolean;
  readonly rpc?: TestRpc;
} = {}) {
  const temporary = await temporaryState();
  const wrapping = new TestWrappingSecret();
  const consent = new FixtureConsent();
  const sessions = new FixedSessionFactory();
  let now = NOW;
  const setNow = (value: number) => { now = value; };
  const build = (repositoryOverride?: ProviderProfileRepositoryPort) => {
    const state = new StateStore(temporary.root, { lockWaitMs: 1_000 });
    const store = new EncryptedSmartAccountPermissionStore(state, wrapping);
    const adapter = new MetaMaskSmartAccountAdapter(store, consent, sessions, () => new Date(now * 1_000));
    const repository = repositoryOverride ?? new StateProfileRepository(state);
    const registry = new ProviderRegistry([
      { provider_id: METAMASK_SMART_ACCOUNT_PROVIDER_ID, create: () => adapter.bundle() },
      {
        provider_id: "read-only",
        create: () => ({
          provider_id: "read-only",
          trust_class: "provider_managed_non_custodial_signer",
          capabilities: lifecycleReadOnlyCapabilitySnapshot(),
          lifecycle: {
            authenticationMethods: ["browser"],
            connect: async () => undefined,
            probeStatus: async () => undefined,
            logout: async () => undefined,
          },
          reads: {
            observeBalance: async () => { throw new Error("must not run"); },
            crossCheckAddress: async () => { throw new Error("must not run"); },
          },
        }),
      },
    ]);
    return {
      state,
      adapter,
      core: new ApnCore({
        state,
        profileRepository: repository,
        providerRegistry: registry,
        ...(options.rpc === undefined ? {} : { rpc: options.rpc }),
        clock: { now: () => new Date(now * 1_000) },
        ids: { next: () => "12345678-1234-4234-8234-123456789abc" },
      }),
    };
  };
  const initialState = new StateStore(temporary.root, { lockWaitMs: 1_000 });
  const initialRepository = new StateProfileRepository(initialState);
  const repository = options.failFirstProfileSave
    ? new FailingOnceRepository(initialRepository)
    : options.failFirstProfileRemove
      ? new FailingOnceRemoveRepository(initialRepository)
      : initialRepository;
  const first = build(repository);
  return {
    temporary,
    consent,
    sessions,
    state: first.state,
    adapter: first.adapter,
    core: first.core,
    setNow,
    restart: () => build().core,
  };
}

function validObservation(input: SmartAccountConsentRequest) {
  const environment = smartAccountEnvironment();
  const periodEnforcer = requiredHex(environment.caveatEnforcers.ERC20PeriodTransferEnforcer);
  const valueEnforcer = requiredHex(environment.caveatEnforcers.ValueLteEnforcer);
  const nonceEnforcer = requiredHex(environment.caveatEnforcers.NonceEnforcer);
  const timestampEnforcer = requiredHex(environment.caveatEnforcers.TimestampEnforcer);
  const allowanceAmount = `0x${BigInt(input.capAtomic).toString(16)}` as Hex;
  const permission = {
    type: "erc20-token-allowance" as const,
    isAdjustmentAllowed: true,
    data: { tokenAddress: BASE_USDC, allowanceAmount, startTime: input.startsAtUnix, justification: "APN test" },
  };
  const caveats: Array<{ enforcer: Hex; terms: Hex; args: Hex }> = createErc20TokenAllowanceCaveats({
    permission,
    contracts: {
      erc20PeriodTransferEnforcer: periodEnforcer,
      valueLteEnforcer: valueEnforcer,
    },
  }).map((caveat) => ({ enforcer: caveat.enforcer as Hex, terms: caveat.terms as Hex, args: caveat.args as Hex }));
  caveats.push({
    enforcer: nonceEnforcer,
    terms: `0x${"1".padStart(64, "0")}`,
    args: "0x",
  }, {
    enforcer: timestampEnforcer,
    terms: encodePacked(["uint128", "uint128"], [0n, BigInt(input.expiresAtUnix)]),
    args: "0x",
  });
  const context = encodeDelegations([{
    delegate: input.sessionAddress,
    delegator: OWNER,
    authority: ROOT_AUTHORITY,
    caveats,
    salt: "0x01",
    signature: `0x${"11".repeat(65)}`,
  }]);
  const response = {
    chainId: "0x2105",
    from: OWNER,
    to: input.sessionAddress,
    permission,
    rules: [{ type: "expiry", data: { timestamp: input.expiresAtUnix } }],
    context,
    dependencies: [],
    delegationManager: environment.DelegationManager,
  };
  return preflight([response]);
}

function preflight(permissionResponses: readonly unknown[]) {
  const environment = smartAccountEnvironment();
  const implementation = requiredHex(environment.implementations.EIP7702StatelessDeleGatorImpl);
  return {
    owner_address: OWNER,
    chain_id: "0x2105" as Hex,
    account_code: `0xef0100${implementation.slice(2)}` as Hex,
    supported_permissions: { "erc20-token-allowance": { ruleTypes: ["expiry", "redeemer", "payee"] } },
    permission_responses: permissionResponses,
  };
}

function mcpEnvelope(result: Awaited<ReturnType<Client["callTool"]>>) {
  const content = result.content[0];
  if (content?.type !== "text") throw new Error("expected one text MCP result");
  return JSON.parse(content.text) as import("../../src/commands.js").OutputEnvelope;
}

function requiredHex(value: Hex | undefined): Hex {
  if (value === undefined) throw new Error("MetaMask fixture environment is incomplete");
  return value;
}

function mutateFirstCaveatArgs(context: Hex): Hex {
  const decoded = decodeDelegations(context);
  decoded[0]!.caveats[0] = { ...decoded[0]!.caveats[0]!, args: "0x01" };
  return encodeDelegations(decoded);
}
