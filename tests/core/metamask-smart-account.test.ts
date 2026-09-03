import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { createErc20TokenAllowanceCaveats } from "@metamask/7715-permission-types";
import { ROOT_AUTHORITY } from "@metamask/smart-accounts-kit";
import { decodeDelegations, encodeDelegations } from "@metamask/smart-accounts-kit/utils";
import { encodePacked, keccak256 } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sha256 } from "../../src/canonical.js";
import { ApnCore } from "../../src/core.js";
import { runCli } from "../../src/cli.js";
import { BASE_USDC } from "../../src/constants.js";
import { EncryptedSmartAccountPermissionStore } from "../../src/encrypted-smart-account-permission-store.js";
import { EncryptedSmartAccountDirectEffectStore } from "../../src/encrypted-smart-account-direct-effect-store.js";
import type { WrappingSecretPort } from "../../src/macos-keychain.js";
import {
  METAMASK_SMART_ACCOUNT_PROVIDER_ID,
  MetaMaskSmartAccountAdapter,
  type SessionKeyFactoryPort,
} from "../../src/metamask-smart-account-adapter.js";
import { isGrantedPermissionRecord } from "../../src/metamask-smart-account-record.js";
import {
  MetaMaskSmartAccountDirectAdapter,
  OfficialSmartAccountDelegationEngine,
  type SmartAccountAllowancePort,
  type SmartAccountDelegationEnginePort,
} from "../../src/metamask-smart-account-direct.js";
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
import { ApnError } from "../../src/errors.js";
import { createMcpServer } from "../../src/mcp-server.js";
import type { RpcReceipt } from "../../src/ports.js";
import type { DirectExecutionPort, ProviderProfileRepositoryPort } from "../../src/provider-ports.js";
import { ProviderRegistry } from "../../src/provider-registry.js";
import { StateProfileRepository } from "../../src/profile-repository.js";
import { HttpsBaseRpc } from "../../src/rpc.js";
import { StateStore } from "../../src/state.js";
import {
  accountBindingHash,
  capabilityHash,
  lifecycleReadOnlyCapabilitySnapshot,
  metamaskSmartAccountLegacyCapabilitySnapshot,
} from "../../src/provider-profile.js";
import type { TransferApprovalPort } from "../../src/tty-approval.js";
import { RAW_TRANSACTION, TestRpc, temporaryState } from "./helpers.js";

// All Smart Account fixtures in this file are deterministic, no-browser and no-money.

const OWNER = privateKeyToAccount(`0x${"1".repeat(64)}` as Hex).address;
const SESSION_PRIVATE_KEY = `0x${"2".repeat(64)}` as Hex;
const SESSION = privateKeyToAccount(SESSION_PRIVATE_KEY).address;
const NOW = 1_788_393_600;
const EXPIRY = NOW + 3_600;
const CAP = "2000000";
const IDEMPOTENCY_KEY = "smart-account-connect-0001";
const PROFILE = "smart-account";
const DIRECT_RECIPIENT = "0x4444444444444444444444444444444444444444" as Address;

class FixtureAllowance implements SmartAccountAllowancePort {
  availableAtomic = CAP;
  calls = 0;
  async available(): Promise<string> { this.calls += 1; return this.availableAtomic; }
}

class FixtureDelegationEngine implements SmartAccountDelegationEnginePort {
  createCalls = 0;
  signCalls = 0;
  lastCreate: Parameters<SmartAccountDelegationEnginePort["createRedemption"]>[0] | null = null;
  async createRedemption(input: Parameters<SmartAccountDelegationEnginePort["createRedemption"]>[0]) {
    this.createCalls += 1;
    this.lastCreate = input;
    const childContext = "0x1234" as Hex;
    return {
      childContext,
      childFingerprint: sha256(`apn.smart-account.child\0${childContext}`),
      calldata: "0xabcdef" as Hex,
    };
  }
  async signTransaction(): Promise<Hex> { this.signCalls += 1; return RAW_TRANSACTION; }
}

class FixtureApproval implements TransferApprovalPort {
  calls = 0;
  reject = false;
  async approve(): Promise<void> {
    this.calls += 1;
    if (this.reject) throw new ApnError("APN_NATIVE_REJECTED", "approval refused");
  }
}

