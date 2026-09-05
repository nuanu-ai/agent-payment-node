import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import {
  ALL_METAMASK_FACILITATOR_ADDRESSES,
  METAMASK_FACILITATOR_ADDRESSES_DEV,
  createErc20TokenAllowanceCaveats,
} from "@metamask/7715-permission-types";
import {
  ANY_BENEFICIARY,
  createRedeemerTerms,
  decodeAllowedCalldataTerms,
  decodeERC20TransferAmountTerms,
  decodeRedeemerTerms,
  decodeTimestampTerms,
  decodeValueLteTerms,
  hashDelegation,
} from "@metamask/delegation-core";
import { ROOT_AUTHORITY } from "@metamask/smart-accounts-kit";
import { METAMASK_FACILITATOR_ADDRESSES } from "@metamask/smart-accounts-kit/experimental";
import {
  SIGNABLE_DELEGATION_TYPED_DATA,
  decodeDelegations,
  encodeDelegations,
  toDelegationStruct,
} from "@metamask/smart-accounts-kit/utils";
import { encodePacked, keccak256, pad, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { canonicalJson, sha256 } from "../../src/canonical.js";
import { ApnCore } from "../../src/core.js";
import { runCli } from "../../src/cli.js";
import { BASE_USDC } from "../../src/constants.js";
import { EncryptedSmartAccountPermissionStore } from "../../src/encrypted-smart-account-permission-store.js";
import { EncryptedSmartAccountDirectEffectStore } from "../../src/encrypted-smart-account-direct-effect-store.js";
import { EncryptedSmartAccountX402MaterialStore } from "../../src/encrypted-smart-account-x402-material-store.js";
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
import {
  MetaMaskSmartAccountX402Adapter,
  OfficialSmartAccountX402Engine,
  type SmartAccountX402EnginePort,
} from "../../src/metamask-smart-account-x402.js";
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
  METAMASK_X402_INTEGRITY,
  METAMASK_X402_VERSION,
  X402_EVM_INTEGRITY,
  X402_EVM_VERSION,
} from "../../src/metamask-smart-account-package.js";
import { smartAccountEnvironment, validateSmartAccountObservation } from "../../src/metamask-smart-account-grant.js";
import type { Address, Hex } from "../../src/model.js";
import { ApnError } from "../../src/errors.js";
import { createMcpServer } from "../../src/mcp-server.js";
import type { RpcReceipt, X402TransferLogs } from "../../src/ports.js";
import type { DirectExecutionPort, ProviderProfileRepositoryPort } from "../../src/provider-ports.js";
import { ProviderRegistry } from "../../src/provider-registry.js";
import { StateProfileRepository } from "../../src/profile-repository.js";
import { HttpsBaseRpc } from "../../src/rpc.js";
import { StateStore } from "../../src/state.js";
import { decodePaymentSignatureHeader, encodePaymentSignatureHeader } from "../../src/x402-codec.js";
import {
  appendX402Transition,
  sealX402Operation,
  validateX402Operation,
  x402Fingerprint,
  type X402OperationRecord,
} from "../../src/x402-state-integrity.js";
import {
  accountBindingHash,
  capabilityHash,
  lifecycleReadOnlyCapabilitySnapshot,
  metamaskSmartAccountCapabilitySnapshot,
  metamaskSmartAccountLegacyCapabilitySnapshot,
} from "../../src/provider-profile.js";
import type { TransferApprovalPort } from "../../src/tty-approval.js";
import { RAW_TRANSACTION, TestProfilePolicy, TestRpc, temporaryState } from "./helpers.js";
import { QueuedHttp, RecoveryRpc, challengeObservation, paidObservation, transferLog } from "./x402-helpers.js";
import {
  X402_TRANSACTION,
  X402_URL,
  canonicalPaymentRequiredHeader,
  canonicalPaymentResponseHeader,
} from "./x402-vectors.js";

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
const SMART_X402_AMOUNT = "1000";
const SMART_X402_PAYEE = "0x2222222222222222222222222222222222222222" as Address;
const SMART_X402_FACILITATOR = METAMASK_FACILITATOR_ADDRESSES[0] as Address;

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

class SmartAccountX402Rpc extends RecoveryRpc {
  ownerUsdcAtomic = "10000000";
  observedUnix = NOW;
  readonly balanceAddresses: Address[] = [];
  readonly transferCalls: { readonly fromBlock: string; readonly toBlock: string }[] = [];
  transferOutcomes: X402TransferLogs[] = [];

  override async getBalances(address: Address) {
    this.balanceCalls += 1;
    this.balanceAddresses.push(address);
    return {
      ...this.balances,
      address,
      usdcAtomic: address.toLowerCase() === OWNER.toLowerCase() ? this.ownerUsdcAtomic : "0",
      ethAtomic: "0",
      observedAt: new Date(this.observedUnix * 1_000).toISOString(),
    };
  }

  override async getX402PrepareEvidence(address: Address) {
    this.x402PrepareCalls += 1;
    return {
      ...this.x402Evidence,
      address,
      usdcAtomic: this.ownerUsdcAtomic,
      tokenName: "ignored-for-erc7710",
      tokenVersion: "ignored-for-erc7710",
      domainSeparator: "0x01" as Hex,
      observedAt: new Date(this.observedUnix * 1_000).toISOString(),
      block: {
        number: "12345",
        hash: `0x${"b".repeat(64)}` as Hex,
        timestamp: (BigInt(this.observedUnix) - 1n).toString(),
      },
    };
  }

  override async getX402TransferLogs(input: {
    readonly from: Address; readonly fromBlock: string; readonly toBlock: string;
  }): Promise<X402TransferLogs> {
    this.transferCalls.push({ fromBlock: input.fromBlock, toBlock: input.toBlock });
    return this.transferOutcomes.shift() ?? { kind: "complete", logs: [] };
  }
}

class MutableSmartAccountClock {
  unix = NOW;
  now(): Date { return new Date(this.unix * 1_000); }
  advance(seconds: number): void { this.unix += seconds; }
}

class RecordingSmartAccountX402Engine implements SmartAccountX402EnginePort {
  calls = 0;
  lastInput: Parameters<SmartAccountX402EnginePort["create"]>[0] | null = null;
  lastPayload: Awaited<ReturnType<SmartAccountX402EnginePort["create"]>> | null = null;
  private readonly official = new OfficialSmartAccountX402Engine();

  async create(input: Parameters<SmartAccountX402EnginePort["create"]>[0]) {
    this.calls += 1;
    this.lastInput = input;
    this.lastPayload = await this.official.create(input);
    return this.lastPayload;
  }
}

type SmartAccountX402EngineInput = Parameters<SmartAccountX402EnginePort["create"]>[0];
type SmartAccountX402EngineOutput = Awaited<ReturnType<SmartAccountX402EnginePort["create"]>>;

class MutatingSmartAccountX402Engine implements SmartAccountX402EnginePort {
  calls = 0;
  private readonly official = new OfficialSmartAccountX402Engine();

  constructor(private readonly mutate: (
    payload: SmartAccountX402EngineOutput,
    input: SmartAccountX402EngineInput,
  ) => SmartAccountX402EngineOutput | Promise<SmartAccountX402EngineOutput>) {}

