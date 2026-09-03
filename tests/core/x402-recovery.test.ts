import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import test, { type TestContext } from "node:test";
import { canonicalJson, domainHash } from "../../src/canonical.js";
import { ApnError } from "../../src/errors.js";
import type { Hex } from "../../src/model.js";
import type { HttpGetRequest, HttpObservation } from "../../src/x402-model.js";
import type { WaitPort, X402RpcPort, X402RpcReceipt } from "../../src/ports.js";
import { classifyX402LogAvailabilityMessage } from "../../src/rpc.js";
import {
  appendX402Transition,
  sealX402Operation,
  type X402OperationRecord,
} from "../../src/x402-state-integrity.js";
import { TestClock, makeCore, temporaryState } from "./helpers.js";
import {
  ExactX402Native,
  QueuedHttp,
  RecoveryRpc,
  X402_TEST_ACCOUNT,
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
  paymentIdentifierDeclaration,
} from "./x402-vectors.js";

interface Fixture {
  readonly core: ReturnType<typeof makeCore>;
  readonly operationId: string;
  readonly native: ExactX402Native;
  readonly rpc: RecoveryRpc;
  readonly http: QueuedHttp;
  readonly clock: TestClock;
  readonly root: string;
}

async function authorizedFixture(t: TestContext, input: {
  readonly paidOutcomes?: readonly (HttpObservation | Error)[];
  readonly paymentIdentifier?: boolean;
  readonly clock?: TestClock;
  readonly idempotencyKey?: string;
  readonly onHttpCall?: (request: HttpGetRequest, callNumber: number) => void | Promise<void>;
  readonly wait?: WaitPort;
  readonly rpc?: RecoveryRpc;
} = {}): Promise<Fixture> {
  const temporary = await temporaryState();
  t.after(temporary.cleanup);
  const required = input.paymentIdentifier === true ? {
    ...X402_PAYMENT_REQUIRED,
    extensions: { "payment-identifier": paymentIdentifierDeclaration(false) },
  } : X402_PAYMENT_REQUIRED;
  const http = new QueuedHttp([
    challengeObservation({ header: canonicalPaymentRequiredHeader(required) }),
    ...(input.paidOutcomes ?? [new Error("ambiguous paid request")]),
  ], input.onHttpCall);
  const native = new ExactX402Native();
  const rpc = input.rpc ?? new RecoveryRpc();
  rpc.x402Evidence = { ...rpc.x402Evidence, address: X402_TEST_ACCOUNT.address };
  const clock = input.clock ?? new TestClock();
  const core = makeCore({
    root: temporary.root,
    native,
    rpc,
    http,
    clock,
    ...(input.wait === undefined ? {} : { wait: input.wait }),
  });
  assert.equal((await core.execute({ command: "wallet.ensure", profile: "default" })).ok, true);
  const prepared = await core.execute({
    command: "x402.fetch.prepare",
    profile: "default",
    url: X402_URL,
    maxAmountAtomic: "2000000",
    idempotencyKey: input.idempotencyKey ?? "x402-recovery",
  });
  const operationId = (prepared.operation as { readonly operationId?: unknown } | null)?.operationId;
  assert.equal(typeof operationId, "string", JSON.stringify(prepared));
  const approved = await core.execute({ command: "x402.fetch.approve", operationId: operationId as string });
  assert.equal(approved.ok, true, JSON.stringify(approved));
  rpc.x402Calls.length = 0;
  native.calls.length = 0;
  return { core, operationId: operationId as string, native, rpc, http, clock, root: temporary.root };
}

class ControlledWait implements WaitPort {
  value = 0;
  readonly calls: number[] = [];
  onWait?: (milliseconds: number) => void | Promise<void>;
  outcome: "elapsed" | "interrupted" = "elapsed";

  nowMs(): number { return this.value; }
  async wait(milliseconds: number): Promise<"elapsed" | "interrupted"> {
    this.calls.push(milliseconds);
    this.value += milliseconds;
    await this.onWait?.(milliseconds);
    return this.outcome;
  }
}

class SlowSecondBoundedRpc extends RecoveryRpc {
  readonly boundedCalls: number[] = [];
  private slowTimeout: number | undefined;
  override withTotalTimeout(milliseconds: number): X402RpcPort {
    this.boundedCalls.push(milliseconds);
    if (this.boundedCalls.length === 2) this.slowTimeout = milliseconds;
    return this;
  }
  override async assertBaseChain(): Promise<{ readonly chainId: 8453; readonly rpcOrigin: string }> {
    if (this.slowTimeout !== undefined) {
      const timeout = this.slowTimeout;
      this.slowTimeout = undefined;
      await new Promise((resolve) => setTimeout(resolve, timeout));
      throw new Error("injected bounded local RPC timeout");
    }
    return await super.assertBaseChain();
  }
}

async function operation(fixture: Fixture): Promise<X402OperationRecord> {
  return await fixture.core.context.state.findX402Operation(fixture.operationId) as X402OperationRecord;
}

function transitionlessZeroScanExtension(
  operation: X402OperationRecord,
  targetSafeHead: NonNullable<X402OperationRecord["authorizationUsedScan"]>["targetSafeHead"],
): X402OperationRecord {
  const previous = operation.authorizationUsedScan;
  assert.notEqual(previous, undefined);
  const scanBody = {
    schemaVersion: "apn.x402.authorization-used-scan.v1" as const,
    searchStartBlock: previous!.searchStartBlock,
    nextFromBlock: previous!.nextFromBlock,
    targetSafeHead,
    ...(previous!.lastCompletedChunk === undefined ? {} : { lastCompletedChunk: previous!.lastCompletedChunk }),
    candidates: previous!.candidates,
    status: "active" as const,
    updatedAt: operation.updatedAt,
  };
  const { integrityHash: _integrityHash, ...withoutIntegrity } = operation;
  return sealX402Operation({
    ...withoutIntegrity,
    authorizationUsedScan: {
      ...scanBody,
      evidenceHash: domainHash("apn.x402.authorization-used-scan.v1", canonicalJson(scanBody)),
    },
  });
}

function failRecoveredNativeMaterial(
  fixture: Fixture,
  nativeCode: "APN_KEYCHAIN_LOCKED" | "APN_APPROVAL_EXPIRED",
): void {
  const originalRequest = fixture.native.request.bind(fixture.native);
  fixture.native.request = async (request) => {
    if (request.operation === "x402Exact.authorizationMaterial.get") {
      fixture.native.calls.push(request);
      throw new ApnError("APN_NATIVE_REJECTED", "Native material is temporarily unavailable.", {
        nativeCode,
      });
    }
    return await originalRequest(request);
  };
}

function settlementResponseTransactionForTest(value: string | undefined): unknown {
  return value === undefined ? undefined : (JSON.parse(value) as { readonly transaction?: unknown }).transaction;
}

async function advanceSafeAndReset(fixture: Fixture, hashNibble = "e"): Promise<void> {
  const httpCalls = fixture.http.calls.length;
  const before = await operation(fixture);
  const priorTarget = before.authorizationUsedScan?.targetSafeHead;
  if (priorTarget !== undefined) {
    fixture.rpc.blockHashes.set(priorTarget.number, `0x${hashNibble.repeat(64)}` as Hex);
  }
  fixture.rpc.safeHead = {
    ...fixture.rpc.safeHead,
    number: (BigInt(fixture.rpc.safeHead.number) + 1n).toString(),
    hash: `0x${hashNibble.repeat(64)}` as Hex,
  };
  const reset = await fixture.core.execute({ command: "operation.resume", operationId: fixture.operationId });
  assert.equal(reset.ok, true, JSON.stringify(reset));
  assert.equal(fixture.http.calls.length, httpCalls, "scan reorg reset never sends HTTP");
  const current = await operation(fixture);
  assert.equal(current.authorizationUsedScan?.status, "active");
  assert.equal(current.authorizationUsedScan?.nextFromBlock, current.authorizationUsedScan?.searchStartBlock);
  assert.equal(current.authorizationUsedScan?.targetSafeHead.number, fixture.rpc.safeHead.number);
}

function configureSettlement(rpc: RecoveryRpc, op: X402OperationRecord, input: {
  readonly transactionHash?: Hex;
  readonly blockNumber?: string;
  readonly blockHash?: Hex;
  readonly duplicateAuthorization?: boolean;
  readonly duplicateTransfer?: boolean;
} = {}): X402RpcReceipt {
  const transactionHash: Hex = input.transactionHash ?? X402_TRANSACTION as Hex;
  const blockNumber = input.blockNumber ?? rpc.safeHead.number;
  const blockHash = input.blockHash ?? rpc.safeHead.hash;
  rpc.blockHashes.set(blockNumber, blockHash);
  rpc.authorizationStateValue = true;
  const authorization = authorizationUsedLog({
    authorizer: op.wallet,
    nonce: op.authorization.nonce,
    transactionHash,
    blockNumber,
    blockHash,
  });
  const transfer = transferLog({
    from: op.wallet,
    to: op.payee,
    value: op.amountAtomic,
    transactionHash,
    blockNumber,
    blockHash,
  });
  const logs = [
    authorization,
    ...(input.duplicateAuthorization === true ? [{ ...authorization, logIndex: "2" }] : []),
    transfer,
    ...(input.duplicateTransfer === true ? [{ ...transfer, logIndex: "3" }] : []),
  ];
  const receipt: X402RpcReceipt = {
    transactionHash,
    status: "success",
    blockNumber,
    blockHash,
    logs,
    observedAt: rpc.safeHead.observedAt,
    rpcOrigin: rpc.rpcOrigin,
  };
  rpc.x402Receipt = receipt;
  return receipt;
}

test("x402 recovery begins from explicit safe/finalized read-only heads", async () => {
  const rpc = new RecoveryRpc();
  assert.equal((await rpc.getX402Head("safe")).queriedTag, "safe");
  assert.equal((await rpc.getX402Head("finalized")).queriedTag, "finalized");
  assert.equal(rpc.submissions.length, 0);
});

test("first authorized send follows recovered material and a durable Base safe scan", async (t) => {
  let fixtureRef: Fixture | undefined;
  let callsAtPaidHttp: readonly string[] = [];
  let nativeAtPaidHttp: readonly string[] = [];
  const fixture = await authorizedFixture(t, {
    idempotencyKey: "first-send-order",
    onHttpCall: (_request, callNumber) => {
      if (callNumber === 2) {
        callsAtPaidHttp = [...(fixtureRef?.rpc.x402Calls ?? [])];
        nativeAtPaidHttp = (fixtureRef?.native.calls ?? []).map((call) => call.operation);
      }
    },
  });
  fixtureRef = fixture;
  const resumed = await fixture.core.execute({ command: "operation.resume", operationId: fixture.operationId });
  assert.equal(resumed.ok, true, JSON.stringify(resumed));
  assert.deepEqual(callsAtPaidHttp, [
    "chain", "safe", "block:12345", "logs:12345-12345", "block:12345", "block:12345",
  ]);
  assert.deepEqual(nativeAtPaidHttp, ["x402Exact.authorizationMaterial.get"]);
  assert.equal((await operation(fixture)).authorizationUsedScan?.status, "complete");
});

test("one bounded resume waits outside locks and completes through RPC-only settlement observations", async (t) => {
  const wait = new ControlledWait();
  const fixture = await authorizedFixture(t, {
    idempotencyKey: "bounded-settlement-wait",
    wait,
    paidOutcomes: [paidObservation({
      paymentResponseHeader: canonicalPaymentResponseHeader({
        success: true,
        transaction: X402_TRANSACTION,
        network: "eip155:8453",
        payer: X402_TEST_ACCOUNT.address.toLowerCase(),
        amount: "1250000",
      }),
    })],
  });
  let observedReleasedLocks = false;
  wait.onWait = async () => {
    const current = await operation(fixture);
    await fixture.core.context.state.withLocks([
      `profile:${current.profileHash}`,
      `operation:${current.operationId}`,
    ], async () => { observedReleasedLocks = true; });
    configureSettlement(fixture.rpc, current);
  };

  const completed = await fixture.core.execute({
    command: "operation.resume",
    operationId: fixture.operationId,
    waitSeconds: 10,
  });
  assert.equal(completed.ok, true, JSON.stringify(completed));
  assert.equal((completed.operation as { state: string }).state, "completed");
  assert.deepEqual((completed.operation as { settlementWait: unknown }).settlementWait, {
    outcome: "completed",
    requestedSeconds: "10",
    observationCount: "2",
  });
  assert.equal(observedReleasedLocks, true);
  assert.equal(fixture.http.calls.length, 2, "challenge plus exactly one paid GET");
  assert.deepEqual(fixture.native.calls.map((call) => call.operation), ["x402Exact.authorizationMaterial.get"]);
  assert.equal((await operation(fixture)).attempts.filter((attempt) => attempt.purpose === "payment").length, 1);
  assert.equal(fixture.rpc.submissions.length, 0);

  const httpCalls = fixture.http.calls.length;
  const nativeCalls = fixture.native.calls.length;
  const replay = await fixture.core.execute({
    command: "operation.resume",
    operationId: fixture.operationId,
    waitSeconds: 1,
  });
  assert.deepEqual((replay.operation as { settlementWait: unknown }).settlementWait, {
    outcome: "completed",
    requestedSeconds: "1",
    observationCount: "0",
  });
  assert.equal(fixture.http.calls.length, httpCalls);
  assert.equal(fixture.native.calls.length, nativeCalls);
});

