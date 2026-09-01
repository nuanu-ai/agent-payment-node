import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { access, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import test, { type TestContext } from "node:test";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import {
  AWAL_X402_PROCESS_TIMEOUT_MS,
  AWAL_X402_SHUTDOWN_MARGIN_MS,
  AwalX402Adapter,
  type AwalX402LaunchPort,
} from "../../src/awal-x402-adapter.js";
import { AWAL_PROVIDER_ID } from "../../src/awal-process-adapter.js";
import { canonicalJson, hashObject, sha256 } from "../../src/canonical.js";
import { BASE_USDC, TRANSFER_TOPIC } from "../../src/constants.js";
import { ApnCore } from "../../src/core.js";
import { runCli } from "../../src/cli.js";
import { canonicalizeNormalizedProviderJson } from "../../src/normalized-provider-json.js";
import type { OutputEnvelope } from "../../src/commands.js";
import { createMcpServer } from "../../src/mcp-server.js";
import type { Address, Hex } from "../../src/model.js";
import type {
  ProviderAdapterBundle,
  ProviderBalanceObservation,
  ProviderX402Invocation,
  ProviderX402SellerResult,
  X402ExecutionPort,
} from "../../src/provider-ports.js";
import {
  providerX402InvocationIntentHash,
  type ProviderX402OperationRecord,
  type ProviderX402ReceiptRecord,
  type ProviderX402RangeSettlementEvidence,
} from "../../src/provider-x402-model.js";
import { ProviderRegistry } from "../../src/provider-registry.js";
import {
  accountBindingHash,
  capabilityHash,
  coinbaseDirectCapabilitySnapshot,
  type ProviderProfileRecord,
} from "../../src/provider-profile.js";
import { ProviderX402Repository } from "../../src/provider-x402-repository.js";
import { OperationService } from "../../src/operation-service.js";
import { recoveryMaterialDigest } from "../../src/provider-x402-transaction-binding.js";
import { validatePublicX402Receipt } from "../../src/x402-public-artifacts.js";
import type {
  X402AuthorizationState,
  X402AuthorizationUsedLogs,
  X402BlockReference,
  X402RpcBlock,
  X402RpcHead,
  X402RpcLog,
  X402RpcPort,
  X402RpcReceipt,
  X402TransferLogs,
} from "../../src/ports.js";
import { StateProfileRepository } from "../../src/profile-repository.js";
import { policyBinding, type ProfilePolicyPort } from "../../src/profile-policy.js";
import { StateStore } from "../../src/state.js";
import type { HttpGetRequest, HttpObservation } from "../../src/x402-model.js";
import { TestClock, TestNative, TestProfilePolicy, TestRpc, temporaryState } from "./helpers.js";
import { challengeObservation, TestHttp } from "./x402-helpers.js";
import {
  canonicalPaymentRequiredHeader,
  X402_PAYMENT_REQUIRED,
  X402_PAYEE,
  X402_REQUIREMENTS,
  X402_URL,
} from "./x402-vectors.js";

const PAYER = "0x1111111111111111111111111111111111111111" as Address;
const TRANSACTION = `0x${"c".repeat(64)}` as Hex;
const SCRIPT_PATH_CANARY = "/PROTECTED_SCRIPT_PATH_CANARY/node_modules/awal/dist/index.js";

class FixtureX402 implements X402ExecutionPort {
  readonly mode = "provider_atomic_paid_fetch" as const;
  readonly calls: Array<{ readonly url: string; readonly amountAtomic: string; readonly correlationId: string }> = [];
  primeCalls = 0;
  result: Awaited<ReturnType<NonNullable<X402ExecutionPort["execute"]>>> = {
    disposition: "seller_result",
    invocation: invocation(),
    result: sellerResult(),
  };
  assertCompatibleIntent(input: { readonly amountAtomic: string }): void {
    if (BigInt(input.amountAtomic) > 9_007_199_254_740_991n) throw new Error("unsafe provider amount");
  }
  async prime(): Promise<void> { this.primeCalls += 1; }
  async execute(input: {
    readonly url: string;
    readonly amountAtomic: string;
    readonly correlationId: string;
    readonly requestDigest: string;
  }) {
    this.calls.push(input);
    if (this.result.disposition === "seller_result") {
      return { ...this.result, invocation: invocation(input.correlationId, input.amountAtomic, input.requestDigest) };
    }
    if (this.result.disposition === "ambiguous" && this.result.invocation !== undefined) {
      return { ...this.result, invocation: invocation(input.correlationId, input.amountAtomic, input.requestDigest) };
    }
    return this.result;
  }
}

class ProviderReads {
  statusCalls = 0;
  balanceCalls = 0;
  address = PAYER;
  raw = "50000000";
  observedAt = "2026-08-30T00:00:00.000Z";
  failBalance = false;
  async connect(): Promise<void> {}
  async logout(): Promise<void> {}
  async probeStatus(): Promise<void> { this.statusCalls += 1; }
  async crossCheckAddress(expected: Address): Promise<void> {
    if (expected.toLowerCase() !== this.address.toLowerCase()) throw new Error("address drift");
  }
  async observeBalance(): Promise<ProviderBalanceObservation> {
    this.balanceCalls += 1;
    if (this.failBalance) throw new Error("injected provider balance failure");
    return {
      address: this.address,
      account_binding_hash: accountBindingHash(AWAL_PROVIDER_ID, this.address),
      chain: "base",
      asset: "USDC",
      raw: this.raw,
      formatted: "50 USDC",
      decimals: 6,
      observed_at: this.observedAt,
    };
  }
}

class ProviderRpc extends TestRpc implements X402RpcPort {
  readonly clock: TestClock;
  lowerNumber = 1000n;
  lowerTimestamp: bigint;
  safeNumber = 1000n;
  transferLogs: X402RpcLog[] = [];
  transferOutcome: X402TransferLogs | undefined;
  x402Receipt: X402RpcReceipt | null = null;
  readonly blockHashOverrides = new Map<string, Hex>();
  transferCalls = 0;
  chainCalls = 0;
  receiptCalls = 0;
  headCalls = 0;
  blockCalls = 0;
  readonly receiptHashes: Hex[] = [];
  readonly boundedTimeouts: number[] = [];
  readonly transferRanges: Array<{ readonly from: Address; readonly fromBlock: string; readonly toBlock: string }> = [];
  slowBounded = false;
  failChain = false;
  private boundedTimeout: number | undefined;

  constructor(clock: TestClock) {
    super();
    this.clock = clock;
    this.lowerTimestamp = BigInt(Math.floor(clock.now().getTime() / 1000) - 12);
  }

  withTotalTimeout(milliseconds: number): X402RpcPort {
    this.boundedTimeouts.push(milliseconds);
    if (this.slowBounded) this.boundedTimeout = milliseconds;
    return this;
  }
  override async assertBaseChain(): Promise<{ readonly chainId: 8453; readonly rpcOrigin: string }> {
    this.chainCalls += 1;
    if (this.failChain) throw new Error("injected Base RPC identity failure");
    return await super.assertBaseChain();
  }
  async getX402Head(tag: "safe" | "finalized"): Promise<X402RpcHead> {
    this.headCalls += 1;
    if (this.boundedTimeout !== undefined) {
      const timeout = this.boundedTimeout;
      this.boundedTimeout = undefined;
      await new Promise((resolve) => setTimeout(resolve, timeout));
      throw new Error("injected bounded RPC timeout");
    }
    const number = tag === "safe" ? this.safeNumber : this.lowerNumber;
    return {
      queriedTag: tag,
      number: number.toString(),
      hash: blockHash(number),
      timestamp: this.timestamp(number),
      observedAt: this.clock.now().toISOString(),
      rpcOrigin: this.rpcOrigin,
    };
  }
  async getX402Block(number: string): Promise<X402RpcBlock> {
    this.blockCalls += 1;
    const value = BigInt(number);
    return {
      queriedTag: "number",
      number,
      hash: this.blockHashOverrides.get(number) ?? blockHash(value),
      timestamp: this.timestamp(value),
      observedAt: this.clock.now().toISOString(),
      rpcOrigin: this.rpcOrigin,
    };
  }
  async getX402Receipt(transactionHash: Hex): Promise<X402RpcReceipt | null> {
    this.receiptCalls += 1;
    this.receiptHashes.push(transactionHash);
    return this.x402Receipt;
  }
  async getX402AuthorizationState(_authorizer: Address, _nonce: Hex, block: X402BlockReference): Promise<X402AuthorizationState> {
    const identity = "tag" in block ? await this.getX402Head(block.tag) : await this.getX402Block(block.number);
    return {
      value: false,
      blockNumber: identity.number,
      blockHash: identity.hash,
      blockTag: "tag" in block ? block.tag : "number",
      observedAt: identity.observedAt,
      rpcOrigin: identity.rpcOrigin,
    };
  }
  async getX402AuthorizationUsedLogs(): Promise<X402AuthorizationUsedLogs> { return { kind: "complete", logs: [] }; }
  async getX402TransferLogs(input: {
    readonly from: Address;
    readonly fromBlock: string;
    readonly toBlock: string;
  }): Promise<X402TransferLogs> {
    this.transferCalls += 1;
    this.transferRanges.push(input);
    return this.transferOutcome ?? { kind: "complete", logs: [...this.transferLogs] };
  }
  private timestamp(number: bigint): string {
    return (this.lowerTimestamp + (number - this.lowerNumber) * 12n).toString();
  }
}

class FailingProviderRepository extends ProviderX402Repository {
  failStarted = false;
  failCompleted = false;
  failPreparingWriteAt: number | undefined;
  failAwaiting = false;
  preparingWrites = 0;
  failSettledWithoutResult = false;
  failReceipt = false;
  override async writeOperation(operation: Parameters<ProviderX402Repository["writeOperation"]>[0]): Promise<void> {
    if (operation.state === "preparing") {
      this.preparingWrites += 1;
      if (this.preparingWrites === this.failPreparingWriteAt) throw new Error("injected preparing store failure");
    }
    if (operation.state === "awaiting_approval" && this.failAwaiting) {
      this.failAwaiting = false;
      throw new Error("injected awaiting store failure");
    }
    if (operation.state === "started" && this.failStarted) {
      this.failStarted = false;
      throw new Error("injected started store failure");
    }
    if (operation.state === "completed" && this.failCompleted) {
      this.failCompleted = false;
      throw new Error("injected terminal store failure");
    }
    if (operation.state === "failed_settled_without_result" && this.failSettledWithoutResult) {
      this.failSettledWithoutResult = false;
      throw new Error("injected settled-without-result store failure");
    }
    await super.writeOperation(operation);
  }
  override async writeReceipt(
    profileHash: string,
    receipt: Parameters<ProviderX402Repository["writeReceipt"]>[1],
  ): Promise<void> {
    if (receipt.terminalState === "failed_settled_without_result" && this.failReceipt) {
      this.failReceipt = false;
      throw new Error("injected receipt store failure");
    }
    await super.writeReceipt(profileHash, receipt);
  }
}

class FailOnceHttp extends TestHttp {
  failNext = true;
  override async get(request: HttpGetRequest): Promise<HttpObservation> {
    if (!this.failNext) return await super.get(request);
    this.failNext = false;
    this.calls.push(request);
    throw new Error("injected seller read failure");
  }
}

async function setup(t: TestContext, input: {
  readonly http?: TestHttp;
  readonly effect?: FixtureX402;
  readonly failStartedStore?: boolean;
  readonly failCompletedStore?: boolean;
  readonly failPreparingWriteAt?: number;
  readonly failAwaitingStore?: boolean;
  readonly failSettledWithoutResultStore?: boolean;
  readonly failReceiptStore?: boolean;
  readonly policy?: ProfilePolicyPort;
  readonly rpcUrl?: string;
} = {}) {
  const temporary = await temporaryState();
  t.after(temporary.cleanup);
  const state = new StateStore(temporary.root, { lockWaitMs: 1_000 });
  await state.initialize();
  const profileRepository = new StateProfileRepository(state);
  const capabilities = coinbaseDirectCapabilitySnapshot();
  const profile: ProviderProfileRecord = {
    schema_version: "apn.provider-profile.v1",
    profile: "provider-one",
    profile_hash: state.profileHash("provider-one"),
    provider_id: AWAL_PROVIDER_ID,
    public_address: PAYER,
    account_binding_hash: accountBindingHash(AWAL_PROVIDER_ID, PAYER),
    trust_class: "provider_managed_non_custodial_tee",
    revision: 3,
    capability_snapshot: capabilities,
    capability_hash: capabilityHash(capabilities),
    observed_at: "2026-08-30T00:00:00.000Z",
    drift: { state: "bound", reason: "none" },
  };
  await profileRepository.save(profile);
  const effect = input.effect ?? new FixtureX402();
  const reads = new ProviderReads();
  const bundle: ProviderAdapterBundle = {
    provider_id: AWAL_PROVIDER_ID,
    trust_class: profile.trust_class,
    capabilities,
    lifecycle: reads,
    reads,
    x402: effect,
    evidence: { owner: "apn" },
  };
  const registry = new ProviderRegistry([{ provider_id: AWAL_PROVIDER_ID, create: () => bundle }]);
  const clock = new TestClock();
  clock.value = new Date("2026-08-30T00:00:00.000Z");
  const rpc = new ProviderRpc(clock);
  const http = input.http ?? new TestHttp(challengeObservation());
  const policy = input.policy ?? new TestProfilePolicy();
  const injectedRepository = input.failStartedStore || input.failCompletedStore || input.failAwaitingStore ||
    input.failSettledWithoutResultStore || input.failReceiptStore || input.failPreparingWriteAt !== undefined
    ? new FailingProviderRepository(temporary.root)
    : undefined;
  if (injectedRepository !== undefined) {
    injectedRepository.failStarted = input.failStartedStore === true;
    injectedRepository.failCompleted = input.failCompletedStore === true;
    injectedRepository.failPreparingWriteAt = input.failPreparingWriteAt;
    injectedRepository.failAwaiting = input.failAwaitingStore === true;
    injectedRepository.failSettledWithoutResult = input.failSettledWithoutResultStore === true;
    injectedRepository.failReceipt = input.failReceiptStore === true;
  }
  const core = new ApnCore({
    state,
    profileRepository,
    providerRegistry: registry,
    ...(injectedRepository === undefined ? {} : { providerX402Repository: injectedRepository }),
    policy,
    rpc,
    http,
    rpcUrl: input.rpcUrl ?? "https://rpc.example/base?tenant=one",
    clock,
    ids: { next: () => "12345678-1234-4234-8234-123456789abc" },
  });
  return { core, state, profile, effect, reads, rpc, http, policy, clock, registry, temporary, injectedRepository };
}

function restartedCore(
  fixture: Awaited<ReturnType<typeof setup>>,
  rpcUrl = "https://rpc.example/base?tenant=one",
): ApnCore {
  const state = new StateStore(fixture.temporary.root, { lockWaitMs: 1_000 });
  return new ApnCore({
    state,
    profileRepository: new StateProfileRepository(state),
    providerRegistry: fixture.registry,
    policy: fixture.policy,
    rpc: fixture.rpc,
    http: fixture.http,
    rpcUrl,
    clock: fixture.clock,
  });
}

function armExactSettlement(fixture: Awaited<ReturnType<typeof setup>>, blockNumber = 1010n): void {
  const transfer = exactTransfer(blockNumber);
  fixture.rpc.transferLogs = [transfer];
  fixture.rpc.x402Receipt = {
    transactionHash: TRANSACTION,
    status: "success",
    blockNumber: transfer.blockNumber,
    blockHash: transfer.blockHash,
    logs: [transfer],
    observedAt: fixture.clock.now().toISOString(),
    rpcOrigin: fixture.rpc.rpcOrigin,
  };
  fixture.clock.advance(240_000);
  fixture.reads.observedAt = fixture.clock.now().toISOString();
  fixture.rpc.safeNumber = 1021n;
}

async function prepare(core: ApnCore, key = "provider-x402-001"): Promise<string> {
  const response = await core.execute({
    command: "x402.fetch.prepare",
    profile: "provider-one",
    url: X402_URL,
    idempotencyKey: key,
    maxAmountAtomic: "2000000",
  });
  assert.equal(response.ok, true, JSON.stringify(response));
  const operationId = (response.operation as { operationId?: unknown } | null)?.operationId;
  assert.equal(typeof operationId, "string");
  return operationId as string;
}

async function executeAwalEnvelope(value: unknown) {
  const launch: AwalX402LaunchPort = () => {
    const child = new EventEmitter() as EventEmitter & {
      pid: number; stdout: EventEmitter; stderr: EventEmitter; kill(): boolean;
    };
    child.pid = 42;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => true;
    queueMicrotask(() => {
      child.emit("spawn");
      child.stdout.emit("data", Buffer.from(JSON.stringify(value)));
      child.emit("close", 0);
    });
    return child;
  };
  return await new AwalX402Adapter(async () => "/exact/awal", launch).execute({
    url: X402_URL,
    amountAtomic: X402_REQUIREMENTS.amount,
    correlationId: "a".repeat(64),
    requestDigest: "b".repeat(64),
  });
}

test("AWAL x402 uses exact Node argv, exact deadline and normalized bounded JSON", async () => {
  assert.equal(AWAL_X402_PROCESS_TIMEOUT_MS, 210_000);
  assert.equal(AWAL_X402_SHUTDOWN_MARGIN_MS, 30_000);
  const launches: Array<{ executable: string; args: readonly string[]; options: unknown }> = [];
  const launch: AwalX402LaunchPort = (executable, args, options) => {
    launches.push({ executable, args: [...args], options });
    const child = new EventEmitter() as EventEmitter & { pid: number; stdout: EventEmitter; stderr: EventEmitter; kill(): boolean };
    child.pid = 42;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => true;
    queueMicrotask(() => {
      child.emit("spawn");
      child.stdout.emit("data", Buffer.from(JSON.stringify({
        status: 200,
        statusText: "PROVIDER_STATUS_TEXT_CANARY",
        data: true,
        paymentMade: true,
        amountPaid: "1250000",
      })));
      child.emit("close", 0);
    });
    return child;
  };
  const adapter = new AwalX402Adapter(async () => SCRIPT_PATH_CANARY, launch);
  const result = await adapter.execute({
    url: X402_URL,
    amountAtomic: "1250000",
    correlationId: "a".repeat(64),
    requestDigest: "b".repeat(64),
  });
  assert.equal(result.disposition, "seller_result");
  assert.equal(JSON.stringify(result).includes("PROVIDER_STATUS_TEXT_CANARY"), false);
  assert.equal(JSON.stringify(result).includes("paymentMade"), false);
  assert.deepEqual(launches, [{
    executable: process.execPath,
    args: [
      SCRIPT_PATH_CANARY, "x402", "pay", X402_URL, "-X", "GET",
      "--max-amount", "1250000", "--scheme", "exact", "--correlation-id", "a".repeat(64), "--json",
    ],
    options: { shell: false, stdio: ["ignore", "pipe", "pipe"] },
  }]);
  assert.equal(JSON.stringify(launches).includes("-d"), false);
  if (result.disposition === "seller_result") {
    assert.equal(result.result.classification, "normalized_provider_json");
    assert.equal(result.result.canonical_json, "true");
  }
  assert.equal(JSON.stringify(result).includes(SCRIPT_PATH_CANARY), false, "resolved host script path must never leave the adapter");
  assert.throws(() => adapter.assertCompatibleIntent({ amountAtomic: "9007199254740992" }), /unsupported safe x402/u);
});

test("AWAL 2.12.1 source-shaped object seller result is normalized", async () => {
  const launch: AwalX402LaunchPort = () => {
    const child = new EventEmitter() as EventEmitter & {
      pid: number; stdout: EventEmitter; stderr: EventEmitter; kill(): boolean;
    };
    child.pid = 42;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => true;
    queueMicrotask(() => {
      child.emit("spawn");
      child.stdout.emit("data", Buffer.from(JSON.stringify({
        status: 200,
        statusText: "SOURCE_SHAPED_STATUS_TEXT_CANARY",
        data: { ok: true },
        paymentMade: true,
        amountPaid: 1_250_000,
      })));
      child.emit("close", 0);
    });
    return child;
  };
  const result = await new AwalX402Adapter(async () => "/exact/awal", launch).execute({
    url: X402_URL,
    amountAtomic: X402_REQUIREMENTS.amount,
    correlationId: "a".repeat(64),
    requestDigest: "b".repeat(64),
  });
  assert.equal(result.disposition, "seller_result");
  assert.equal(JSON.stringify(result).includes("SOURCE_SHAPED_STATUS_TEXT_CANARY"), false);
  assert.equal(JSON.stringify(result).includes("paymentMade"), false);
  if (result.disposition === "seller_result") {
    assert.equal(result.result.canonical_json, '{"ok":true}');
    assert.equal(result.result.byte_length, "11");
    assert.equal(result.result.sha256, sha256('{"ok":true}'));
  }
});

test("AWAL 2.12.1 source-proven envelope discards safe additive fields without accepting aliases or wrappers", async () => {
  const required = {
    status: 200,
    data: { ok: true },
    paymentMade: true,
    amountPaid: 1_250_000,
  };
  const additiveCanary = "SOURCE_PROVEN_ADDITIVE_CANARY";
  for (const value of [
    required,
    { ...required, statusText: "OK" },
    { ...required, statusText: "OK", providerMetadata: { note: additiveCanary } },
  ]) {
    const result = await executeAwalEnvelope(value);
    assert.equal(result.disposition, "seller_result");
    assert.equal(JSON.stringify(result).includes(additiveCanary), false);
    if (result.disposition === "seller_result") assert.equal(result.result.canonical_json, '{"ok":true}');
  }

  for (const value of [
    { result: required },
    { response: required },
    { ...required, result: { ok: false } },
    { ...required, response: { ok: false } },
    { ...required, amount_paid: 1_250_000 },
    { ...required, httpStatusCode: 402 },
    { ...required, paidAmount: 999 },
    { ...required, paymentstatus: "unpaid" },
    { ...required, paymentamount: 999 },
    { ...required, resultdata: { ok: false } },
    { ...required, sessionToken: "PROTECTED_OUTER_CANARY" },
    { ...required, providerMetadata: { sessionToken: "PROTECTED_NESTED_CANARY" } },
  ]) {
    const result = await executeAwalEnvelope(value);
    assert.equal(result.disposition, "ambiguous");
    assert.equal(JSON.stringify(result).includes("PROTECTED_OUTER_CANARY"), false);
    assert.equal(JSON.stringify(result).includes("PROTECTED_NESTED_CANARY"), false);
  }
});

test("AWAL x402 treats non-2xx, missing payment facts, amount mismatch and protected data as ambiguous", async () => {
  const protocolCases: readonly unknown[] = [
    { status: 402, statusText: "Payment Required", data: {}, paymentMade: true, amountPaid: 1_250_000 },
    { status: 200, statusText: "OK", data: {}, paymentMade: false, amountPaid: 1_250_000 },
    { status: 200, statusText: "OK", data: {}, paymentMade: true, amountPaid: 1_250_001 },
    { status: 200.5, statusText: "OK", data: {}, paymentMade: true, amountPaid: 1_250_000 },
    { status: 200, statusText: "OK", data: {}, amountPaid: 1_250_000 },
    { status: 200, statusText: 200, data: {}, paymentMade: true, amountPaid: 1_250_000 },
    { status: 200, statusText: "x".repeat(513), data: {}, paymentMade: true, amountPaid: 1_250_000 },
  ];
  const protectedValues: readonly unknown[] = [
    { neutral: "owner@example.com" },
    { neutral: "Bearer abcdefghijklmnopqrstuvwxyz" },
    { neutral: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJwcm90ZWN0ZWQifQ.signature12" },
    { neutral: "session=protected-session-value" },
    { neutral: "sid=protected-cookie; Path=/; HttpOnly=true" },
    { neutral: "/Users/tony/.config/wallet.key" },
    { neutral: "-----BEGIN PRIVATE KEY----- protected" },
    { neutral: "AbCdEfGhIjKlMnOpQrStUvWx1234" },
    ["safe", "owner@example.com"],
    "123456",
    "OTP: 123456",
    "one-time code 123456",
    { sessionToken: "PROTECTED_CANARY" },
  ];
  const cases = [
    ...protocolCases,
    ...protectedValues.map((data) => ({
      status: 200, statusText: "OK", data, paymentMade: true, amountPaid: 1_250_000,
    })),
  ];
  for (const value of cases) {
    const launch: AwalX402LaunchPort = () => {
      const child = new EventEmitter() as EventEmitter & { pid: number; stdout: EventEmitter; stderr: EventEmitter; kill(): boolean };
      child.pid = 42;
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = () => true;
      queueMicrotask(() => {
        child.emit("spawn");
        child.stdout.emit("data", Buffer.from(JSON.stringify(value)));
        child.emit("close", 0);
      });
      return child;
    };
    const result = await new AwalX402Adapter(async () => "/exact/awal", launch).execute({
      url: X402_URL,
      amountAtomic: X402_REQUIREMENTS.amount,
      correlationId: "a".repeat(64),
      requestDigest: "b".repeat(64),
    });
    assert.equal(result.disposition, "ambiguous");
    for (const protectedValue of [
      "owner@example.com", "Bearer", "eyJhbGci", "protected-session", "protected-cookie",
      "/Users/tony", "PRIVATE KEY", "AbCdEfGh", "123456", "OTP", "one-time code", "PROTECTED_CANARY",
    ]) assert.equal(JSON.stringify(result).includes(protectedValue), false);
  }
});

test("AWAL x402 zeroizes captured provider buffers on success and parser rejection", async () => {
  const execute = async (stdout: Buffer, stderr: Buffer) => {
    const launch: AwalX402LaunchPort = () => {
      const child = new EventEmitter() as EventEmitter & {
        pid: number; stdout: EventEmitter; stderr: EventEmitter; kill(): boolean;
      };
      child.pid = 42;
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = () => true;
      queueMicrotask(() => {
        child.emit("spawn");
        child.stdout.emit("data", stdout);
        child.stderr.emit("data", stderr);
        child.emit("close", 0);
      });
      return child;
    };
    return await new AwalX402Adapter(async () => "/exact/awal", launch).execute({
      url: X402_URL,
      amountAtomic: X402_REQUIREMENTS.amount,
      correlationId: "a".repeat(64),
      requestDigest: "b".repeat(64),
    });
  };

  const valid = Buffer.from(JSON.stringify({
    status: 200, statusText: "OK", data: { ok: true }, paymentMade: true, amountPaid: 1_250_000,
  }));
  const validStderr = Buffer.from("PROTECTED_STDERR_CANARY");
  assert.equal((await execute(valid, validStderr)).disposition, "seller_result");
  assert.equal(valid.every((byte) => byte === 0), true);
  assert.equal(validStderr.every((byte) => byte === 0), true);

  const invalid = Buffer.from('{"unsupported":true}');
  const invalidStderr = Buffer.from("PROTECTED_REJECTION_CANARY");
  assert.equal((await execute(invalid, invalidStderr)).disposition, "ambiguous");
  assert.equal(invalid.every((byte) => byte === 0), true);
  assert.equal(invalidStderr.every((byte) => byte === 0), true);
});

test("AWAL x402 zeroizes captured provider buffers on process, size and timeout exits", async (t) => {
  const executeExit = async (
    trigger: (child: EventEmitter & { stdout: EventEmitter; stderr: EventEmitter }, stdout: Buffer) => void,
    stdout = Buffer.from("PROTECTED_PROCESS_EXIT_CANARY"),
  ) => {
    let childRef: (EventEmitter & { stdout: EventEmitter; stderr: EventEmitter }) | undefined;
    const launch: AwalX402LaunchPort = () => {
      const child = new EventEmitter() as EventEmitter & {
        pid: number; stdout: EventEmitter; stderr: EventEmitter; kill(): boolean;
      };
      child.pid = 42;
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = () => true;
      childRef = child;
      return child;
    };
    const pending = new AwalX402Adapter(async () => "/exact/awal", launch).execute({
      url: X402_URL,
      amountAtomic: X402_REQUIREMENTS.amount,
      correlationId: "a".repeat(64),
      requestDigest: "b".repeat(64),
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.notEqual(childRef, undefined);
    trigger(childRef!, stdout);
    const result = await pending;
    assert.equal(stdout.every((byte) => byte === 0), true);
    return result;
  };

  assert.equal((await executeExit((child, stdout) => {
    child.emit("spawn");
    child.stdout.emit("data", stdout);
    child.emit("error", new Error("injected process loss"));
  })).disposition, "ambiguous");
  assert.equal((await executeExit((child, stdout) => {
    child.emit("spawn");
    child.stdout.emit("data", stdout);
    child.emit("close", 1);
  })).disposition, "ambiguous");

  const oversized = Buffer.alloc(256 * 1024 + 1, 65);
  assert.equal((await executeExit((child, stdout) => {
    child.emit("spawn");
    child.stdout.emit("data", stdout);
  }, oversized)).disposition, "ambiguous");

  t.mock.timers.enable({ apis: ["setTimeout"] });
  const timeoutBytes = Buffer.from("PROTECTED_TIMEOUT_CANARY");
  let timeoutChild: (EventEmitter & { stdout: EventEmitter; stderr: EventEmitter }) | undefined;
  const timeoutLaunch: AwalX402LaunchPort = () => {
    const child = new EventEmitter() as EventEmitter & {
      pid: number; stdout: EventEmitter; stderr: EventEmitter; kill(): boolean;
    };
    child.pid = 42;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => true;
    timeoutChild = child;
    return child;
  };
  const timed = new AwalX402Adapter(async () => "/exact/awal", timeoutLaunch).execute({
    url: X402_URL,
    amountAtomic: X402_REQUIREMENTS.amount,
    correlationId: "a".repeat(64),
    requestDigest: "b".repeat(64),
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.notEqual(timeoutChild, undefined);
  timeoutChild?.emit("spawn");
  timeoutChild?.stdout.emit("data", timeoutBytes);
  try {
    t.mock.timers.tick(AWAL_X402_PROCESS_TIMEOUT_MS);
    assert.equal((await timed).disposition, "ambiguous");
    assert.equal(timeoutBytes.every((byte) => byte === 0), true);
  } finally {
    t.mock.timers.reset();
  }

  const launchFailure = await new AwalX402Adapter(async () => "/exact/awal", () => {
    throw new Error("injected launch failure");
  }).execute({
    url: X402_URL,
    amountAtomic: X402_REQUIREMENTS.amount,
    correlationId: "a".repeat(64),
    requestDigest: "b".repeat(64),
  });
  assert.equal(launchFailure.disposition, "not_started");
});

test("durable validation downgrades injected protected seller values without persistence or replay", async (t) => {
  const canary = "owner@example.com";
  const canonical = canonicalJson({ neutral: canary });
  const effect = new FixtureX402();
  effect.result = {
    disposition: "seller_result",
    invocation: invocation(),
    result: {
      classification: "normalized_provider_json",
      http_status: "200",
      payment_made: true,
      amount_paid_atomic: X402_REQUIREMENTS.amount,
      canonical_json: canonical,
      byte_length: Buffer.byteLength(canonical).toString(),
      sha256: sha256(canonical),
    },
  };
  const fixture = await setup(t, { effect });
  const operationId = await prepare(fixture.core, "provider-protected-injected");
  const response = await fixture.core.execute({ command: "x402.fetch.approve", operationId });
  assert.equal(response.ok, false);
  const status = await fixture.core.execute({ command: "operation.status", operationId });
  assert.equal((status.operation as { state?: unknown }).state, "ambiguous_effect");
  assert.equal((status.operation as { reason?: unknown }).reason, "provider_result_invalid");
  const operationPath = join(fixture.temporary.root, "x402-operations", fixture.profile.profile_hash, `${operationId}.json`);
  for (const value of [await readFile(operationPath, "utf8"), JSON.stringify(response), JSON.stringify(status)]) {
    assert.equal(value.includes(canary), false);
  }
  await fixture.core.execute({ command: "operation.resume", operationId });
  assert.equal(effect.calls.length, 1);
});

test("protected seller values cannot cross CLI or MCP output surfaces", async (t) => {
  for (const surface of ["cli", "mcp"] as const) {
    await t.test(surface, async (sub) => {
      const canary = "one-time code 123456";
      const canonical = canonicalJson({ neutral: canary });
      const effect = new FixtureX402();
      effect.result = {
        disposition: "seller_result",
        invocation: invocation(),
        result: {
          classification: "normalized_provider_json", http_status: "200", payment_made: true,
          amount_paid_atomic: X402_REQUIREMENTS.amount, canonical_json: canonical,
          byte_length: Buffer.byteLength(canonical).toString(), sha256: sha256(canonical),
        },
      };
      const fixture = await setup(sub, { effect });
      const operationId = await prepare(fixture.core, `provider-protected-${surface}`);
      const options = {
        stateRoot: fixture.temporary.root,
        native: new TestNative(),
        profileRepository: new StateProfileRepository(fixture.state),
        providerRegistry: fixture.registry,
        policy: fixture.policy,
        rpc: fixture.rpc,
        http: fixture.http,
        clock: fixture.clock,
      };
      let output: OutputEnvelope;
      if (surface === "cli") {
        output = await runCli([
          "x402", "fetch", "approve", "--operation", operationId,
          "--rpc-url", "https://rpc.example/base?tenant=one",
        ], {}, options);
      } else {
        const server = createMcpServer(options);
        const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
        await server.connect(serverTransport);
        const client = new Client({ name: "provider-protected-test", version: "1.0.0" });
        await client.connect(clientTransport);
        try {
          const result = await client.callTool({
            name: "apn_x402_fetch_approve",
            arguments: { operation: operationId, rpc_url: "https://rpc.example/base?tenant=one" },
          });
          assert.equal(result.content[0]?.type, "text");
          output = result.structuredContent as unknown as OutputEnvelope;
          assert.equal(JSON.stringify(result.content).includes(canary), false);
        } finally {
          await client.close();
          await server.close();
        }
      }
      assert.equal(output.ok, false);
      assert.equal(JSON.stringify(output).includes(canary), false);
      const durable = await new ProviderX402Repository(fixture.temporary.root).findOperation(operationId);
      assert.equal(durable?.state, "ambiguous_effect");
      assert.equal(effect.calls.length, 1);
    });
  }
});

test("provider x402 joins normalized seller result with the sole exact fixed-window Base-USDC transfer", async (t) => {
  const fixture = await setup(t);
  const operationId = await prepare(fixture.core);
  assert.equal(fixture.effect.calls.length, 0);
  assert.equal(fixture.reads.balanceCalls, 1);
  const approved = await fixture.core.execute({ command: "x402.fetch.approve", operationId });
  assert.equal(approved.ok, true, JSON.stringify(approved));
  assert.equal((approved.operation as { state?: unknown }).state, "settlement_pending");
  assert.equal(fixture.effect.calls.length, 1);
  assert.equal(fixture.effect.calls[0]?.amountAtomic, X402_REQUIREMENTS.amount);
  assert.equal(fixture.http.calls.length, 2, "prepare plus exactly one final unpaid preflight");

  armExactSettlement(fixture);
  const resumed = await fixture.core.execute({ command: "operation.resume", operationId });
  assert.equal(resumed.ok, true, JSON.stringify(resumed));
  assert.equal((resumed.operation as { state?: unknown }).state, "completed");
  assert.deepEqual((resumed.data as { body?: unknown }).body, {
    forecast: { condition: "clear", temperatureC: 27.5 }, ok: true,
  });
  assert.equal(fixture.effect.calls.length, 1, "settlement observation must never replay AWAL pay");
  const receipt = await fixture.core.execute({ command: "receipt.get", operationId });
  assert.equal(receipt.ok, true, JSON.stringify(receipt));
  assert.equal((receipt.receipt as { terminalState?: unknown }).terminalState, "completed");
  assert.equal((receipt.receipt as { schemaVersion?: unknown }).schemaVersion, "apn.x402.public-receipt.v1");
  assert.equal((receipt.receipt as { variant?: unknown }).variant, "normalized_provider_json");
  validatePublicX402Receipt(receipt.receipt);
  assert.equal(JSON.stringify(receipt.receipt).includes("provider-x402"), false, "public receipt must use the common x402 schema family");
  assert.equal(JSON.stringify(receipt.receipt).toLowerCase().includes("mediatype"), false);
  assert.equal(JSON.stringify(resumed.data).toLowerCase().includes("mediatype"), false);
  assert.equal(JSON.stringify(receipt).includes("header"), false);
  assert.equal(JSON.stringify(receipt).includes("finalUrl"), false);

  const operationPath = join(fixture.temporary.root, "x402-operations", fixture.profile.profile_hash, `${operationId}.json`);
  const receiptPath = join(fixture.temporary.root, "x402-receipts", fixture.profile.profile_hash, `${operationId}.json`);
  const [storedOperation, storedReceipt] = await Promise.all([readFile(operationPath, "utf8"), readFile(receiptPath, "utf8")]);
  assert.equal(JSON.parse(storedOperation).schemaVersion, "apn.provider-x402.state.v1");
  assert.equal(JSON.parse(storedReceipt).schemaVersion, "apn.provider-x402.receipt.v1");
  for (const path of [
    join(fixture.temporary.root, "provider-x402-operations"),
    join(fixture.temporary.root, "provider-x402-receipts"),
  ]) await assert.rejects(access(path), (error: unknown) => hasCode(error, "ENOENT"));
  for (const output of [storedOperation, storedReceipt, JSON.stringify(approved), JSON.stringify(resumed), JSON.stringify(receipt)]) {
    assert.equal(output.includes(SCRIPT_PATH_CANARY), false, "host script path must not enter durable or public state");
  }

  const localCore = new ApnCore({
    state: fixture.state,
    native: new TestNative(),
    policy: new TestProfilePolicy(),
    rpc: new TestRpc(),
    http: new TestHttp(challengeObservation()),
    clock: new TestClock(),
  });
  const ensured = await localCore.execute({ command: "wallet.ensure", profile: "provider-one" });
  assert.equal(ensured.ok, true, JSON.stringify(ensured));
  const collision = await localCore.execute({
    command: "x402.fetch.prepare",
    profile: "provider-one",
    url: X402_URL,
    idempotencyKey: "provider-x402-001",
    maxAmountAtomic: "2000000",
  });
  assert.equal(collision.ok, false);
  assert.equal(collision.error?.code, "APN_IDEMPOTENCY_CONFLICT");
  assert.equal(await readFile(operationPath, "utf8"), storedOperation, "strategy collision must not overwrite provider state");
  const localPrepared = await localCore.execute({
    command: "x402.fetch.prepare",
    profile: "provider-one",
    url: X402_URL,
    idempotencyKey: "local-x402-mixed-001",
    maxAmountAtomic: "2000000",
  });
  assert.equal(localPrepared.ok, true, JSON.stringify(localPrepared));
  const localOperationId = (localPrepared.operation as { operationId?: unknown }).operationId;
  assert.equal(typeof localOperationId, "string");
  assert.deepEqual((await fixture.state.listX402Operations(fixture.profile.profile_hash)).map((item) => item.operationId), [localOperationId]);
  assert.deepEqual((await new ProviderX402Repository(fixture.temporary.root).listOperations(fixture.profile.profile_hash)).map((item) => item.operationId), [operationId]);
  assert.deepEqual(await fixture.state.listX402Receipts(fixture.profile.profile_hash), [], "local receipt reader must skip provider receipt schema");
});

test("Coinbase-only sole-offer and final-preflight mismatch gates create zero child effects", async (t) => {
  const multiple = {
    ...X402_PAYMENT_REQUIRED,
    accepts: [X402_REQUIREMENTS, { ...X402_REQUIREMENTS, amount: "1250001" }],
  };
  const multiHttp = new TestHttp(challengeObservation({ header: canonicalPaymentRequiredHeader(multiple) }));
  const multi = await setup(t, { http: multiHttp });
  const rejected = await multi.core.execute({
    command: "x402.fetch.prepare",
    profile: "provider-one",
    url: X402_URL,
    idempotencyKey: "provider-multiple",
    maxAmountAtomic: "2000000",
  });
  assert.equal(rejected.ok, false);
  assert.equal(multi.effect.calls.length, 0);
  assert.equal(multi.reads.balanceCalls, 0, "offer selection must precede provider access");
  assert.deepEqual(await new ProviderX402Repository(multi.temporary.root).listOperations(multi.profile.profile_hash), []);

  const mismatch = await setup(t);
  const operationId = await prepare(mismatch.core, "provider-preflight");
  mismatch.http.response = challengeObservation({
    header: canonicalPaymentRequiredHeader({
      ...X402_PAYMENT_REQUIRED,
      accepts: [{ ...X402_REQUIREMENTS, amount: "1250001" }],
    }),
  });
  const failed = await mismatch.core.execute({ command: "x402.fetch.approve", operationId });
  assert.equal(failed.ok, false);
  assert.equal(mismatch.effect.calls.length, 0);
  const status = await mismatch.core.execute({ command: "operation.status", operationId });
  assert.equal((status.operation as { state?: unknown }).state, "failed_before_effect");
});

test("provider x402 rechecks the exact existing policy, caller-lowered cap, profile and fresh balance before effect", async (t) => {
  await t.test("missing policy", async (sub) => {
    const missing: ProfilePolicyPort = { load: async () => null, set: async () => { throw new Error("unused"); } };
    const fixture = await setup(sub, { policy: missing });
    const response = await fixture.core.execute({
      command: "x402.fetch.prepare",
      profile: "provider-one",
      url: X402_URL,
      idempotencyKey: "provider-no-policy",
    });
    assert.equal(response.ok, false);
    assert.equal(response.error?.code, "APN_WALLET_POLICY_REQUIRED");
    assert.equal(fixture.effect.calls.length, 0);
  });

  await t.test("caller cap escalation", async (sub) => {
    const fixture = await setup(sub);
    const response = await fixture.core.execute({
      command: "x402.fetch.prepare",
      profile: "provider-one",
      url: X402_URL,
      idempotencyKey: "provider-cap-escalation",
      maxAmountAtomic: "10000001",
    });
    assert.equal(response.ok, false);
    assert.equal(response.error?.code, "APN_X402_PROFILE_LIMIT_EXCEEDED");
    assert.equal(fixture.reads.balanceCalls, 0);
  });

  await t.test("policy drift and insufficient fresh balance", async (sub) => {
    const fixture = await setup(sub);
    const operationId = await prepare(fixture.core, "provider-policy-drift");
    await fixture.policy.set(policyBinding(fixture.profile), {
      maxBalanceUsdcAtomic: "100000000",
      maxX402AmountAtomic: "1500000",
    });
    fixture.reads.raw = "1";
    const response = await fixture.core.execute({ command: "x402.fetch.approve", operationId });
    assert.equal(response.ok, false);
    assert.equal(fixture.effect.calls.length, 0);
    const status = await fixture.core.execute({ command: "operation.status", operationId });
    assert.equal((status.operation as { state?: unknown }).state, "failed_before_effect");
  });

  await t.test("profile revision drift", async (sub) => {
    const fixture = await setup(sub);
    const operationId = await prepare(fixture.core, "provider-profile-drift");
    await new StateProfileRepository(fixture.state).save({ ...fixture.profile, revision: fixture.profile.revision + 1 });
    const response = await fixture.core.execute({ command: "x402.fetch.approve", operationId });
    assert.equal(response.ok, false);
    assert.equal(fixture.effect.calls.length, 0);
  });

  await t.test("stale balance observation", async (sub) => {
    const fixture = await setup(sub);
    const operationId = await prepare(fixture.core, "provider-stale-balance");
    fixture.reads.observedAt = "2026-08-29T23:59:59.999Z";
    const response = await fixture.core.execute({ command: "x402.fetch.approve", operationId });
    assert.equal(response.ok, false);
    assert.equal(fixture.effect.calls.length, 0);
  });
});

test("full-material staged operation is durable before provider/RPC reads and exact prepare replay is observation-free", async (t) => {
  const fixture = await setup(t);
  fixture.reads.failBalance = true;
  const key = "provider-stage-balance-crash";
  const operationId = await prepare(fixture.core, key);
  const path = join(fixture.temporary.root, "x402-operations", fixture.profile.profile_hash, `${operationId}.json`);
  const stagedText = await readFile(path, "utf8");
  const staged = JSON.parse(stagedText) as ProviderX402OperationRecord;
  assert.equal(staged.state, "preparing");
  assert.equal(staged.request.canonicalUrl, X402_URL);
  assert.equal(staged.requirement.payee, X402_PAYEE.toLowerCase());
  assert.equal(staged.requirement.amountAtomic, X402_REQUIREMENTS.amount);
  assert.equal(staged.provider.payer, PAYER);
  assert.equal(staged.policy.effectiveCapAtomic, "2000000");
  assert.equal(staged.preparedBalance, undefined);
  assert.equal(fixture.http.calls.length, 1);
  assert.equal(fixture.reads.balanceCalls, 1);
  assert.equal(fixture.rpc.chainCalls, 0);

  const status = await restartedCore(fixture).execute({ command: "operation.status", operationId });
  assert.equal((status.operation as { state?: unknown }).state, "preparing");
  const exactReplay = await prepare(fixture.core, key);
  assert.equal(exactReplay, operationId);
  assert.equal(fixture.http.calls.length, 1, "exact prepare replay must not re-read the seller");
  assert.equal(fixture.reads.balanceCalls, 1, "exact prepare replay must not re-read the provider");
  assert.equal(fixture.rpc.chainCalls, 0);

  const conflict = await fixture.core.execute({
    command: "x402.fetch.prepare", profile: fixture.profile.profile, url: X402_URL,
    idempotencyKey: key, maxAmountAtomic: "1999999",
  });
  assert.equal(conflict.error?.code, "APN_IDEMPOTENCY_CONFLICT");
  assert.equal(fixture.http.calls.length, 1);
  assert.equal(fixture.reads.balanceCalls, 1);

  const localRpc = new TestRpc();
  const localHttp = new TestHttp(challengeObservation());
  const localCore = new ApnCore({
    state: fixture.state, native: new TestNative(), policy: new TestProfilePolicy(),
    rpc: localRpc, http: localHttp, clock: new TestClock(),
  });
  await localCore.execute({ command: "wallet.ensure", profile: fixture.profile.profile });
  const localCollision = await localCore.execute({
    command: "x402.fetch.prepare", profile: fixture.profile.profile, url: X402_URL,
    idempotencyKey: key, maxAmountAtomic: "2000000",
  });
  const directCollision = await localCore.execute({
    command: "transfer.prepare", profile: fixture.profile.profile, idempotencyKey: key,
    recipient: X402_PAYEE, amount: "1",
  });
  assert.equal(localCollision.error?.code, "APN_IDEMPOTENCY_CONFLICT");
  assert.equal(directCollision.error?.code, "APN_IDEMPOTENCY_CONFLICT");
  assert.equal(localHttp.calls.length, 0);
  assert.equal(localRpc.balanceCalls, 0);
  assert.equal(await readFile(path, "utf8"), stagedText, "cross-strategy collisions must not overwrite staged state");

  fixture.reads.failBalance = false;
  const resumed = await fixture.core.execute({ command: "operation.resume", operationId });
  assert.equal(resumed.ok, true, JSON.stringify(resumed));
  assert.equal((resumed.operation as { state?: unknown }).state, "awaiting_approval");
  assert.equal(fixture.reads.balanceCalls, 2);
  assert.equal(fixture.rpc.chainCalls, 1);
});

test("staged preparation crash boundaries are addressable and only explicit resume repeats incomplete observations", async (t) => {
  await t.test("seller read and initial stage write", async (sub) => {
    const sellerFailure = await setup(sub, { http: new FailOnceHttp(challengeObservation()) });
    const seller = await sellerFailure.core.execute({
      command: "x402.fetch.prepare", profile: "provider-one", url: X402_URL,
      idempotencyKey: "provider-stage-seller-failure", maxAmountAtomic: "2000000",
    });
    assert.equal(seller.ok, false);
    assert.equal(sellerFailure.reads.balanceCalls, 0);
    assert.equal(sellerFailure.rpc.chainCalls, 0);
    assert.deepEqual(await new ProviderX402Repository(sellerFailure.temporary.root).listOperations(sellerFailure.profile.profile_hash), []);

    const stageFailure = await setup(sub, { failPreparingWriteAt: 1 });
    const stage = await stageFailure.core.execute({
      command: "x402.fetch.prepare", profile: "provider-one", url: X402_URL,
      idempotencyKey: "provider-stage-write-failure", maxAmountAtomic: "2000000",
    });
    assert.equal(stage.ok, false);
    assert.equal(stageFailure.http.calls.length, 1);
    assert.equal(stageFailure.reads.balanceCalls, 0);
    assert.equal(stageFailure.rpc.chainCalls, 0);
  });

  await t.test("balance persistence", async (sub) => {
    const fixture = await setup(sub, { failPreparingWriteAt: 2 });
    const operationId = await prepare(fixture.core, "provider-stage-balance-persist");
    assert.equal(fixture.reads.balanceCalls, 1);
    assert.equal(fixture.rpc.chainCalls, 0);
    assert.equal((await new ProviderX402Repository(fixture.temporary.root).findOperation(operationId))?.preparedBalance, undefined);
    await prepare(fixture.core, "provider-stage-balance-persist");
    assert.equal(fixture.reads.balanceCalls, 1, "prepare replay must not repeat failed observation");
    const resumed = await fixture.core.execute({ command: "operation.resume", operationId });
    assert.equal((resumed.operation as { state?: unknown }).state, "awaiting_approval");
    assert.equal(fixture.reads.balanceCalls, 2);
    assert.equal(fixture.rpc.chainCalls, 1);
  });

  await t.test("Base identity and awaiting persistence", async (sub) => {
    const rpcFailure = await setup(sub);
    rpcFailure.rpc.failChain = true;
    const rpcOperation = await prepare(rpcFailure.core, "provider-stage-rpc-failure");
    const rpcStaged = await new ProviderX402Repository(rpcFailure.temporary.root).findOperation(rpcOperation);
    assert.notEqual(rpcStaged?.preparedBalance, undefined);
    assert.equal(rpcFailure.reads.balanceCalls, 1);
    assert.equal(rpcFailure.rpc.chainCalls, 1);
    await prepare(rpcFailure.core, "provider-stage-rpc-failure");
    assert.equal(rpcFailure.rpc.chainCalls, 1);
    rpcFailure.rpc.failChain = false;
    await rpcFailure.core.execute({ command: "operation.resume", operationId: rpcOperation });
    assert.equal(rpcFailure.reads.balanceCalls, 1);
    assert.equal(rpcFailure.rpc.chainCalls, 2);

    const storeFailure = await setup(sub, { failAwaitingStore: true });
    const storeOperation = await prepare(storeFailure.core, "provider-stage-awaiting-persist");
    assert.equal((await new ProviderX402Repository(storeFailure.temporary.root).findOperation(storeOperation))?.state, "preparing");
    assert.equal(storeFailure.reads.balanceCalls, 1);
    assert.equal(storeFailure.rpc.chainCalls, 1);
    await prepare(storeFailure.core, "provider-stage-awaiting-persist");
    assert.equal(storeFailure.rpc.chainCalls, 1);
    const resumed = await storeFailure.core.execute({ command: "operation.resume", operationId: storeOperation });
    assert.equal((resumed.operation as { state?: unknown }).state, "awaiting_approval");
    assert.equal(storeFailure.reads.balanceCalls, 1);
    assert.equal(storeFailure.rpc.chainCalls, 2);
  });
});

test("full normalized RPC URL is frozen for approve and every settlement observation", async (t) => {
  await t.test("approve path/query drift", async (sub) => {
    const fixture = await setup(sub);
    const operationId = await prepare(fixture.core, "provider-rpc-approve-drift");
    const drifted = restartedCore(fixture, "https://rpc.example/other?tenant=two");
    const response = await drifted.execute({ command: "x402.fetch.approve", operationId });
    assert.equal(response.ok, false);
    assert.equal(response.error?.code, "APN_REPREPARE_REQUIRED");
    assert.equal(fixture.effect.calls.length, 0);
  });

  await t.test("resume path/query drift", async (sub) => {
    const fixture = await setup(sub);
    const operationId = await prepare(fixture.core, "provider-rpc-resume-drift");
    await fixture.core.execute({ command: "x402.fetch.approve", operationId });
    armExactSettlement(fixture);
    const transferCalls = fixture.rpc.transferCalls;
    const drifted = restartedCore(fixture, "https://rpc.example/other?tenant=two");
    const response = await drifted.execute({ command: "operation.resume", operationId });
    assert.equal(response.ok, false);
    assert.equal(response.error?.code, "APN_RPC_CONFIG");
    assert.equal(fixture.rpc.transferCalls, transferCalls);
    assert.equal(fixture.effect.calls.length, 1);
  });
});

test("fresh status and receipt recover an orphan terminal receipt under common locks without replay", async (t) => {
  const fixture = await setup(t, { failCompletedStore: true });
  const operationId = await prepare(fixture.core, "provider-orphan-receipt");
  await fixture.core.execute({ command: "x402.fetch.approve", operationId });
  armExactSettlement(fixture);
  const interrupted = await fixture.core.execute({ command: "operation.resume", operationId });
  assert.equal(interrupted.ok, false);
  const before = await new ProviderX402Repository(fixture.temporary.root).findOperation(operationId);
  assert.equal(before?.terminal, false);
  assert.notEqual(await new ProviderX402Repository(fixture.temporary.root).loadReceipt(fixture.profile.profile_hash, operationId), null);
  fixture.clock.advance(1_000);

  const fresh = restartedCore(fixture);
  const status = await fresh.execute({ command: "operation.status", operationId });
  assert.equal(status.ok, true, JSON.stringify(status));
  assert.equal((status.operation as { state?: unknown }).state, "completed");
  assert.equal(status.receipt, null, "status does not expose the terminal receipt");
  const receipt = await fresh.execute({ command: "receipt.get", operationId });
  assert.equal(receipt.ok, true, JSON.stringify(receipt));
  assert.equal((receipt.receipt as { terminalState?: unknown }).terminalState, "completed");
  assert.equal((receipt.receipt as { schemaVersion?: unknown }).schemaVersion, "apn.x402.public-receipt.v1");
  assert.equal(fixture.effect.calls.length, 1);
});

test("provider settlement wait uses the common projection and a single total wall-clock budget", async (t) => {
  const fixture = await setup(t);
  const operationId = await prepare(fixture.core, "provider-bounded-wait");
  await fixture.core.execute({ command: "x402.fetch.approve", operationId });
  armExactSettlement(fixture);
  fixture.rpc.slowBounded = true;
  const started = performance.now();
  const response = await fixture.core.execute({ command: "operation.resume", operationId, waitSeconds: 1 });
  const elapsed = performance.now() - started;
  assert.equal(response.ok, true, JSON.stringify(response));
  assert.ok(elapsed < 1_500, `bounded resume exceeded caller window: ${elapsed}ms`);
  assert.deepEqual((response.operation as { settlementWait?: unknown }).settlementWait, {
    outcome: "timeout", requestedSeconds: "1", observationCount: "0",
  });
  assert.equal((response.operation as { reason?: unknown }).reason, "x402_settlement_wait_timeout");
  assert.equal((response.operation as { proofClass?: unknown }).proofClass, "x402_unknown_finality");
  assert.ok((fixture.rpc.boundedTimeouts[0] ?? Infinity) <= 1_000);
  assert.equal(fixture.effect.calls.length, 1);
});

test("one-second settlement wait includes common lock acquisition and returns local-parity timeout projection", async (t) => {
  const fixture = await setup(t);
  const operationId = await prepare(fixture.core, "provider-held-lock-wait");
  await fixture.core.execute({ command: "x402.fetch.approve", operationId });
  let releaseLock: (() => void) | undefined;
  let markHeld: (() => void) | undefined;
  const held = new Promise<void>((resolve) => { markHeld = resolve; });
  const release = new Promise<void>((resolve) => { releaseLock = resolve; });
  const holder = fixture.state.withLocks([
    `profile:${fixture.profile.profile_hash}`,
    `operation:${operationId}`,
    `operation:evidence:${operationId}`,
  ], async () => { markHeld?.(); await release; });
  await held;
  const started = performance.now();
  let response;
  try {
    response = await fixture.core.execute({ command: "operation.resume", operationId, waitSeconds: 1 });
  } finally {
    releaseLock?.();
    await holder;
  }
  const elapsed = performance.now() - started;
  assert.equal(response.ok, true, JSON.stringify(response));
  assert.ok(elapsed < 1_500, `lock-bound resume exceeded caller window: ${elapsed}ms`);
  assert.deepEqual({
    reason: (response.operation as { reason?: unknown }).reason,
    proofClass: (response.operation as { proofClass?: unknown }).proofClass,
    settlementWait: (response.operation as { settlementWait?: unknown }).settlementWait,
  }, {
    reason: "x402_settlement_wait_timeout",
    proofClass: "x402_unknown_finality",
    settlementWait: { outcome: "timeout", requestedSeconds: "1", observationCount: "0" },
  });
  assert.equal(response.error, null, "lock budget exhaustion must not surface APN_STATE_BUSY");
  assert.equal(fixture.effect.calls.length, 1);
});

test("recomputed settlement and receipt tampering cannot cross the authoritative join", async (t) => {
  const fixture = await setup(t);
  const operationId = await prepare(fixture.core, "provider-integrity-tamper");
  await fixture.core.execute({ command: "x402.fetch.approve", operationId });
  armExactSettlement(fixture);
  const completed = await fixture.core.execute({ command: "operation.resume", operationId });
  assert.equal((completed.operation as { state?: unknown }).state, "completed");
  const operationPath = join(fixture.temporary.root, "x402-operations", fixture.profile.profile_hash, `${operationId}.json`);
  const receiptPath = join(fixture.temporary.root, "x402-receipts", fixture.profile.profile_hash, `${operationId}.json`);
  const originalOperationText = await readFile(operationPath, "utf8");
  const originalReceiptText = await readFile(receiptPath, "utf8");
  const originalOperation = JSON.parse(originalOperationText) as ProviderX402OperationRecord;
  assert.notEqual(originalOperation.settlementEvidence, undefined);
  const evidence = originalOperation.settlementEvidence as ProviderX402RangeSettlementEvidence;
  const wrongHash = `0x${"e".repeat(64)}` as Hex;
  const mutations: readonly ((value: ProviderX402RangeSettlementEvidence) => ProviderX402RangeSettlementEvidence)[] = [
    (value) => ({ ...value, transactionHash: wrongHash }),
    (value) => ({ ...value, transfer: { ...value.transfer, transactionHash: wrongHash } }),
    (value) => ({ ...value, transfer: { ...value.transfer, address: PAYER } }),
    (value) => ({ ...value, transfer: {
      ...value.transfer,
      topics: [value.transfer.topics[0] as Hex, `0x${"4".repeat(64)}` as Hex, value.transfer.topics[2] as Hex],
    } }),
    (value) => ({ ...value, transfer: { ...value.transfer, data: `0x${"0".repeat(64)}` as Hex } }),
    (value) => ({ ...value, transfer: { ...value.transfer, blockNumber: "999" } }),
    (value) => ({ ...value, lowerBlock: { ...value.lowerBlock, hash: wrongHash } }),
    (value) => ({ ...value, upperBlock: { ...value.upperBlock, hash: wrongHash } }),
  ];
  for (const mutate of mutations) {
    const changed = mutate(evidence);
    const { evidenceHash: _evidenceHash, ...evidenceBase } = changed;
    const sealedEvidence = { ...evidenceBase, evidenceHash: hashObject(evidenceBase) };
    const { integrityHash: _integrityHash, ...operationBase } = originalOperation;
    const changedOperation = { ...operationBase, settlementEvidence: sealedEvidence };
    await writeFile(operationPath, canonicalJson({
      ...changedOperation,
      integrityHash: hashObject(changedOperation),
    }), { mode: 0o600 });
    await assert.rejects(
      new ProviderX402Repository(fixture.temporary.root).findOperation(operationId),
      (error: unknown) => hasCode(error, "APN_STATE_CORRUPT"),
    );
    await writeFile(operationPath, originalOperationText, { mode: 0o600 });
  }

  const originalReceipt = JSON.parse(originalReceiptText) as ProviderX402ReceiptRecord;
  assert.notEqual(originalReceipt.result, undefined);
  const { integrityHash: _receiptIntegrity, ...receiptBase } = originalReceipt;
  const changedReceipt = {
    ...receiptBase,
    result: { ...(originalReceipt.result as NonNullable<ProviderX402ReceiptRecord["result"]>), sha256: "f".repeat(64) },
  };
  await writeFile(receiptPath, canonicalJson({
    ...changedReceipt,
    integrityHash: hashObject(changedReceipt),
  }), { mode: 0o600 });
  await assert.rejects(
    new ProviderX402Repository(fixture.temporary.root).loadReceipt(fixture.profile.profile_hash, operationId),
    (error: unknown) => hasCode(error, "APN_STATE_CORRUPT"),
  );
  await writeFile(receiptPath, originalReceiptText, { mode: 0o600 });
});

test("transient receipt observation retries the identical frozen interval after restart and terminalizes without replay", async (t) => {
  const effect = new FixtureX402();
  effect.result = { disposition: "ambiguous", reason: "provider_result_invalid", invocation: invocation() };
  const fixture = await setup(t, { effect });
  const operationId = await prepare(fixture.core, "provider-frozen-range-retry");
  await fixture.core.execute({ command: "x402.fetch.approve", operationId });
  const transfer = exactTransfer(1010n);
  fixture.rpc.transferLogs = [transfer];
  fixture.clock.advance(240_000);
  fixture.rpc.safeNumber = 1021n;

  const first = await fixture.core.execute({ command: "operation.resume", operationId });
  assert.equal((first.operation as { state?: unknown }).state, "ambiguous_effect");
  assert.equal((first.operation as { reason?: unknown }).reason, "settlement_receipt_missing");
  const frozen = await new ProviderX402Repository(fixture.temporary.root).findOperation(operationId);
  assert.equal(frozen?.immutableUpperBlock?.number, "1021");
  assert.deepEqual(fixture.rpc.transferRanges.map(({ fromBlock, toBlock }) => ({ fromBlock, toBlock })), [
    { fromBlock: "1000", toBlock: "1021" },
  ]);

  fixture.rpc.x402Receipt = {
    transactionHash: TRANSACTION,
    status: "success",
    blockNumber: transfer.blockNumber,
    blockHash: transfer.blockHash,
    logs: [transfer],
    observedAt: fixture.clock.now().toISOString(),
    rpcOrigin: fixture.rpc.rpcOrigin,
  };
  fixture.clock.advance(120_000);
  fixture.rpc.safeNumber = 1031n;
  const restarted = restartedCore(fixture);
  const recovered = await restarted.execute({ command: "operation.resume", operationId });
  assert.equal((recovered.operation as { state?: unknown }).state, "failed_settled_without_result");
  assert.equal((recovered.operation as { terminal?: unknown }).terminal, true);
  assert.equal(recovered.data, null);
  assert.deepEqual(fixture.rpc.transferRanges.map(({ fromBlock, toBlock }) => ({ fromBlock, toBlock })), [
    { fromBlock: "1000", toBlock: "1021" },
    { fromBlock: "1000", toBlock: "1021" },
  ]);
  assert.equal(effect.calls.length, 1);
  const receipt = await restarted.execute({ command: "receipt.get", operationId });
  assert.equal((receipt.receipt as { terminalState?: unknown }).terminalState, "failed_settled_without_result");
  const receiptText = canonicalJson(receipt.receipt);
  await restarted.execute({ command: "operation.resume", operationId });
  assert.equal(canonicalJson((await restarted.execute({ command: "receipt.get", operationId })).receipt), receiptText);
  assert.equal(fixture.rpc.transferRanges.length, 2);
  assert.equal(effect.calls.length, 1);
});

test("transient receipt observation joins an existing seller result after restart without provider replay", async (t) => {
  const fixture = await setup(t);
  const operationId = await prepare(fixture.core, "provider-frozen-range-result-retry");
  await fixture.core.execute({ command: "x402.fetch.approve", operationId });
  const transfer = exactTransfer(1010n);
  fixture.rpc.transferLogs = [transfer];
  fixture.clock.advance(240_000);
  fixture.rpc.safeNumber = 1021n;

  const first = await fixture.core.execute({ command: "operation.resume", operationId });
  assert.equal((first.operation as { state?: unknown }).state, "ambiguous_effect");
  assert.equal((first.operation as { reason?: unknown }).reason, "settlement_receipt_missing");
  fixture.rpc.x402Receipt = {
    transactionHash: TRANSACTION,
    status: "success",
    blockNumber: transfer.blockNumber,
    blockHash: transfer.blockHash,
    logs: [transfer],
    observedAt: fixture.clock.now().toISOString(),
    rpcOrigin: fixture.rpc.rpcOrigin,
  };
  fixture.clock.advance(120_000);
  fixture.rpc.safeNumber = 1031n;

  const restarted = restartedCore(fixture);
  const recovered = await restarted.execute({ command: "operation.resume", operationId });
  assert.equal(recovered.ok, true, JSON.stringify(recovered));
  assert.equal((recovered.operation as { state?: unknown }).state, "completed");
  assert.equal((recovered.operation as { terminal?: unknown }).terminal, true);
  assert.deepEqual(fixture.rpc.transferRanges.map(({ fromBlock, toBlock }) => ({ fromBlock, toBlock })), [
    { fromBlock: "1000", toBlock: "1021" },
    { fromBlock: "1000", toBlock: "1021" },
  ]);
  assert.equal(fixture.effect.calls.length, 1);
  const receipt = await restarted.execute({ command: "receipt.get", operationId });
  assert.equal((receipt.receipt as { terminalState?: unknown }).terminalState, "completed");
});

test("contradictory frozen-range observation is durable and cannot be erased by a later RPC response", async (t) => {
  const effect = new FixtureX402();
  effect.result = { disposition: "ambiguous", reason: "provider_result_invalid", invocation: invocation() };
  const fixture = await setup(t, { effect });
  const operationId = await prepare(fixture.core, "provider-frozen-range-contradiction");
  await fixture.core.execute({ command: "x402.fetch.approve", operationId });
  const transfer = exactTransfer(1010n);
  fixture.rpc.transferLogs = [transfer, { ...transfer, logIndex: "2" }];
  fixture.clock.advance(240_000);
  fixture.rpc.safeNumber = 1021n;

  const first = await fixture.core.execute({ command: "operation.resume", operationId });
  assert.equal((first.operation as { state?: unknown }).state, "ambiguous_effect");
  assert.equal((first.operation as { reason?: unknown }).reason, "settlement_not_unique");
  const frozen = await new ProviderX402Repository(fixture.temporary.root).findOperation(operationId);
  assert.equal(frozen?.immutableUpperBlock?.number, "1021");
  assert.deepEqual(fixture.rpc.transferRanges.map(({ fromBlock, toBlock }) => ({ fromBlock, toBlock })), [
    { fromBlock: "1000", toBlock: "1021" },
  ]);

  fixture.rpc.transferLogs = [transfer];
  fixture.rpc.x402Receipt = {
    transactionHash: TRANSACTION,
    status: "success",
    blockNumber: transfer.blockNumber,
    blockHash: transfer.blockHash,
    logs: [transfer],
    observedAt: fixture.clock.now().toISOString(),
    rpcOrigin: fixture.rpc.rpcOrigin,
  };
  fixture.clock.advance(120_000);
  fixture.rpc.safeNumber = 1031n;
  const restarted = restartedCore(fixture);
  const retried = await restarted.execute({ command: "operation.resume", operationId });
  assert.equal((retried.operation as { state?: unknown }).state, "ambiguous_effect");
  assert.equal((retried.operation as { reason?: unknown }).reason, "settlement_not_unique");
  assert.deepEqual(fixture.rpc.transferRanges.map(({ fromBlock, toBlock }) => ({ fromBlock, toBlock })), [
    { fromBlock: "1000", toBlock: "1021" },
  ]);
  assert.equal(effect.calls.length, 1);
  const receipt = await restarted.execute({ command: "receipt.get", operationId });
  assert.equal(receipt.ok, false);
  assert.equal((receipt.error as { code?: unknown }).code, "APN_RECEIPT_NOT_FOUND");
});

test("repeated pre-range transient failures preserve the frozen upper bound without transition growth", async (t) => {
  const effect = new FixtureX402();
  effect.result = { disposition: "ambiguous", reason: "provider_result_invalid", invocation: invocation() };
  const fixture = await setup(t, { effect });
  const operationId = await prepare(fixture.core, "provider-frozen-range-prequery-transient");
  await fixture.core.execute({ command: "x402.fetch.approve", operationId });
  const transfer = exactTransfer(1010n);
  fixture.rpc.transferLogs = [transfer];
  fixture.clock.advance(240_000);
  fixture.rpc.safeNumber = 1021n;
  const first = await fixture.core.execute({ command: "operation.resume", operationId });
  assert.equal((first.operation as { reason?: unknown }).reason, "settlement_receipt_missing");

  fixture.rpc.failChain = true;
  const transient = await fixture.core.execute({ command: "operation.resume", operationId });
  assert.equal((transient.operation as { reason?: unknown }).reason, "provider_evidence_capability_gap");
  const afterTransient = await new ProviderX402Repository(fixture.temporary.root).findOperation(operationId);
  assert.equal(afterTransient?.immutableUpperBlock?.number, "1021");
  const transitionCount = afterTransient?.transitions.length;
  const repeated = await fixture.core.execute({ command: "operation.resume", operationId });
  assert.equal((repeated.operation as { reason?: unknown }).reason, "provider_evidence_capability_gap");
  const afterRepeated = await new ProviderX402Repository(fixture.temporary.root).findOperation(operationId);
  assert.equal(afterRepeated?.transitions.length, transitionCount);
  assert.equal(afterRepeated?.immutableUpperBlock?.number, "1021");
  assert.deepEqual(fixture.rpc.transferRanges.map(({ fromBlock, toBlock }) => ({ fromBlock, toBlock })), [
    { fromBlock: "1000", toBlock: "1021" },
  ]);

  fixture.rpc.failChain = false;
  fixture.rpc.x402Receipt = {
    transactionHash: TRANSACTION,
    status: "success",
    blockNumber: transfer.blockNumber,
    blockHash: transfer.blockHash,
    logs: [transfer],
    observedAt: fixture.clock.now().toISOString(),
    rpcOrigin: fixture.rpc.rpcOrigin,
  };
  const recovered = await fixture.core.execute({ command: "operation.resume", operationId });
  assert.equal((recovered.operation as { state?: unknown }).state, "failed_settled_without_result");
  assert.equal(effect.calls.length, 1);
  assert.deepEqual(fixture.rpc.transferRanges.map(({ fromBlock, toBlock }) => ({ fromBlock, toBlock })), [
    { fromBlock: "1000", toBlock: "1021" },
    { fromBlock: "1000", toBlock: "1021" },
  ]);
});

test("fixed-window settlement rejects zero, multiple, another, reverted and unavailable outgoing evidence", async (t) => {
  const cases = ["zero", "multiple", "another", "reverted", "unavailable"] as const;
  for (const classification of cases) {
    await t.test(classification, async (sub) => {
      const fixture = await setup(sub);
      const operationId = await prepare(fixture.core, `provider-settlement-${classification}`);
      await fixture.core.execute({ command: "x402.fetch.approve", operationId });
      const exact = exactTransfer(1010n);
      fixture.rpc.transferLogs = classification === "zero" ? []
        : classification === "multiple" ? [exact, { ...exact, logIndex: "2" }]
          : classification === "another" ? [{
              ...exact,
              topics: [exact.topics[0] as Hex, exact.topics[1] as Hex, `0x${"3".repeat(40).padStart(64, "0")}` as Hex],
            }]
            : [exact];
      if (classification === "unavailable") fixture.rpc.transferOutcome = { kind: "range_unavailable" };
      fixture.rpc.x402Receipt = {
        transactionHash: TRANSACTION,
        status: classification === "reverted" ? "reverted" : "success",
        blockNumber: exact.blockNumber,
        blockHash: exact.blockHash,
        logs: [exact],
        observedAt: fixture.clock.now().toISOString(),
        rpcOrigin: fixture.rpc.rpcOrigin,
      };
      fixture.clock.advance(240_000);
      fixture.rpc.safeNumber = 1021n;
      const response = await fixture.core.execute({ command: "operation.resume", operationId });
      assert.equal(response.ok, true, JSON.stringify(response));
      assert.equal((response.operation as { state?: unknown }).state, "ambiguous_effect");
      assert.equal(fixture.effect.calls.length, 1);
      const first = await new ProviderX402Repository(fixture.temporary.root).findOperation(operationId);
      assert.equal(first?.immutableUpperBlock?.number, "1021");
      fixture.clock.advance(120_000);
      fixture.rpc.safeNumber = 1031n;
      await fixture.core.execute({ command: "operation.resume", operationId });
      const second = await new ProviderX402Repository(fixture.temporary.root).findOperation(operationId);
      assert.equal(second?.immutableUpperBlock?.number, "1021", "recovery must never extend the evidence window");
      assert.equal(fixture.effect.calls.length, 1);
    });
  }
});

test("frozen settlement lower-block mismatch is durable ambiguity and can never complete", async (t) => {
  const fixture = await setup(t);
  const operationId = await prepare(fixture.core, "provider-lower-block-mismatch");
  await fixture.core.execute({ command: "x402.fetch.approve", operationId });
  const exact = exactTransfer(1010n);
  fixture.rpc.transferLogs = [exact];
  fixture.rpc.x402Receipt = {
    transactionHash: TRANSACTION,
    status: "success",
    blockNumber: exact.blockNumber,
    blockHash: exact.blockHash,
    logs: [exact],
    observedAt: fixture.clock.now().toISOString(),
    rpcOrigin: fixture.rpc.rpcOrigin,
  };
  fixture.clock.advance(240_000);
  fixture.rpc.safeNumber = 1021n;
  fixture.rpc.blockHashOverrides.set("1000", `0x${"f".repeat(64)}` as Hex);
  const mismatch = await fixture.core.execute({ command: "operation.resume", operationId });
  assert.equal((mismatch.operation as { state?: unknown }).state, "ambiguous_effect");
  fixture.rpc.blockHashOverrides.delete("1000");
  const recoveredRpc = await fixture.core.execute({ command: "operation.resume", operationId });
  assert.equal((recoveredRpc.operation as { state?: unknown }).state, "ambiguous_effect");
  assert.equal(fixture.effect.calls.length, 1);
});

test("started persistence, same-operation races and exact spend without seller result terminalize once without replay", async (t) => {
  const failing = await setup(t, { failStartedStore: true });
  const failedOperationId = await prepare(failing.core, "provider-store-failure");
  const failedStart = await failing.core.execute({ command: "x402.fetch.approve", operationId: failedOperationId });
  assert.equal(failedStart.ok, false);
  assert.equal(failing.effect.calls.length, 0, "a failed started write must create no child");

  const ambiguousEffect = new FixtureX402();
  ambiguousEffect.result = { disposition: "ambiguous", reason: "provider_process_timeout", invocation: invocation() };
  const ambiguous = await setup(t, { effect: ambiguousEffect });
  const operationId = await prepare(ambiguous.core, "provider-race");
  const [first, second] = await Promise.all([
    ambiguous.core.execute({ command: "x402.fetch.approve", operationId }),
    ambiguous.core.execute({ command: "x402.fetch.approve", operationId }),
  ]);
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.equal(second.ok, true, JSON.stringify(second));
  assert.equal(ambiguousEffect.calls.length, 1);
  assert.equal((first.operation as { state?: unknown }).state, "ambiguous_effect");
  await ambiguous.core.execute({ command: "operation.status", operationId });
  await ambiguous.core.execute({ command: "operation.resume", operationId });
  await ambiguous.core.execute({ command: "x402.fetch.approve", operationId });
  assert.equal(ambiguousEffect.calls.length, 1, "status/resume/approve replay must never invoke AWAL pay again");

  const transfer = exactTransfer(1010n);
  ambiguous.rpc.transferLogs = [transfer];
  ambiguous.rpc.x402Receipt = {
    transactionHash: TRANSACTION,
    status: "success",
    blockNumber: transfer.blockNumber,
    blockHash: transfer.blockHash,
    logs: [transfer],
    observedAt: ambiguous.clock.now().toISOString(),
    rpcOrigin: ambiguous.rpc.rpcOrigin,
  };
  ambiguous.clock.advance(240_000);
  ambiguous.rpc.safeNumber = 1021n;
  const restartedState = new StateStore(ambiguous.temporary.root, { lockWaitMs: 1_000 });
  const restarted = new ApnCore({
    state: restartedState,
    profileRepository: new StateProfileRepository(restartedState),
    providerRegistry: ambiguous.registry,
    policy: ambiguous.policy,
    rpc: ambiguous.rpc,
    http: ambiguous.http,
    rpcUrl: "https://rpc.example/base?tenant=one",
    clock: ambiguous.clock,
  });
  const httpCallsBeforeRecovery = ambiguous.http.calls.length;
  const [recovered, concurrentRecovered] = await Promise.all([
    restarted.execute({ command: "operation.resume", operationId }),
    restarted.execute({ command: "operation.resume", operationId }),
  ]);
  assert.equal(recovered.ok, true, JSON.stringify(recovered));
  assert.equal(concurrentRecovered.ok, true, JSON.stringify(concurrentRecovered));
  assert.equal((recovered.operation as { state?: unknown }).state, "failed_settled_without_result");
  assert.equal((recovered.operation as { terminal?: unknown }).terminal, true);
  assert.equal((recovered.operation as { reason?: unknown }).reason, "seller_result_missing");
  assert.equal(
    (recovered.operation as { proofClass?: unknown }).proofClass,
    "confirmed_settlement_without_seller_result",
  );
  assert.equal(recovered.data, null, "settlement evidence must not invent seller data");
  assert.deepEqual(concurrentRecovered.operation, recovered.operation, "concurrent reconciliation must converge byte-stably");
  const durable = await new ProviderX402Repository(ambiguous.temporary.root).findOperation(operationId);
  assert.equal(durable?.state, "failed_settled_without_result");
  assert.equal(durable?.terminal, true);
  assert.equal(durable?.sellerResult, undefined);
  assert.notEqual(durable?.settlementEvidence, undefined, "exact settlement must be preserved in the spent terminal");

  const firstReceipt = await restarted.execute({ command: "receipt.get", operationId });
  assert.equal(firstReceipt.ok, true, JSON.stringify(firstReceipt));
  assert.equal((firstReceipt.receipt as { terminalState?: unknown }).terminalState, "failed_settled_without_result");
  assert.equal((firstReceipt.receipt as { reason?: unknown }).reason, "seller_result_missing");
  assert.equal(
    (firstReceipt.receipt as { proofClass?: unknown }).proofClass,
    "confirmed_settlement_without_seller_result",
  );
  assert.equal("result" in (firstReceipt.receipt as object), false);
  assert.equal(
    (firstReceipt.receipt as { settlement?: { receiptStatus?: unknown } }).settlement?.receiptStatus,
    "success",
  );
  assert.equal(
    (firstReceipt.receipt as { settlement?: { transfer?: { value?: unknown } } }).settlement?.transfer?.value,
    X402_REQUIREMENTS.amount,
  );
  validatePublicX402Receipt(firstReceipt.receipt);
  const receiptPath = join(ambiguous.temporary.root, "x402-receipts", ambiguous.profile.profile_hash, `${operationId}.json`);
  const storedReceipt = await readFile(receiptPath, "utf8");

  await restarted.execute({ command: "operation.status", operationId });
  await restarted.execute({ command: "operation.resume", operationId });
  await restarted.execute({ command: "x402.fetch.approve", operationId });
  const replayedReceipt = await restarted.execute({ command: "receipt.get", operationId });
  assert.deepEqual(replayedReceipt.receipt, firstReceipt.receipt);
  assert.equal(await readFile(receiptPath, "utf8"), storedReceipt, "spent receipt must be immutable and counted once");

  const parsedReceipt = JSON.parse(storedReceipt) as ProviderX402ReceiptRecord;
  const { integrityHash: _receiptHash, ...receiptBase } = parsedReceipt;
  const injectedBase = { ...receiptBase, seller_result: { status: "invented" } };
  await writeFile(receiptPath, canonicalJson({ ...injectedBase, integrityHash: hashObject(injectedBase) }), { mode: 0o600 });
  await assert.rejects(
    new ProviderX402Repository(ambiguous.temporary.root).loadReceipt(ambiguous.profile.profile_hash, operationId),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "APN_STATE_CORRUPT",
    "a recomputed receipt with an undeclared seller field must fail closed",
  );
  await writeFile(receiptPath, storedReceipt, { mode: 0o600 });

  await unlink(receiptPath);
  const stateFirstRestart = restartedCore(ambiguous);
  const stateFirstStatus = await stateFirstRestart.execute({ command: "operation.status", operationId });
  assert.equal(stateFirstStatus.ok, true, JSON.stringify(stateFirstStatus));
  assert.equal((stateFirstStatus.operation as { state?: unknown }).state, "failed_settled_without_result");
  assert.equal(await readFile(receiptPath, "utf8"), storedReceipt, "state-first recovery must reconstruct identical receipt bytes");
  const stateFirstReceipt = await stateFirstRestart.execute({ command: "receipt.get", operationId });
  assert.deepEqual(stateFirstReceipt.receipt, firstReceipt.receipt);

  const surfaceOptions = {
    stateRoot: ambiguous.temporary.root,
    native: new TestNative(),
    profileRepository: new StateProfileRepository(ambiguous.state),
    providerRegistry: ambiguous.registry,
    policy: ambiguous.policy,
    rpc: ambiguous.rpc,
    http: ambiguous.http,
    clock: ambiguous.clock,
  };
  const cliReceipt = await runCli(["receipt", "get", "--operation", operationId], {}, surfaceOptions);
  assert.deepEqual(cliReceipt.receipt, firstReceipt.receipt, "CLI must project the shared terminal receipt schema");
  const server = createMcpServer(surfaceOptions);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "provider-spent-receipt-test", version: "1.0.0" });
  await client.connect(clientTransport);
  try {
    const result = await client.callTool({ name: "apn_receipt_get", arguments: { operation: operationId } });
    assert.deepEqual(
      (result.structuredContent as unknown as OutputEnvelope).receipt,
      firstReceipt.receipt,
      "MCP must project the shared terminal receipt schema",
    );
  } finally {
    await client.close();
    await server.close();
  }
  assert.equal(ambiguousEffect.calls.length, 1, "restart settlement recovery must never replay AWAL pay");
  assert.equal(ambiguous.http.calls.length, httpCallsBeforeRecovery, "terminal recovery must never repeat paid or unpaid HTTP");
});

test("exact-transaction recovery terminalizes once, survives restart and projects identical bounded CLI/MCP output", async (t) => {
  const effect = ambiguousEffect();
  const fixture = await setup(t, { effect });
  const operationId = await legacyCapabilityGap(fixture, "provider-exact-recovery-success");
  armTransactionReceipt(fixture);
  const callsBefore = recoveryCallCounts(fixture);
  const request = {
    command: "operation.recover-transaction-settlement" as const,
    operationId,
    transactionHash: TRANSACTION.toUpperCase().replace("0X", "0x"),
    idempotencyKey: "provider-exact-recovery-idempotency",
  };
  const recovered = await fixture.core.execute(request);
  assert.equal(recovered.ok, true, JSON.stringify(recovered));
  assert.deepEqual(Object.keys(recovered.operation as object), [
    "operationId", "state", "reason", "proofClass", "transactionHash", "terminal",
    "createdAt", "updatedAt", "nextActions",
  ]);
  assert.deepEqual(Object.keys(recovered.receipt as object), [
    "operationId", "terminalState", "reason", "proofClass", "transactionHash", "receiptIntegrity", "createdAt",
  ]);
  assert.equal((recovered.operation as { state?: unknown }).state, "failed_settled_without_result");
  assert.equal(
    (recovered.operation as { proofClass?: unknown }).proofClass,
    "confirmed_exact_transaction_settlement_without_seller_result",
  );
  assert.equal(effect.calls.length, 1, "recovery must not invoke the provider again");
  assert.equal(fixture.rpc.transferCalls, callsBefore.transferCalls, "recovery must not scan logs");
  assert.deepEqual(fixture.rpc.receiptHashes.slice(callsBefore.receiptCalls), [TRANSACTION]);
  assert.equal(fixture.rpc.receiptCalls, callsBefore.receiptCalls + 1);
  assert.equal(fixture.rpc.headCalls, callsBefore.headCalls + 1);
  assert.equal(fixture.rpc.blockCalls, callsBefore.blockCalls + 1);

  const stored = await new ProviderX402Repository(fixture.temporary.root).findOperation(operationId);
  assert.equal(stored?.transactionRecovery?.stage, "evidence_validated");
  assert.equal(stored?.transactionRecovery?.transactionHash, TRANSACTION);
  assert.equal(stored?.settlementEvidence?.schemaVersion, "apn.provider-x402.transaction-settlement.v1");
  assert.equal(stored?.sellerResult, undefined);
  const publicReceipt = await fixture.core.execute({ command: "receipt.get", operationId });
  assert.equal(publicReceipt.ok, true, JSON.stringify(publicReceipt));
  assert.equal((publicReceipt.receipt as { amountAtomic?: unknown }).amountAtomic, X402_REQUIREMENTS.amount);
  assert.equal(
    (publicReceipt.receipt as { settlement?: { evidenceMode?: unknown } }).settlement?.evidenceMode,
    "exact_transaction",
  );
  await new OperationService(
    new StateStore(fixture.temporary.root),
    new ProviderX402Repository(fixture.temporary.root),
  ).assertProfileAvailable(fixture.profile.profile_hash);

  const countsAfterCommit = recoveryCallCounts(fixture);
  const replay = await fixture.core.execute(request);
  assert.deepEqual(replay.operation, recovered.operation);
  assert.deepEqual(replay.receipt, recovered.receipt);
  assert.deepEqual(recoveryCallCounts(fixture), countsAfterCommit, "terminal replay must not observe RPC again");

  const surfaceOptions = {
    stateRoot: fixture.temporary.root,
    profileRepository: new StateProfileRepository(fixture.state),
    providerRegistry: fixture.registry,
    policy: fixture.policy,
    rpc: fixture.rpc,
    http: fixture.http,
    clock: fixture.clock,
  };
  const cli = await runCli([
    "operation", "recover-transaction-settlement", "--operation", operationId,
    "--transaction-hash", TRANSACTION, "--idempotency-key", request.idempotencyKey,
    "--rpc-url", "https://rpc.example/base?tenant=one",
  ], {}, surfaceOptions);
  assert.deepEqual(cli.operation, recovered.operation);
  assert.deepEqual(cli.receipt, recovered.receipt);
  const server = createMcpServer(surfaceOptions);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "provider-exact-recovery-test", version: "1.0.0" });
  await client.connect(clientTransport);
  try {
    const result = await client.callTool({
      name: "apn_operation_recover_transaction_settlement",
      arguments: {
        operation: operationId,
        transaction_hash: TRANSACTION,
        idempotency_key: request.idempotencyKey,
        rpc_url: "https://rpc.example/base?tenant=one",
      },
    });
    const envelope = result.structuredContent as unknown as OutputEnvelope;
    assert.deepEqual(envelope.operation, recovered.operation);
    assert.deepEqual(envelope.receipt, recovered.receipt);
  } finally {
    await client.close();
    await server.close();
  }
  assert.deepEqual(recoveryCallCounts(fixture), countsAfterCommit, "fresh CLI/MCP replay must remain read-only locally");
});

test("exact-transaction recovery fails closed for every receipt, canonicality and transfer mismatch", async (t) => {
  const cases = [
    "missing", "reverted", "wrong_transaction", "wrong_block", "not_safe",
    "wrong_token", "wrong_payer", "wrong_payee", "wrong_amount", "multiple",
  ] as const;
  for (const classification of cases) {
    await t.test(classification, async (sub) => {
      const effect = ambiguousEffect();
      const fixture = await setup(sub, { effect });
      const operationId = await legacyCapabilityGap(fixture, `provider-exact-negative-${classification}`);
      const transfer = exactTransfer(1010n);
      const receipt: X402RpcReceipt = {
        transactionHash: classification === "wrong_transaction" ? `0x${"d".repeat(64)}` : TRANSACTION,
        status: classification === "reverted" ? "reverted" : "success",
        blockNumber: transfer.blockNumber,
        blockHash: classification === "wrong_block" ? `0x${"e".repeat(64)}` : transfer.blockHash,
        logs: classification === "multiple" ? [transfer, { ...transfer, logIndex: "2" }] : [
          classification === "wrong_token" ? { ...transfer, address: "0x3333333333333333333333333333333333333333" }
          : classification === "wrong_payer" ? { ...transfer, topics: [
              transfer.topics[0] as Hex, `0x${"4".repeat(40).padStart(64, "0")}` as Hex, transfer.topics[2] as Hex,
            ] }
            : classification === "wrong_payee" ? { ...transfer, topics: [
                transfer.topics[0] as Hex, transfer.topics[1] as Hex, `0x${"5".repeat(40).padStart(64, "0")}` as Hex,
              ] }
              : classification === "wrong_amount" ? { ...transfer, data: `0x${"1".padStart(64, "0")}` as Hex }
                : transfer],
        observedAt: fixture.clock.now().toISOString(),
        rpcOrigin: fixture.rpc.rpcOrigin,
      };
      fixture.rpc.x402Receipt = classification === "missing" ? null : receipt;
      if (classification === "not_safe") fixture.rpc.safeNumber = 1009n;
      const beforeRangeCalls = fixture.rpc.transferCalls;
      const failed = await fixture.core.execute({
        command: "operation.recover-transaction-settlement",
        operationId,
        transactionHash: TRANSACTION,
        idempotencyKey: `provider-exact-negative-recovery-${classification}`,
      });
      assert.equal(failed.ok, false, `${classification}: ${JSON.stringify(failed)}`);
      assert.equal(
        failed.error?.code,
        ["missing", "not_safe"].includes(classification) ? "APN_X402_RECOVERY_AMBIGUOUS" : "APN_X402_SETTLEMENT_INVALID",
      );
      const durable = await new ProviderX402Repository(fixture.temporary.root).findOperation(operationId);
      assert.equal(durable?.state, "ambiguous_effect");
      assert.equal(durable?.terminal, false);
      assert.equal(durable?.transactionRecovery?.stage, "bound");
      assert.equal(durable?.settlementEvidence, undefined);
      assert.equal(await new ProviderX402Repository(fixture.temporary.root).loadReceipt(fixture.profile.profile_hash, operationId), null);
      assert.equal(fixture.rpc.transferCalls, beforeRangeCalls);
      assert.equal(effect.calls.length, 1);
    });
  }
});

test("exact-transaction recovery converges across concurrency, crash boundaries and rejects binding reuse", async (t) => {
  await t.test("concurrent identical calls", async (sub) => {
    const fixture = await setup(sub, { effect: ambiguousEffect() });
    const operationId = await legacyCapabilityGap(fixture, "provider-exact-concurrent");
    armTransactionReceipt(fixture);
    const request = {
      command: "operation.recover-transaction-settlement" as const,
      operationId,
      transactionHash: TRANSACTION,
      idempotencyKey: "provider-exact-concurrent-recovery",
    };
    const [left, right] = await Promise.all([fixture.core.execute(request), fixture.core.execute(request)]);
    assert.equal(left.ok, true, JSON.stringify(left));
    assert.deepEqual(right.operation, left.operation);
    assert.deepEqual(right.receipt, left.receipt);
    assert.equal(fixture.rpc.receiptCalls, 1);
    assert.equal(fixture.rpc.transferCalls, 0);
  });

  for (const failure of ["receipt", "terminal"] as const) {
    await t.test(`restart after ${failure} write failure`, async (sub) => {
      const fixture = await setup(sub, {
        effect: ambiguousEffect(),
        ...(failure === "receipt" ? { failReceiptStore: true } : { failSettledWithoutResultStore: true }),
      });
      const operationId = await legacyCapabilityGap(fixture, `provider-exact-crash-${failure}`);
      armTransactionReceipt(fixture);
      const request = {
        command: "operation.recover-transaction-settlement" as const,
        operationId,
        transactionHash: TRANSACTION,
        idempotencyKey: `provider-exact-crash-recovery-${failure}`,
      };
      const failed = await fixture.core.execute(request);
      assert.equal(failed.ok, false);
      const calls = recoveryCallCounts(fixture);
      const recovered = await restartedCore(fixture).execute(request);
      assert.equal(recovered.ok, true, JSON.stringify(recovered));
      assert.equal((recovered.operation as { state?: unknown }).state, "failed_settled_without_result");
      assert.deepEqual(recoveryCallCounts(fixture), calls, "restart must commit already validated evidence without RPC replay");
      const replay = await restartedCore(fixture).execute(request);
      assert.deepEqual(replay.receipt, recovered.receipt);
      assert.deepEqual(recoveryCallCounts(fixture), calls);
    });
  }

  await t.test("operation, transaction and idempotency conflicts", async (sub) => {
    const fixture = await setup(sub, { effect: ambiguousEffect() });
    const operationId = await legacyCapabilityGap(fixture, "provider-exact-conflict");
    fixture.rpc.x402Receipt = null;
    const key = "provider-exact-conflict-recovery";
    const first = await fixture.core.execute({
      command: "operation.recover-transaction-settlement", operationId, transactionHash: TRANSACTION, idempotencyKey: key,
    });
    assert.equal(first.error?.code, "APN_X402_RECOVERY_AMBIGUOUS");
    const repository = new ProviderX402Repository(fixture.temporary.root);
    const before = await repository.findOperation(operationId);
    for (const request of [
      { transactionHash: `0x${"d".repeat(64)}`, idempotencyKey: key },
      { transactionHash: TRANSACTION, idempotencyKey: "provider-exact-conflicting-key" },
    ]) {
      const conflict = await fixture.core.execute({
        command: "operation.recover-transaction-settlement", operationId, ...request,
      });
      assert.equal(conflict.error?.code, "APN_IDEMPOTENCY_CONFLICT");
      assert.deepEqual(await repository.findOperation(operationId), before);
    }
    const otherOperation = "d".repeat(64);
    const otherProfile = "e".repeat(64);
    const otherIdempotency = "f".repeat(64);
    await assert.rejects(repository.reserveTransactionRecovery({
      operationId: otherOperation,
      profileHash: otherProfile,
      transactionHash: TRANSACTION,
      idempotencyDigest: otherIdempotency,
      materialDigest: recoveryMaterialDigest({
        operationId: otherOperation, transactionHash: TRANSACTION, idempotencyDigest: otherIdempotency,
      }),
      createdAt: fixture.clock.now().toISOString(),
    }), (error: unknown) => hasCode(error, "APN_IDEMPOTENCY_CONFLICT"));
  });
});

function ambiguousEffect(): FixtureX402 {
  const effect = new FixtureX402();
  effect.result = { disposition: "ambiguous", reason: "provider_result_invalid", invocation: invocation() };
  return effect;
}

async function legacyCapabilityGap(
  fixture: Awaited<ReturnType<typeof setup>>,
  key: string,
): Promise<string> {
  const operationId = await prepare(fixture.core, key);
  const approved = await fixture.core.execute({ command: "x402.fetch.approve", operationId });
  assert.equal(approved.ok, true, JSON.stringify(approved));
  fixture.clock.advance(240_000);
  fixture.rpc.safeNumber = 1021n;
  fixture.rpc.failChain = true;
  const gap = await fixture.core.execute({ command: "operation.resume", operationId });
  fixture.rpc.failChain = false;
  assert.equal(gap.ok, true, JSON.stringify(gap));
  assert.equal((gap.operation as { state?: unknown }).state, "ambiguous_effect");
  assert.equal((gap.operation as { reason?: unknown }).reason, "provider_evidence_capability_gap");
  const stored = await new ProviderX402Repository(fixture.temporary.root).findOperation(operationId);
  assert.equal(stored?.immutableUpperBlock, undefined);
  return operationId;
}

function armTransactionReceipt(fixture: Awaited<ReturnType<typeof setup>>): void {
  const transfer = exactTransfer(1010n);
  fixture.rpc.x402Receipt = {
    transactionHash: TRANSACTION,
    status: "success",
    blockNumber: transfer.blockNumber,
    blockHash: transfer.blockHash,
    logs: [transfer],
    observedAt: fixture.clock.now().toISOString(),
    rpcOrigin: fixture.rpc.rpcOrigin,
  };
}

function recoveryCallCounts(fixture: Awaited<ReturnType<typeof setup>>): {
  readonly transferCalls: number;
  readonly receiptCalls: number;
  readonly headCalls: number;
  readonly blockCalls: number;
} {
  return {
    transferCalls: fixture.rpc.transferCalls,
    receiptCalls: fixture.rpc.receiptCalls,
    headCalls: fixture.rpc.headCalls,
    blockCalls: fixture.rpc.blockCalls,
  };
}

function invocation(
  operationId: string = "a".repeat(64),
  amountAtomic: string = X402_REQUIREMENTS.amount,
  requestDigest: string = "b".repeat(64),
): ProviderX402Invocation {
  return {
    correlation_id: operationId,
    request_digest: requestDigest,
    intent_binding_hash: providerX402InvocationIntentHash({
      correlationId: operationId,
      canonicalUrl: X402_URL,
      amountAtomic,
      requestDigest,
    }),
    child_identity_hash: sha256(SCRIPT_PATH_CANARY),
    output_sha256: "b".repeat(64),
    output_byte_length: "128",
  };
}

function hasCode(error: unknown, code: string): boolean {
  return error !== null && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === code;
}

function sellerResult(): ProviderX402SellerResult {
  const body = canonicalizeNormalizedProviderJson({
    ok: true,
    forecast: { temperatureC: 27.5, condition: "clear" },
  });
  return {
    classification: "normalized_provider_json",
    http_status: "200",
    payment_made: true,
    amount_paid_atomic: X402_REQUIREMENTS.amount,
    canonical_json: body,
    byte_length: Buffer.byteLength(body).toString(),
    sha256: sha256(body),
  };
}

function blockHash(number: bigint): Hex {
  return `0x${number.toString(16).padStart(64, "0")}` as Hex;
}

function exactTransfer(blockNumber: bigint): X402RpcLog {
  return {
    address: BASE_USDC.toLowerCase() as Address,
    topics: [
      TRANSFER_TOPIC,
      `0x${PAYER.slice(2).toLowerCase().padStart(64, "0")}` as Hex,
      `0x${X402_PAYEE.slice(2).toLowerCase().padStart(64, "0")}` as Hex,
    ],
    data: `0x${BigInt(X402_REQUIREMENTS.amount).toString(16).padStart(64, "0")}` as Hex,
    blockNumber: blockNumber.toString(),
    blockHash: blockHash(blockNumber),
    transactionHash: TRANSACTION,
    logIndex: "1",
  };
}