  async create(input: SmartAccountX402EngineInput): Promise<SmartAccountX402EngineOutput> {
    this.calls += 1;
    return await this.mutate(await this.official.create(input), input);
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
  failRequestCount = 0;
  syncCalls = 0;
  lastResponse: Record<string, unknown> | null = null;
  syncMode: "present" | "absent" | "drift" | "throw" = "present";

  async request(input: SmartAccountConsentRequest): Promise<unknown> {
    this.requestCalls += 1;
    if (this.failRequestCount > 0) {
      this.failRequestCount -= 1;
      throw new ApnError(
        "APN_PROVIDER_UNAVAILABLE",
        "MetaMask foreground consent timed out safely; retry the same connect intent.",
        { retryable: true },
      );
    }
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
  assert.equal(lock.packages["node_modules/@metamask/x402"].version, METAMASK_X402_VERSION);
  assert.equal(lock.packages["node_modules/@metamask/x402"].integrity, METAMASK_X402_INTEGRITY);
  assert.equal(lock.packages["node_modules/@x402/evm"].version, X402_EVM_VERSION);
  assert.equal(lock.packages["node_modules/@x402/evm"].integrity, X402_EVM_INTEGRITY);
  const fixture = await makeFixture();
  try {
    const bundle = fixture.adapter.bundle();
    assert.equal(bundle.provider_id, METAMASK_SMART_ACCOUNT_PROVIDER_ID);
    assert.equal(bundle.capabilities.direct.available, true);
    assert.equal(bundle.capabilities.direct.mode, "delegated_session_transaction");
    assert.equal(bundle.capabilities.x402.available, true);
    assert.equal(bundle.capabilities.x402.mode, "delegated_erc7710_apn_paid_retry");
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

test("timed-out consent stays visible after restart and exact retry reuses the session", async () => {
  const fixture = await makeFixture({ failFirstConsentRequest: true });
  try {
    const timedOut = await fixture.core.execute(connectCommand());
    assert.equal(timedOut.ok, false);
    assert.equal(timedOut.error?.code, "APN_PROVIDER_UNAVAILABLE");
    assert.equal(fixture.sessions.calls, 1);
    assert.equal(fixture.consent.requestCalls, 1);

    const restarted = fixture.restart();
    const status = await restarted.execute({ command: "wallet.status", profile: PROFILE });
    const listed = await restarted.execute({ command: "wallet.permission.list", profile: PROFILE });
    for (const result of [status, listed]) {
      assert.equal(result.ok, true, JSON.stringify(result));
      assert.equal((result.data as any).status, "pending_consent");
      assert.equal((result.data as any).revision, 1);
      assert.equal((result.data as any).permission.session_account, SESSION);
      assert.equal((result.data as any).permission.requested_cap_usdc_atomic, CAP);
      assert.match((result.data as any).warning, /may already exist/);
      assert.equal(JSON.stringify(result).includes(IDEMPOTENCY_KEY), false);
      assert.equal(JSON.stringify(result).includes(SESSION_PRIVATE_KEY), false);
    }

    const changed = await restarted.execute({
      ...connectCommand(),
      permissionCapUsdcAtomic: "3000000",
    });
    assert.equal(changed.error?.code, "APN_IDEMPOTENCY_CONFLICT");
    assert.equal(fixture.sessions.calls, 1);
    assert.equal(fixture.consent.requestCalls, 1);

    const recovered = await restarted.execute(connectCommand());
    assert.equal(recovered.ok, true, JSON.stringify(recovered));
    assert.equal((recovered.data as any).status, "active");
    assert.equal((recovered.data as any).permission.session_account, SESSION);
    assert.equal(fixture.sessions.calls, 1);
    assert.equal(fixture.consent.requestCalls, 2);
  } finally { await fixture.temporary.cleanup(); }
});

test("explicit pending cancellation is revision-guarded and permits a changed replacement intent", async () => {
  const fixture = await makeFixture({ failFirstConsentRequest: true });
  try {
    assert.equal((await fixture.core.execute(connectCommand())).error?.code, "APN_PROVIDER_UNAVAILABLE");
    const stale = await fixture.restart().execute({
      command: "wallet.permission.forget",
      profile: PROFILE,
      expectedRevision: 2,
    });
    assert.equal(stale.error?.code, "APN_PROFILE_REVISION_CONFLICT");
    const forgotten = await fixture.restart().execute({
      command: "wallet.permission.forget",
      profile: PROFILE,
      expectedRevision: 1,
    });
    assert.equal(forgotten.ok, true, JSON.stringify(forgotten));
    assert.equal((forgotten.data as any).status, "forgotten");
    assert.equal((forgotten.data as any).provider_revoke, "not_performed");
    assert.match((forgotten.data as any).warning, /may still exist/);

    const replacement = await fixture.restart().execute({
      ...connectCommand(),
      permissionCapUsdcAtomic: "3000000",
      idempotencyKey: "smart-account-connect-replacement-0002",
    });
    assert.equal(replacement.ok, true, JSON.stringify(replacement));
    assert.equal(fixture.sessions.calls, 2);
    assert.equal(fixture.consent.requestCalls, 2);
  } finally { await fixture.temporary.cleanup(); }
});

test("a consent result cannot commit after its pending revision was cancelled", async () => {
  const temporary = await temporaryState();
  const wrapping = new TestWrappingSecret();
  const state = new StateStore(temporary.root, { lockWaitMs: 1_000 });
  const store = new EncryptedSmartAccountPermissionStore(state, wrapping);
  let resolveRequest!: (value: unknown) => void;
  let markStarted!: () => void;
  const started = new Promise<void>((resolve) => { markStarted = resolve; });
  const consent: SmartAccountConsentPort = {
    request: async (input) => await new Promise<unknown>((resolve) => {
      resolveRequest = resolve;
      markStarted();
      void input;
    }),
    sync: async () => { throw new Error("must not sync"); },
  };
  const adapter = new MetaMaskSmartAccountAdapter(
    store,
    consent,
    new FixedSessionFactory(),
    () => new Date(NOW * 1_000),
  );
  const profileHash = state.profileHash(PROFILE);
  try {
    await state.initialize();
    const connecting = adapter.connect({
      profile: PROFILE,
      profileHash,
      authenticationMethod: "browser",
      idempotencyKey: IDEMPOTENCY_KEY,
      capAtomic: CAP,
      expiresAtUnix: EXPIRY,
    });
    await started;
    await adapter.forget(profileHash, 1);
    resolveRequest(validObservation({
      sessionAddress: SESSION,
      capAtomic: CAP,
      startsAtUnix: NOW,
      expiresAtUnix: EXPIRY,
    }));
    await assert.rejects(connecting, (error: any) =>
      error.code === "APN_PROVIDER_PROTOCOL" && /was not committed/u.test(error.message)
    );
    assert.equal(await store.load(profileHash), null);
  } finally { await temporary.cleanup(); }
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

test("Slice 3 capability is local and does not reopen browser consent", async () => {
  const fixture = await makeFixture();
  try {
    assert.equal((await fixture.core.execute(connectCommand())).ok, true);
    const status = await fixture.core.execute({ command: "wallet.status", profile: PROFILE });
    assert.equal((status.data as any).capabilities.x402.available, true);
    assert.equal((status.data as any).capabilities.x402.mode, "delegated_erc7710_apn_paid_retry");
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
      assert.match(String(handoff.error?.details?.cli_handoff), /--idempotency-key '<same-idempotency-key>'$/u);
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
      assert.deepEqual(syncHandoff.error?.details?.cli_handoff_argv, [
        "apn", "wallet", "permission", "sync", "--profile", PROFILE, "--expected-revision", "1",
      ]);
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

test("actual CLI and MCP expose and cancel the same pending consent after restart", async () => {
  const temporary = await temporaryState();
  const wrappingSecret = new TestWrappingSecret();
  const consent = new FixtureConsent();
  consent.failRequestCount = 1;
  const sessions = new FixedSessionFactory();
  const options = {
    stateRoot: temporary.root,
    wrappingSecret,
    smartAccountConsent: consent,
    smartAccountSessionKeys: sessions,
    clock: { now: () => new Date(NOW * 1_000) },
  } as const;
  const connectArgv = [
    "wallet", "connect", "--profile", PROFILE,
    "--provider", METAMASK_SMART_ACCOUNT_PROVIDER_ID,
    "--auth-method", "browser",
    "--permission-cap-usdc-atomic", CAP,
    "--permission-expires-at", String(EXPIRY),
    "--idempotency-key", IDEMPOTENCY_KEY,
  ];
  try {
    const timedOut = await runCli(connectArgv, {}, options);
    assert.equal(timedOut.error?.code, "APN_PROVIDER_UNAVAILABLE");
    const cliStatus = await runCli(["wallet", "status", "--profile", PROFILE], {}, options);
    assert.equal((cliStatus.data as any).status, "pending_consent");

    const server = createMcpServer(options);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: "pending-smart-account-parity", version: "1.0.0" });
    await client.connect(clientTransport);
    try {
      const listed = mcpEnvelope(await client.callTool({
        name: "apn_wallet_permission_list", arguments: { profile: PROFILE },
      }));
      assert.equal((listed.data as any).status, "pending_consent");
      assert.equal((listed.data as any).permission.session_account, SESSION);
      assert.equal(JSON.stringify(listed).includes(IDEMPOTENCY_KEY), false);
      assert.equal(JSON.stringify(listed).includes(SESSION_PRIVATE_KEY), false);

      const forgotten = mcpEnvelope(await client.callTool({
        name: "apn_wallet_permission_forget", arguments: { profile: PROFILE, expected_revision: "1" },
      }));
      assert.equal((forgotten.data as any).status, "forgotten");
      assert.equal((forgotten.data as any).provider_revoke, "not_performed");
    } finally {
      await client.close();
      await server.close();
    }
    const absent = await runCli(["wallet", "status", "--profile", PROFILE], {}, options);
    assert.equal((absent.data as any).status, "absent");
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
    assert.equal((upgraded.data as any).revision, 3);
    assert.equal((upgraded.data as any).permission.revision, 1);
    assert.equal((upgraded.data as any).capabilities.direct.mode, "delegated_session_transaction");
    assert.equal(fixture.consent.requestCalls, 1);
    const reused = await fixture.core.execute({ command: "wallet.status", profile: PROFILE });
    assert.equal((reused.data as any).revision, 3);
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
    assert.equal(operation?.providerDirect?.profileRevision, 3);
    assert.equal(operation?.providerDirect?.executionMode, "delegated_session_transaction");
    if (operation?.providerDirect?.executionMode !== "delegated_session_transaction") throw new Error("missing delegated binding");
    assert.equal(operation.providerDirect.permissionRevision, 1);
    assert.equal((await runtime.state.loadProviderProfile(profileHash))?.revision, 3);
    assert.equal(fixture.consent.requestCalls, 1);
    assert.equal(engine.createCalls, 0);
    assert.equal(rpc.submissions.length, 0);
  } finally { await fixture.temporary.cleanup(); }
});

test("common x402 prepare upgrades the exact Slice 2 capability once before freezing ERC-7710 authority", async () => {
  const fixture = await makeFixture();
  try {
    assert.equal((await fixture.core.execute(connectCommand())).ok, true);
    const profileHash = fixture.state.profileHash(PROFILE);
    const current = await fixture.state.loadProviderProfile(profileHash);
    assert.ok(current !== null);
    const slice2 = metamaskSmartAccountCapabilitySnapshot();
    await fixture.state.writeProviderProfile({
      ...current,
      revision: 2,
      capability_snapshot: slice2,
      capability_hash: capabilityHash(slice2),
    });
    const rpc = new SmartAccountX402Rpc();
    const engine = new RecordingSmartAccountX402Engine();
    const runtime = smartAccountX402Runtime(
      fixture,
      rpc,
      new QueuedHttp([smartAccountX402Challenge()]),
      new MutableSmartAccountClock(),
      engine,
    );
    const prepared = await runtime.core.execute(smartAccountX402Prepare("smart-account-migrated-x402-0001"));
    assert.equal(prepared.ok, true, JSON.stringify(prepared));
    const operation = await runtime.state.findX402Operation(publicOperationId(prepared.operation));
    assert.equal(operation?.delegatedMaterial?.profileRevision, 3);
    assert.equal(operation?.delegatedMaterial?.method, "erc7710");
    const upgraded = await fixture.state.loadProviderProfile(profileHash);
    assert.equal(upgraded?.revision, 3);
    assert.equal(upgraded?.capability_snapshot.x402.mode, "delegated_erc7710_apn_paid_retry");
    assert.equal(fixture.consent.requestCalls, 1);
    assert.equal(engine.calls, 0);
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

test("Smart Account ERC-7710 completes the common x402 lifecycle across restart without session funding", async () => {
  const fixture = await makeFixture();
  try {
    assert.equal((await fixture.core.execute(connectCommand())).ok, true);
    const rpc = new SmartAccountX402Rpc();
    const clock = new MutableSmartAccountClock();
    const engine = new RecordingSmartAccountX402Engine();
    const http = new QueuedHttp([smartAccountX402Challenge(), smartAccountX402PaidSuccess()]);
    const runtime = smartAccountX402Runtime(fixture, rpc, http, clock, engine);

    const prepared = await runtime.core.execute(smartAccountX402Prepare("smart-account-x402-complete-0001"));
    assert.equal(prepared.ok, true, JSON.stringify(prepared));
    const operationId = publicOperationId(prepared.operation);
    const frozen = await runtime.state.findX402Operation(operationId);
    assert.equal(frozen?.selectedOffer.resolved.assetTransferMethod, "erc7710");
    assert.equal(frozen?.delegatedMaterial?.facilitatorAddresses[0], SMART_X402_FACILITATOR.toLowerCase());
    assert.equal(engine.calls, 0);
    assert.equal(await runtime.materials.load(operationId), null);
    assert.equal(http.calls.length, 1);
    assert.equal(rpc.balanceAddresses.some((address) => address.toLowerCase() === SESSION.toLowerCase()), false);

    const approved = await runtime.core.execute({ command: "x402.fetch.approve", operationId });
    assert.equal(approved.ok, true, JSON.stringify(approved));
    assert.equal((approved.operation as any).state, "authorized_not_sent");
    assert.equal(engine.calls, 1);
    assert.equal(http.calls.length, 1);
    const material = await runtime.materials.load(operationId);
    assert.ok(material !== null);
    assert.equal(material.phase, "sealed");

    const permission = await runtime.permissions.load(runtime.state.profileHash(PROFILE));
    assert.ok(permission !== null && isGrantedPermissionRecord(permission));
    const payload = engine.lastPayload;
    assert.ok(payload !== null && typeof payload.payload === "object" && payload.payload !== null);
    const wire = payload.payload as { delegationManager: Address; permissionContext: Hex; delegator: Address };
    assert.deepEqual(Object.keys(wire).sort(), ["delegationManager", "delegator", "permissionContext"]);
    const chain = decodeDelegations(wire.permissionContext);
    assert.equal(chain.length, 2);
    assert.equal(encodeDelegations([chain[1]!]).toLowerCase(), permission.grant_context.toLowerCase());
    assert.equal(chain[0]?.delegate.toLowerCase(), ANY_BENEFICIARY.toLowerCase());
    assert.equal(chain[0]?.delegator.toLowerCase(), SESSION.toLowerCase());
    assert.equal(
      chain[0]?.authority.toLowerCase(),
      hashDelegation(toDelegationStruct(chain[1]!)).toLowerCase(),
    );
    assert.equal(
      chain[0]?.salt.toLowerCase(),
      keccak256(toHex(`apn.smart-account.x402\0${operationId}\0${frozen?.fingerprint}`)).toLowerCase(),
    );
    assert.equal(wire.delegator.toLowerCase(), OWNER.toLowerCase());
    assert.equal(wire.delegationManager.toLowerCase(), permission.delegation_manager.toLowerCase());
    assert.equal(canonicalJson(payload.accepted), frozen?.selectedOffer.declaredCanonicalJson);
    assert.deepEqual(decodePaymentSignatureHeader(material.payment_header), payload);
    assert.equal(encodePaymentSignatureHeader(payload), material.payment_header);
    assertExactSmartAccountX402Caveats(chain[0]!.caveats, NOW, NOW + 60);

    const encrypted = await readFile(join(
      fixture.temporary.root, "smart-account-x402-materials", `${operationId}.json`,
    ), "utf8");
    for (const protectedValue of [
      permission.session_private_key,
      permission.grant_context,
      material.payment_header,
      material.child_permission_context,
    ]) assert.equal(encrypted.includes(protectedValue), false);

    const restarted = smartAccountX402Runtime(fixture, rpc, http, clock, engine);
    const sent = await restarted.core.execute({ command: "operation.resume", operationId });
    assert.equal(sent.ok, true, JSON.stringify(sent));
    assert.equal((sent.operation as any).state, "settlement_pending");
    assert.equal(sent.data, null, "seller result remains protected before settlement proof");
    assert.equal(engine.calls, 1);
    assert.equal(http.calls.length, 2);
    assert.equal(http.calls[1]?.paymentSignature, material.payment_header);
    assert.equal((await restarted.materials.load(operationId))?.phase, "exposed");
    const resultPending = await restarted.state.findX402Operation(operationId);
    assert.ok(resultPending?.resultLink !== undefined);
    assert.equal(resultPending?.settlementEvidence, undefined);

    // Post-exposure recovery must not require the already-spent owner balance.
    rpc.ownerUsdcAtomic = "0";
    armSmartAccountX402Settlement(rpc, resultPending!);
    const completedRuntime = smartAccountX402Runtime(fixture, rpc, http, clock, engine);
    const completed = await completedRuntime.core.execute({ command: "operation.resume", operationId });
    assert.equal(completed.ok, true, JSON.stringify(completed));
    assert.equal((completed.operation as any).state, "completed");
    assert.deepEqual((completed.data as any).body, { forecast: "sunny" });
    assert.equal(engine.calls, 1);
    assert.equal(http.calls.length, 2);
    assert.equal(rpc.x402Calls.some((call) => call.startsWith("logs:") || call.startsWith("state:")), false);
    assert.equal(rpc.balanceAddresses.some((address) => address.toLowerCase() === SESSION.toLowerCase()), false);

    const cold = new ApnCore({ state: new StateStore(fixture.temporary.root, { lockWaitMs: 1_000 }) });
    const status = await cold.execute({ command: "operation.status", operationId });
    const receipt = await cold.execute({ command: "receipt.get", operationId });
    assert.equal((status.operation as any).state, "completed");
    assert.equal((receipt.receipt as any).transferMethod, "erc7710");
    assert.equal((receipt.receipt as any).settlementEvidence.schemaVersion, "apn.x402.erc7710-settlement-evidence.v1");
    assert.equal((receipt.receipt as any).settlementEvidence.transfer.from, OWNER.toLowerCase());
    assert.equal((receipt.receipt as any).settlementEvidence.transfer.to, SMART_X402_PAYEE.toLowerCase());
    const safeOutput = JSON.stringify([prepared, approved, sent, completed, status, receipt]);
    assert.equal(safeOutput.includes(permission.session_private_key), false);
    assert.equal(safeOutput.includes(permission.grant_context), false);
    assert.equal(safeOutput.includes(material.payment_header), false);
  } finally { await fixture.temporary.cleanup(); }
});

test("Smart Account ERC-7710 freezes the approved facilitator set independent of seller order", async () => {
  const fixture = await makeFixture();
  try {
    assert.equal((await fixture.core.execute(connectCommand())).ok, true);
    const approved = ALL_METAMASK_FACILITATOR_ADDRESSES.map((value) => value.toLowerCase() as Address);
    const offered = [...approved].reverse();
    const runtime = smartAccountX402Runtime(
      fixture,
      new SmartAccountX402Rpc(),
      new QueuedHttp([smartAccountX402Challenge({
        extra: { assetTransferMethod: "erc7710", facilitatorAddresses: offered },
      })]),
      new MutableSmartAccountClock(),
      new RecordingSmartAccountX402Engine(),
      { approvedFacilitators: approved },
    );

    const prepared = await runtime.core.execute(smartAccountX402Prepare("smart-account-x402-facilitator-order-0001"));
    assert.equal(prepared.ok, true, JSON.stringify(prepared));
    const frozen = await runtime.state.findX402Operation(publicOperationId(prepared.operation));
    assert.deepEqual(frozen?.delegatedMaterial?.facilitatorAddresses, [...approved].sort());
    assert.deepEqual(frozen?.selectedOffer.resolved.assetTransferMethod === "erc7710"
      ? frozen.selectedOffer.resolved.facilitatorAddresses
      : [], [...approved].sort());
    assert.equal(frozen?.delegatedMaterial?.facilitatorAddresses.includes(
      METAMASK_FACILITATOR_ADDRESSES_DEV[0].toLowerCase() as Address,
    ), true);
  } finally { await fixture.temporary.cleanup(); }
});

test("Smart Account ERC-7710 reloads a legacy default facilitator binding after the official set expands", async () => {
  const fixture = await makeFixture();
  try {
    assert.equal((await fixture.core.execute(connectCommand())).ok, true);
    const runtime = smartAccountX402Runtime(
      fixture,
      new SmartAccountX402Rpc(),
      new QueuedHttp([smartAccountX402Challenge({ extra: { assetTransferMethod: "erc7710" } })]),
      new MutableSmartAccountClock(),
      new RecordingSmartAccountX402Engine(),
      { approvedFacilitators: ALL_METAMASK_FACILITATOR_ADDRESSES as readonly Address[] },
    );
    const prepared = await runtime.core.execute(smartAccountX402Prepare("smart-account-x402-legacy-facilitators-0001"));
    assert.equal(prepared.ok, true, JSON.stringify(prepared));
    const current = await runtime.state.findX402Operation(publicOperationId(prepared.operation));
    assert.ok(current !== null && current.delegatedMaterial !== undefined &&
      current.selectedOffer.resolved.assetTransferMethod === "erc7710");
    const legacy = METAMASK_FACILITATOR_ADDRESSES.map((value) => value.toLowerCase() as Address);
    const { integrityHash: _integrity, ...currentBody } = current;
    const legacyBody = {
      ...currentBody,
      selectedOffer: {
        ...current.selectedOffer,
        resolved: { ...current.selectedOffer.resolved, facilitatorAddresses: legacy },
      },
      delegatedMaterial: { ...current.delegatedMaterial, facilitatorAddresses: legacy },
    };
    const legacyOperation = sealX402Operation({
      ...legacyBody,
      fingerprint: x402Fingerprint(legacyBody as unknown as X402OperationRecord),
    });
    assert.equal(validateX402Operation(legacyOperation).operationId, current.operationId);

    const unknown = [legacy[0]!, legacy[1]!] as const;
    const unknownBody = {
      ...legacyBody,
      selectedOffer: {
        ...legacyBody.selectedOffer,
        resolved: { ...legacyBody.selectedOffer.resolved, facilitatorAddresses: unknown },
      },
      delegatedMaterial: { ...legacyBody.delegatedMaterial, facilitatorAddresses: unknown },
    };
    const unknownOperation = sealX402Operation({
      ...unknownBody,
      fingerprint: x402Fingerprint(unknownBody as unknown as X402OperationRecord),
    });
    assert.throws(() => validateX402Operation(unknownOperation), { code: "APN_STATE_CORRUPT" });
  } finally { await fixture.temporary.cleanup(); }
});

test("Smart Account x402 rejects non-explicit, malformed and unapproved offers before child or paid effect", async (t) => {
  const otherFacilitator = "0x5555555555555555555555555555555555555555" as Address;
  const cases: ReadonlyArray<{
    readonly label: string;
    readonly extra?: Readonly<Record<string, unknown>>;
    readonly approved?: readonly Address[];
  }> = [
    {
      label: "EIP-3009 only",
      extra: { assetTransferMethod: "eip3009", name: "USD Coin", version: "2" },
    },
    { label: "absent method", extra: {} },
    {
      label: "malformed duplicate facilitator",
      extra: {
        assetTransferMethod: "erc7710",
        facilitatorAddresses: [SMART_X402_FACILITATOR, SMART_X402_FACILITATOR],
      },
    },
    {
      label: "non-approved facilitator",
      extra: { assetTransferMethod: "erc7710", facilitatorAddresses: [SMART_X402_FACILITATOR] },
      approved: [otherFacilitator],
    },
  ];
  for (const item of cases) await t.test(item.label, async () => {
    const fixture = await makeFixture();
    try {
      assert.equal((await fixture.core.execute(connectCommand())).ok, true);
      const rpc = new SmartAccountX402Rpc();
      const http = new QueuedHttp([
        smartAccountX402Challenge(item.extra === undefined ? {} : { extra: item.extra }),
      ]);
      const engine = new RecordingSmartAccountX402Engine();
      const runtime = smartAccountX402Runtime(
        fixture,
        rpc,
        http,
        new MutableSmartAccountClock(),
        engine,
        item.approved === undefined ? {} : { approvedFacilitators: item.approved },
      );
      const result = await runtime.core.execute(smartAccountX402Prepare(`smart-account-offer-${item.label.replaceAll(" ", "-")}`));
      assert.equal(result.ok, false, JSON.stringify(result));
      assert.equal(result.error?.code, "APN_X402_UNSUPPORTED_OFFER");
      assert.equal(engine.calls, 0);
      assert.equal(http.calls.length, 1);
      assert.equal(http.calls.some((call) => call.paymentSignature !== undefined), false);
      assert.equal(rpc.submissions.length, 0);
    } finally { await fixture.temporary.cleanup(); }
  });
});

test("Smart Account x402 readiness, cap and expiry gates fail before material or paid HTTP", async (t) => {
  const cases: ReadonlyArray<{
    readonly label: string;
    readonly callerCap?: string;
    readonly allowance?: string;
    readonly ownerBalance?: string;
    readonly clockAdvance?: number;
    readonly expectedCode: string;
  }> = [
    { label: "offer over caller cap", callerCap: "999", expectedCode: "APN_X402_OFFER_EXCEEDS_LIMIT" },
    { label: "root allowance insufficient", allowance: "999", expectedCode: "APN_PERMISSION_ALLOWANCE_INSUFFICIENT" },
    { label: "owner balance insufficient", ownerBalance: "999", expectedCode: "APN_INSUFFICIENT_USDC" },
    { label: "root permission expired", clockAdvance: 3_601, expectedCode: "APN_PERMISSION_INACTIVE" },
  ];
  for (const item of cases) await t.test(item.label, async () => {
    const fixture = await makeFixture();
    try {
      assert.equal((await fixture.core.execute(connectCommand())).ok, true);
      const rpc = new SmartAccountX402Rpc();
      if (item.ownerBalance !== undefined) rpc.ownerUsdcAtomic = item.ownerBalance;
      const allowance = new FixtureAllowance();
      if (item.allowance !== undefined) allowance.availableAtomic = item.allowance;
      const clock = new MutableSmartAccountClock();
      if (item.clockAdvance !== undefined) clock.advance(item.clockAdvance);
      rpc.observedUnix = clock.unix;
      const http = new QueuedHttp([smartAccountX402Challenge()]);
      const engine = new RecordingSmartAccountX402Engine();
      const runtime = smartAccountX402Runtime(fixture, rpc, http, clock, engine, { allowance });
      const result = await runtime.core.execute(smartAccountX402Prepare(
        `smart-account-gate-${item.label.replaceAll(" ", "-")}`,
        item.callerCap,
      ));
      assert.equal(result.ok, false, JSON.stringify(result));
      assert.equal(result.error?.code, item.expectedCode, JSON.stringify(result));
      assert.equal(engine.calls, 0);
      assert.equal(http.calls.some((call) => call.paymentSignature !== undefined), false);
      assert.equal(rpc.submissions.length, 0);
    } finally { await fixture.temporary.cleanup(); }
  });
});

test("Smart Account x402 requires the common approval and treats pre-exposure expiry as proven no-effect", async () => {
  const fixture = await makeFixture();
  try {
    assert.equal((await fixture.core.execute(connectCommand())).ok, true);
    const rpc = new SmartAccountX402Rpc();
    const clock = new MutableSmartAccountClock();
    const engine = new RecordingSmartAccountX402Engine();
    const http = new QueuedHttp([smartAccountX402Challenge()]);
    const runtime = smartAccountX402Runtime(fixture, rpc, http, clock, engine);
    const prepared = await runtime.core.execute(smartAccountX402Prepare("smart-account-approval-expiry-0001"));
    const operationId = publicOperationId(prepared.operation);

    const unapproved = await runtime.core.execute({ command: "operation.resume", operationId });
    assert.equal(unapproved.error?.code, "APN_OPERATION_BLOCKED");
    assert.equal(engine.calls, 0);
    assert.equal(await runtime.materials.load(operationId), null);
    assert.equal(http.calls.length, 1);

    clock.advance(61);
    const expired = await runtime.core.execute({ command: "x402.fetch.approve", operationId });
    assert.equal(expired.ok, true, JSON.stringify(expired));
    assert.equal((expired.operation as any).state, "failed_before_effect");
    assert.equal((expired.operation as any).terminal, true);
    assert.equal(expired.proof_class, "x402_proven_no_effect");
    assert.equal(engine.calls, 0);
    assert.equal(await runtime.materials.load(operationId), null);
    assert.equal(http.calls.length, 1);
  } finally { await fixture.temporary.cleanup(); }
});

test("Smart Account permission drift after prepare blocks approval before child, seal or paid HTTP", async () => {
  const fixture = await makeFixture();
  try {
    assert.equal((await fixture.core.execute(connectCommand())).ok, true);
    const rpc = new SmartAccountX402Rpc();
    const http = new QueuedHttp([smartAccountX402Challenge()]);
    const engine = new RecordingSmartAccountX402Engine();
    const runtime = smartAccountX402Runtime(
      fixture, rpc, http, new MutableSmartAccountClock(), engine,
    );
    const prepared = await runtime.core.execute(smartAccountX402Prepare("smart-account-permission-drift-0001"));
    const operationId = publicOperationId(prepared.operation);
    const disabled = await fixture.core.execute({
      command: "wallet.permission.disable", profile: PROFILE, expectedRevision: 1,
    });
    assert.equal(disabled.ok, true, JSON.stringify(disabled));
    const rejected = await runtime.core.execute({ command: "x402.fetch.approve", operationId });
    assert.equal(rejected.ok, false, JSON.stringify(rejected));
    assert.equal(rejected.error?.code, "APN_PROFILE_DRIFT");
    assert.equal(engine.calls, 0);
    assert.equal(await runtime.materials.load(operationId), null);
    assert.equal(http.calls.length, 1);
  } finally { await fixture.temporary.cleanup(); }
});

test("Smart Account x402 exact replay converges while conflicting intent has zero additional reads or effects", async () => {
  const fixture = await makeFixture();
  try {
    assert.equal((await fixture.core.execute(connectCommand())).ok, true);
    const rpc = new SmartAccountX402Rpc();
    const clock = new MutableSmartAccountClock();
    const engine = new RecordingSmartAccountX402Engine();
    const http = new QueuedHttp([smartAccountX402Challenge()]);
    const runtime = smartAccountX402Runtime(fixture, rpc, http, clock, engine);
    const request = smartAccountX402Prepare("smart-account-idempotency-0001");
    const prepared = await runtime.core.execute(request);
    const operationId = publicOperationId(prepared.operation);
    const counts = [http.calls.length, rpc.x402PrepareCalls, rpc.balanceCalls, engine.calls];

    const duplicate = await runtime.core.execute(request);
    assert.equal(publicOperationId(duplicate.operation), operationId);
    assert.deepEqual([http.calls.length, rpc.x402PrepareCalls, rpc.balanceCalls, engine.calls], counts);
    const conflict = await runtime.core.execute({ ...request, url: "https://seller.example/different" });
    assert.equal(conflict.error?.code, "APN_IDEMPOTENCY_CONFLICT");
    assert.deepEqual([http.calls.length, rpc.x402PrepareCalls, rpc.balanceCalls, engine.calls], counts);
    assert.equal(await runtime.materials.load(operationId), null);
  } finally { await fixture.temporary.cleanup(); }
});

test("Smart Account rejects malformed or widened official material before encrypted seal and paid exposure", async (t) => {
  const wrongAddress = "0x5555555555555555555555555555555555555555" as Address;
  const mutations: ReadonlyArray<{
    readonly label: string;
    readonly mutate: ConstructorParameters<typeof MutatingSmartAccountX402Engine>[0];
  }> = [
    {
      label: "wrong delegation manager",
      mutate: (payload) => mutateSmartAccountPayload(payload, (wire) => ({
        ...wire, delegationManager: wrongAddress,
      })),
    },
    {
      label: "wrong delegator",
      mutate: (payload) => mutateSmartAccountPayload(payload, (wire) => ({
        ...wire, delegator: wrongAddress,
      })),
    },
    {
      label: "extra delegation in chain",
      mutate: (payload) => mutateSmartAccountPayload(payload, (wire) => {
        const chain = decodeDelegations(wire.permissionContext);
        return { ...wire, permissionContext: encodeDelegations([...chain, chain[1]!]) };
      }),
    },
    {
      label: "wrong signed redeemer",
      mutate: async (payload) => await mutateSmartAccountPayloadRedeemer(payload, wrongAddress),
    },
  ];
  for (const item of mutations) await t.test(item.label, async () => {
    const fixture = await makeFixture();
    try {
      assert.equal((await fixture.core.execute(connectCommand())).ok, true);
      const rpc = new SmartAccountX402Rpc();
      const http = new QueuedHttp([smartAccountX402Challenge()]);
      const engine = new MutatingSmartAccountX402Engine(item.mutate);
      const runtime = smartAccountX402Runtime(
        fixture, rpc, http, new MutableSmartAccountClock(), engine,
      );
      const prepared = await runtime.core.execute(smartAccountX402Prepare(
        `smart-account-material-${item.label.replaceAll(" ", "-")}`,
      ));
      const operationId = publicOperationId(prepared.operation);
      const rejected = await runtime.core.execute({ command: "x402.fetch.approve", operationId });
      assert.equal(rejected.ok, false, JSON.stringify(rejected));
      assert.equal(rejected.error?.code, "APN_PROVIDER_PROTOCOL");
      assert.equal(engine.calls, 1);
      assert.equal(await runtime.materials.load(operationId), null);
      assert.equal(http.calls.length, 1);
      assert.equal(http.calls.some((call) => call.paymentSignature !== undefined), false);
      assert.equal(rpc.submissions.length, 0);
      assert.equal((await runtime.state.findX402Operation(operationId))?.state, "authorization_material_pending");
    } finally { await fixture.temporary.cleanup(); }
  });
});

test("Smart Account encrypted x402 material is single-assignment and authenticated before exposure", async (t) => {
  await t.test("conflicting second material", async () => {
    const fixture = await makeFixture();
    try {
      assert.equal((await fixture.core.execute(connectCommand())).ok, true);
      const runtime = smartAccountX402Runtime(
        fixture,
        new SmartAccountX402Rpc(),
        new QueuedHttp([smartAccountX402Challenge()]),
        new MutableSmartAccountClock(),
        new RecordingSmartAccountX402Engine(),
      );
      const prepared = await runtime.core.execute(smartAccountX402Prepare("smart-account-material-conflict-0001"));
      const operationId = publicOperationId(prepared.operation);
      assert.equal((await runtime.core.execute({ command: "x402.fetch.approve", operationId })).ok, true);
      const existing = await runtime.materials.load(operationId);
      assert.ok(existing !== null);
      const { material_identity_hash: _identity, integrity_hash: _integrity, ...unsealed } = existing;
      const differentInstant = new Date((NOW + 1) * 1_000).toISOString();
      await assert.rejects(
        runtime.materials.seal({ ...unsealed, sealed_at: differentInstant, updated_at: differentInstant }),
        (error: unknown) => error instanceof ApnError && error.code === "APN_IDEMPOTENCY_CONFLICT",
      );
    } finally { await fixture.temporary.cleanup(); }
  });

  await t.test("authenticated envelope corruption", async () => {
    const fixture = await makeFixture();
    try {
      assert.equal((await fixture.core.execute(connectCommand())).ok, true);
      const http = new QueuedHttp([smartAccountX402Challenge()]);
      const engine = new RecordingSmartAccountX402Engine();
      const runtime = smartAccountX402Runtime(
        fixture, new SmartAccountX402Rpc(), http, new MutableSmartAccountClock(), engine,
      );
      const prepared = await runtime.core.execute(smartAccountX402Prepare("smart-account-material-corrupt-0001"));
      const operationId = publicOperationId(prepared.operation);
      assert.equal((await runtime.core.execute({ command: "x402.fetch.approve", operationId })).ok, true);
      const path = join(fixture.temporary.root, "smart-account-x402-materials", `${operationId}.json`);
      const envelope = JSON.parse(await readFile(path, "utf8")) as {
        cipher: { tag: string };
      } & Record<string, unknown>;
      envelope.cipher.tag = `${envelope.cipher.tag[0] === "A" ? "B" : "A"}${envelope.cipher.tag.slice(1)}`;
      await writeFile(path, JSON.stringify(envelope), { mode: 0o600 });
      const resumed = await runtime.core.execute({ command: "operation.resume", operationId });
      assert.equal(resumed.error?.code, "APN_STATE_CORRUPT", JSON.stringify(resumed));
      assert.equal(http.calls.length, 1);
      assert.equal(engine.calls, 1);
    } finally { await fixture.temporary.cleanup(); }
  });
});

test("Smart Account authorization recovers the same deterministic material across both seal crash boundaries", async (t) => {
  for (const boundary of ["before_seal", "after_seal"] as const) await t.test(boundary, async () => {
    const fixture = await makeFixture();
    try {
      assert.equal((await fixture.core.execute(connectCommand())).ok, true);
      const rpc = new SmartAccountX402Rpc();
      const http = new QueuedHttp([smartAccountX402Challenge()]);
      const clock = new MutableSmartAccountClock();
      const engine = new RecordingSmartAccountX402Engine();
      const runtime = smartAccountX402Runtime(fixture, rpc, http, clock, engine);
      const prepared = await runtime.core.execute(smartAccountX402Prepare(`smart-account-crash-${boundary}-0001`));
      const operationId = publicOperationId(prepared.operation);
      const operation = await runtime.state.findX402Operation(operationId);
      assert.ok(operation !== null);
      if (boundary === "after_seal") await runtime.x402.materialize(operation);
      await runtime.state.writeX402Operation(authorizationMaterialPending(operation));

      const recoveredRuntime = smartAccountX402Runtime(fixture, rpc, http, clock, engine);
      const recovered = await recoveredRuntime.core.execute({ command: "operation.resume", operationId });
      assert.equal(recovered.ok, true, JSON.stringify(recovered));
      assert.equal((recovered.operation as any).state, "authorized_not_sent");
      assert.equal(engine.calls, 1, "the boundary must converge on one material construction");
      assert.equal((await recoveredRuntime.materials.load(operationId))?.phase, "sealed");
      assert.equal(http.calls.length, 1);
    } finally { await fixture.temporary.cleanup(); }
  });
});

test("ambiguous Smart Account paid HTTP finalizes unused only after expiry and a complete exact-transfer scan", async () => {
  const fixture = await makeFixture();
  try {
    assert.equal((await fixture.core.execute(connectCommand())).ok, true);
    const rpc = new SmartAccountX402Rpc();
    const clock = new MutableSmartAccountClock();
    const http = new QueuedHttp([smartAccountX402Challenge(), new Error("injected lost paid response")]);
    const engine = new RecordingSmartAccountX402Engine();
    const runtime = smartAccountX402Runtime(fixture, rpc, http, clock, engine);
    const prepared = await runtime.core.execute(smartAccountX402Prepare("smart-account-http-ambiguous-0001"));
    const operationId = publicOperationId(prepared.operation);
    assert.equal((await runtime.core.execute({ command: "x402.fetch.approve", operationId })).ok, true);

    const exposed = await runtime.core.execute({ command: "operation.resume", operationId });
    assert.equal((exposed.operation as any).state, "effect_unknown");
    const durable = await runtime.state.findX402Operation(operationId);
    assert.deepEqual(durable?.attempts.map((attempt) => [attempt.purpose, attempt.phase]), [["payment", "ambiguous"]]);
    assert.equal((await runtime.materials.load(operationId))?.phase, "exposed");
    clock.advance(61);
    rpc.observedUnix = clock.unix;
    armSmartAccountExpiredRange(rpc, durable as X402OperationRecord);
    let finalizedReads = 0;
    rpc.onX402Call = (name) => {
      if (name !== "finalized" || ++finalizedReads !== 2) return;
      const previous = rpc.finalizedHead;
      const number = (BigInt(previous.number) + 1n).toString();
      const hash = `0x${"e".repeat(64)}` as Hex;
      const timestamp = (BigInt(previous.timestamp) + 2n).toString();
      rpc.finalizedHead = { ...previous, number, hash, timestamp, observedAt: new Date(Number(timestamp) * 1_000).toISOString() };
      rpc.blockHashes.set(number, hash);
      rpc.blockTimestamps.set(number, timestamp);
    };
    const recovered = await smartAccountX402Runtime(fixture, rpc, http, clock, engine).core.execute({
      command: "operation.resume", operationId,
    });
    assert.equal((recovered.operation as any).state, "failed_expired_unused", JSON.stringify(recovered));
    assert.equal((recovered.operation as any).terminal, true);
    assert.equal(recovered.proof_class, "x402_expired_unused_finalized");
    assert.equal((recovered.receipt as any).unusedExpiryEvidence.schemaVersion,
      "apn.x402.erc7710-unused-expiry-evidence.v1");
    assert.equal((recovered.receipt as any).unusedExpiryEvidence.scan.matchingTransferCount, "0");
    assert.equal(http.calls.length, 2, "challenge plus one ambiguous paid request only");
    assert.equal(engine.calls, 1);
    assert.ok(rpc.transferCalls.length > 0);
    assert.equal(rpc.x402Calls.some((call) => call.startsWith("state:")), false);
    assert.equal(rpc.submissions.length, 0);

    const restarted = smartAccountX402Runtime(fixture, rpc, http, clock, engine);
    const durableTerminal = await restarted.core.execute({ command: "operation.status", operationId });
    assert.equal((durableTerminal.operation as any).state, "failed_expired_unused");
    assert.equal(http.calls.length, 2, "restart cannot replay the paid request");
  } finally { await fixture.temporary.cleanup(); }
});

test("Smart Account expired-unused recovery remains unknown without complete negative evidence", async (t) => {
  for (const posture of ["not-finalized", "range-unavailable", "matching-transfer"] as const) await t.test(posture, async () => {
    const fixture = await makeFixture();
    try {
      assert.equal((await fixture.core.execute(connectCommand())).ok, true);
      const rpc = new SmartAccountX402Rpc();
      const clock = new MutableSmartAccountClock();
      const http = new QueuedHttp([smartAccountX402Challenge(), new Error("injected lost paid response")]);
      const engine = new RecordingSmartAccountX402Engine();
      const runtime = smartAccountX402Runtime(fixture, rpc, http, clock, engine);
      const prepared = await runtime.core.execute(smartAccountX402Prepare(`smart-account-expiry-negative-${posture}`));
      const operationId = publicOperationId(prepared.operation);
      assert.equal((await runtime.core.execute({ command: "x402.fetch.approve", operationId })).ok, true);
      assert.equal((await runtime.core.execute({ command: "operation.resume", operationId }).then((item) => item.operation as any)).state,
        "effect_unknown");
      const operation = await runtime.state.findX402Operation(operationId) as X402OperationRecord;
      clock.advance(61);
      rpc.observedUnix = clock.unix;
      armSmartAccountExpiredRange(rpc, operation);
      if (posture === "not-finalized") {
        rpc.finalizedHead = { ...rpc.finalizedHead, timestamp: (BigInt(operation.authorization.validBefore) - 1n).toString() };
        rpc.blockTimestamps.set(rpc.finalizedHead.number, rpc.finalizedHead.timestamp);
      } else if (posture === "range-unavailable") {
        rpc.transferOutcomes = Array.from({ length: 12 }, () => ({ kind: "range_unavailable" as const }));
      } else {
        const expiryBlock = rpc.finalizedHead.number;
        rpc.transferOutcomes = [{ kind: "complete", logs: [transferLog({
          from: operation.wallet,
          to: operation.payee,
          value: operation.amountAtomic,
          transactionHash: X402_TRANSACTION as Hex,
          blockNumber: expiryBlock,
          blockHash: rpc.finalizedHead.hash,
        })] }];
      }
      const recovered = await runtime.core.execute({ command: "operation.resume", operationId });
      assert.equal((recovered.operation as any).state, "effect_unknown", JSON.stringify(recovered));
      assert.equal((recovered.operation as any).terminal, false);
      assert.equal((await runtime.state.findX402Operation(operationId))?.unusedExpiryEvidence, undefined);
      assert.equal(http.calls.length, 2);
      assert.equal(engine.calls, 1);
    } finally { await fixture.temporary.cleanup(); }
  });
});

test("concurrent Smart Account resume calls expose one sealed header exactly once", async () => {
  const fixture = await makeFixture();
  try {
    assert.equal((await fixture.core.execute(connectCommand())).ok, true);
    const rpc = new SmartAccountX402Rpc();
    const clock = new MutableSmartAccountClock();
    const http = new QueuedHttp([smartAccountX402Challenge(), smartAccountX402PaidSuccess()]);
    const engine = new RecordingSmartAccountX402Engine();
    const runtime = smartAccountX402Runtime(fixture, rpc, http, clock, engine);
    const prepared = await runtime.core.execute(smartAccountX402Prepare("smart-account-concurrent-resume-0001"));
    const operationId = publicOperationId(prepared.operation);
    assert.equal((await runtime.core.execute({ command: "x402.fetch.approve", operationId })).ok, true);
    const [first, second] = await Promise.all([
      runtime.core.execute({ command: "operation.resume", operationId }),
      runtime.core.execute({ command: "operation.resume", operationId }),
    ]);
    assert.equal(first.ok, true, JSON.stringify(first));
    assert.equal(second.ok, true, JSON.stringify(second));
    assert.equal((await runtime.state.findX402Operation(operationId))?.attempts.length, 1);
    assert.equal(http.calls.length, 2);
    assert.equal(http.calls.filter((call) => call.paymentSignature !== undefined).length, 1);
    assert.equal(engine.calls, 1);
  } finally { await fixture.temporary.cleanup(); }
});

test("wrong, reverted or absent ERC-7710 settlement never completes or replays paid HTTP", async (t) => {
  const cases = ["missing", "reverted", "wrong_transaction", "wrong_transfer", "not_safe"] as const;
  for (const classification of cases) await t.test(classification, async () => {
    const fixture = await makeFixture();
    try {
      assert.equal((await fixture.core.execute(connectCommand())).ok, true);
      const rpc = new SmartAccountX402Rpc();
      const clock = new MutableSmartAccountClock();
      const http = new QueuedHttp([smartAccountX402Challenge(), smartAccountX402PaidSuccess()]);
      const engine = new RecordingSmartAccountX402Engine();
      const runtime = smartAccountX402Runtime(fixture, rpc, http, clock, engine);
      const prepared = await runtime.core.execute(smartAccountX402Prepare(`smart-account-settlement-${classification}`));
      const operationId = publicOperationId(prepared.operation);
      await runtime.core.execute({ command: "x402.fetch.approve", operationId });
      await runtime.core.execute({ command: "operation.resume", operationId });
      const operation = await runtime.state.findX402Operation(operationId);
      assert.ok(operation !== null);
      if (classification !== "missing") armSmartAccountX402Settlement(rpc, operation);
      if (classification === "reverted") rpc.x402Receipt = { ...rpc.x402Receipt!, status: "reverted" };
      if (classification === "wrong_transaction") {
        const wrong = `0x${"e".repeat(64)}` as Hex;
        rpc.x402Receipt = { ...rpc.x402Receipt!, transactionHash: wrong };
      }
      if (classification === "wrong_transfer") {
        rpc.x402Receipt = {
          ...rpc.x402Receipt!,
          logs: [transferLog({
            from: operation.wallet,
            to: DIRECT_RECIPIENT,
            value: operation.amountAtomic,
            transactionHash: X402_TRANSACTION as Hex,
            blockNumber: rpc.x402Receipt!.blockNumber,
            blockHash: rpc.x402Receipt!.blockHash,
          })],
        };
      }
      if (classification === "not_safe") {
        rpc.safeHead = { ...rpc.safeHead, number: (BigInt(rpc.x402Receipt!.blockNumber) - 1n).toString() };
      }
      const resumed = await runtime.core.execute({ command: "operation.resume", operationId });
      assert.equal(resumed.ok, true, JSON.stringify(resumed));
      assert.equal((resumed.operation as any).state, "settlement_pending");
      assert.equal((resumed.operation as any).terminal, false);
      assert.equal((await runtime.state.findX402Operation(operationId))?.settlementEvidence, undefined);
      const replay = await runtime.core.execute({ command: "operation.resume", operationId });
      assert.equal((replay.operation as any).state, "settlement_pending");
      assert.equal(http.calls.length, 2);
      assert.equal(engine.calls, 1);
      assert.equal(rpc.x402Calls.some((call) => call.startsWith("logs:") || call.startsWith("state:")), false);
    } finally { await fixture.temporary.cleanup(); }
  });
});

test("proven ERC-7710 settlement without a seller result closes with a safe common failure receipt", async () => {
  const fixture = await makeFixture();
  try {
    assert.equal((await fixture.core.execute(connectCommand())).ok, true);
    const rpc = new SmartAccountX402Rpc();
    const clock = new MutableSmartAccountClock();
    const noResult = smartAccountX402PaidSuccess({ status: 204, bodyText: "" });
    const http = new QueuedHttp([smartAccountX402Challenge(), noResult]);
    const engine = new RecordingSmartAccountX402Engine();
    const runtime = smartAccountX402Runtime(fixture, rpc, http, clock, engine);
    const prepared = await runtime.core.execute(smartAccountX402Prepare("smart-account-settled-no-result-0001"));
    const operationId = publicOperationId(prepared.operation);
    await runtime.core.execute({ command: "x402.fetch.approve", operationId });
    const sent = await runtime.core.execute({ command: "operation.resume", operationId });
    assert.equal((sent.operation as any).state, "settlement_pending");
    const operation = await runtime.state.findX402Operation(operationId);
    assert.ok(operation !== null && operation.resultLink === undefined);
    armSmartAccountX402Settlement(rpc, operation);
    const closed = await smartAccountX402Runtime(fixture, rpc, http, clock, engine).core.execute({
      command: "operation.resume", operationId,
    });
    assert.equal((closed.operation as any).state, "failed_settled_without_result");
    assert.equal((closed.operation as any).terminal, true);
    assert.equal(closed.proof_class, "x402_settled_result_unavailable");
    assert.equal((closed.receipt as any).transferMethod, "erc7710");
    assert.equal((closed.receipt as any).settlementEvidence.schemaVersion, "apn.x402.erc7710-settlement-evidence.v1");
    assert.equal(http.calls.length, 2);
    assert.equal(engine.calls, 1);
  } finally { await fixture.temporary.cleanup(); }
});

test("common CLI and MCP x402 surfaces share one Smart Account ERC-7710 operation and receipt", async () => {
  const fixture = await makeFixture();
  try {
    assert.equal((await fixture.core.execute(connectCommand())).ok, true);
    const rpc = new SmartAccountX402Rpc();
    const clock = new MutableSmartAccountClock();
    const http = new QueuedHttp([smartAccountX402Challenge(), smartAccountX402PaidSuccess()]);
    const engine = new RecordingSmartAccountX402Engine();
    const runtime = smartAccountX402Runtime(fixture, rpc, http, clock, engine);
    const options = {
      stateRoot: fixture.temporary.root,
      wrappingSecret: fixture.wrapping,
      providerRegistry: runtime.registry,
      rpc,
      http,
      policy: runtime.policy,
      clock,
      ids: { next: () => "12345678-1234-4234-8234-123456789abc" },
    } as const;
    const prepared = await runCli([
      "x402", "fetch", "prepare", "--profile", PROFILE, "--url", X402_URL,
      "--idempotency-key", "smart-account-cli-mcp-x402-0001",
      "--max-amount-atomic", CAP, "--rpc-url", "https://rpc.example",
    ], {}, options);
    assert.equal(prepared.ok, true, JSON.stringify(prepared));
    const operationId = publicOperationId(prepared.operation);
    const server = createMcpServer(options);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: "smart-account-x402-parity", version: "1.0.0" });
    await client.connect(clientTransport);
    try {
      const approved = mcpEnvelope(await client.callTool({
        name: "apn_x402_fetch_approve",
        arguments: { operation: operationId, rpc_url: "https://rpc.example" },
      }));
      assert.equal((approved.operation as any).state, "authorized_not_sent", JSON.stringify(approved));
      const sent = mcpEnvelope(await client.callTool({
        name: "apn_operation_resume",
        arguments: { operation: operationId, rpc_url: "https://rpc.example" },
      }));
      assert.equal((sent.operation as any).state, "settlement_pending", JSON.stringify(sent));
      const operation = await runtime.state.findX402Operation(operationId);
      assert.ok(operation !== null);
      armSmartAccountX402Settlement(rpc, operation);
      const completed = await runCli([
        "operation", "resume", "--operation", operationId, "--rpc-url", "https://rpc.example",
      ], {}, options);
      assert.equal((completed.operation as any).state, "completed", JSON.stringify(completed));
      const receipt = mcpEnvelope(await client.callTool({
        name: "apn_receipt_get", arguments: { operation: operationId },
      }));
      assert.equal((receipt.receipt as any).transferMethod, "erc7710");
      assert.equal((receipt.receipt as any).settlementEvidence.methodBinding.method, "erc7710");
      assert.equal(engine.calls, 1);
      assert.equal(http.calls.length, 2);
      const safe = JSON.stringify([prepared, approved, sent, completed, receipt]);
      const material = await runtime.materials.load(operationId);
      const permission = await runtime.permissions.load(runtime.state.profileHash(PROFILE));
      assert.ok(material !== null && permission !== null && isGrantedPermissionRecord(permission));
      for (const secret of [material.payment_header, material.child_permission_context, permission.session_private_key]) {
        assert.equal(safe.includes(secret), false);
      }
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
  readonly failFirstConsentRequest?: boolean;
  readonly rpc?: TestRpc;
} = {}) {
  const temporary = await temporaryState();
  const wrapping = new TestWrappingSecret();
  const consent = new FixtureConsent();
  if (options.failFirstConsentRequest === true) consent.failRequestCount = 1;
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

function smartAccountX402Runtime(
  fixture: Awaited<ReturnType<typeof makeFixture>>,
  rpc: SmartAccountX402Rpc,
  http: QueuedHttp,
  clock: MutableSmartAccountClock,
  engine: SmartAccountX402EnginePort,
  options: {
    readonly allowance?: SmartAccountAllowancePort;
    readonly policy?: TestProfilePolicy;
    readonly approvedFacilitators?: readonly Address[];
  } = {},
) {
  const state = new StateStore(fixture.temporary.root, { lockWaitMs: 1_000 });
  const permissions = new EncryptedSmartAccountPermissionStore(state, fixture.wrapping);
  const materials = new EncryptedSmartAccountX402MaterialStore(state, fixture.wrapping);
  const x402 = new MetaMaskSmartAccountX402Adapter(
    permissions,
    materials,
    rpc,
    options.allowance ?? new FixtureAllowance(),
    engine,
    () => clock.now(),
    options.approvedFacilitators ?? [SMART_X402_FACILITATOR],
  );
  const adapter = new MetaMaskSmartAccountAdapter(
    permissions,
    fixture.consent,
    fixture.sessions,
    () => clock.now(),
    undefined,
    x402,
  );
  const registry = new ProviderRegistry([
    { provider_id: METAMASK_SMART_ACCOUNT_PROVIDER_ID, create: () => adapter.bundle() },
  ]);
  const policy = options.policy ?? new TestProfilePolicy({
    maxBalanceUsdcAtomic: "10000000",
    maxX402AmountAtomic: CAP,
  });
  return {
    state,
    permissions,
    materials,
    registry,
    policy,
    x402,
    core: new ApnCore({
      state,
      profileRepository: new StateProfileRepository(state),
      providerRegistry: registry,
      policy,
      rpc,
      http,
      clock,
      ids: { next: () => "12345678-1234-4234-8234-123456789abc" },
    }),
  };
}

function smartAccountX402Challenge(input: {
  readonly extra?: Readonly<Record<string, unknown>>;
  readonly amount?: string;
  readonly maxTimeoutSeconds?: number;
} = {}) {
  const extra = input.extra ?? {
    assetTransferMethod: "erc7710",
    facilitatorAddresses: [SMART_X402_FACILITATOR],
  };
  return challengeObservation({
    finalUrl: X402_URL,
    header: canonicalPaymentRequiredHeader({
      x402Version: 2,
      resource: {
        url: X402_URL,
        description: "Smart Account deterministic result",
        mimeType: "application/json",
      },
      accepts: [{
        scheme: "exact",
        network: "eip155:8453",
        amount: input.amount ?? SMART_X402_AMOUNT,
        asset: BASE_USDC,
        payTo: SMART_X402_PAYEE,
        maxTimeoutSeconds: input.maxTimeoutSeconds ?? 60,
        extra,
      }],
    }),
  });
}

function smartAccountX402PaidSuccess(input: {
  readonly status?: number;
  readonly bodyText?: string;
} = {}) {
  const instant = new Date(NOW * 1_000).toISOString();
  return paidObservation({
    finalUrl: X402_URL,
    ...(input.status === undefined ? {} : { status: input.status }),
    ...(input.bodyText === undefined ? {} : { bodyText: input.bodyText }),
    startedAt: instant,
    observedAt: instant,
    paymentResponseHeader: canonicalPaymentResponseHeader({
      success: true,
      transaction: X402_TRANSACTION,
      network: "eip155:8453",
      payer: OWNER.toLowerCase(),
      amount: SMART_X402_AMOUNT,
    }),
  });
}

function smartAccountX402Prepare(idempotencyKey: string, maxAmountAtomic = CAP) {
  return {
    command: "x402.fetch.prepare" as const,
    profile: PROFILE,
    url: X402_URL,
    idempotencyKey,
    maxAmountAtomic,
  };
}

function publicOperationId(value: unknown): string {
  if (value === null || typeof value !== "object" || !("operationId" in value) ||
    typeof (value as { operationId?: unknown }).operationId !== "string") {
    throw new Error("expected public x402 operation id");
  }
  return (value as { operationId: string }).operationId;
}

function assertExactSmartAccountX402Caveats(
  caveats: readonly { readonly enforcer: Hex; readonly terms: Hex; readonly args: Hex }[],
  after: number,
  before: number,
): void {
  const environment = smartAccountEnvironment();
  const at = (address: Hex | undefined) => caveats.find((item) =>
    item.enforcer.toLowerCase() === requiredHex(address).toLowerCase());
  const value = at(environment.caveatEnforcers.ValueLteEnforcer)!;
  const transfer = at(environment.caveatEnforcers.ERC20TransferAmountEnforcer)!;
  const calldata = at(environment.caveatEnforcers.AllowedCalldataEnforcer)!;
  const timestamp = at(environment.caveatEnforcers.TimestampEnforcer)!;
  const redeemer = at(environment.caveatEnforcers.RedeemerEnforcer)!;
  assert.equal(caveats.length, 5);
  assert.deepEqual([value.args, transfer.args, calldata.args, timestamp.args, redeemer.args], [
    "0x00", "0x00", "0x", "0x00", "0x",
  ]);
  assert.equal(decodeValueLteTerms(value.terms).maxValue, 0n);
  const decodedTransfer = decodeERC20TransferAmountTerms(transfer.terms);
  assert.equal(decodedTransfer.tokenAddress.toLowerCase(), BASE_USDC.toLowerCase());
  assert.equal(decodedTransfer.maxAmount, BigInt(SMART_X402_AMOUNT));
  assert.deepEqual(decodeAllowedCalldataTerms(calldata.terms), {
    startIndex: 4,
    value: pad(SMART_X402_PAYEE, { size: 32 }),
  });
  assert.deepEqual(decodeTimestampTerms(timestamp.terms), {
    afterThreshold: after,
    beforeThreshold: before,
  });
  assert.deepEqual(decodeRedeemerTerms(redeemer.terms).redeemers.map((item) => item.toLowerCase()), [
    SMART_X402_FACILITATOR.toLowerCase(),
  ]);
}

function authorizationMaterialPending(operation: X402OperationRecord): X402OperationRecord {
  const { integrityHash: _integrity, ...body } = operation;
  const transition = {
    at: operation.updatedAt,
    state: "authorization_material_pending" as const,
    terminal: false,
    reason: "x402_authorization_material_pending" as const,
    proofClass: "x402_authorization_recovery" as const,
  };
  return sealX402Operation({
    ...body,
    state: transition.state,
    finalityClass: "pre_effect",
    terminal: false,
    reason: transition.reason,
    proofClass: transition.proofClass,
    nextActions: ["operation.resume", "operation.status"],
    transitions: appendX402Transition(operation.transitions, transition),
  });
}

type SmartAccountWirePayload = {
  readonly delegationManager: Address;
  readonly permissionContext: Hex;
  readonly delegator: Address;
};

function mutateSmartAccountPayload(
  payment: SmartAccountX402EngineOutput,
  mutate: (wire: SmartAccountWirePayload) => SmartAccountWirePayload,
): SmartAccountX402EngineOutput {
  const wire = payment.payload as SmartAccountWirePayload;
  return { ...payment, payload: mutate(wire) };
}

async function mutateSmartAccountPayloadRedeemer(
  payment: SmartAccountX402EngineOutput,
  redeemer: Address,
): Promise<SmartAccountX402EngineOutput> {
  const wire = payment.payload as SmartAccountWirePayload;
  const chain = decodeDelegations(wire.permissionContext);
  const child = chain[0]!;
  const environment = smartAccountEnvironment();
  const enforcer = requiredHex(environment.caveatEnforcers.RedeemerEnforcer);
  const caveats = child.caveats.map((caveat) => caveat.enforcer.toLowerCase() === enforcer.toLowerCase()
    ? { ...caveat, terms: createRedeemerTerms({ redeemers: [redeemer] }) }
    : caveat);
  const unsigned = { ...child, caveats, signature: "0x" as Hex };
  const signature = await privateKeyToAccount(SESSION_PRIVATE_KEY).signTypedData({
    domain: {
      chainId: 8453,
      name: "DelegationManager",
      version: "1",
      verifyingContract: wire.delegationManager,
    },
    types: SIGNABLE_DELEGATION_TYPED_DATA,
    primaryType: "Delegation",
    message: toDelegationStruct(unsigned),
  });
  return {
    ...payment,
    payload: {
      ...wire,
      permissionContext: encodeDelegations([{ ...unsigned, signature }, ...chain.slice(1)]),
    },
  };
}

function armSmartAccountX402Settlement(rpc: SmartAccountX402Rpc, operation: X402OperationRecord): void {
  const blockNumber = "12350";
  const blockHash = `0x${"d".repeat(64)}` as Hex;
  const observedAt = new Date((NOW + 10) * 1_000).toISOString();
  rpc.safeHead = {
    queriedTag: "safe",
    number: blockNumber,
    hash: blockHash,
    timestamp: (BigInt(NOW) + 10n).toString(),
    observedAt,
    rpcOrigin: rpc.rpcOrigin,
  };
  rpc.blockHashes.set(blockNumber, blockHash);
  rpc.blockTimestamps.set(blockNumber, rpc.safeHead.timestamp);
  rpc.x402Receipt = {
    transactionHash: X402_TRANSACTION as Hex,
    status: "success",
    blockNumber,
    blockHash,
    logs: [transferLog({
      from: operation.wallet,
      to: operation.payee,
      value: operation.amountAtomic,
      transactionHash: X402_TRANSACTION as Hex,
      blockNumber,
      blockHash,
    })],
    observedAt,
    rpcOrigin: rpc.rpcOrigin,
  };
}

function armSmartAccountExpiredRange(rpc: SmartAccountX402Rpc, operation: X402OperationRecord): void {
  const blockNumber = (BigInt(operation.preparedBlock.number) + 5n).toString();
  const blockHash = `0x${"c".repeat(64)}` as Hex;
  const timestamp = (BigInt(operation.authorization.validBefore) + 1n).toString();
  const observedAt = new Date(Number(timestamp) * 1_000).toISOString();
  rpc.safeHead = {
    queriedTag: "safe",
    number: blockNumber,
    hash: blockHash,
    timestamp,
    observedAt,
    rpcOrigin: rpc.rpcOrigin,
  };
  rpc.finalizedHead = { ...rpc.safeHead, queriedTag: "finalized" };
  rpc.blockHashes.set(operation.preparedBlock.number, operation.preparedBlock.hash);
  rpc.blockTimestamps.set(operation.preparedBlock.number, operation.authorization.createdAt);
  rpc.blockHashes.set(blockNumber, blockHash);
  rpc.blockTimestamps.set(blockNumber, timestamp);
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
