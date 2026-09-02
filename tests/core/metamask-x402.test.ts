import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { privateKeyToAccount } from "viem/accounts";
import { ApnCore } from "../../src/core.js";
import { BASE_USDC } from "../../src/constants.js";
import { EncryptedProviderAuthorizationStore } from "../../src/encrypted-provider-authorization-store.js";
import type { WrappingSecretPort } from "../../src/macos-keychain.js";
import { MetaMaskX402Adapter } from "../../src/metamask-x402-adapter.js";
import {
  METAMASK_AGENT_WALLET_PROVIDER_ID,
  MetaMaskProcessAdapter,
} from "../../src/metamask-process-adapter.js";
import type { MetaMaskProcessResult, MetaMaskProcessRunnerPort } from "../../src/metamask-process-runner.js";
import type { Address, Hex } from "../../src/model.js";
import type { ForegroundAuthenticationPort, X402SigningIntent } from "../../src/provider-ports.js";
import { ProviderRegistry } from "../../src/provider-registry.js";
import { StateProfileRepository } from "../../src/profile-repository.js";
import { StateStore } from "../../src/state.js";
import type { X402OperationRecord } from "../../src/x402-state-integrity.js";
import { TestClock, TestProfilePolicy, temporaryState } from "./helpers.js";
import {
  QueuedHttp,
  RecoveryRpc,
  authorizationUsedLog,
  challengeObservation,
  paidObservation,
  transferLog,
} from "./x402-helpers.js";
import {
  X402_PAYMENT_REQUIRED,
  X402_TRANSACTION,
  X402_URL,
  canonicalPaymentRequiredHeader,
  canonicalPaymentResponseHeader,
} from "./x402-vectors.js";

const ACCOUNT = privateKeyToAccount(`0x${"0".repeat(63)}1` as Hex);
const WRONG_ACCOUNT = privateKeyToAccount(`0x${"0".repeat(63)}2` as Hex);
const PROFILE = "metamask-x402";
const TOKEN = "signature-request-01234567";

class TestWrappingSecret implements WrappingSecretPort {
  private secret: Buffer | null = null;
  createCalls = 0;
  async load(): Promise<Buffer | null> { return this.secret === null ? null : Buffer.from(this.secret); }
  async create(): Promise<Buffer> {
    this.createCalls += 1;
    this.secret ??= Buffer.from("44".repeat(32), "hex");
    return Buffer.from(this.secret);
  }
}

class FixtureRunner implements MetaMaskProcessRunnerPort {
  readonly calls: Array<{ readonly argv: readonly string[]; readonly timeoutMs?: number }> = [];
  address: Address = ACCOUNT.address;
  initial: "pending" | "rejected" | "throw" = "pending";
  watch: "signed" | "denied" | "denied_error" | "expired_error" | "timeout" = "signed";
  signer = ACCOUNT;
  signature: Hex | undefined;

  async runJson(argv: readonly string[], timeoutMs?: number): Promise<MetaMaskProcessResult> {
    this.calls.push({ argv: [...argv], ...(timeoutMs === undefined ? {} : { timeoutMs }) });
    if (argv[0] === "doctor") return success({
      cli: "6.1.5", env: "prod", authenticated: true, initialized: true,
    });
    if (argv[0] === "wallet" && argv[1] === "select") return success({ selected: this.address });
    if (argv[0] === "wallet" && argv[1] === "address") return success({
      mode: "server", chainNamespace: "evm", address: this.address,
    });
    if (argv[0] === "wallet" && argv[1] === "sign-typed-data") {
      if (this.initial === "throw") throw new Error("provider response lost");
      if (this.initial === "rejected") return success({
        mode: "server", address: this.address, status: "DENIED",
      });
      this.signature = await signPayload(this.signer, requiredFlag(argv, "--payload"));
      return success({
        mode: "server", address: this.address, status: "AWAITING_MFA", pollingId: TOKEN,
      });
    }
    if (argv[0] === "wallet" && argv[1] === "requests" && argv[2] === "watch") {
      if (this.watch === "timeout") return failure("JOB_TIMEOUT");
      if (this.watch === "denied_error") return failure("TX_DENIED");
      if (this.watch === "expired_error") return failure("TX_EXPIRED");
      if (this.watch === "denied") return success({
        request: { pollingId: TOKEN, kind: "signature" },
        status: { kind: "signature", status: "DENIED" },
      });
      return success({
        request: { pollingId: TOKEN, kind: "signature" },
        status: { kind: "signature", status: "SIGNED", signature: this.signature },
      });
    }
    if (argv[0] === "logout") return success({ success: true });
    throw new Error(`unexpected MetaMask fixture command: ${argv.join(" ")}`);
  }