test("bounded wait advances a no-hint multi-chunk cursor and discovers settlement without another effect", async (t) => {
  const wait = new ControlledWait();
  const fixture = await authorizedFixture(t, {
    idempotencyKey: "bounded-no-hint-multichunk",
    wait,
    paidOutcomes: [paidObservation()],
  });
  let advanced = false;
  wait.onWait = async () => {
    if (advanced) return;
    advanced = true;
    const current = await operation(fixture);
    const previousSafe = fixture.rpc.safeHead;
    fixture.rpc.blockHashes.set(previousSafe.number, previousSafe.hash);
    fixture.rpc.safeHead = {
      ...previousSafe,
      number: (BigInt(previousSafe.number) + 3_000n).toString(),
      hash: `0x${"e".repeat(64)}` as Hex,
    };
    const settlement = configureSettlement(fixture.rpc, current);
    fixture.rpc.logOutcomes.push(
      { kind: "complete", logs: [] },
      { kind: "complete", logs: [settlement.logs[0]!] },
    );
  };

  const completed = await fixture.core.execute({
    command: "operation.resume",
    operationId: fixture.operationId,
    waitSeconds: 20,
  });
  assert.equal(completed.ok, true, JSON.stringify(completed));
  assert.equal((completed.operation as { state: string }).state, "failed_settled_without_result");
  assert.equal((completed.operation as { terminal: boolean }).terminal, true);
  assert.notEqual(completed.receipt, null);
  assert.deepEqual(
    fixture.rpc.x402Calls.filter((call) => call.startsWith("logs:")),
    ["logs:12345-12345", "logs:12346-14393", "logs:14394-15345"],
  );
  assert.equal(fixture.http.calls.length, 2, "challenge plus one paid GET only");
  assert.equal(fixture.native.calls.length, 1, "one existing authorization retrieval only");
  assert.equal((await operation(fixture)).attempts.filter((attempt) => attempt.purpose === "payment").length, 1);
  assert.equal(fixture.rpc.submissions.length, 0);
});

test("bounded settlement timeout remains resumable without another authorization or paid request", async (t) => {
  const wait = new ControlledWait();
  const fixture = await authorizedFixture(t, {
    idempotencyKey: "bounded-settlement-timeout",
    wait,
    paidOutcomes: [paidObservation({
      paymentResponseHeader: canonicalPaymentResponseHeader({
        success: true,
        transaction: X402_TRANSACTION,
        network: "eip155:8453",
        payer: X402_TEST_ACCOUNT.address.toLowerCase(),
        amount: "1250000",
      }),
    })],
  });
  const timedOut = await fixture.core.execute({
    command: "operation.resume",
    operationId: fixture.operationId,
    waitSeconds: 1,
  });
  assert.equal(timedOut.ok, true, JSON.stringify(timedOut));
  assert.equal((timedOut.operation as { state: string }).state, "settlement_pending");
  assert.equal((timedOut.operation as { reason: string }).reason, "x402_settlement_wait_timeout");
  assert.deepEqual((timedOut.operation as { settlementWait: unknown }).settlementWait, {
    outcome: "timeout",
    requestedSeconds: "1",
    observationCount: "1",
  });
  assert.equal(fixture.http.calls.length, 2);
  assert.deepEqual(fixture.native.calls.map((call) => call.operation), ["x402Exact.authorizationMaterial.get"]);
  assert.equal((await operation(fixture)).attempts.length, 1);

  const resumed = await fixture.core.execute({ command: "operation.resume", operationId: fixture.operationId });
  assert.equal(resumed.ok, true, JSON.stringify(resumed));
  assert.equal(fixture.http.calls.length, 2, "manual recovery must not replay the paid GET");
  assert.equal(fixture.native.calls.length, 1, "manual recovery must not create or retrieve another authorization");
  assert.equal(fixture.rpc.submissions.length, 0);
});

test("bounded wait caps the second local RPC observation inside the same caller deadline", async (t) => {
  const rpc = new SlowSecondBoundedRpc();
  const fixture = await authorizedFixture(t, {
    idempotencyKey: "bounded-local-rpc-total-deadline",
    rpc,
    paidOutcomes: [new Error("ambiguous paid request")],
  });
  await fixture.core.execute({ command: "operation.resume", operationId: fixture.operationId });
  assert.equal((await operation(fixture)).state, "effect_unknown");
  const started = performance.now();
  const response = await fixture.core.execute({
    command: "operation.resume", operationId: fixture.operationId, waitSeconds: 1,
  });
  const elapsed = performance.now() - started;
  assert.equal(response.ok, true, JSON.stringify(response));
  assert.ok(elapsed < 1_500, `local bounded RPC exceeded caller window: ${elapsed}ms`);
  assert.deepEqual({
    reason: (response.operation as { reason?: unknown }).reason,
    proofClass: (response.operation as { proofClass?: unknown }).proofClass,
    settlementWait: (response.operation as { settlementWait?: unknown }).settlementWait,
  }, {
    reason: "x402_settlement_wait_timeout",
    proofClass: "x402_unknown_finality",
    settlementWait: { outcome: "timeout", requestedSeconds: "1", observationCount: "0" },
  });
  assert.equal(rpc.boundedCalls.length, 2);
  assert.ok(rpc.boundedCalls.every((value) => value <= 1_000));
  assert.equal(fixture.http.calls.length, 2, "bounded observation must not replay the paid request");
});

test("one-second bounded wait caps the permitted paid HTTP and journals timeout ambiguity", async (t) => {
  const wait = new ControlledWait();
  const fixture = await authorizedFixture(t, {
    idempotencyKey: "bounded-paid-http-deadline",
    wait,
    paidOutcomes: [paidObservation()],
    onHttpCall: (request, callNumber) => {
      if (callNumber !== 2) return;
      assert.equal(request.timeoutMs, 750);
      wait.value += request.timeoutMs;
      throw new Error("injected paid HTTP timeout");
    },
  });
  let consumedRpcBudget = false;
  fixture.rpc.onX402Call = () => {
    if (consumedRpcBudget) return;
    consumedRpcBudget = true;
    wait.value += 250;
  };
  const response = await fixture.core.execute({
    command: "operation.resume", operationId: fixture.operationId, waitSeconds: 1,
  });
  assert.equal(response.ok, true, JSON.stringify(response));
  assert.equal((response.operation as { state?: unknown }).state, "effect_unknown");
  assert.deepEqual((response.operation as { settlementWait?: unknown }).settlementWait, {
    outcome: "timeout", requestedSeconds: "1", observationCount: "0",
  });
  const durable = await operation(fixture);
  assert.deepEqual(durable.attempts.map((attempt) => [attempt.purpose, attempt.phase]), [["payment", "ambiguous"]]);
  assert.equal(fixture.http.calls.length, 2);
  assert.equal(wait.value, 1_000);
});

test("one-second bounded wait caps cached result-recovery HTTP without replay", async (t) => {
  const wait = new ControlledWait();
  const fixture = await authorizedFixture(t, {
    paymentIdentifier: true,
    idempotencyKey: "bounded-result-recovery-http-deadline",
    wait,
    paidOutcomes: [new Error("initial ambiguity"), paidObservation()],
    onHttpCall: (request, callNumber) => {
      if (callNumber !== 3) return;
      assert.equal(request.timeoutMs, 750);
      wait.value += request.timeoutMs;
      throw new Error("injected result-recovery HTTP timeout");
    },
  });
  await fixture.core.execute({ command: "operation.resume", operationId: fixture.operationId });
  await advanceSafeAndReset(fixture);
  const exposed = await operation(fixture);
  const settlement = configureSettlement(fixture.rpc, exposed);
  fixture.rpc.logOutcomes.push({ kind: "complete", logs: [settlement.logs[0]!] });
  let consumedRpcBudget = false;
  fixture.rpc.onX402Call = () => {
    if (consumedRpcBudget) return;
    consumedRpcBudget = true;
    wait.value += 250;
  };
  const response = await fixture.core.execute({
    command: "operation.resume", operationId: fixture.operationId, waitSeconds: 1,
  });
  assert.equal(response.ok, true, JSON.stringify(response));
  assert.equal((response.operation as { state?: unknown }).state, "failed_settled_without_result");
  assert.deepEqual((response.operation as { settlementWait?: unknown }).settlementWait, {
    outcome: "timeout", requestedSeconds: "1", observationCount: "0",
  });
  const durable = await operation(fixture);
  assert.deepEqual(durable.attempts.map((attempt) => [attempt.purpose, attempt.phase]), [
    ["payment", "ambiguous"], ["result_recovery", "ambiguous"],
  ]);
  assert.equal(fixture.http.calls.length, 3);
  assert.equal(wait.value, 1_000);
  await fixture.core.execute({ command: "operation.resume", operationId: fixture.operationId });
  assert.equal(fixture.http.calls.length, 3, "terminal recovery timeout must never replay seller HTTP");
});

test("interrupted bounded wait restarts from the same operation and never duplicates payment effects", async (t) => {
  const wait = new ControlledWait();
  wait.outcome = "interrupted";
  const fixture = await authorizedFixture(t, {
    idempotencyKey: "bounded-settlement-interrupt-restart",
    wait,
    paidOutcomes: [paidObservation({
      paymentResponseHeader: canonicalPaymentResponseHeader({
        success: true,
        transaction: X402_TRANSACTION,
        network: "eip155:8453",
        payer: X402_TEST_ACCOUNT.address.toLowerCase(),
        amount: "1250000",
      }),
    })],
  });
  const interrupted = await fixture.core.execute({
    command: "operation.resume",
    operationId: fixture.operationId,
    waitSeconds: 10,
  });
  assert.equal(interrupted.ok, true, JSON.stringify(interrupted));
  assert.equal((interrupted.operation as { state: string }).state, "settlement_pending");
  assert.deepEqual((interrupted.operation as { settlementWait: unknown }).settlementWait, {
    outcome: "interrupted",
    requestedSeconds: "10",
    observationCount: "1",
  });
  assert.equal(fixture.http.calls.length, 2);
  assert.equal(fixture.native.calls.length, 1);

  configureSettlement(fixture.rpc, await operation(fixture));
  const restarted = makeCore({
    root: fixture.root,
    native: fixture.native,
    rpc: fixture.rpc,
    http: fixture.http,
    clock: fixture.clock,
    wait: new ControlledWait(),
  });
  const completed = await restarted.execute({
    command: "operation.resume",
    operationId: fixture.operationId,
    waitSeconds: 10,
  });
  assert.equal(completed.ok, true, JSON.stringify(completed));
  assert.equal((completed.operation as { state: string }).state, "completed");
  assert.equal(fixture.http.calls.length, 2, "restart must not issue another paid GET");
  assert.equal(fixture.native.calls.length, 1, "restart must not retrieve or create another authorization");
  assert.equal((await operation(fixture)).attempts.filter((attempt) => attempt.purpose === "payment").length, 1);
  assert.equal(fixture.rpc.submissions.length, 0);
});

test("bounded wait rejects unsafe RPC provenance and pre-approval state before payment effects", async (t) => {
  const wrongChain = await authorizedFixture(t, { idempotencyKey: "bounded-wrong-chain" });
  wrongChain.rpc.assertBaseChain = async () => {
    throw new ApnError("APN_CHAIN_MISMATCH", "wrong chain");
  };
  const rejected = await wrongChain.core.execute({
    command: "operation.resume",
    operationId: wrongChain.operationId,
    waitSeconds: 1,
  });
  assert.equal(rejected.error?.code, "APN_CHAIN_MISMATCH");
  assert.equal(wrongChain.http.calls.length, 1, "wait preflight must not send a paid GET");
  assert.equal(wrongChain.native.calls.length, 0);
  assert.equal((await operation(wrongChain)).state, "authorized_not_sent");

  const temporary = await temporaryState();
  t.after(temporary.cleanup);
  const native = new ExactX402Native();
  const rpc = new RecoveryRpc();
  rpc.x402Evidence = { ...rpc.x402Evidence, address: X402_TEST_ACCOUNT.address };
  const http = new QueuedHttp([challengeObservation()]);
  const core = makeCore({ root: temporary.root, native, rpc, http });
  assert.equal((await core.execute({ command: "wallet.ensure", profile: "default" })).ok, true);
  const prepared = await core.execute({
    command: "x402.fetch.prepare",
    profile: "default",
    url: X402_URL,
    idempotencyKey: "bounded-awaiting-approval",
  });
  const operationId = (prepared.operation as { operationId: string }).operationId;
  native.calls.length = 0;
  rpc.x402Calls.length = 0;
  const unsafeState = await core.execute({
    command: "operation.resume",
    operationId,
    waitSeconds: 1,
  });
  assert.equal(unsafeState.error?.code, "APN_OPERATION_BLOCKED");
  assert.equal(http.calls.length, 1);
  assert.equal(native.calls.length, 0);
  assert.equal(rpc.x402Calls.length, 0);
});

test("a complete pre-send AuthorizationUsed scan persists effect-unknown without paid HTTP", async (t) => {
  const fixture = await authorizedFixture(t, { idempotencyKey: "pre-send-complete-candidate" });
  const authorized = await operation(fixture);
  fixture.rpc.logOutcomes.push({ kind: "complete", logs: [authorizationUsedLog({
    authorizer: authorized.wallet,
    nonce: authorized.authorization.nonce,
    transactionHash: X402_TRANSACTION as Hex,
    blockNumber: fixture.rpc.safeHead.number,
    blockHash: fixture.rpc.safeHead.hash,
  })] });

  const resumed = await fixture.core.execute({ command: "operation.resume", operationId: fixture.operationId });
  assert.equal(resumed.ok, true, JSON.stringify(resumed));
  const durable = await operation(fixture);
  assert.equal(durable.state, "effect_unknown");
  assert.equal(durable.attempts.length, 0);
  assert.equal(durable.authorizationUsedScan?.status, "complete");
  assert.equal(durable.authorizationUsedScan?.candidates.length, 1);
  assert.equal(durable.transactionHint?.source, "authorization_used_log");
  assert.equal(fixture.http.calls.length, 1, "pre-send settlement evidence cannot trigger a paid request");
  assert.deepEqual(fixture.native.calls, [], "pre-send settlement evidence is reconciled before material recovery");
});