class SmartAccountRpc extends TestRpc {
  ownerUsdcAtomic = "10000000";
  sessionEthAtomic = "1000000000000000000";
  nonceSequence: string[] = [];
  estimateInput: { readonly from: Address; readonly to: Address; readonly data: Hex } | null = null;
  override async getBalances(address: Address) {
    this.balanceCalls += 1;
    return {
      ...this.balances,
      address,
      usdcAtomic: address.toLowerCase() === OWNER.toLowerCase() ? this.ownerUsdcAtomic : "0",
      ethAtomic: address.toLowerCase() === SESSION.toLowerCase() ? this.sessionEthAtomic : "0",
    };
  }
  override async estimateTransaction(input: { readonly from: Address; readonly to: Address; readonly data: Hex }) {
    this.estimateInput = input;
    return this.fees;
  }
  override async getPendingNonce(_address: Address): Promise<string> {
    this.nonceCalls += 1;
    return this.nonceSequence.shift() ?? this.nonceAtomic;
  }
}

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
    assert.equal(bundle.capabilities.direct.available, true);
    assert.equal(bundle.capabilities.direct.mode, "delegated_session_transaction");
    assert.equal(bundle.capabilities.x402.available, false);
    assert.equal(bundle.capabilities.permission?.protocol, "erc7715");
  } finally { await fixture.temporary.cleanup(); }
});