  async runForeground(): Promise<number> { return 0; }
}

const foreground: ForegroundAuthenticationPort = {
  readIdentity: async () => { throw new Error("MetaMask owns login"); },
  readChallengeResponse: async () => { throw new Error("MetaMask owns login"); },
  confirmRebind: async () => true,
};

test("MetaMask x402 adapter sends only the exact frozen EIP-712 payload and watches the same MFA request", async () => {
  const runner = new FixtureRunner();
  const intent = sampleIntent();
  const adapter = new MetaMaskX402Adapter(runner);
  assert.deepEqual(await adapter.request(intent), {
    disposition: "pending", recoveryToken: TOKEN, providerState: "AWAITING_MFA",
  });
  const signCall = runner.calls.find((call) => call.argv[1] === "sign-typed-data");
  assert.notEqual(signCall, undefined);
  assert.deepEqual(JSON.parse(requiredFlag(signCall?.argv ?? [], "--payload")), {
    domain: { chainId: 8453, name: "USD Coin", verifyingContract: BASE_USDC.toLowerCase(), version: "2" },
    message: intent.authorization,
    primaryType: "TransferWithAuthorization",
    types: { TransferWithAuthorization: [
      { name: "from", type: "address" }, { name: "to", type: "address" },
      { name: "value", type: "uint256" }, { name: "validAfter", type: "uint256" },
      { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" },
    ] },
  });
  assert.equal(requiredFlag(signCall?.argv ?? [], "--intent"), intent.humanIntent);
  assert.equal(signCall?.argv.includes("--wait"), false);
  const signed = await adapter.observe({ recoveryToken: TOKEN, sender: ACCOUNT.address, waitSeconds: 30 });
  assert.equal(signed.disposition, "signed");
  assert.deepEqual(runner.calls.at(-1), {
    argv: ["wallet", "requests", "watch", TOKEN, "--wallet-timeout", "30", "--json"],
    timeoutMs: 35_000,
  });
});

test("MetaMask x402 adapter preserves the official streamed MFA recovery identity", async () => {
  const runner = new FixtureRunner();
  const intent = sampleIntent();
  const adapter = new MetaMaskX402Adapter(runner);
  const originalRunJson = runner.runJson.bind(runner);
  runner.runJson = async (argv: readonly string[], timeoutMs?: number): Promise<MetaMaskProcessResult> => {
    if (argv[0] === "wallet" && argv[1] === "sign-typed-data") {
      runner.signature = await signPayload(runner.signer, requiredFlag(argv, "--payload"));
      return streamed(
        [{ kind: "AWAITING_MFA", source: "wallet:sign-typed-data", pollingId: TOKEN }],
        { mode: "server", address: runner.address, status: "AWAITING_MFA", pollingId: TOKEN },
      );
    }
    if (argv[0] === "wallet" && argv[1] === "requests" && argv[2] === "watch") {
      return streamed([{ kind: "AWAITING_MFA", pollingId: TOKEN }], undefined, 1);
    }
    return await originalRunJson(argv, timeoutMs);
  };
  assert.deepEqual(await adapter.request(intent), {
    disposition: "pending", recoveryToken: TOKEN, providerState: "AWAITING_MFA",
  });
  assert.deepEqual(await adapter.observe({ recoveryToken: TOKEN, sender: ACCOUNT.address, waitSeconds: 1 }), {
    disposition: "pending", recoveryToken: TOKEN, providerState: "AWAITING_MFA",
  });
});

test("MetaMask x402 adapter recognizes the exact 6.1.5 terminal error codes", async () => {
  const runner = new FixtureRunner();
  const adapter = new MetaMaskX402Adapter(runner);
  runner.watch = "denied_error";
  assert.deepEqual(await adapter.observe({ recoveryToken: TOKEN, sender: ACCOUNT.address }), {
    disposition: "rejected", reason: "provider_denied",
  });
  runner.watch = "expired_error";
  assert.deepEqual(await adapter.observe({ recoveryToken: TOKEN, sender: ACCOUNT.address }), {
    disposition: "rejected", reason: "provider_expired",
  });
});

test("MetaMask profile completes one APN-owned x402 journey across restart with one signing request", async (t) => {
  const temporary = await temporaryState();
  t.after(temporary.cleanup);
  const wrapping = new TestWrappingSecret();
  const initialRunner = new FixtureRunner();
  const rpc = new RecoveryRpc();
  rpc.x402Evidence = { ...rpc.x402Evidence, address: ACCOUNT.address };
  const http = new QueuedHttp([challenge(), paidSuccess()]);
  const clock = new TestClock();
  const initial = core(temporary.root, initialRunner, wrapping, rpc, http, clock);
  await connect(initial);
  const prepared = await initial.execute({
    command: "x402.fetch.prepare",
    profile: PROFILE,
    url: X402_URL,
    maxAmountAtomic: "2000000",
    idempotencyKey: "metamask-x402-complete-001",
  });
  assert.equal(prepared.ok, true, JSON.stringify(prepared));
  const operationId = requiredOperationId(prepared);
  assert.equal((prepared.operation as { signer?: { provider?: unknown } }).signer?.provider, METAMASK_AGENT_WALLET_PROVIDER_ID);

  const approved = await initial.execute({ command: "x402.fetch.approve", operationId });
  assert.equal(approved.ok, true, JSON.stringify(approved));
  assert.equal((approved.operation as { state?: unknown }).state, "authorization_material_pending");
  assert.equal(initialRunner.calls.filter((call) => call.argv[1] === "sign-typed-data").length, 1);
  assert.equal(JSON.stringify(approved).includes(TOKEN), false);
  assert.equal(JSON.stringify(approved).includes(initialRunner.signature ?? "missing"), false);
  const encrypted = await readFile(join(
    temporary.root,
    "provider-authorizations",
    new StateStore(temporary.root).profileHash(PROFILE),
    `${operationId}.json`,
  ), "utf8");
  assert.equal(encrypted.includes(TOKEN), false);
  assert.equal(encrypted.includes(initialRunner.signature ?? "missing"), false);
  assert.equal(wrapping.createCalls, 1, "provider-only x402 creates its encrypted wrapping secret lazily");

  const restartedRunner = new FixtureRunner();
  restartedRunner.signature = initialRunner.signature;
  const restarted = core(temporary.root, restartedRunner, wrapping, rpc, http, clock);
  const authorized = await restarted.execute({ command: "operation.resume", operationId });
  assert.equal(authorized.ok, true, JSON.stringify(authorized));
  assert.equal((authorized.operation as { state?: unknown }).state, "authorized_not_sent");
  assert.equal(restartedRunner.calls.filter((call) => call.argv[1] === "sign-typed-data").length, 0);
  assert.equal(restartedRunner.calls.filter((call) => call.argv[2] === "watch").length, 1);

  const sent = await restarted.execute({ command: "operation.resume", operationId });
  assert.equal(sent.ok, true, JSON.stringify(sent));
  assert.equal((sent.operation as { state?: unknown }).state, "settlement_pending");
  assert.equal(http.calls.filter((call) => call.paymentSignature !== undefined).length, 1);
  const durable = await restarted.context.state.findX402Operation(operationId);
  assert.notEqual(durable, null);
  armSettlement(rpc, durable as X402OperationRecord);
  const completed = await restarted.execute({ command: "operation.resume", operationId });
  assert.equal(completed.ok, true, JSON.stringify(completed));
  assert.equal((completed.operation as { state?: unknown }).state, "completed");
  assert.equal(completed.proof_class, "x402_safe_settlement");
  assert.equal((completed.receipt as { payer?: unknown }).payer, ACCOUNT.address.toLowerCase());

  const duplicate = await restarted.execute({
    command: "x402.fetch.prepare",
    profile: PROFILE,
    url: X402_URL,
    maxAmountAtomic: "2000000",
    idempotencyKey: "metamask-x402-complete-001",
  });
  assert.equal(requiredOperationId(duplicate), operationId);
  assert.equal(restartedRunner.calls.filter((call) => call.argv[1] === "sign-typed-data").length, 0);
  assert.equal(http.calls.filter((call) => call.paymentSignature !== undefined).length, 1);
});

test("denial and expiry close before HTTP while a lost initial response is never replayed", async (t) => {
  const deniedState = await temporaryState();
  const expiredState = await temporaryState();
  const lostState = await temporaryState();
  t.after(async () => { await deniedState.cleanup(); await expiredState.cleanup(); await lostState.cleanup(); });

  const deniedRunner = new FixtureRunner();
  deniedRunner.initial = "rejected";
  const denied = await preparedCore(deniedState.root, deniedRunner, new TestWrappingSecret(), "denied");
  const deniedResult = await denied.core.execute({ command: "x402.fetch.approve", operationId: denied.operationId });
  assert.equal((deniedResult.operation as { state?: unknown }).state, "failed_before_effect");
  assert.equal((deniedResult.receipt as { proofClass?: unknown }).proofClass, "x402_proven_no_effect");
  assert.equal(denied.http.calls.length, 1, "only the unpaid challenge is allowed");

  const expiredRunner = new FixtureRunner();
  const expired = await preparedCore(expiredState.root, expiredRunner, new TestWrappingSecret(), "expired");
  expired.clock.advance(61_000);
  const expiredResult = await expired.core.execute({ command: "x402.fetch.approve", operationId: expired.operationId });
  assert.equal((expiredResult.operation as { state?: unknown }).state, "failed_before_effect");
  assert.equal(expiredRunner.calls.filter((call) => call.argv[1] === "sign-typed-data").length, 0);
  assert.equal(expired.http.calls.length, 1);

  const wrapping = new TestWrappingSecret();
  const lostRunner = new FixtureRunner();
  lostRunner.initial = "throw";
  const lost = await preparedCore(lostState.root, lostRunner, wrapping, "lost");
  const first = await lost.core.execute({ command: "x402.fetch.approve", operationId: lost.operationId });
  assert.equal((first.operation as { state?: unknown }).state, "failed_before_effect");
  const restartedRunner = new FixtureRunner();
  const restarted = core(lostState.root, restartedRunner, wrapping, lost.rpc, lost.http, lost.clock);
  const resumed = await restarted.execute({ command: "operation.resume", operationId: lost.operationId });
  assert.equal((resumed.operation as { state?: unknown }).state, "failed_before_effect");
  assert.equal(lostRunner.calls.filter((call) => call.argv[1] === "sign-typed-data").length, 1);
  assert.equal(restartedRunner.calls.filter((call) => call.argv[1] === "sign-typed-data").length, 0);
  assert.equal(restartedRunner.calls.filter((call) => call.argv[2] === "watch").length, 0);
});

test("a signature from any address other than the frozen payer fails before paid HTTP", async (t) => {
  const temporary = await temporaryState();
  t.after(temporary.cleanup);
  const runner = new FixtureRunner();
  runner.signer = WRONG_ACCOUNT;
  const fixture = await preparedCore(temporary.root, runner, new TestWrappingSecret(), "wrong-signer");
  await fixture.core.execute({ command: "x402.fetch.approve", operationId: fixture.operationId });
  const resumed = await fixture.core.execute({ command: "operation.resume", operationId: fixture.operationId });
  assert.equal(resumed.ok, false);
  assert.equal(resumed.error?.code, "APN_NATIVE_PROTOCOL");
  assert.equal(fixture.http.calls.length, 1, "signer mismatch cannot produce a paid request");
  const durable = await fixture.core.context.state.findX402Operation(fixture.operationId);
  assert.equal(durable?.state, "authorization_material_pending");
});

function core(
  root: string,
  runner: FixtureRunner,
  wrapping: TestWrappingSecret,
  rpc: RecoveryRpc,
  http: QueuedHttp,
  clock: TestClock,
): ApnCore {
  const state = new StateStore(root, { lockWaitMs: 1_000 });
  return new ApnCore({
    state,
    profileRepository: new StateProfileRepository(state),
    providerRegistry: new ProviderRegistry([{
      provider_id: METAMASK_AGENT_WALLET_PROVIDER_ID,
      create: () => new MetaMaskProcessAdapter(
        runner,
        async (work) => await work(),
        () => clock.now(),
      ).bundle(),
    }]),
    foregroundAuthentication: foreground,
    providerAuthorizationStore: new EncryptedProviderAuthorizationStore(state, wrapping),
    policy: new TestProfilePolicy(),
    rpc,
    rpcUrl: "https://rpc.example/",
    http,
    clock,
  });
}

async function preparedCore(
  root: string,
  runner: FixtureRunner,
  wrapping: TestWrappingSecret,
  key: string,
): Promise<{
  readonly core: ApnCore; readonly operationId: string; readonly rpc: RecoveryRpc;
  readonly http: QueuedHttp; readonly clock: TestClock;
}> {
  const rpc = new RecoveryRpc();
  rpc.x402Evidence = { ...rpc.x402Evidence, address: ACCOUNT.address };
  const http = new QueuedHttp([challenge()]);
  const clock = new TestClock();
  const instance = core(root, runner, wrapping, rpc, http, clock);
  await connect(instance);
  const prepared = await instance.execute({
    command: "x402.fetch.prepare", profile: PROFILE, url: X402_URL,
    maxAmountAtomic: "2000000", idempotencyKey: `metamask-x402-${key}`,
  });
  assert.equal(prepared.ok, true, JSON.stringify(prepared));
  return { core: instance, operationId: requiredOperationId(prepared), rpc, http, clock };
}

async function connect(coreInstance: ApnCore): Promise<void> {
  const result = await coreInstance.execute({
    command: "wallet.connect", profile: PROFILE, providerId: METAMASK_AGENT_WALLET_PROVIDER_ID,
  });
  assert.equal(result.ok, true, JSON.stringify(result));
}

function challenge() {
  return challengeObservation({ header: canonicalPaymentRequiredHeader(X402_PAYMENT_REQUIRED) });
}

function paidSuccess() {
  return paidObservation({ paymentResponseHeader: canonicalPaymentResponseHeader({
    success: true,
    transaction: X402_TRANSACTION,
    network: "eip155:8453",
    payer: ACCOUNT.address.toLowerCase(),
    amount: "1250000",
  }) });
}

function armSettlement(rpc: RecoveryRpc, operation: X402OperationRecord): void {
  const blockNumber = rpc.safeHead.number;
  const blockHash = rpc.safeHead.hash;
  const transactionHash = X402_TRANSACTION as Hex;
  rpc.blockHashes.set(blockNumber, blockHash);
  rpc.authorizationStateValue = true;
  rpc.x402Receipt = {
    transactionHash,
    status: "success",
    blockNumber,
    blockHash,
    logs: [
      authorizationUsedLog({
        authorizer: operation.wallet,
        nonce: operation.authorization.nonce,
        transactionHash,
        blockNumber,
        blockHash,
      }),
      transferLog({
        from: operation.wallet,
        to: operation.payee,
        value: operation.amountAtomic,
        transactionHash,
        blockNumber,
        blockHash,
      }),
    ],
    observedAt: rpc.safeHead.observedAt,
    rpcOrigin: rpc.rpcOrigin,
  };
}

function sampleIntent(): X402SigningIntent {
  return {
    sender: ACCOUNT.address,
    chainId: "8453",
    token: BASE_USDC.toLowerCase() as Address,
    tokenDomain: { name: "USD Coin", version: "2" },
    authorization: {
      from: ACCOUNT.address.toLowerCase() as Address,
      to: "0x2222222222222222222222222222222222222222",
      value: "1250000",
      validAfter: "0",
      validBefore: "1787702460",
      nonce: `0x${"ab".repeat(32)}` as Hex,
    },
    humanIntent: "Authorize 1.25 USDC x402 payment on Base.",
  };
}

async function signPayload(account: typeof ACCOUNT, payloadText: string): Promise<Hex> {
  const payload = JSON.parse(payloadText) as {
    readonly domain: { readonly name: string; readonly version: string; readonly chainId: number; readonly verifyingContract: Address };
    readonly types: { readonly TransferWithAuthorization: readonly { readonly name: string; readonly type: string }[] };
    readonly primaryType: "TransferWithAuthorization";
    readonly message: {
      readonly from: Address; readonly to: Address; readonly value: string; readonly validAfter: "0";
      readonly validBefore: string; readonly nonce: Hex;
    };
  };
  return await account.signTypedData({
    domain: payload.domain,
    types: { TransferWithAuthorization: [...payload.types.TransferWithAuthorization] },
    primaryType: payload.primaryType,
    message: {
      ...payload.message,
      value: BigInt(payload.message.value),
      validAfter: 0n,
      validBefore: BigInt(payload.message.validBefore),
    },
  });
}

function requiredFlag(argv: readonly string[], name: string): string {
  const index = argv.indexOf(name);
  const value = index < 0 ? undefined : argv[index + 1];
  if (value === undefined) throw new Error(`missing ${name}`);
  return value;
}

function requiredOperationId(value: { readonly operation?: unknown }): string {
  const operation = value.operation as { readonly operationId?: unknown } | null;
  if (typeof operation?.operationId !== "string") throw new Error("operation ID is missing");
  return operation.operationId;
}

function success(data: Record<string, unknown>): MetaMaskProcessResult {
  return { exitCode: 0, stdout: Buffer.from(JSON.stringify({ ok: true, data })) };
}

function failure(code: string): MetaMaskProcessResult {
  return { exitCode: 1, stdout: Buffer.from(JSON.stringify({ ok: false, error: { code } })) };
}

function streamed(
  notices: readonly Record<string, unknown>[],
  summary?: Record<string, unknown>,
  exitCode = 0,
): MetaMaskProcessResult {
  return {
    exitCode,
    stdout: Buffer.from([
      ...notices.map((notice) => JSON.stringify({ _notice: notice })),
      ...(summary === undefined ? [] : [JSON.stringify({ _summary: summary })]),
    ].join("\n")),
  };
}