test("a provisional pre-send AuthorizationUsed candidate persists its multi-chunk cursor", async (t) => {
  const fixture = await authorizedFixture(t, { idempotencyKey: "pre-send-provisional-candidate" });
  const authorized = await operation(fixture);
  fixture.rpc.safeHead = {
    ...fixture.rpc.safeHead,
    number: (BigInt(authorized.preparedBlock.number) + 3000n).toString(),
    hash: `0x${"e".repeat(64)}` as Hex,
  };
  fixture.rpc.logOutcomes.push({ kind: "complete", logs: [authorizationUsedLog({
    authorizer: authorized.wallet,
    nonce: authorized.authorization.nonce,
    transactionHash: X402_TRANSACTION as Hex,
    blockNumber: authorized.preparedBlock.number,
    blockHash: authorized.preparedBlock.hash,
  })] });

  const first = await fixture.core.execute({ command: "operation.resume", operationId: fixture.operationId });
  assert.equal(first.ok, true, JSON.stringify(first));
  let durable = await operation(fixture);
  assert.equal(durable.state, "effect_unknown");
  assert.equal(durable.attempts.length, 0);
  assert.equal(durable.authorizationUsedScan?.status, "active");
  assert.equal(durable.authorizationUsedScan?.candidates.length, 1);
  assert.equal(durable.authorizationUsedScan?.nextFromBlock, (BigInt(authorized.preparedBlock.number) + 2048n).toString());
  assert.deepEqual(
    fixture.rpc.x402Calls.filter((call) => call.startsWith("logs:")),
    [`logs:${authorized.preparedBlock.number}-${(BigInt(authorized.preparedBlock.number) + 2047n).toString()}`],
  );
  assert.equal(fixture.http.calls.length, 1);
  assert.deepEqual(fixture.native.calls, []);

  fixture.rpc.logOutcomes.push({ kind: "complete", logs: [] });
  const second = await fixture.core.execute({ command: "operation.resume", operationId: fixture.operationId });
  assert.equal(second.ok, true, JSON.stringify(second));
  durable = await operation(fixture);
  assert.equal(durable.authorizationUsedScan?.status, "complete");
  assert.equal(durable.authorizationUsedScan?.candidates.length, 1);
  assert.equal(durable.transactionHint?.source, "authorization_used_log");
  assert.deepEqual(
    fixture.rpc.x402Calls.filter((call) => call.startsWith("logs:")),
    [
      `logs:${authorized.preparedBlock.number}-${(BigInt(authorized.preparedBlock.number) + 2047n).toString()}`,
      `logs:${(BigInt(authorized.preparedBlock.number) + 2048n).toString()}-${fixture.rpc.safeHead.number}`,
    ],
    "the second resume continues from the fsynced cursor instead of repeating the first chunk",
  );
  assert.equal(fixture.http.calls.length, 1);
  assert.deepEqual(fixture.native.calls, []);
});

test("zero-attempt effect-unknown cannot invent an empty active scan", async (t) => {
  const fixture = await authorizedFixture(t, { idempotencyKey: "invalid-empty-pre-send-scan" });
  const authorized = await operation(fixture);
  const scanBody = {
    schemaVersion: "apn.x402.authorization-used-scan.v1" as const,
    searchStartBlock: authorized.preparedBlock.number,
    nextFromBlock: authorized.preparedBlock.number,
    targetSafeHead: {
      number: fixture.rpc.safeHead.number,
      hash: fixture.rpc.safeHead.hash,
      observedAt: fixture.rpc.safeHead.observedAt,
    },
    candidates: [],
    status: "active" as const,
    updatedAt: authorized.updatedAt,
  };
  const { integrityHash: _integrityHash, ...withoutIntegrity } = authorized;
  const invalid = sealX402Operation({
    ...withoutIntegrity,
    authorizationUsedScan: {
      ...scanBody,
      evidenceHash: domainHash("apn.x402.authorization-used-scan.v1", canonicalJson(scanBody)),
    },
    state: "effect_unknown",
    finalityClass: "unknown_finality",
    reason: "x402_effect_unknown",
    proofClass: "x402_unknown_finality",
    nextActions: ["operation.resume", "operation.status"],
    transitions: appendX402Transition(authorized.transitions, {
      at: authorized.updatedAt,
      state: "effect_unknown",
      terminal: false,
      reason: "x402_effect_unknown",
      proofClass: "x402_unknown_finality",
    }),
  });
  await assert.rejects(
    fixture.core.context.state.writeX402Operation(invalid),
    { code: "APN_STATE_CORRUPT" },
    "an empty zero-attempt scan is valid only as the durable reset after prior effect-unknown evidence",
  );
  const { integrityHash: _invalidIntegrityHash, ...invalidWithoutIntegrity } = invalid;
  const twoTransitionBypass = sealX402Operation({
    ...invalidWithoutIntegrity,
    transitions: appendX402Transition(invalid.transitions, {
      at: authorized.updatedAt,
      state: "effect_unknown",
      terminal: false,
      reason: "x402_effect_unknown",
      proofClass: "x402_unknown_finality",
    }),
  });
  await assert.rejects(
    fixture.core.context.state.writeX402Operation(twoTransitionBypass),
    { code: "APN_STATE_CORRUPT" },
    "one atomic overwrite cannot invent reorg lineage by appending two transitions",
  );
});

test("pre-send AuthorizationUsed candidates reset durably after a canonical reorg", async (t) => {
  for (const posture of ["complete", "provisional"] as const) {
    await t.test(posture, async (nested) => {
      const fixture = await authorizedFixture(nested, { idempotencyKey: `pre-send-candidate-reorg-${posture}` });
      const authorized = await operation(fixture);
      if (posture === "provisional") {
        fixture.rpc.safeHead = {
          ...fixture.rpc.safeHead,
          number: (BigInt(authorized.preparedBlock.number) + 3000n).toString(),
          hash: `0x${"e".repeat(64)}` as Hex,
        };
      }
      fixture.rpc.logOutcomes.push({ kind: "complete", logs: [authorizationUsedLog({
        authorizer: authorized.wallet,
        nonce: authorized.authorization.nonce,
        transactionHash: X402_TRANSACTION as Hex,
        blockNumber: authorized.preparedBlock.number,
        blockHash: authorized.preparedBlock.hash,
      })] });
      await fixture.core.execute({ command: "operation.resume", operationId: fixture.operationId });
      const candidate = await operation(fixture);
      assert.equal(candidate.state, "effect_unknown");
      assert.equal(candidate.attempts.length, 0);
      assert.equal(candidate.authorizationUsedScan?.status, posture === "complete" ? "complete" : "active");
      assert.equal(candidate.authorizationUsedScan?.candidates.length, 1);

      fixture.rpc.safeHead = {
        ...fixture.rpc.safeHead,
        number: candidate.authorizationUsedScan!.targetSafeHead.number,
        hash: `0x${"f".repeat(64)}` as Hex,
      };
      fixture.rpc.x402Calls.length = 0;
      const resumed = await fixture.core.execute({ command: "operation.resume", operationId: fixture.operationId });
      assert.equal(resumed.ok, true, JSON.stringify(resumed));
      const reset = await operation(fixture);
      assert.equal(reset.state, "effect_unknown");
      assert.equal(reset.attempts.length, 0);
      assert.equal(reset.authorizationUsedScan?.status, "active");
      assert.equal(reset.authorizationUsedScan?.nextFromBlock, reset.authorizationUsedScan?.searchStartBlock);
      assert.equal(reset.authorizationUsedScan?.lastCompletedChunk, undefined);
      assert.deepEqual(reset.authorizationUsedScan?.candidates, []);
      assert.equal(reset.authorizationUsedScan?.targetSafeHead.hash, fixture.rpc.safeHead.hash);
      assert.equal(reset.transactionHint, undefined);
      assert.equal(fixture.rpc.x402Calls.some((call) => call.startsWith("logs:")), false);
      assert.equal(fixture.http.calls.length, 1);
      assert.deepEqual(fixture.native.calls, []);

      fixture.rpc.logOutcomes.push({ kind: "complete", logs: [] });
      if (posture === "provisional") fixture.rpc.logOutcomes.push({ kind: "complete", logs: [] });
      fixture.rpc.x402Calls.length = 0;
      await fixture.core.execute({ command: "operation.resume", operationId: fixture.operationId });
      if (posture === "provisional") {
        const progressed = await operation(fixture);
        assert.equal(progressed.authorizationUsedScan?.status, "active");
        await fixture.core.execute({ command: "operation.resume", operationId: fixture.operationId });
      }
      const rescanned = await operation(fixture);
      assert.equal(rescanned.state, "effect_unknown");
      assert.equal(rescanned.attempts.length, 0);
      assert.equal(rescanned.authorizationUsedScan?.status, "complete");
      assert.deepEqual(rescanned.authorizationUsedScan?.candidates, []);
      const start = BigInt(rescanned.authorizationUsedScan!.searchStartBlock);
      const target = BigInt(rescanned.authorizationUsedScan!.targetSafeHead.number);
      assert.deepEqual(
        fixture.rpc.x402Calls.filter((call) => call.startsWith("logs:")),
        target === start
          ? [`logs:${start.toString()}-${start.toString()}`]
          : [
              `logs:${start.toString()}-${(start + 2047n).toString()}`,
              `logs:${(start + 2048n).toString()}-${target.toString()}`,
            ],
        "the reset scan resumes from the immutable start and completes without repeating a chunk",
      );

      const priorTarget = rescanned.authorizationUsedScan!.targetSafeHead;
      fixture.rpc.blockHashes.set(priorTarget.number, priorTarget.hash as Hex);
      fixture.rpc.safeHead = {
        ...fixture.rpc.safeHead,
        number: (BigInt(priorTarget.number) + 1n).toString(),
        hash: `0x${"c".repeat(64)}` as Hex,
      };
      fixture.rpc.logOutcomes.push({ kind: "complete", logs: [] });
      fixture.rpc.x402Calls.length = 0;
      await fixture.core.execute({ command: "operation.resume", operationId: fixture.operationId });
      const extended = await operation(fixture);
      assert.equal(extended.authorizationUsedScan?.status, "complete");
      assert.equal(extended.authorizationUsedScan?.targetSafeHead.number, fixture.rpc.safeHead.number);
      assert.deepEqual(
        fixture.rpc.x402Calls.filter((call) => call.startsWith("logs:")),
        [`logs:${fixture.rpc.safeHead.number}-${fixture.rpc.safeHead.number}`],
      );
      assert.equal(fixture.http.calls.length, 1);
      assert.deepEqual(fixture.native.calls, []);
    });
  }
});

test("RPC log availability classifier separates history/range gaps from rate limiting", () => {
  assert.equal(classifyX402LogAvailabilityMessage("historical state pruned"), "pruned");
  assert.equal(classifyX402LogAvailabilityMessage("block range limit exceeded"), "range_unavailable");
  assert.equal(classifyX402LogAvailabilityMessage("query returned more than 10000 results"), "range_unavailable");
  assert.equal(classifyX402LogAvailabilityMessage("rate limit exceeded"), null);
  assert.equal(classifyX402LogAvailabilityMessage("historical state request was rate limited"), null);
  assert.equal(classifyX402LogAvailabilityMessage("logs query was rate-limited"), null);
  assert.equal(classifyX402LogAvailabilityMessage("too many requests"), null);
  assert.equal(classifyX402LogAvailabilityMessage("historical state request rate limit exceeded"), null);
  assert.equal(classifyX402LogAvailabilityMessage("history unavailable: request limit exceeded"), null);
});

test("rate-limited log faults preserve the active cursor without archival classification", async (t) => {
  for (const [caseName, message] of [
    ["historical-state", "historical state request was rate limited"],
    ["logs-query", "logs query was rate-limited"],
  ] as const) {
    await t.test(caseName, async (nested) => {
      const fixture = await authorizedFixture(nested, { idempotencyKey: `rpc-rate-limited-${caseName}` });
      fixture.rpc.safeHead = {
        ...fixture.rpc.safeHead,
        number: "15345",
        hash: `0x${"e".repeat(64)}` as Hex,
      };
      fixture.rpc.logOutcomes.push({ kind: "complete", logs: [] });
      const first = await fixture.core.execute({ command: "operation.resume", operationId: fixture.operationId });
      assert.equal(first.ok, true, JSON.stringify(first));
      const beforeFault = await operation(fixture);
      assert.equal(beforeFault.authorizationUsedScan?.status, "active");
      assert.equal(beforeFault.authorizationUsedScan?.nextFromBlock, "14393");
      fixture.rpc.blockHashes.set(
        beforeFault.authorizationUsedScan!.targetSafeHead.number,
        beforeFault.authorizationUsedScan!.targetSafeHead.hash as Hex,
      );
      fixture.rpc.blockHashes.set(
        beforeFault.authorizationUsedScan!.lastCompletedChunk!.toBlock,
        beforeFault.authorizationUsedScan!.lastCompletedChunk!.toBlockHash as Hex,
      );
      const httpCalls = fixture.http.calls.length;
      const nativeCalls = fixture.native.calls.length;
      fixture.rpc.onX402Call = (name) => {
        if (name.startsWith("logs:")) {
          assert.equal(classifyX402LogAvailabilityMessage(message), null);
          throw new ApnError("APN_RPC_AMBIGUOUS", "transient rate-limit fault");
        }
      };

      const resumed = await fixture.core.execute({ command: "operation.resume", operationId: fixture.operationId });
      assert.equal(resumed.ok, true, JSON.stringify(resumed));
      const afterFault = await operation(fixture);
      assert.equal(afterFault.integrityHash, beforeFault.integrityHash);
      assert.deepEqual(afterFault.authorizationUsedScan, beforeFault.authorizationUsedScan);
      assert.equal(afterFault.nextActions.includes("use.archival_rpc"), false);
      assert.equal(fixture.http.calls.length, httpCalls);
      assert.equal(fixture.native.calls.length, nativeCalls);
    });
  }
});

test("top-level transient chain, safe, and finalized RPC faults preserve the durable operation", async (t) => {
  for (const faultAt of ["chain", "safe", "finalized"] as const) {
    await t.test(faultAt, async (nested) => {
      const fixture = await authorizedFixture(nested, { idempotencyKey: `rpc-fault-${faultAt}` });
      await fixture.core.execute({ command: "operation.resume", operationId: fixture.operationId });
      const durable = await operation(fixture);
      if (faultAt === "finalized") {
        fixture.clock.advance(61_000);
        fixture.rpc.safeHead = {
          ...fixture.rpc.safeHead,
          timestamp: durable.authorization.validBefore,
          observedAt: fixture.clock.now().toISOString(),
        };
      }
      const httpCalls = fixture.http.calls.length;
      const nativeCalls = fixture.native.calls.length;
      fixture.rpc.onX402Call = (name) => {
        if (name === faultAt) throw new ApnError("APN_RPC_AMBIGUOUS", `transient ${faultAt} fault`);
      };

      const resumed = await fixture.core.execute({ command: "operation.resume", operationId: fixture.operationId });
      assert.equal(resumed.ok, true, JSON.stringify(resumed));
      assert.equal((resumed.operation as { readonly state?: unknown } | null)?.state, durable.state);
      assert.equal(fixture.http.calls.length, httpCalls);
      assert.equal(fixture.native.calls.length, nativeCalls);
      assert.equal((await operation(fixture)).integrityHash, durable.integrityHash);
    });
  }
});