test("production RPC estimates the exact DelegationManager call while retaining strict local-transfer targeting", async () => {
  const rpc = new HttpsBaseRpc("https://rpc.example");
  const calls: Array<[string, readonly unknown[]]> = [];
  (rpc as unknown as { call(method: string, params: readonly unknown[]): Promise<unknown> }).call = async (method, params) => {
    calls.push([method, params]);
    if (method === "eth_chainId") return "0x2105";
    if (method === "eth_estimateGas") return "0x5208";
    if (method === "eth_maxPriorityFeePerGas") return "0x3";
    if (method === "eth_getBlockByNumber") return { baseFeePerGas: "0x4" };
    throw new Error(`unexpected RPC method ${method}`);
  };
  const manager = smartAccountEnvironment().DelegationManager;
  const input = { from: SESSION, to: manager, data: "0x1234" as Hex };
  assert.deepEqual(await rpc.estimateTransaction(input), {
    gasLimitAtomic: "21000", maxFeePerGasAtomic: "11", maxPriorityFeePerGasAtomic: "3",
  });
  assert.equal((calls.find(([method]) => method === "eth_estimateGas")?.[1][0] as any).to, manager);
  await assert.rejects(rpc.estimateDirectTransfer(input), { code: "APN_INVALID_INPUT" });
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

test("Slice 2 keeps x402 unavailable without reopening browser consent", async () => {
  const rpc = new TestRpc();
  const fixture = await makeFixture({ rpc });
  try {
    assert.equal((await fixture.core.execute(connectCommand())).ok, true);
    const x402 = await fixture.core.execute({
      command: "x402.fetch.prepare", profile: PROFILE, idempotencyKey: "smart-x402-blocked-001",
      url: "https://example.com/paid", maxAmountAtomic: "10000",
    });
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

test("the exact Slice 1 profile upgrades once without consent and arbitrary capability drift is rejected", async () => {
  const fixture = await makeFixture();
  try {
    assert.equal((await fixture.core.execute(connectCommand())).ok, true);
    const profileHash = fixture.state.profileHash(PROFILE);
    const current = await fixture.state.loadProviderProfile(profileHash);
    assert.ok(current !== null);
    const legacy = metamaskSmartAccountLegacyCapabilitySnapshot();
    await fixture.state.writeProviderProfile({
      ...current,
      revision: 1,
      capability_snapshot: legacy,
      capability_hash: capabilityHash(legacy),
    });
    const upgraded = await fixture.core.execute({ command: "wallet.permission.list", profile: PROFILE });
    assert.equal(upgraded.ok, true);
    assert.equal((upgraded.data as any).revision, 2);
    assert.equal((upgraded.data as any).permission.revision, 1);
    assert.equal((upgraded.data as any).capabilities.direct.mode, "delegated_session_transaction");
    assert.equal(fixture.consent.requestCalls, 1);
    const reused = await fixture.core.execute({ command: "wallet.status", profile: PROFILE });
    assert.equal((reused.data as any).revision, 2);
    assert.equal(fixture.consent.requestCalls, 1);

    const stored = await fixture.state.loadProviderProfile(profileHash);
    assert.ok(stored !== null);
    const unknown = lifecycleReadOnlyCapabilitySnapshot();
    await fixture.state.writeProviderProfile({
      ...stored,
      capability_snapshot: unknown,
      capability_hash: capabilityHash(unknown),
    });
    const rejected = await fixture.core.execute({ command: "wallet.status", profile: PROFILE });
    assert.equal(rejected.error?.code, "APN_PROFILE_DRIFT");
  } finally { await fixture.temporary.cleanup(); }
});

test("common transfer prepare performs the exact Slice 1 migration before freezing authority", async () => {
  const fixture = await makeFixture();
  try {
    assert.equal((await fixture.core.execute(connectCommand())).ok, true);
    const profileHash = fixture.state.profileHash(PROFILE);
    const current = await fixture.state.loadProviderProfile(profileHash);
    assert.ok(current !== null);
    const legacy = metamaskSmartAccountLegacyCapabilitySnapshot();
    await fixture.state.writeProviderProfile({
      ...current,
      revision: 1,
      capability_snapshot: legacy,
      capability_hash: capabilityHash(legacy),
    });
    const rpc = new SmartAccountRpc();
    const engine = new FixtureDelegationEngine();
    const runtime = directRuntime(fixture, rpc, new FixtureAllowance(), engine, new FixtureApproval());
    const prepared = await runtime.core.execute({
      command: "transfer.prepare", profile: PROFILE, idempotencyKey: "smart-account-migrated-direct-0001",
      recipient: DIRECT_RECIPIENT, amount: "0.01",
    });
    assert.equal(prepared.ok, true, JSON.stringify(prepared));
    const operationId = String((prepared.operation as any).operation_id);
    const operation = await runtime.state.findOperation(operationId);
    assert.equal(operation?.providerDirect?.profileRevision, 2);
    assert.equal(operation?.providerDirect?.executionMode, "delegated_session_transaction");
    if (operation?.providerDirect?.executionMode !== "delegated_session_transaction") throw new Error("missing delegated binding");
    assert.equal(operation.providerDirect.permissionRevision, 1);
    assert.equal((await runtime.state.loadProviderProfile(profileHash))?.revision, 2);
    assert.equal(fixture.consent.requestCalls, 1);
    assert.equal(engine.createCalls, 0);
    assert.equal(rpc.submissions.length, 0);
  } finally { await fixture.temporary.cleanup(); }
});

test("common transfer seals one delegated effect, proves the owner USDC log and survives restart", async () => {
  const fixture = await makeFixture();
  try {
    assert.equal((await fixture.core.execute(connectCommand())).ok, true);
    const rpc = new SmartAccountRpc();
    const allowance = new FixtureAllowance();
    const engine = new FixtureDelegationEngine();
    const approval = new FixtureApproval();
    const runtime = directRuntime(fixture, rpc, allowance, engine, approval);
    const request = {
      command: "transfer.prepare" as const,
      profile: PROFILE,
      idempotencyKey: "smart-account-direct-0001",
      recipient: DIRECT_RECIPIENT,
      amount: "0.01",
    };
    const [first, duplicate] = await Promise.all([runtime.core.execute(request), runtime.core.execute(request)]);
    assert.equal(first.ok, true);
    assert.equal(duplicate.ok, true);
    const operationId = String((first.operation as any).operation_id);
    assert.equal((duplicate.operation as any).operation_id, operationId);
    assert.equal(engine.createCalls, 0);
    assert.equal(engine.signCalls, 0);
    assert.equal(rpc.submissions.length, 0);
    assert.equal(allowance.calls, 1);
    const stored = await runtime.state.findOperation(operationId);
    assert.equal(stored?.providerDirect?.executionMode, "delegated_session_transaction");
    if (stored?.providerDirect?.executionMode !== "delegated_session_transaction") throw new Error("missing delegated binding");
    assert.equal(stored.providerDirect.sessionAddress, SESSION);
    assert.equal(stored.providerDirect.permissionRevision, 1);

    const pending = await runtime.core.execute({ command: "transfer.approve", operationId });
    assert.equal(pending.ok, true, JSON.stringify({ pending, stored: await runtime.state.findOperation(operationId) }));
    assert.equal((pending.operation as any).state, "evidence_pending", JSON.stringify(pending));
    assert.equal(approval.calls, 1);
    assert.equal(engine.createCalls, 1);
    assert.equal(engine.signCalls, 1);
    assert.equal(rpc.submissions.length, 1);
    assert.equal(engine.lastCreate?.amountAtomic, "10000");
    assert.equal(engine.lastCreate?.recipient, DIRECT_RECIPIENT);
    assert.equal(rpc.estimateInput?.from, SESSION);
    assert.equal(rpc.estimateInput?.to, smartAccountEnvironment().DelegationManager);

    const effect = await runtime.effects.load(operationId);
    assert.ok(effect !== null);
    assert.equal(effect.phase, "submitted");
    assert.equal(effect.transaction_hash, keccak256(RAW_TRANSACTION));
    const envelope = await readFile(join(fixture.temporary.root, "smart-account-effects", `${operationId}.json`), "utf8");
    assert.equal(envelope.includes(SESSION_PRIVATE_KEY.slice(2)), false);
    assert.equal(envelope.includes(RAW_TRANSACTION.slice(2)), false);
    assert.equal(JSON.stringify(pending).includes(RAW_TRANSACTION), false);
    assert.equal(JSON.stringify(pending).includes(effect.child_context), false);
    const { integrity_hash: _integrity, ...unsealed } = effect;
    await assert.rejects(runtime.effects.seal({
      ...unsealed,
      transaction_hash: `0x${"f".repeat(64)}`,
    }), { code: "APN_STATE_CORRUPT" });

    rpc.receipt = exactSmartAccountReceipt(effect.transaction_hash, "10000");
    const restarted = directRuntime(fixture, rpc, allowance, engine, approval);
    const completed = await restarted.core.execute({ command: "operation.resume", operationId });
    assert.equal((completed.operation as any).state, "completed");
    assert.equal((completed.operation as any).wallet_address, OWNER);
    const receipt = await restarted.core.execute({ command: "receipt.get", operationId });
    assert.equal((receipt.receipt as any).exact_transfer_log, true);
    assert.equal(rpc.submissions.length, 1);
    assert.equal(engine.createCalls, 1);
  } finally { await fixture.temporary.cleanup(); }
});

test("approval refusal creates no delegated signature or submission", async () => {
  const fixture = await makeFixture();
  try {
    assert.equal((await fixture.core.execute(connectCommand())).ok, true);
    const rpc = new SmartAccountRpc();
    const allowance = new FixtureAllowance();
    const engine = new FixtureDelegationEngine();
    const approval = new FixtureApproval();
    const runtime = directRuntime(fixture, rpc, allowance, engine, approval);
    const prepared = await runtime.core.execute({
      command: "transfer.prepare", profile: PROFILE, idempotencyKey: "smart-account-refused-0001",
      recipient: DIRECT_RECIPIENT, amount: "0.01",
    });
    const operationId = String((prepared.operation as any).operation_id);
    approval.reject = true;
    const refused = await runtime.core.execute({ command: "transfer.approve", operationId });
    assert.equal(refused.error?.code, "APN_NATIVE_REJECTED");
    assert.equal(engine.createCalls, 0);
    assert.equal(engine.signCalls, 0);
    assert.equal(rpc.submissions.length, 0);
    assert.equal((await runtime.state.findOperation(operationId))?.state, "awaiting_approval");
    assert.equal(await runtime.effects.load(operationId), null);

    assert.equal(engine.createCalls, 0);
    assert.equal(engine.signCalls, 0);
    assert.equal(rpc.submissions.length, 0);
  } finally { await fixture.temporary.cleanup(); }
});

test("authority and split owner/session funding failures stop before durable effect", async () => {
  for (const [name, configure, code] of [
    ["allowance", (allowance: FixtureAllowance) => { allowance.availableAtomic = "9999"; }, "APN_PERMISSION_ALLOWANCE_INSUFFICIENT"],
    ["owner-funds", (_allowance: FixtureAllowance, rpc: SmartAccountRpc) => { rpc.ownerUsdcAtomic = "9999"; }, "APN_INSUFFICIENT_USDC"],
    ["session-gas", (_allowance: FixtureAllowance, rpc: SmartAccountRpc) => { rpc.sessionEthAtomic = "0"; }, "APN_INSUFFICIENT_GAS"],
  ] as const) {
    const fixture = await makeFixture();
    try {
      assert.equal((await fixture.core.execute(connectCommand())).ok, true);
      const rpc = new SmartAccountRpc();
      const allowance = new FixtureAllowance();
      const engine = new FixtureDelegationEngine();
      configure(allowance, rpc);
      const runtime = directRuntime(fixture, rpc, allowance, engine, new FixtureApproval());
      const failed = await runtime.core.execute({
        command: "transfer.prepare", profile: PROFILE, idempotencyKey: `smart-account-${name}-0001`,
        recipient: DIRECT_RECIPIENT, amount: "0.01",
      });
      assert.equal(failed.error?.code, code);
      assert.equal(engine.createCalls, 0);
      assert.equal(engine.signCalls, 0);
      assert.equal(rpc.submissions.length, 0);
      assert.equal((await runtime.state.listAllOperations()).length, 0);
    } finally { await fixture.temporary.cleanup(); }
  }
});

test("precise delegated gas insufficiency stops before transaction signature, seal or submission", async () => {
  const fixture = await makeFixture();
  try {
    assert.equal((await fixture.core.execute(connectCommand())).ok, true);
    const rpc = new SmartAccountRpc();
    rpc.sessionEthAtomic = "129999999999999";
    const allowance = new FixtureAllowance();
    const engine = new FixtureDelegationEngine();
    const approval = new FixtureApproval();
    const runtime = directRuntime(fixture, rpc, allowance, engine, approval);
    const prepared = await runtime.core.execute({
      command: "transfer.prepare", profile: PROFILE, idempotencyKey: "smart-account-exact-gas-0001",
      recipient: DIRECT_RECIPIENT, amount: "0.01",
    });
    const operationId = String((prepared.operation as any).operation_id);
    const failed = await runtime.core.execute({ command: "transfer.approve", operationId });
    assert.equal(failed.error?.code, "APN_INSUFFICIENT_GAS");
    assert.equal(approval.calls, 1);
    assert.equal(engine.createCalls, 1);
    assert.equal(engine.signCalls, 0);
    assert.equal(rpc.submissions.length, 0);
    assert.equal(await runtime.effects.load(operationId), null);
    const durable = await runtime.state.findOperation(operationId);
    assert.equal(durable?.state, "failed_before_effect");
    assert.equal(durable?.terminal, true);
    assert.equal(durable?.proofClass, "durable_pre_effect_failure");
  } finally { await fixture.temporary.cleanup(); }
});

test("malformed post-approval RPC economics terminalize before transaction signature or effect", async () => {
  const fixture = await makeFixture();
  try {
    assert.equal((await fixture.core.execute(connectCommand())).ok, true);
    const rpc = new SmartAccountRpc();
    rpc.nonceAtomic = "01";
    const engine = new FixtureDelegationEngine();
    const runtime = directRuntime(fixture, rpc, new FixtureAllowance(), engine, new FixtureApproval());
    const prepared = await runtime.core.execute({
      command: "transfer.prepare", profile: PROFILE, idempotencyKey: "smart-account-rpc-protocol-0001",
      recipient: DIRECT_RECIPIENT, amount: "0.01",
    });
    const operationId = String((prepared.operation as any).operation_id);
    const failed = await runtime.core.execute({ command: "transfer.approve", operationId });
    assert.equal(failed.error?.code, "APN_RPC_PROTOCOL");
    assert.equal(engine.createCalls, 1);
    assert.equal(engine.signCalls, 0);
    assert.equal(rpc.submissions.length, 0);
    assert.equal(await runtime.effects.load(operationId), null);
    assert.equal((await runtime.state.findOperation(operationId))?.state, "failed_before_effect");
  } finally { await fixture.temporary.cleanup(); }
});

test("a nonce change during exact simulation terminalizes without a signature or effect", async () => {
  const fixture = await makeFixture();
  try {
    assert.equal((await fixture.core.execute(connectCommand())).ok, true);
    const rpc = new SmartAccountRpc();
    rpc.nonceSequence = ["7", "8"];
    const engine = new FixtureDelegationEngine();
    const runtime = directRuntime(fixture, rpc, new FixtureAllowance(), engine, new FixtureApproval());
    const prepared = await runtime.core.execute({
      command: "transfer.prepare", profile: PROFILE, idempotencyKey: "smart-account-stale-nonce-0001",
      recipient: DIRECT_RECIPIENT, amount: "0.01",
    });
    const operationId = String((prepared.operation as any).operation_id);
    const failed = await runtime.core.execute({ command: "transfer.approve", operationId });
    assert.equal(failed.error?.code, "APN_RPC_PROTOCOL");
    assert.equal(engine.createCalls, 1);
    assert.equal(engine.signCalls, 0);
    assert.equal(rpc.nonceCalls, 2);
    assert.equal(rpc.submissions.length, 0);
    assert.equal(await runtime.effects.load(operationId), null);
  } finally { await fixture.temporary.cleanup(); }
});

test("a successful receipt without the exact owner transfer never completes and later exact evidence recovers", async () => {
  const fixture = await makeFixture();
  try {
    assert.equal((await fixture.core.execute(connectCommand())).ok, true);
    const rpc = new SmartAccountRpc();
    const runtime = directRuntime(
      fixture, rpc, new FixtureAllowance(), new FixtureDelegationEngine(), new FixtureApproval(),
    );
    const prepared = await runtime.core.execute({
      command: "transfer.prepare", profile: PROFILE, idempotencyKey: "smart-account-exact-log-0001",
      recipient: DIRECT_RECIPIENT, amount: "0.01",
    });
    const operationId = String((prepared.operation as any).operation_id);
    const pending = await runtime.core.execute({ command: "transfer.approve", operationId });
    assert.equal((pending.operation as any).state, "evidence_pending");
    const transactionHash = String((pending.operation as any).transaction_hash) as Hex;
    rpc.receipt = { ...exactSmartAccountReceipt(transactionHash, "10000"), logs: [] };
    const ambiguous = await runtime.core.execute({ command: "operation.resume", operationId });
    assert.equal((ambiguous.operation as any).state, "ambiguous_effect");
    assert.equal((ambiguous.operation as any).terminal, false);
    assert.equal((ambiguous.operation as any).reason, "successful_receipt_missing_exact_transfer");
    assert.equal(rpc.submissions.length, 1);

    rpc.receipt = exactSmartAccountReceipt(transactionHash, "10000");
    const completed = await runtime.core.execute({ command: "operation.resume", operationId });
    assert.equal((completed.operation as any).state, "completed");
    assert.equal(rpc.submissions.length, 1);
  } finally { await fixture.temporary.cleanup(); }
});

test("ambiguous submission rebroadcasts only the sealed bytes and exact receipt recovery completes", async () => {
  const fixture = await makeFixture();
  try {
    assert.equal((await fixture.core.execute(connectCommand())).ok, true);
    const rpc = new SmartAccountRpc();
    rpc.submitError = new Error("response lost");
    const allowance = new FixtureAllowance();
    const engine = new FixtureDelegationEngine();
    const approval = new FixtureApproval();
    const initial = directRuntime(fixture, rpc, allowance, engine, approval);
    const prepared = await initial.core.execute({
      command: "transfer.prepare", profile: PROFILE, idempotencyKey: "smart-account-recovery-0001",
      recipient: DIRECT_RECIPIENT, amount: "0.01",
    });
    const operationId = String((prepared.operation as any).operation_id);
    const ambiguous = await initial.core.execute({ command: "transfer.approve", operationId });
    assert.equal((ambiguous.operation as any).state, "provider_pending", JSON.stringify(ambiguous));
    assert.equal(rpc.submissions.length, 1);
    const sealed = await initial.effects.load(operationId);
    assert.equal(sealed?.phase, "submission_ambiguous");

    rpc.submitError = null;
    const restarted = directRuntime(fixture, rpc, allowance, engine, approval);
    const resumed = await restarted.core.execute({ command: "operation.resume", operationId });
    assert.equal((resumed.operation as any).state, "evidence_pending");
    assert.equal(rpc.submissions.length, 2);
    assert.equal(rpc.submissions[0], rpc.submissions[1]);
    assert.equal(engine.createCalls, 1);
    assert.equal(engine.signCalls, 1);
    const submitted = await restarted.effects.load(operationId);
    assert.equal(submitted?.submission_attempts, 2);
    rpc.receipt = exactSmartAccountReceipt(keccak256(RAW_TRANSACTION), "10000");
    const completed = await restarted.core.execute({ command: "operation.resume", operationId });
    assert.equal((completed.operation as any).state, "completed");
    assert.equal(rpc.submissions.length, 2);
  } finally { await fixture.temporary.cleanup(); }
});

test("official MetaMask engine creates deterministic session-to-session exact child and redemption bytes", async () => {
  const fixture = await makeFixture();
  try {
    assert.equal((await fixture.core.execute(connectCommand())).ok, true);
    const store = new EncryptedSmartAccountPermissionStore(fixture.state, fixture.wrapping);
    const record = await store.load(fixture.state.profileHash(PROFILE));
    if (record === null || !isGrantedPermissionRecord(record)) throw new Error("missing granted fixture permission");
    const engine = new OfficialSmartAccountDelegationEngine();
    const input = {
      record,
      operationId: "d".repeat(64),
      fingerprint: "e".repeat(64),
      recipient: DIRECT_RECIPIENT,
      amountAtomic: "10000",
      preparedAt: new Date(NOW * 1_000).toISOString(),
      expiresAt: new Date((NOW + 600) * 1_000).toISOString(),
      rpcUrl: "https://rpc.example",
    };
    const first = await engine.createRedemption(input);
    const second = await engine.createRedemption(input);
    assert.deepEqual(first, second);
    const children = decodeDelegations(first.childContext);
    assert.equal(children.length, 1);
    assert.equal(children[0]?.delegate.toLowerCase(), SESSION.toLowerCase());
    assert.equal(children[0]?.delegator.toLowerCase(), SESSION.toLowerCase());
    const enforcers = new Set(children[0]?.caveats.map((caveat) => caveat.enforcer.toLowerCase()));
    const environment = smartAccountEnvironment();
    for (const address of [
      environment.caveatEnforcers.ExactExecutionEnforcer,
      environment.caveatEnforcers.LimitedCallsEnforcer,
      environment.caveatEnforcers.TimestampEnforcer,
      environment.caveatEnforcers.RedeemerEnforcer,
    ]) assert.equal(address === undefined ? false : enforcers.has(address.toLowerCase()), true);
    const exact = children[0]?.caveats.find((item) =>
      item.enforcer.toLowerCase() === environment.caveatEnforcers.ExactExecutionEnforcer?.toLowerCase());
    assert.match(exact?.terms.toLowerCase() ?? "", new RegExp(BASE_USDC.slice(2).toLowerCase()));
    assert.match(exact?.terms.toLowerCase() ?? "", new RegExp(DIRECT_RECIPIENT.slice(2).toLowerCase()));
    assert.ok(first.calldata.length > first.childContext.length);
  } finally { await fixture.temporary.cleanup(); }
});

test("common CLI and MCP direct surfaces preserve one Smart Account operation and foreground boundary", async () => {
  const fixture = await makeFixture();
  try {
    assert.equal((await fixture.core.execute(connectCommand())).ok, true);
    const rpc = new SmartAccountRpc();
    const engine = new FixtureDelegationEngine();
    const approval = new FixtureApproval();
    const runtime = directRuntime(fixture, rpc, new FixtureAllowance(), engine, approval);
    const rpcUrl = "https://rpc.example/smart-account-direct";
    const options = {
      stateRoot: fixture.temporary.root,
      providerRegistry: runtime.registry,
      rpc,
      wrappingSecret: fixture.wrapping,
      clock: { now: () => new Date(NOW * 1_000) },
      ids: { next: () => "12345678-1234-4234-8234-123456789abc" },
    } as const;
    const prepared = await runCli([
      "pay", "transfer", "prepare", "--profile", PROFILE,
      "--idempotency-key", "smart-account-cli-mcp-0001",
      "--to", DIRECT_RECIPIENT, "--amount-usdc", "0.01", "--rpc-url", rpcUrl,
    ], {}, options);
    assert.equal(prepared.ok, true, JSON.stringify(prepared));
    const operationId = String((prepared.operation as any).operation_id);

    const server = createMcpServer(options);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: "smart-account-direct-parity", version: "1.0.0" });
    await client.connect(clientTransport);
    try {
      const handoff = mcpEnvelope(await client.callTool({
        name: "apn_pay_transfer_approve",
        arguments: { operation: operationId, rpc_url: rpcUrl },
      }));
      assert.equal(handoff.error?.code, "APN_FOREGROUND_APPROVAL_REQUIRED");
      assert.match(String(handoff.error?.details?.cli_handoff), new RegExp(operationId));
      assert.equal(engine.createCalls, 0);
      assert.equal(rpc.submissions.length, 0);

      const approved = await runCli([
        "pay", "transfer", "approve", "--operation", operationId, "--rpc-url", rpcUrl,
      ], {}, { ...options, approval });
      assert.equal((approved.operation as any).state, "evidence_pending", JSON.stringify(approved));
      assert.equal(engine.createCalls, 1);
      assert.equal(rpc.submissions.length, 1);
      rpc.receipt = exactSmartAccountReceipt(keccak256(RAW_TRANSACTION), "10000");
      const completed = mcpEnvelope(await client.callTool({
        name: "apn_operation_resume", arguments: { operation: operationId, rpc_url: rpcUrl },
      }));
      assert.equal((completed.operation as any).state, "completed", JSON.stringify(completed));
      const receipt = mcpEnvelope(await client.callTool({
        name: "apn_receipt_get", arguments: { operation: operationId },
      }));
      assert.equal((receipt.receipt as any).exact_transfer_log, true);
      assert.equal(rpc.submissions.length, 1);
    } finally {
      await client.close();
      await server.close();
    }
  } finally { await fixture.temporary.cleanup(); }
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
    wrapping,
    consent,
    sessions,
    state: first.state,
    adapter: first.adapter,
    core: first.core,
    setNow,
    restart: () => build().core,
  };
}

function directRuntime(
  fixture: Awaited<ReturnType<typeof makeFixture>>,
  rpc: SmartAccountRpc,
  allowance: SmartAccountAllowancePort,
  engine: SmartAccountDelegationEnginePort,
  approval: TransferApprovalPort,
) {
  const state = new StateStore(fixture.temporary.root, { lockWaitMs: 1_000 });
  const permissions = new EncryptedSmartAccountPermissionStore(state, fixture.wrapping);
  const effects = new EncryptedSmartAccountDirectEffectStore(state, fixture.wrapping);
  const direct: DirectExecutionPort = new MetaMaskSmartAccountDirectAdapter(
    permissions, effects, rpc, allowance, engine, () => new Date(NOW * 1_000),
  );
  const adapter = new MetaMaskSmartAccountAdapter(
    permissions, fixture.consent, fixture.sessions, () => new Date(NOW * 1_000), direct,
  );
  const repository = new StateProfileRepository(state);
  const registry = new ProviderRegistry([
    { provider_id: METAMASK_SMART_ACCOUNT_PROVIDER_ID, create: () => adapter.bundle() },
  ]);
  return {
    state,
    effects,
    registry,
    core: new ApnCore({
      state,
      profileRepository: repository,
      providerRegistry: registry,
      rpc,
      rpcUrl: "https://rpc.example/smart-account-direct",
      transferApproval: approval,
      clock: { now: () => new Date(NOW * 1_000) },
      ids: { next: () => "12345678-1234-4234-8234-123456789abc" },
    }),
  };
}

function exactSmartAccountReceipt(transactionHash: Hex, amountAtomic: string): RpcReceipt {
  return {
    transactionHash,
    status: "success",
    blockNumberAtomic: "12350",
    observedAt: new Date((NOW + 60) * 1_000).toISOString(),
    rpcOrigin: "https://rpc.example",
    logs: [{
      address: BASE_USDC,
      topics: [
        "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
        `0x${OWNER.slice(2).padStart(64, "0")}` as Hex,
        `0x${DIRECT_RECIPIENT.slice(2).padStart(64, "0")}` as Hex,
      ],
      data: `0x${BigInt(amountAtomic).toString(16).padStart(64, "0")}` as Hex,
    }],
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