test("recoverable RPC faults after intermediate fsync return the latest durable operation", async (t) => {
  await t.test("settlement hint before pinned authorization-state read", async (nested) => {
    const fixture = await authorizedFixture(nested, { idempotencyKey: "rpc-fault-after-hint-fsync" });
    await fixture.core.execute({ command: "operation.resume", operationId: fixture.operationId });
    await advanceSafeAndReset(fixture);
    const exposed = await operation(fixture);
    const settlement = configureSettlement(fixture.rpc, exposed);
    fixture.rpc.logOutcomes.push({ kind: "complete", logs: [settlement.logs[0]!] });
    const authorizationStateRead = `state:${fixture.rpc.safeHead.number}`;
    fixture.rpc.onX402Call = (name) => {
      if (name === authorizationStateRead) {
        throw new ApnError("APN_RPC_AMBIGUOUS", "pinned authorization-state fault after hint fsync");
      }
    };

    const resumed = await fixture.core.execute({ command: "operation.resume", operationId: fixture.operationId });
    assert.equal(resumed.ok, true, JSON.stringify(resumed));
    delete fixture.rpc.onX402Call;
    const durable = await operation(fixture);
    assert.equal(durable.authorizationUsedScan?.status, "complete");
    assert.equal(durable.transactionHint?.transactionHash, X402_TRANSACTION);
    assert.equal(durable.settlementEvidence, undefined);
    const status = await fixture.core.execute({ command: "operation.status", operationId: fixture.operationId });
    assert.deepEqual(resumed.operation, status.operation);
    assert.equal(fixture.http.calls.length, 2);
    assert.equal(fixture.native.calls.length, 1);
  });

  await t.test("zero scan before finalized-head recheck", async (nested) => {
    const fixture = await authorizedFixture(nested, { idempotencyKey: "rpc-fault-after-zero-scan-fsync" });
    const current = await operation(fixture);
    fixture.clock.advance(61_000);
    fixture.rpc.safeHead = {
      ...fixture.rpc.safeHead,
      timestamp: current.authorization.validBefore,
      observedAt: fixture.clock.now().toISOString(),
    };
    fixture.rpc.finalizedHead = {
      queriedTag: "finalized",
      number: fixture.rpc.safeHead.number,
      hash: fixture.rpc.safeHead.hash,
      timestamp: current.authorization.validBefore,
      observedAt: fixture.rpc.safeHead.observedAt,
      rpcOrigin: fixture.rpc.rpcOrigin,
    };
    fixture.rpc.logOutcomes.push({ kind: "complete", logs: [] });
    let finalizedReads = 0;
    fixture.rpc.onX402Call = (name) => {
      if (name === "finalized" && ++finalizedReads === 2) {
        throw new ApnError("APN_RPC_AMBIGUOUS", "finalized-head recheck fault after zero-scan fsync");
      }
    };

    const resumed = await fixture.core.execute({ command: "operation.resume", operationId: fixture.operationId });
    assert.equal(resumed.ok, true, JSON.stringify(resumed));
    delete fixture.rpc.onX402Call;
    const durable = await operation(fixture);
    assert.equal(durable.state, "authorized_not_sent");
    assert.equal(durable.authorizationUsedScan?.status, "complete");
    assert.equal(durable.unusedExpiryEvidence, undefined);
    const status = await fixture.core.execute({ command: "operation.status", operationId: fixture.operationId });
    assert.deepEqual(resumed.operation, status.operation);
    assert.equal(fixture.http.calls.length, 1);
    assert.deepEqual(fixture.native.calls, []);
  });
});

test("response hint is fsynced before ordered receipt reconciliation and terminal commit", async (t) => {
  const response = paidObservation({
    paymentResponseHeader: canonicalPaymentResponseHeader({
      success: true,
      transaction: X402_TRANSACTION,
      network: "eip155:8453",
      payer: X402_TEST_ACCOUNT.address.toLowerCase(),
      amount: "1250000",
    }),
  });
  const fixture = await authorizedFixture(t, { paidOutcomes: [response], idempotencyKey: "response-hint" });
  const exposed = await fixture.core.execute({ command: "operation.resume", operationId: fixture.operationId });
  assert.equal((exposed.operation as { readonly state?: unknown } | null)?.state, "settlement_pending");
  fixture.rpc.x402Calls.length = 0;
  const preterminal = await operation(fixture);
  configureSettlement(fixture.rpc, preterminal);
  let responseDurableBeforeReceipt = false;
  fixture.rpc.onX402Call = async (name) => {
    if (name !== "receipt") return;
    const durable = await operation(fixture);
    responseDurableBeforeReceipt = durable.settlementResponseObservation !== undefined && durable.transactionHint !== undefined;
  };

  const completed = await fixture.core.execute({ command: "operation.resume", operationId: fixture.operationId });
  assert.equal(completed.ok, true, JSON.stringify(completed));
  assert.equal((completed.operation as { readonly state?: unknown } | null)?.state, "completed");
  assert.equal(responseDurableBeforeReceipt, true);
  assert.deepEqual(fixture.rpc.x402Calls, ["chain", "safe", "receipt", "block:12345", "state:12345", "block:12345"]);
  const terminal = await operation(fixture);
  const receipt = await fixture.core.context.state.loadX402Receipt(terminal.profileHash, terminal.operationId);
  assert.equal(receipt?.previousLinkHash, terminal.transitions.at(-1)?.previousHash);
  assert.equal(receipt?.settlementResponseHash, terminal.settlementResponseObservation?.settlementResponseHash);
  assert.equal(fixture.rpc.submissions.length, 0);
});

test("settlement pins the observed safe block while the safe tag advances", async (t) => {
  const response = paidObservation({
    paymentResponseHeader: canonicalPaymentResponseHeader({
      success: true,
      transaction: X402_TRANSACTION,
      network: "eip155:8453",
      payer: X402_TEST_ACCOUNT.address.toLowerCase(),
      amount: "1250000",
    }),
  });
  const fixture = await authorizedFixture(t, { paidOutcomes: [response], idempotencyKey: "safe-tag-advance-mid-proof" });
  const exposed = await fixture.core.execute({ command: "operation.resume", operationId: fixture.operationId });
  assert.equal((exposed.operation as { readonly state?: unknown } | null)?.state, "settlement_pending");
  const operationBeforeProof = await operation(fixture);
  const observedSafe = { ...fixture.rpc.safeHead };
  configureSettlement(fixture.rpc, operationBeforeProof);
  fixture.rpc.blockHashes.set(observedSafe.number, observedSafe.hash);
  fixture.rpc.blockTimestamps.set(observedSafe.number, observedSafe.timestamp);
  fixture.rpc.onX402Call = (name) => {
    if (name !== "receipt") return;
    fixture.rpc.safeHead = {
      ...fixture.rpc.safeHead,
      number: (BigInt(fixture.rpc.safeHead.number) + 1n).toString(),
      hash: `0x${"e".repeat(64)}` as Hex,
    };
  };

  const completed = await fixture.core.execute({ command: "operation.resume", operationId: fixture.operationId });
  assert.equal(completed.ok, true, JSON.stringify(completed));
  assert.equal((completed.operation as { readonly state?: unknown } | null)?.state, "completed");
  const terminal = await operation(fixture);
  assert.equal(terminal.settlementEvidence?.safeHead.number, observedSafe.number);
  assert.equal(terminal.settlementEvidence?.safeHead.hash, observedSafe.hash);
  assert.equal(terminal.settlementEvidence?.schemaVersion, "apn.x402.settlement-evidence.v1");
  if (terminal.settlementEvidence?.schemaVersion !== "apn.x402.settlement-evidence.v1") {
    throw new Error("expected EIP-3009 settlement evidence");
  }
  assert.equal(terminal.settlementEvidence.authorizationState.blockTag, "number");
  assert.equal(terminal.settlementEvidence.authorizationState.blockNumber, observedSafe.number);
});

test("a completed unique AuthorizationUsed scan produces a bound hint and scan-backed spent receipt", async (t) => {
  const fixture = await authorizedFixture(t, { idempotencyKey: "scan-happy" });
  assert.equal((await fixture.core.execute({ command: "operation.resume", operationId: fixture.operationId })).ok, true);
  await advanceSafeAndReset(fixture);
  const exposed = await operation(fixture);
  const settlement = configureSettlement(fixture.rpc, exposed);
  fixture.rpc.logOutcomes.push({ kind: "complete", logs: [settlement.logs[0]!] });
  fixture.rpc.x402Calls.length = 0;

  const result = await fixture.core.execute({ command: "operation.resume", operationId: fixture.operationId });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal((result.operation as { readonly state?: unknown } | null)?.state, "failed_settled_without_result");
  const terminal = await operation(fixture);
  assert.equal(terminal.transactionHint?.source, "authorization_used_log");
  assert.equal(terminal.authorizationUsedScan?.status, "complete");
  assert.equal(terminal.authorizationUsedScan?.candidates.length, 1);
  const receipt = await fixture.core.context.state.loadX402Receipt(terminal.profileHash, terminal.operationId);
  assert.equal(receipt?.settlementResponseHash, undefined);
  assert.equal(receipt?.settlementEvidence?.transactionHash, X402_TRANSACTION);
  assert.deepEqual(fixture.rpc.x402Calls, [
    "chain", "safe", "block:12346", "logs:12345-12346", "block:12346", "block:12346",
    "receipt", "block:12346", "state:12346", "block:12346",
  ]);
});

test("canonical safe-head advancement discovers a post-exposure facilitator transaction", async (t) => {
  const fixture = await authorizedFixture(t, { idempotencyKey: "canonical-post-exposure-settlement" });
  await fixture.core.execute({ command: "operation.resume", operationId: fixture.operationId });
  const exposed = await operation(fixture);
  const priorTarget = exposed.authorizationUsedScan?.targetSafeHead;
  assert.notEqual(priorTarget, undefined);
  fixture.rpc.blockHashes.set(priorTarget!.number, priorTarget!.hash as Hex);
  fixture.rpc.safeHead = {
    ...fixture.rpc.safeHead,
    number: (BigInt(fixture.rpc.safeHead.number) + 1n).toString(),
    hash: `0x${"e".repeat(64)}` as Hex,
  };
  const settlement = configureSettlement(fixture.rpc, exposed);
  fixture.rpc.logOutcomes.push({ kind: "complete", logs: [settlement.logs[0]!] });
  fixture.rpc.x402Calls.length = 0;
  const httpCalls = fixture.http.calls.length;
  const nativeCalls = fixture.native.calls.length;

  const resumed = await fixture.core.execute({ command: "operation.resume", operationId: fixture.operationId });
  assert.equal(resumed.ok, true, JSON.stringify(resumed));
  assert.equal((resumed.operation as { readonly state?: unknown } | null)?.state, "failed_settled_without_result");
  const terminal = await operation(fixture);
  assert.equal(terminal.authorizationUsedScan?.searchStartBlock, exposed.authorizationUsedScan?.searchStartBlock);
  assert.equal(terminal.authorizationUsedScan?.targetSafeHead.number, fixture.rpc.safeHead.number);
  assert.deepEqual(
    fixture.rpc.x402Calls.filter((call) => call.startsWith("logs:")),
    [`logs:${(BigInt(priorTarget!.number) + 1n).toString()}-${fixture.rpc.safeHead.number}`],
  );
  assert.equal(fixture.http.calls.length, httpCalls);
  assert.equal(fixture.native.calls.length, nativeCalls);
});

test("state persistence rejects a transitionless completed-zero scan extension", async (t) => {
  const fixture = await authorizedFixture(t, { idempotencyKey: "transitionless-zero-extension" });
  await fixture.core.execute({ command: "operation.resume", operationId: fixture.operationId });
  const current = await operation(fixture);
  assert.equal(current.state, "effect_unknown");
  assert.equal(current.authorizationUsedScan?.status, "complete");
  assert.deepEqual(current.authorizationUsedScan?.candidates, []);
  const targetSafeHead = {
    number: (BigInt(current.authorizationUsedScan!.targetSafeHead.number) + 1n).toString(),
    hash: `0x${"d".repeat(64)}` as Hex,
    observedAt: current.updatedAt,
  };
  const transitionless = transitionlessZeroScanExtension(current, targetSafeHead);
  await assert.rejects(
    fixture.core.context.state.writeX402Operation(transitionless),
    { code: "APN_STATE_CORRUPT" },
    "a completed-zero extension must append a durable self-transition",
  );
  const { integrityHash: _integrityHash, ...withTransitionBody } = transitionless;
  const valid = sealX402Operation({
    ...withTransitionBody,
    transitions: appendX402Transition(current.transitions, {
      at: current.updatedAt,
      state: current.state,
      terminal: false,
      reason: current.reason,
      proofClass: current.proofClass,
    }),
  });
  await fixture.core.context.state.writeX402Operation(valid);
  assert.equal((await operation(fixture)).authorizationUsedScan?.targetSafeHead.number, targetSafeHead.number);
});

test("canonical zero-scan extensions permit one identical retry but never a third paid send", async (t) => {
  const fixture = await authorizedFixture(t, {
    paidOutcomes: [new Error("first ambiguity"), new Error("bounded retry ambiguity")],
    idempotencyKey: "canonical-zero-extension-retry-cap",
  });
  await fixture.core.execute({ command: "operation.resume", operationId: fixture.operationId });
  let durable = await operation(fixture);
  let target = durable.authorizationUsedScan?.targetSafeHead;
  assert.notEqual(target, undefined);
  fixture.rpc.blockHashes.set(target!.number, target!.hash as Hex);
  fixture.rpc.safeHead = {
    ...fixture.rpc.safeHead,
    number: (BigInt(fixture.rpc.safeHead.number) + 1n).toString(),
    hash: `0x${"e".repeat(64)}` as Hex,
  };
  fixture.rpc.logOutcomes.push({ kind: "complete", logs: [] });
  await fixture.core.execute({ command: "operation.resume", operationId: fixture.operationId });
  durable = await operation(fixture);
  assert.equal(durable.attempts.filter((attempt) => attempt.purpose === "payment").length, 2);
  assert.equal(fixture.http.calls.length, 3);

  target = durable.authorizationUsedScan?.targetSafeHead;
  assert.notEqual(target, undefined);
  fixture.rpc.blockHashes.set(target!.number, target!.hash as Hex);
  fixture.rpc.safeHead = {
    ...fixture.rpc.safeHead,
    number: (BigInt(fixture.rpc.safeHead.number) + 1n).toString(),
    hash: `0x${"f".repeat(64)}` as Hex,
  };
  fixture.rpc.logOutcomes.push({ kind: "complete", logs: [] });
  await fixture.core.execute({ command: "operation.resume", operationId: fixture.operationId });
  durable = await operation(fixture);
  assert.equal(durable.attempts.filter((attempt) => attempt.purpose === "payment").length, 2);
  assert.equal(durable.authorizationUsedScan?.targetSafeHead.number, fixture.rpc.safeHead.number);
  assert.equal(fixture.http.calls.length, 3);
});

test("a stale multi-chunk zero completion cannot retry before scanning the latest safe gap", async (t) => {
  const fixture = await authorizedFixture(t, { idempotencyKey: "stale-multichunk-retry-gate" });
  await fixture.core.execute({ command: "operation.resume", operationId: fixture.operationId });
  let durable = await operation(fixture);
  const originalTarget = durable.authorizationUsedScan?.targetSafeHead;
  assert.notEqual(originalTarget, undefined);
  fixture.rpc.blockHashes.set(originalTarget!.number, originalTarget!.hash as Hex);
  fixture.rpc.safeHead = {
    ...fixture.rpc.safeHead,
    number: (BigInt(originalTarget!.number) + 3000n).toString(),
    hash: `0x${"e".repeat(64)}` as Hex,
  };
  fixture.rpc.logOutcomes.push({ kind: "complete", logs: [] });
  const httpCalls = fixture.http.calls.length;
  await fixture.core.execute({ command: "operation.resume", operationId: fixture.operationId });
  durable = await operation(fixture);
  assert.equal(durable.authorizationUsedScan?.status, "active");
  assert.equal(fixture.http.calls.length, httpCalls);

  const frozenTarget = durable.authorizationUsedScan?.targetSafeHead;
  assert.notEqual(frozenTarget, undefined);
  fixture.rpc.blockHashes.set(frozenTarget!.number, frozenTarget!.hash as Hex);
  fixture.rpc.safeHead = {
    ...fixture.rpc.safeHead,
    number: (BigInt(frozenTarget!.number) + 1n).toString(),
    hash: `0x${"f".repeat(64)}` as Hex,
  };
  const settlement = configureSettlement(fixture.rpc, durable);
  fixture.rpc.logOutcomes.push(
    { kind: "complete", logs: [] },
    { kind: "complete", logs: [settlement.logs[0]!] },
  );
  await fixture.core.execute({ command: "operation.resume", operationId: fixture.operationId });
  durable = await operation(fixture);
  assert.equal(durable.authorizationUsedScan?.status, "complete");
  assert.equal(durable.authorizationUsedScan?.targetSafeHead.number, frozenTarget!.number);
  assert.equal(durable.attempts.filter((attempt) => attempt.purpose === "payment").length, 1);
  assert.equal(fixture.http.calls.length, httpCalls);

  const settled = await fixture.core.execute({ command: "operation.resume", operationId: fixture.operationId });
  assert.equal(settled.ok, true, JSON.stringify(settled));
  assert.equal((settled.operation as { readonly state?: unknown } | null)?.state, "failed_settled_without_result");
  assert.equal(fixture.http.calls.length, httpCalls);
});

test("restart reuses fsynced settlement evidence after a crash before receipt write", async (t) => {
  const fixture = await authorizedFixture(t, { idempotencyKey: "settlement-evidence-restart" });
  await fixture.core.execute({ command: "operation.resume", operationId: fixture.operationId });
  await advanceSafeAndReset(fixture);
  const exposed = await operation(fixture);
  const settlement = configureSettlement(fixture.rpc, exposed);
  fixture.rpc.logOutcomes.push({ kind: "complete", logs: [settlement.logs[0]!] });

  const state = fixture.core.context.state;
  const originalWriteReceipt = state.writeX402Receipt.bind(state);
  state.writeX402Receipt = async () => { throw new Error("receipt write crash cut"); };
  const crashed = await fixture.core.execute({ command: "operation.resume", operationId: fixture.operationId });
  assert.equal(crashed.ok, false);
  state.writeX402Receipt = originalWriteReceipt;
  const preterminal = await operation(fixture);
  assert.equal(preterminal.terminal, false);
  assert.equal(preterminal.settlementEvidence?.transactionHash, X402_TRANSACTION);

  const httpCalls = fixture.http.calls.length;
  const nativeCalls = fixture.native.calls.length;
  fixture.rpc.x402Calls.length = 0;
  const restarted = makeCore({
    root: fixture.root,
    clock: fixture.clock,
  });
  const resumed = await restarted.execute({ command: "operation.resume", operationId: fixture.operationId });
  assert.equal(resumed.ok, true, JSON.stringify(resumed));
  assert.equal((resumed.operation as { readonly state?: unknown } | null)?.state, "failed_settled_without_result");
  assert.deepEqual(fixture.rpc.x402Calls, []);
  assert.equal(fixture.http.calls.length, httpCalls);
  assert.equal(fixture.native.calls.length, nativeCalls);
});

test("post-exposure settlement recovery does not depend on unlocked native material", async (t) => {
  const fixture = await authorizedFixture(t, { idempotencyKey: "settlement-keychain-locked" });
  await fixture.core.execute({ command: "operation.resume", operationId: fixture.operationId });
  const nativeCalls = fixture.native.calls.length;
  failRecoveredNativeMaterial(fixture, "APN_KEYCHAIN_LOCKED");

  await advanceSafeAndReset(fixture);
  assert.equal(fixture.native.calls.length, nativeCalls);
  const exposed = await operation(fixture);
  const settlement = configureSettlement(fixture.rpc, exposed);
  fixture.rpc.logOutcomes.push({ kind: "complete", logs: [settlement.logs[0]!] });

  const recovered = await fixture.core.execute({ command: "operation.resume", operationId: fixture.operationId });
  assert.equal(
    (recovered.operation as { readonly state?: unknown } | null)?.state,
    "failed_settled_without_result",
    JSON.stringify(recovered),
  );
  assert.equal(fixture.native.calls.length, nativeCalls);
  assert.equal(fixture.http.calls.length, 2);
});

test("response-backed settlement without seller result commits spent receipt, while duplicate exact logs do not", async (t) => {
  const settlementOnly = paidObservation({
    status: 402,
    bodyText: "settled without cached body",
    paymentResponseHeader: canonicalPaymentResponseHeader({
      success: true,
      transaction: X402_TRANSACTION,
      network: "eip155:8453",
      payer: X402_TEST_ACCOUNT.address.toLowerCase(),
      amount: "1250000",
    }),
  });
  const fixture = await authorizedFixture(t, { paidOutcomes: [settlementOnly], idempotencyKey: "response-spent" });
  await fixture.core.execute({ command: "operation.resume", operationId: fixture.operationId });
  const exposed = await operation(fixture);
  configureSettlement(fixture.rpc, exposed);
  const settled = await fixture.core.execute({ command: "operation.resume", operationId: fixture.operationId });
  assert.equal((settled.operation as { readonly state?: unknown } | null)?.state, "failed_settled_without_result");
  const terminal = await operation(fixture);
  const receipt = await fixture.core.context.state.loadX402Receipt(terminal.profileHash, terminal.operationId);
  assert.equal(receipt?.settlementResponseHash, terminal.settlementResponseObservation?.settlementResponseHash);
  assert.equal(receipt?.result, undefined);

  for (const duplicate of ["authorization", "transfer"] as const) {
    await t.test(`duplicate-${duplicate}`, async (nested) => {
      const ambiguous = await authorizedFixture(nested, {
        paidOutcomes: [settlementOnly],
        idempotencyKey: `duplicate-${duplicate}`,
      });
      await ambiguous.core.execute({ command: "operation.resume", operationId: ambiguous.operationId });
      const current = await operation(ambiguous);
      configureSettlement(ambiguous.rpc, current, {
        duplicateAuthorization: duplicate === "authorization",
        duplicateTransfer: duplicate === "transfer",
      });
      const resumed = await ambiguous.core.execute({ command: "operation.resume", operationId: ambiguous.operationId });
      assert.equal((resumed.operation as { readonly terminal?: unknown } | null)?.terminal, false);
      assert.equal((await operation(ambiguous)).settlementEvidence, undefined);
    });
  }
});

test("one inclusive 2048-block chunk is fsynced per restart and resumes at the exact cursor", async (t) => {
  const fixture = await authorizedFixture(t, {
    paidOutcomes: [new Error("first ambiguity"), new Error("retry ambiguity"), new Error("second retry ambiguity")],
    idempotencyKey: "cursor-restart",
  });
  await fixture.core.execute({ command: "operation.resume", operationId: fixture.operationId });
  fixture.rpc.safeHead = { ...fixture.rpc.safeHead, number: "15345", hash: `0x${"e".repeat(64)}` };
  fixture.rpc.logOutcomes.push({ kind: "complete", logs: [] }, { kind: "complete", logs: [] });
  fixture.rpc.x402Calls.length = 0;

  await fixture.core.execute({ command: "operation.resume", operationId: fixture.operationId });
  fixture.rpc.x402Calls.length = 0;
  await fixture.core.execute({ command: "operation.resume", operationId: fixture.operationId });
  const afterFirst = await operation(fixture);
  assert.equal(afterFirst.authorizationUsedScan?.nextFromBlock, "14393");
  assert.equal(afterFirst.authorizationUsedScan?.lastCompletedChunk?.fromBlock, "12345");
  assert.equal(afterFirst.authorizationUsedScan?.lastCompletedChunk?.toBlock, "14392");
  assert.equal(fixture.rpc.x402Calls.filter((call) => call.startsWith("logs:")).length, 1);

  const restarted = makeCore({ root: fixture.root, native: fixture.native, rpc: fixture.rpc, http: fixture.http, clock: fixture.clock });
  fixture.rpc.x402Calls.length = 0;
  await restarted.execute({ command: "operation.resume", operationId: fixture.operationId });
  const afterSecond = await operation(fixture);
  assert.equal(afterSecond.authorizationUsedScan?.status, "complete");
  assert.equal(afterSecond.authorizationUsedScan?.nextFromBlock, "15346");
  assert.deepEqual(fixture.rpc.x402Calls.filter((call) => call.startsWith("logs:")), ["logs:14393-15345"]);
});

test("normal safe-head advancement preserves the frozen target and continues the next scan chunk", async (t) => {
  const fixture = await authorizedFixture(t, { idempotencyKey: "cursor-safe-advance" });
  const frozenHash = `0x${"e".repeat(64)}` as Hex;
  fixture.rpc.safeHead = { ...fixture.rpc.safeHead, number: "15345", hash: frozenHash };
  fixture.rpc.logOutcomes.push({ kind: "complete", logs: [] }, { kind: "complete", logs: [] });

  const first = await fixture.core.execute({ command: "operation.resume", operationId: fixture.operationId });
  assert.equal(first.ok, true, JSON.stringify(first));
  const afterFirst = await operation(fixture);
  assert.equal(afterFirst.authorizationUsedScan?.status, "active");
  assert.equal(afterFirst.authorizationUsedScan?.nextFromBlock, "14393");
  assert.equal(fixture.http.calls.length, 1);
  fixture.rpc.blockHashes.set("15345", frozenHash);
  fixture.rpc.blockHashes.set("14392", `0x${"d".repeat(64)}` as Hex);

  fixture.rpc.safeHead = {
    ...fixture.rpc.safeHead,
    number: "15346",
    hash: `0x${"f".repeat(64)}` as Hex,
  };
  fixture.rpc.x402Calls.length = 0;
  const second = await fixture.core.execute({ command: "operation.resume", operationId: fixture.operationId });
  assert.equal(second.ok, true, JSON.stringify(second));
  const afterSecond = await operation(fixture);
  assert.equal(afterSecond.authorizationUsedScan?.status, "complete");
  assert.equal(afterSecond.authorizationUsedScan?.targetSafeHead.number, "15345");
  assert.equal(afterSecond.authorizationUsedScan?.nextFromBlock, "15346");
  assert.deepEqual(fixture.rpc.x402Calls.filter((call) => call.startsWith("logs:")), ["logs:14393-15345"]);
  assert.equal(fixture.http.calls.length, 2);
});

test("partial, pruned, range-unavailable, multiple, and used-with-zero evidence stay nonterminal", async (t) => {
  for (const kind of ["pruned", "range_unavailable"] as const) {
    await t.test(kind, async (nested) => {
      const fixture = await authorizedFixture(nested, { idempotencyKey: `unavailable-${kind}` });
      await fixture.core.execute({ command: "operation.resume", operationId: fixture.operationId });
      await advanceSafeAndReset(fixture);
      fixture.rpc.logOutcomes.push({ kind });
      const resumed = await fixture.core.execute({ command: "operation.resume", operationId: fixture.operationId });
      assert.equal((resumed.operation as { readonly state?: unknown } | null)?.state, "effect_unknown");
      const current = await operation(fixture);
      assert.equal(current.authorizationUsedScan?.status, "unavailable");
      assert.equal(current.authorizationUsedScan?.nextFromBlock, current.authorizationUsedScan?.searchStartBlock);
      assert.deepEqual(current.nextActions, ["operation.resume", "operation.status", "use.archival_rpc"]);
    });
  }

  await t.test("partial-malformed", async (nested) => {
    const fixture = await authorizedFixture(nested, { idempotencyKey: "partial-case" });
    await fixture.core.execute({ command: "operation.resume", operationId: fixture.operationId });
    await advanceSafeAndReset(fixture);
    const current = await operation(fixture);
    fixture.rpc.logOutcomes.push({
      kind: "complete",
      logs: [authorizationUsedLog({
        authorizer: current.wallet,
        nonce: current.authorization.nonce,
        transactionHash: X402_TRANSACTION as Hex,
        blockNumber: (BigInt(fixture.rpc.safeHead.number) + 1n).toString(),
        blockHash: `0x${"d".repeat(64)}` as Hex,
      })],
    });
    await fixture.core.execute({ command: "operation.resume", operationId: fixture.operationId });
    const after = await operation(fixture);
    assert.equal(after.authorizationUsedScan?.nextFromBlock, after.authorizationUsedScan?.searchStartBlock);
    assert.equal(after.authorizationUsedScan?.lastCompletedChunk, undefined);
  });

  await t.test("multiple", async (nested) => {
    const fixture = await authorizedFixture(nested, { idempotencyKey: "multiple" });
    await fixture.core.execute({ command: "operation.resume", operationId: fixture.operationId });
    await advanceSafeAndReset(fixture);
    const current = await operation(fixture);
    const first = authorizationUsedLog({
      authorizer: current.wallet,
      nonce: current.authorization.nonce,
      transactionHash: X402_TRANSACTION as Hex,
      blockNumber: fixture.rpc.safeHead.number,
      blockHash: fixture.rpc.safeHead.hash,
    });
    const second = { ...first, transactionHash: `0x${"9".repeat(64)}` as Hex, logIndex: "1" };
    fixture.rpc.logOutcomes.push({ kind: "complete", logs: [first, second] });
    await fixture.core.execute({ command: "operation.resume", operationId: fixture.operationId });
    const after = await operation(fixture);
    assert.equal(after.authorizationUsedScan?.status, "ambiguous");
    assert.equal(after.transactionHint, undefined);
  });

  await t.test("zero-scan-but-used-state", async (nested) => {
    const fixture = await authorizedFixture(nested, {
      paidOutcomes: [new Error("initial ambiguity"), new Error("bounded retry")],
      idempotencyKey: "zero-used",
    });
    await fixture.core.execute({ command: "operation.resume", operationId: fixture.operationId });
    const current = await operation(fixture);
    fixture.clock.advance(61_000);
    fixture.rpc.safeHead = {
      ...fixture.rpc.safeHead,
      timestamp: current.authorization.validBefore,
      observedAt: fixture.clock.now().toISOString(),
    };
    fixture.rpc.finalizedHead = {
      queriedTag: "finalized",
      number: fixture.rpc.safeHead.number,
      hash: fixture.rpc.safeHead.hash,
      timestamp: current.authorization.validBefore,
      observedAt: fixture.rpc.safeHead.observedAt,
      rpcOrigin: fixture.rpc.rpcOrigin,
    };
    fixture.rpc.authorizationStateValue = true;
    fixture.rpc.logOutcomes.push({ kind: "complete", logs: [] });
    const resumed = await fixture.core.execute({ command: "operation.resume", operationId: fixture.operationId });
    assert.equal((resumed.operation as { readonly terminal?: unknown } | null)?.terminal, false);
    assert.equal((await operation(fixture)).unusedExpiryEvidence, undefined);
  });
});

test("an archival RPC adapter resumes an unavailable scan from the same durable cursor", async (t) => {
  const fixture = await authorizedFixture(t, { idempotencyKey: "archival-rpc-resume" });
  await fixture.core.execute({ command: "operation.resume", operationId: fixture.operationId });
  await advanceSafeAndReset(fixture);
  fixture.rpc.logOutcomes.push({ kind: "pruned" });
  const unavailable = await fixture.core.execute({ command: "operation.resume", operationId: fixture.operationId });
  assert.equal(unavailable.ok, true, JSON.stringify(unavailable));
  const checkpoint = await operation(fixture);
  assert.equal(checkpoint.authorizationUsedScan?.status, "unavailable");
  const cursor = checkpoint.authorizationUsedScan?.nextFromBlock;
  const httpCalls = fixture.http.calls.length;
  const nativeCalls = fixture.native.calls.length;

  const archivalRpc = new RecoveryRpc();
  archivalRpc.x402Evidence = { ...fixture.rpc.x402Evidence };
  archivalRpc.safeHead = { ...fixture.rpc.safeHead };
  archivalRpc.finalizedHead = { ...fixture.rpc.finalizedHead };
  const settlement = configureSettlement(archivalRpc, checkpoint);
  archivalRpc.logOutcomes.push({ kind: "complete", logs: [settlement.logs[0]!] });
  const restarted = makeCore({
    root: fixture.root,
    native: fixture.native,
    rpc: archivalRpc,
    http: fixture.http,
    clock: fixture.clock,
  });
  const resumed = await restarted.execute({ command: "operation.resume", operationId: fixture.operationId });
  assert.equal(resumed.ok, true, JSON.stringify(resumed));
  assert.equal((resumed.operation as { readonly state?: unknown } | null)?.state, "failed_settled_without_result");
  const terminal = await operation({ ...fixture, core: restarted, rpc: archivalRpc });
  assert.equal(terminal.authorizationUsedScan?.searchStartBlock, cursor);
  assert.equal(terminal.authorizationUsedScan?.status, "complete");
  assert.equal(terminal.settlementEvidence?.transactionHash, X402_TRANSACTION);
  assert.equal(fixture.http.calls.length, httpCalls);
  assert.equal(fixture.native.calls.length, nativeCalls);
});

test("a pruned first scan remains authorized and resumable before any paid HTTP exposure", async (t) => {
  const fixture = await authorizedFixture(t, { idempotencyKey: "archival-before-first-send" });
  fixture.rpc.logOutcomes.push({ kind: "pruned" });
  const unavailable = await fixture.core.execute({ command: "operation.resume", operationId: fixture.operationId });
  assert.equal(unavailable.ok, true, JSON.stringify(unavailable));
  const durable = await operation(fixture);
  assert.equal(durable.state, "authorized_not_sent");
  assert.equal(durable.authorizationUsedScan?.status, "unavailable");
  assert.deepEqual(durable.nextActions, ["operation.resume", "operation.status", "use.archival_rpc"]);
  assert.equal(fixture.http.calls.length, 1);
  assert.deepEqual(fixture.native.calls, []);

  const archivalRpc = new RecoveryRpc();
  archivalRpc.x402Evidence = { ...fixture.rpc.x402Evidence };
  archivalRpc.safeHead = { ...fixture.rpc.safeHead };
  archivalRpc.finalizedHead = { ...fixture.rpc.finalizedHead };
  archivalRpc.logOutcomes.push({ kind: "complete", logs: [] });
  const restarted = makeCore({
    root: fixture.root,
    native: fixture.native,
    rpc: archivalRpc,
    http: fixture.http,
    clock: fixture.clock,
  });
  const resumed = await restarted.execute({ command: "operation.resume", operationId: fixture.operationId });
  assert.equal(resumed.ok, true, JSON.stringify(resumed));
  assert.equal((resumed.operation as { readonly state?: unknown } | null)?.state, "effect_unknown");
  assert.equal(fixture.http.calls.length, 2);
  assert.equal(fixture.native.calls.length, 1);
});

test("an archival RPC resumes the exact second chunk after one chunk was committed", async (t) => {
  const fixture = await authorizedFixture(t, { idempotencyKey: "archival-second-chunk" });
  fixture.rpc.safeHead = {
    ...fixture.rpc.safeHead,
    number: "15345",
    hash: `0x${"e".repeat(64)}` as Hex,
  };
  fixture.rpc.logOutcomes.push({ kind: "complete", logs: [] });
  await fixture.core.execute({ command: "operation.resume", operationId: fixture.operationId });
  const afterFirst = await operation(fixture);
  assert.equal(afterFirst.state, "authorized_not_sent");
  assert.equal(afterFirst.authorizationUsedScan?.status, "active");
  assert.equal(afterFirst.authorizationUsedScan?.nextFromBlock, "14393");
  assert.equal(afterFirst.authorizationUsedScan?.lastCompletedChunk?.toBlock, "14392");

  fixture.rpc.logOutcomes.push({ kind: "range_unavailable" });
  await fixture.core.execute({ command: "operation.resume", operationId: fixture.operationId });
  const unavailable = await operation(fixture);
  assert.equal(unavailable.authorizationUsedScan?.status, "unavailable");
  assert.equal(unavailable.authorizationUsedScan?.nextFromBlock, "14393");
  assert.equal(unavailable.authorizationUsedScan?.lastCompletedChunk?.toBlock, "14392");

  const archivalRpc = new RecoveryRpc();
  archivalRpc.x402Evidence = { ...fixture.rpc.x402Evidence };
  archivalRpc.safeHead = { ...fixture.rpc.safeHead };
  archivalRpc.finalizedHead = { ...fixture.rpc.finalizedHead };
  const priorChunk = unavailable.authorizationUsedScan?.lastCompletedChunk;
  assert.notEqual(priorChunk, undefined);
  archivalRpc.blockHashes.set(priorChunk!.toBlock, priorChunk!.toBlockHash as Hex);
  archivalRpc.logOutcomes.push({ kind: "complete", logs: [] });
  const restarted = makeCore({
    root: fixture.root,
    native: fixture.native,
    rpc: archivalRpc,
    http: fixture.http,
    clock: fixture.clock,
  });
  const resumed = await restarted.execute({ command: "operation.resume", operationId: fixture.operationId });
  assert.equal(resumed.ok, true, JSON.stringify(resumed));
  const durable = await operation({ ...fixture, core: restarted, rpc: archivalRpc });
  assert.equal(durable.authorizationUsedScan?.status, "complete");
  assert.equal(durable.authorizationUsedScan?.nextFromBlock, "15346");
  assert.deepEqual(
    archivalRpc.x402Calls.filter((call) => call.startsWith("logs:")),
    ["logs:14393-15345"],
  );
  assert.equal(fixture.http.calls.length, 2);
});

test("safe-head reorg discards candidates and cursor, returns, and scans only next invocation", async (t) => {
  const fixture = await authorizedFixture(t, {
    paidOutcomes: [new Error("initial ambiguity"), new Error("bounded retry")],
    idempotencyKey: "reorg-reset",
  });
  await fixture.core.execute({ command: "operation.resume", operationId: fixture.operationId });
  fixture.rpc.safeHead = { ...fixture.rpc.safeHead, number: "15345", hash: `0x${"e".repeat(64)}` };
  fixture.rpc.logOutcomes.push({ kind: "complete", logs: [] });
  await fixture.core.execute({ command: "operation.resume", operationId: fixture.operationId });
  await fixture.core.execute({ command: "operation.resume", operationId: fixture.operationId });
  const before = await operation(fixture);
  assert.equal(before.authorizationUsedScan?.nextFromBlock, "14393");

  fixture.rpc.safeHead = { ...fixture.rpc.safeHead, number: "15346", hash: `0x${"f".repeat(64)}` };
  fixture.rpc.x402Calls.length = 0;
  const httpCallsBefore = fixture.http.calls.length;
  await fixture.core.execute({ command: "operation.resume", operationId: fixture.operationId });
  const reset = await operation(fixture);
  assert.equal(reset.authorizationUsedScan?.nextFromBlock, reset.authorizationUsedScan?.searchStartBlock);
  assert.equal(reset.authorizationUsedScan?.lastCompletedChunk, undefined);
  assert.deepEqual(reset.authorizationUsedScan?.candidates, []);
  assert.equal(fixture.rpc.x402Calls.some((call) => call.startsWith("logs:")), false);
  assert.equal(fixture.http.calls.length, httpCallsBefore);
});

test("a completed zero scan is revalidated after reorg and never permits a third payment send", async (t) => {
  const fixture = await authorizedFixture(t, {
    paidOutcomes: [new Error("first ambiguity"), new Error("bounded retry")],
    idempotencyKey: "completed-zero-reorg-cap",
  });
  await fixture.core.execute({ command: "operation.resume", operationId: fixture.operationId });
  await advanceSafeAndReset(fixture);
  await fixture.core.execute({ command: "operation.resume", operationId: fixture.operationId });
  assert.equal((await operation(fixture)).attempts.filter((attempt) => attempt.purpose === "payment").length, 2);
  assert.equal(fixture.http.calls.length, 3);

  await advanceSafeAndReset(fixture, "f");
  const callsBeforeFinalScan = fixture.http.calls.length;
  await fixture.core.execute({ command: "operation.resume", operationId: fixture.operationId });
  const durable = await operation(fixture);
  assert.equal(durable.authorizationUsedScan?.status, "complete");
  assert.equal(durable.authorizationUsedScan?.candidates.length, 0);
  assert.equal(durable.attempts.filter((attempt) => attempt.purpose === "payment").length, 2);
  assert.equal(fixture.http.calls.length, callsBeforeFinalScan);
});

test("same-safe-head prior chunk mismatch resets the durable scan before any log read or HTTP send", async (t) => {
  const fixture = await authorizedFixture(t, {
    paidOutcomes: [new Error("first ambiguity")],
    idempotencyKey: "prior-chunk-reorg",
  });
  await fixture.core.execute({ command: "operation.resume", operationId: fixture.operationId });
  fixture.rpc.safeHead = { ...fixture.rpc.safeHead, number: "15345", hash: `0x${"e".repeat(64)}` };
  fixture.rpc.logOutcomes.push({ kind: "complete", logs: [] });
  await fixture.core.execute({ command: "operation.resume", operationId: fixture.operationId });
  await fixture.core.execute({ command: "operation.resume", operationId: fixture.operationId });
  const progressed = await operation(fixture);
  assert.equal(progressed.authorizationUsedScan?.lastCompletedChunk?.toBlock, "14392");

  fixture.rpc.blockHashes.set("14392", `0x${"f".repeat(64)}` as Hex);
  fixture.rpc.x402Calls.length = 0;
  const httpCalls = fixture.http.calls.length;
  await fixture.core.execute({ command: "operation.resume", operationId: fixture.operationId });
  const reset = await operation(fixture);
  assert.equal(reset.authorizationUsedScan?.targetSafeHead.number, "15345");
  assert.equal(reset.authorizationUsedScan?.nextFromBlock, reset.authorizationUsedScan?.searchStartBlock);
  assert.equal(reset.authorizationUsedScan?.lastCompletedChunk, undefined);
  assert.deepEqual(reset.authorizationUsedScan?.candidates, []);
  assert.equal(fixture.rpc.x402Calls.some((call) => call.startsWith("logs:")), false);
  assert.equal(fixture.http.calls.length, httpCalls);
});

test("a third distinct AuthorizationUsed candidate preserves two candidates and durable ambiguity", async (t) => {
  const fixture = await authorizedFixture(t, { idempotencyKey: "third-candidate" });
  await fixture.core.execute({ command: "operation.resume", operationId: fixture.operationId });
  await advanceSafeAndReset(fixture);
  const current = await operation(fixture);
  const base = authorizationUsedLog({
    authorizer: current.wallet,
    nonce: current.authorization.nonce,
    transactionHash: X402_TRANSACTION as Hex,
    blockNumber: fixture.rpc.safeHead.number,
    blockHash: fixture.rpc.safeHead.hash,
  });
  fixture.rpc.logOutcomes.push({ kind: "complete", logs: [
    base,
    { ...base, transactionHash: `0x${"9".repeat(64)}` as Hex, logIndex: "1" },
    { ...base, transactionHash: `0x${"8".repeat(64)}` as Hex, logIndex: "2" },
  ] });
  const httpCalls = fixture.http.calls.length;
  await fixture.core.execute({ command: "operation.resume", operationId: fixture.operationId });
  const ambiguous = await operation(fixture);
  assert.equal(ambiguous.authorizationUsedScan?.status, "ambiguous");
  assert.equal(ambiguous.authorizationUsedScan?.candidates.length, 2);
  assert.equal(ambiguous.transactionHint, undefined);
  assert.equal(fixture.http.calls.length, httpCalls);
});

test("a crash before scan fsync cannot expose HTTP and restart replays the same chunk", async (t) => {
  const fixture = await authorizedFixture(t, {
    paidOutcomes: [new Error("first ambiguity"), new Error("bounded retry")],
    idempotencyKey: "scan-fsync-cut",
  });
  await fixture.core.execute({ command: "operation.resume", operationId: fixture.operationId });
  await advanceSafeAndReset(fixture);
  fixture.rpc.logOutcomes.push({ kind: "complete", logs: [] });
  fixture.rpc.x402Calls.length = 0;
  const state = fixture.core.context.state;
  const originalWrite = state.writeX402Operation.bind(state);
  let interrupted = false;
  state.writeX402Operation = async (next) => {
    if (next.authorizationUsedScan?.status === "complete" && !interrupted) {
      interrupted = true;
      throw new Error("scan commit crash cut");
    }
    await originalWrite(next);
  };
  const httpCalls = fixture.http.calls.length;
  const crashed = await fixture.core.execute({ command: "operation.resume", operationId: fixture.operationId });
  assert.equal(crashed.ok, false);
  assert.equal(fixture.http.calls.length, httpCalls);
  assert.deepEqual(fixture.rpc.x402Calls.filter((call) => call.startsWith("logs:")), ["logs:12345-12346"]);
  state.writeX402Operation = originalWrite;

  fixture.rpc.x402Calls.length = 0;
  const resumed = await fixture.core.execute({ command: "operation.resume", operationId: fixture.operationId });
  assert.equal(resumed.ok, true, JSON.stringify(resumed));
  assert.deepEqual(fixture.rpc.x402Calls.filter((call) => call.startsWith("logs:")), ["logs:12345-12346"]);
  assert.equal(fixture.http.calls.length, httpCalls + 1);
});

test("authorized but never sent can finalize unused expiry after native material expires", async (t) => {
  const fixture = await authorizedFixture(t, { idempotencyKey: "expiry-before-send" });
  const current = await operation(fixture);
  assert.equal(current.state, "authorized_not_sent");
  failRecoveredNativeMaterial(fixture, "APN_APPROVAL_EXPIRED");
  fixture.clock.advance(61_000);
  fixture.rpc.safeHead = {
    ...fixture.rpc.safeHead,
    timestamp: current.authorization.validBefore,
    observedAt: fixture.clock.now().toISOString(),
  };
  fixture.rpc.finalizedHead = {
    queriedTag: "finalized",
    number: fixture.rpc.safeHead.number,
    hash: fixture.rpc.safeHead.hash,
    timestamp: current.authorization.validBefore,
    observedAt: fixture.rpc.safeHead.observedAt,
    rpcOrigin: fixture.rpc.rpcOrigin,
  };
  fixture.rpc.authorizationStateValue = false;
  fixture.rpc.logOutcomes.push({ kind: "complete", logs: [] });

  const expired = await fixture.core.execute({ command: "operation.resume", operationId: fixture.operationId });
  assert.equal((expired.operation as { readonly state?: unknown } | null)?.state, "failed_expired_unused", JSON.stringify(expired));
  assert.equal(fixture.http.calls.length, 1, "expired material cannot expose the paid HTTP request");
  assert.deepEqual(fixture.native.calls, [], "finalized expiry is classified before any optional pre-send material read");
});

test("authorized but never sent extends a stale zero scan before finalized unused expiry", async (t) => {
  const fixture = await authorizedFixture(t, { idempotencyKey: "expiry-before-send-safe-advance" });
  failRecoveredNativeMaterial(fixture, "APN_KEYCHAIN_LOCKED");
  const unavailable = await fixture.core.execute({ command: "operation.resume", operationId: fixture.operationId });
  assert.equal(unavailable.ok, true, JSON.stringify(unavailable));
  const scanned = await operation(fixture);
  assert.equal(scanned.state, "authorized_not_sent");
  assert.equal(scanned.authorizationUsedScan?.status, "complete");
  assert.deepEqual(scanned.authorizationUsedScan?.candidates, []);

  fixture.clock.advance(61_000);
  const previousTarget = scanned.authorizationUsedScan!.targetSafeHead;
  fixture.rpc.blockHashes.set(previousTarget.number, previousTarget.hash as Hex);
  fixture.rpc.safeHead = {
    ...fixture.rpc.safeHead,
    number: (BigInt(previousTarget.number) + 1n).toString(),
    hash: `0x${"d".repeat(64)}` as Hex,
    timestamp: scanned.authorization.validBefore,
    observedAt: fixture.clock.now().toISOString(),
  };
  fixture.rpc.finalizedHead = {
    queriedTag: "finalized",
    number: fixture.rpc.safeHead.number,
    hash: fixture.rpc.safeHead.hash,
    timestamp: scanned.authorization.validBefore,
    observedAt: fixture.rpc.safeHead.observedAt,
    rpcOrigin: fixture.rpc.rpcOrigin,
  };
  fixture.rpc.authorizationStateValue = false;
  const transitionless = transitionlessZeroScanExtension(scanned, {
    number: fixture.rpc.safeHead.number,
    hash: fixture.rpc.safeHead.hash,
    observedAt: fixture.rpc.safeHead.observedAt,
  });
  await assert.rejects(
    fixture.core.context.state.writeX402Operation(transitionless),
    { code: "APN_STATE_CORRUPT" },
    "a pre-send completed-zero extension must append a durable self-transition",
  );
  fixture.rpc.logOutcomes.push({ kind: "complete", logs: [] });
  fixture.rpc.x402Calls.length = 0;
  const nativeCalls = fixture.native.calls.length;
  const httpCalls = fixture.http.calls.length;

  const expired = await fixture.core.execute({ command: "operation.resume", operationId: fixture.operationId });
  assert.equal((expired.operation as { readonly state?: unknown } | null)?.state, "failed_expired_unused", JSON.stringify(expired));
  assert.deepEqual(
    fixture.rpc.x402Calls.filter((call) => call.startsWith("logs:")),
    [`logs:${fixture.rpc.safeHead.number}-${fixture.rpc.safeHead.number}`],
  );
  assert.equal(fixture.native.calls.length, nativeCalls, "finalized expiry completes before another material read");
  assert.equal(fixture.http.calls.length, httpCalls, "pre-send expiry never exposes a paid request");
});

test("inconsistent safe and finalized ancestry cannot prove unused expiry", async (t) => {
  for (const posture of ["same-height", "lower-height", "timestamp"] as const) {
    await t.test(posture, async (nested) => {
      const fixture = await authorizedFixture(nested, { idempotencyKey: `expiry-ancestry-${posture}` });
      const current = await operation(fixture);
      fixture.clock.advance(61_000);
      fixture.rpc.safeHead = {
        ...fixture.rpc.safeHead,
        timestamp: current.authorization.validBefore,
        observedAt: fixture.clock.now().toISOString(),
      };
      if (posture === "same-height") {
        fixture.rpc.finalizedHead = {
          queriedTag: "finalized",
          number: fixture.rpc.safeHead.number,
          hash: `0x${"c".repeat(64)}` as Hex,
          timestamp: current.authorization.validBefore,
          observedAt: fixture.rpc.safeHead.observedAt,
          rpcOrigin: fixture.rpc.rpcOrigin,
        };
      } else if (posture === "lower-height") {
        fixture.rpc.finalizedHead = {
          ...fixture.rpc.finalizedHead,
          timestamp: current.authorization.validBefore,
          observedAt: fixture.rpc.safeHead.observedAt,
        };
        fixture.rpc.blockHashes.set(fixture.rpc.finalizedHead.number, `0x${"c".repeat(64)}` as Hex);
      } else {
        fixture.rpc.finalizedHead = {
          queriedTag: "finalized",
          number: fixture.rpc.safeHead.number,
          hash: fixture.rpc.safeHead.hash,
          timestamp: current.authorization.validBefore,
          observedAt: fixture.rpc.safeHead.observedAt,
          rpcOrigin: fixture.rpc.rpcOrigin,
        };
        fixture.rpc.blockTimestamps.set(
          fixture.rpc.finalizedHead.number,
          (BigInt(current.authorization.validBefore) - 1n).toString(),
        );
      }
      fixture.rpc.authorizationStateValue = false;
      const resumed = await fixture.core.execute({ command: "operation.resume", operationId: fixture.operationId });
      assert.equal(resumed.ok, true, JSON.stringify(resumed));
      assert.equal((resumed.operation as { readonly terminal?: unknown } | null)?.terminal, false);
      assert.equal((await operation(fixture)).unusedExpiryEvidence, undefined);
      assert.equal(fixture.http.calls.length, 1);
    });
  }
});

test("expiry requires finalized timestamp, false state, and complete zero scan", async (t) => {
  const fixture = await authorizedFixture(t, { idempotencyKey: "expiry-positive" });
  await fixture.core.execute({ command: "operation.resume", operationId: fixture.operationId });
  const current = await operation(fixture);
  const nativeCalls = fixture.native.calls.length;
  failRecoveredNativeMaterial(fixture, "APN_APPROVAL_EXPIRED");
  fixture.clock.advance(61_000);
  fixture.rpc.safeHead = {
    ...fixture.rpc.safeHead,
    timestamp: current.authorization.validBefore,
    observedAt: fixture.clock.now().toISOString(),
  };
  fixture.rpc.finalizedHead = {
    queriedTag: "finalized",
    number: fixture.rpc.safeHead.number,
    hash: fixture.rpc.safeHead.hash,
    timestamp: current.authorization.validBefore,
    observedAt: fixture.rpc.safeHead.observedAt,
    rpcOrigin: fixture.rpc.rpcOrigin,
  };
  fixture.rpc.authorizationStateValue = false;
  fixture.rpc.logOutcomes.push({ kind: "complete", logs: [] });
  const expired = await fixture.core.execute({ command: "operation.resume", operationId: fixture.operationId });
  assert.equal((expired.operation as { readonly state?: unknown } | null)?.state, "failed_expired_unused", JSON.stringify(expired));
  const terminal = await operation(fixture);
  assert.deepEqual(terminal.unusedExpiryEvidence?.absence, {
    localSettlement: false,
    httpSettlement: false,
    authorizationUsed: false,
    transactionReceipt: false,
  });
  assert.equal(fixture.native.calls.length, nativeCalls);
});

test("durable unused-expiry evidence completes locally after a crash before receipt write", async (t) => {
  const fixture = await authorizedFixture(t, { idempotencyKey: "unused-expiry-receipt-crash" });
  const current = await operation(fixture);
  fixture.clock.advance(61_000);
  fixture.rpc.safeHead = {
    ...fixture.rpc.safeHead,
    timestamp: current.authorization.validBefore,
    observedAt: fixture.clock.now().toISOString(),
  };
  fixture.rpc.finalizedHead = {
    queriedTag: "finalized",
    number: fixture.rpc.safeHead.number,
    hash: fixture.rpc.safeHead.hash,
    timestamp: current.authorization.validBefore,
    observedAt: fixture.rpc.safeHead.observedAt,
    rpcOrigin: fixture.rpc.rpcOrigin,
  };
  fixture.rpc.logOutcomes.push({ kind: "complete", logs: [] });
  const state = fixture.core.context.state;
  const originalWriteReceipt = state.writeX402Receipt.bind(state);
  state.writeX402Receipt = async () => { throw new Error("unused-expiry receipt crash cut"); };
  const crashed = await fixture.core.execute({ command: "operation.resume", operationId: fixture.operationId });
  assert.equal(crashed.ok, false);
  state.writeX402Receipt = originalWriteReceipt;
  const preterminal = await operation(fixture);
  assert.equal(preterminal.terminal, false);
  assert.notEqual(preterminal.unusedExpiryEvidence, undefined);

  const httpCalls = fixture.http.calls.length;
  const nativeCalls = fixture.native.calls.length;
  fixture.rpc.x402Calls.length = 0;
  const restarted = makeCore({ root: fixture.root, clock: fixture.clock });
  const resumed = await restarted.execute({ command: "operation.resume", operationId: fixture.operationId });
  assert.equal(resumed.ok, true, JSON.stringify(resumed));
  assert.equal((resumed.operation as { readonly state?: unknown } | null)?.state, "failed_expired_unused");
  assert.deepEqual(fixture.rpc.x402Calls, []);
  assert.equal(fixture.http.calls.length, httpCalls);
  assert.equal(fixture.native.calls.length, nativeCalls);
});

test("expired cached-result authorization closes known settlement without native or HTTP", async (t) => {
  const fixture = await authorizedFixture(t, {
    paymentIdentifier: true,
    idempotencyKey: "settled-result-recovery-expired",
  });
  await fixture.core.execute({ command: "operation.resume", operationId: fixture.operationId });
  await advanceSafeAndReset(fixture);
  const exposed = await operation(fixture);
  const settlement = configureSettlement(fixture.rpc, exposed);
  fixture.rpc.logOutcomes.push({ kind: "complete", logs: [settlement.logs[0]!] });
  fixture.clock.advance(61_000);
  fixture.rpc.safeHead = {
    ...fixture.rpc.safeHead,
    timestamp: exposed.authorization.validBefore,
    observedAt: fixture.clock.now().toISOString(),
  };
  failRecoveredNativeMaterial(fixture, "APN_APPROVAL_EXPIRED");
  const nativeCalls = fixture.native.calls.length;
  const httpCalls = fixture.http.calls.length;

  const resumed = await fixture.core.execute({ command: "operation.resume", operationId: fixture.operationId });
  assert.equal(resumed.ok, true, JSON.stringify(resumed));
  assert.equal(
    (resumed.operation as { readonly state?: unknown } | null)?.state,
    "failed_settled_without_result",
  );
  assert.equal(fixture.native.calls.length, nativeCalls);
  assert.equal(fixture.http.calls.length, httpCalls);
});

test("one cached-result retry can complete scan-discovered settlement", async (t) => {
  const recoveryResponse = paidObservation({
    paymentResponseHeader: canonicalPaymentResponseHeader({
      success: true,
      transaction: X402_TRANSACTION,
      network: "eip155:8453",
      payer: X402_TEST_ACCOUNT.address.toLowerCase(),
      amount: "1250000",
      errorMessage: "facilitator metadata",
      extensions: { trace: { provider: "official" } },
      extra: { settlementRoute: "live" },
    }),
    paymentResponseHeaderName: "X-PAYMENT-RESPONSE",
    mediaType: "application/json; charset=utf-8",
    bodyText: '{"recovered":true}',
  });
  const fixture = await authorizedFixture(t, {
    paymentIdentifier: true,
    paidOutcomes: [new Error("initial ambiguity"), recoveryResponse],
    idempotencyKey: "cached-result-retry",
  });
  await fixture.core.execute({ command: "operation.resume", operationId: fixture.operationId });
  await advanceSafeAndReset(fixture);
  const exposed = await operation(fixture);
  const settlement = configureSettlement(fixture.rpc, exposed);
  fixture.rpc.logOutcomes.push({ kind: "complete", logs: [settlement.logs[0]!] });
  const callsBefore = fixture.http.calls.length;
  const recovered = await fixture.core.execute({ command: "operation.resume", operationId: fixture.operationId });
  assert.equal((recovered.operation as { readonly state?: unknown } | null)?.state, "completed");
  assert.equal(fixture.http.calls.length, callsBefore + 1);
  const terminal = await operation(fixture);
  assert.deepEqual(terminal.attempts.map((attempt) => attempt.purpose), ["payment", "result_recovery"]);
  assert.equal(terminal.attempts.filter((attempt) => attempt.purpose === "result_recovery").length, 1);
  assert.equal(terminal.attempts[1]?.observation?.mediaType, "application/json");
  const result = await fixture.core.context.state.loadX402Result(terminal.profileHash, terminal.operationId);
  assert.equal(result?.mediaType, "application/json");
  assert.equal(result?.bodyText, '{"recovered":true}');
});

test("a crash after cached-result HTTP exposure never sends the recovery request twice", async (t) => {
  const recoveryResponse = paidObservation({
    paymentResponseHeader: canonicalPaymentResponseHeader({
      success: true,
      transaction: X402_TRANSACTION,
      network: "eip155:8453",
      payer: X402_TEST_ACCOUNT.address.toLowerCase(),
      amount: "1250000",
    }),
    bodyText: '{"recovered":true}',
  });
  const fixture = await authorizedFixture(t, {
    paymentIdentifier: true,
    paidOutcomes: [new Error("initial ambiguity"), recoveryResponse],
    idempotencyKey: "cached-result-response-fsync-crash",
  });
  await fixture.core.execute({ command: "operation.resume", operationId: fixture.operationId });
  await advanceSafeAndReset(fixture);
  const exposed = await operation(fixture);
  const settlement = configureSettlement(fixture.rpc, exposed);
  fixture.rpc.logOutcomes.push({ kind: "complete", logs: [settlement.logs[0]!] });

  const state = fixture.core.context.state;
  const originalWrite = state.writeX402Operation.bind(state);
  let interrupted = false;
  state.writeX402Operation = async (next) => {
    const recoveryAttempt = next.attempts.find((attempt) => attempt.purpose === "result_recovery");
    if (recoveryAttempt !== undefined && recoveryAttempt.phase !== "pending" && !interrupted) {
      interrupted = true;
      throw new Error("cached-result observation fsync crash cut");
    }
    await originalWrite(next);
  };
  const crashed = await fixture.core.execute({ command: "operation.resume", operationId: fixture.operationId });
  assert.equal(crashed.ok, false);
  state.writeX402Operation = originalWrite;
  const pending = await operation(fixture);
  assert.equal(pending.attempts.find((attempt) => attempt.purpose === "result_recovery")?.phase, "pending");
  const httpCalls = fixture.http.calls.length;
  const nativeCalls = fixture.native.calls.length;
  fixture.rpc.x402Calls.length = 0;
  const restarted = makeCore({ root: fixture.root, clock: fixture.clock });
  const resumed = await restarted.execute({ command: "operation.resume", operationId: fixture.operationId });
  assert.equal(resumed.ok, true, JSON.stringify(resumed));
  assert.equal((resumed.operation as { readonly state?: unknown } | null)?.state, "failed_settled_without_result");
  assert.equal(fixture.http.calls.length, httpCalls);
  assert.equal(fixture.native.calls.length, nativeCalls);
  assert.deepEqual(fixture.rpc.x402Calls, []);
  const terminal = await operation(fixture);
  assert.equal(terminal.attempts.filter((attempt) => attempt.purpose === "result_recovery").length, 1);
  assert.equal(terminal.attempts.find((attempt) => attempt.purpose === "result_recovery")?.phase, "ambiguous");
});

test("a conflicting cached-result transaction never overwrites the durable scan hint", async (t) => {
  const conflictingTransaction = `0x${"8".repeat(64)}` as Hex;
  const fixture = await authorizedFixture(t, {
    paymentIdentifier: true,
    paidOutcomes: [new Error("initial ambiguity"), paidObservation({
      paymentResponseHeader: canonicalPaymentResponseHeader({
        success: true,
        transaction: conflictingTransaction,
        network: "eip155:8453",
        payer: X402_TEST_ACCOUNT.address.toLowerCase(),
        amount: "1250000",
      }),
      bodyText: '{"wrong":"transaction"}',
    })],
    idempotencyKey: "conflicting-result-hint",
  });
  await fixture.core.execute({ command: "operation.resume", operationId: fixture.operationId });
  await advanceSafeAndReset(fixture);
  const exposed = await operation(fixture);
  const settlement = configureSettlement(fixture.rpc, exposed);
  fixture.rpc.logOutcomes.push({ kind: "complete", logs: [settlement.logs[0]!] });
  const resumed = await fixture.core.execute({ command: "operation.resume", operationId: fixture.operationId });
  assert.equal((resumed.operation as { readonly state?: unknown } | null)?.state, "effect_unknown");
  const durable = await operation(fixture);
  assert.equal(durable.transactionHint?.transactionHash, X402_TRANSACTION);
  assert.equal(durable.transactionHint?.source, "authorization_used_log");
  assert.equal(
    settlementResponseTransactionForTest(durable.settlementResponseObservation?.normalizedCanonicalJson),
    conflictingTransaction,
  );
  assert.equal(durable.resultLink, undefined);

  await advanceSafeAndReset(fixture, "f");
  const reset = await operation(fixture);
  assert.equal(reset.transactionHint, undefined);
  assert.equal(reset.settlementEvidence, undefined);
  assert.equal(
    settlementResponseTransactionForTest(reset.settlementResponseObservation?.normalizedCanonicalJson),
    conflictingTransaction,
  );

  fixture.clock.advance(61_000);
  fixture.rpc.safeHead = {
    ...fixture.rpc.safeHead,
    timestamp: reset.authorization.validBefore,
    observedAt: fixture.clock.now().toISOString(),
  };
  fixture.rpc.finalizedHead = {
    queriedTag: "finalized",
    number: fixture.rpc.safeHead.number,
    hash: fixture.rpc.safeHead.hash,
    timestamp: reset.authorization.validBefore,
    observedAt: fixture.rpc.safeHead.observedAt,
    rpcOrigin: fixture.rpc.rpcOrigin,
  };
  fixture.rpc.authorizationStateValue = false;
  fixture.rpc.logOutcomes.push({ kind: "complete", logs: [] });
  const httpCalls = fixture.http.calls.length;
  const afterExpiry = await fixture.core.execute({ command: "operation.resume", operationId: fixture.operationId });
  assert.equal(afterExpiry.ok, true, JSON.stringify(afterExpiry));
  assert.equal((afterExpiry.operation as { readonly state?: unknown } | null)?.state, "effect_unknown");
  assert.equal(fixture.http.calls.length, httpCalls);
  const stillAmbiguous = await operation(fixture);
  assert.equal(stillAmbiguous.unusedExpiryEvidence, undefined);
  assert.equal(
    settlementResponseTransactionForTest(stillAmbiguous.settlementResponseObservation?.normalizedCanonicalJson),
    conflictingTransaction,
  );

  const priorFinalizedNumber = (BigInt(fixture.rpc.safeHead.number) - 1n).toString();
  fixture.rpc.finalizedHead = {
    ...fixture.rpc.finalizedHead,
    number: priorFinalizedNumber,
    hash: fixture.rpc.blockHashes.get(priorFinalizedNumber) ?? `0x${"d".repeat(64)}` as Hex,
    timestamp: reset.authorization.validBefore,
    observedAt: fixture.rpc.safeHead.observedAt,
  };
  await advanceSafeAndReset(fixture, "a");
  const reorged = await operation(fixture);
  const canonicalSettlement = configureSettlement(fixture.rpc, reorged, { transactionHash: conflictingTransaction });
  fixture.rpc.logOutcomes.push({ kind: "complete", logs: [canonicalSettlement.logs[0]!] });
  const terminalHttpCalls = fixture.http.calls.length;
  const canonicallySettled = await fixture.core.execute({ command: "operation.resume", operationId: fixture.operationId });
  assert.equal(canonicallySettled.ok, true, JSON.stringify(canonicallySettled));
  assert.equal(
    (canonicallySettled.operation as { readonly state?: unknown } | null)?.state,
    "failed_settled_without_result",
  );
  assert.equal(fixture.http.calls.length, terminalHttpCalls);
  const terminal = await operation(fixture);
  assert.equal(terminal.transactionHint?.source, "authorization_used_log");
  assert.equal(terminal.transactionHint?.transactionHash, conflictingTransaction);
  assert.equal(
    settlementResponseTransactionForTest(terminal.settlementResponseObservation?.normalizedCanonicalJson),
    conflictingTransaction,
  );
});

test("cached-result non-success, malformed, and transport outcomes persist one attempt then close spent", async (t) => {
  const pending = paidObservation({
    status: 402,
    bodyText: "pending",
    paymentResponseHeader: canonicalPaymentResponseHeader({
      success: false,
      errorReason: "settlement_pending",
      transaction: X402_TRANSACTION,
      network: "eip155:8453",
    }),
  });
  const cases = [
    { label: "non-success", outcome: pending as HttpObservation | Error, classification: "settlement_pending" },
    { label: "malformed", outcome: paidObservation({ paymentResponseHeader: "not-base64" }) as HttpObservation | Error },
    { label: "transport", outcome: new Error("cached result transport ambiguity") as HttpObservation | Error },
  ] as const;
  for (const item of cases) {
    await t.test(item.label, async (nested) => {
      const fixture = await authorizedFixture(nested, {
        paymentIdentifier: true,
        paidOutcomes: [new Error("initial ambiguity"), item.outcome],
        idempotencyKey: `cached-result-${item.label}`,
      });
      await fixture.core.execute({ command: "operation.resume", operationId: fixture.operationId });
      await advanceSafeAndReset(fixture);
      const exposed = await operation(fixture);
      const settlement = configureSettlement(fixture.rpc, exposed);
      fixture.rpc.logOutcomes.push({ kind: "complete", logs: [settlement.logs[0]!] });
      const resumed = await fixture.core.execute({ command: "operation.resume", operationId: fixture.operationId });
      assert.equal((resumed.operation as { readonly state?: unknown } | null)?.state, "failed_settled_without_result");
      const terminal = await operation(fixture);
      assert.equal(terminal.attempts.filter((attempt) => attempt.purpose === "result_recovery").length, 1);
      assert.equal(terminal.attempts.at(-1)?.phase, item.label === "transport" ? "ambiguous" : "observed");
      if ("classification" in item) {
        assert.equal(terminal.settlementResponseObservation?.classification, item.classification);
        assert.equal(terminal.transactionHint?.source, "payment_response");
      }
      const receipt = await fixture.core.context.state.loadX402Receipt(terminal.profileHash, terminal.operationId);
      assert.equal(receipt?.terminalState, "failed_settled_without_result");
    });
  }
});

test("orphan terminal receipt restarts without ports and preserves predecessor linkage", async (t) => {
  const fixture = await authorizedFixture(t, { idempotencyKey: "receipt-crash" });
  await fixture.core.execute({ command: "operation.resume", operationId: fixture.operationId });
  await advanceSafeAndReset(fixture);
  const exposed = await operation(fixture);
  const settlement = configureSettlement(fixture.rpc, exposed);
  fixture.rpc.logOutcomes.push({ kind: "complete", logs: [settlement.logs[0]!] });

  const state = fixture.core.context.state;
  const originalWrite = state.writeX402Operation.bind(state);
  let interrupted = false;
  state.writeX402Operation = async (next) => {
    if (next.terminal && !interrupted) {
      interrupted = true;
      throw new Error("terminal operation crash cut");
    }
    await originalWrite(next);
  };
  const crashed = await fixture.core.execute({ command: "operation.resume", operationId: fixture.operationId });
  assert.equal(crashed.ok, false);
  state.writeX402Operation = originalWrite;
  const preterminal = await operation(fixture);
  const orphan = await state.loadX402RecoveryReceipt(preterminal.profileHash, preterminal.operationId);
  assert.equal(orphan?.previousLinkHash, preterminal.transitions.at(-1)?.hash);

  const rpcCalls = fixture.rpc.x402Calls.length;
  const httpCalls = fixture.http.calls.length;
  const nativeCalls = fixture.native.calls.length;
  const restarted = await fixture.core.execute({ command: "operation.resume", operationId: fixture.operationId });
  assert.equal((restarted.operation as { readonly state?: unknown } | null)?.state, "failed_settled_without_result");
  assert.equal(fixture.rpc.x402Calls.length, rpcCalls);
  assert.equal(fixture.http.calls.length, httpCalls);
  assert.equal(fixture.native.calls.length, nativeCalls);
  const terminal = await operation(fixture);
  assert.equal(orphan?.previousLinkHash, terminal.transitions.at(-1)?.previousHash);
});
