import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import test, { type TestContext } from "node:test";
import { canonicalJson, domainHash } from "../../src/canonical.js";
import { ApnError } from "../../src/errors.js";
import type { Hex } from "../../src/model.js";
import type { HttpGetRequest, HttpObservation } from "../../src/x402-model.js";
import type { WaitPort, X402RpcPort, X402RpcReceipt } from "../../src/ports.js";
import { acceptRpcHttpBody, classifyX402LogAvailabilityMessage } from "../../src/rpc.js";
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

test("first authorized send follows recovered material and one unused nonce read at the safe head", async (t) => {
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
  // chainId plus authorizationState(wallet, nonce) at the safe block: no log scan, no anchor re-reads.
  assert.deepEqual(callsAtPaidHttp, ["chain", "state:safe"]);
  assert.deepEqual(nativeAtPaidHttp, ["x402Exact.authorizationMaterial.get"]);
  assert.equal((await operation(fixture)).authorizationUsedScan, undefined);
});

type AnchorFault = (fixture: Fixture, target: string, durable: X402OperationRecord) => void;

function rpcFaultOn(fixture: Fixture, matches: (call: string, count: number) => boolean): void {
  const counts = new Map<string, number>();
  fixture.rpc.onX402Call = (call) => {
    const count = (counts.get(call) ?? 0) + 1;
    counts.set(call, count);
    if (matches(call, count)) {
      throw new ApnError("APN_RPC_PROTOCOL", "RPC returned an unsuccessful HTTP status.", { httpStatus: 429 });
    }
  };
}

function foreignOriginBlock(fixture: Fixture, number: string): void {
  const original = fixture.rpc.getX402Block.bind(fixture.rpc);
  fixture.rpc.getX402Block = async (requested) => {
    const block = await original(requested);
    return requested === number ? { ...block, rpcOrigin: "https://different.example" } : block;
  };
}

function nextBlock(number: string): string { return (BigInt(number) + 1n).toString(); }

async function completeZeroScanWithoutSend(fixture: Fixture): Promise<X402OperationRecord> {
  const recoverMaterial = fixture.native.request;
  failRecoveredNativeMaterial(fixture, "APN_KEYCHAIN_LOCKED");
  const locked = await fixture.core.execute({ command: "operation.resume", operationId: fixture.operationId });
  assert.equal(locked.ok, true, JSON.stringify(locked));
  fixture.native.request = recoverMaterial;
  const durable = await operation(fixture);
  assert.equal(durable.state, "authorized_not_sent");
  assert.equal(durable.authorizationUsedScan?.status, "complete");
  assert.deepEqual(durable.authorizationUsedScan?.candidates, []);
  assert.equal(durable.attempts.length, 0);
  assert.equal(fixture.http.calls.length, 1, "only the unpaid challenge precedes the locked material read");
  const target = durable.authorizationUsedScan!.targetSafeHead;
  fixture.rpc.blockHashes.set(target.number, target.hash as Hex);
  return durable;
}

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

test("bounded wait discovers a no-hint settlement from the nonce state and completes with the kept body, without another effect", async (t) => {
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
    configureSettlement(fixture.rpc, current);
  };

  const completed = await fixture.core.execute({
    command: "operation.resume",
    operationId: fixture.operationId,
    waitSeconds: 20,
  });
  assert.equal(completed.ok, true, JSON.stringify(completed));
  // The paid 200 came without a PAYMENT-RESPONSE: its body was kept, so the nonce-state proof completes the purchase.
  assert.equal((completed.operation as { state: string }).state, "completed");
  assert.equal((completed.operation as { terminal: boolean }).terminal, true);
  assert.notEqual(completed.receipt, null);
  assert.equal(fixture.rpc.x402Calls.some((call) => call.startsWith("logs:")), false, "no log scan on any poll");
  const settled = await operation(fixture);
  assert.equal(settled.settlementEvidence?.schemaVersion, "apn.x402.settlement-evidence.v2");
  assert.equal(settled.settlementEvidence?.transactionHash, undefined, "no hint names no transaction");
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
  const exposed = await operation(fixture);
  const settlement = configureSettlement(fixture.rpc, exposed);
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

test("RPC log availability classifier separates history/range gaps from rate limiting", () => {
  assert.equal(acceptRpcHttpBody(200, false), true);
  assert.equal(acceptRpcHttpBody(400, true), true);
  for (const status of [undefined, 400, 401, 429, 500]) assert.equal(acceptRpcHttpBody(status, false), false);
  assert.equal(classifyX402LogAvailabilityMessage("historical state pruned"), "pruned");
  assert.equal(classifyX402LogAvailabilityMessage("block range limit exceeded"), "range_unavailable");
  assert.equal(classifyX402LogAvailabilityMessage("query returned more than 10000 results"), "range_unavailable");
  assert.equal(classifyX402LogAvailabilityMessage("You can make eth_getLogs requests with up to a 10 block range"), "range_unavailable");
  assert.equal(classifyX402LogAvailabilityMessage("rate limit exceeded"), null);
  assert.equal(classifyX402LogAvailabilityMessage("historical state request was rate limited"), null);
  assert.equal(classifyX402LogAvailabilityMessage("logs query was rate-limited"), null);
  assert.equal(classifyX402LogAvailabilityMessage("too many requests"), null);
  assert.equal(classifyX402LogAvailabilityMessage("historical state request rate limit exceeded"), null);
  assert.equal(classifyX402LogAvailabilityMessage("history unavailable: request limit exceeded"), null);
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
      const label = faultAt === "chain" ? "chain" : `state:${faultAt}`;
      fixture.rpc.onX402Call = (name) => {
        if (name === label) throw new ApnError("APN_RPC_AMBIGUOUS", `transient ${faultAt} fault`);
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
  // chainId, the nonce state at safe, and one receipt read only to name the transaction.
  assert.deepEqual(fixture.rpc.x402Calls, ["chain", "state:safe", "receipt"]);
  assert.equal((await operation(fixture)).settlementEvidence?.transactionHash, X402_TRANSACTION);
  const terminal = await operation(fixture);
  const receipt = await fixture.core.context.state.loadX402Receipt(terminal.profileHash, terminal.operationId);
  assert.equal(receipt?.previousLinkHash, terminal.transitions.at(-1)?.previousHash);
  assert.equal(receipt?.settlementResponseHash, terminal.settlementResponseObservation?.settlementResponseHash);
  assert.equal(fixture.rpc.submissions.length, 0);
});

test("restart reuses fsynced settlement evidence after a crash before receipt write", async (t) => {
  const fixture = await authorizedFixture(t, { idempotencyKey: "settlement-evidence-restart" });
  await fixture.core.execute({ command: "operation.resume", operationId: fixture.operationId });
  const exposed = await operation(fixture);
  const settlement = configureSettlement(fixture.rpc, exposed);

  const state = fixture.core.context.state;
  const originalWriteReceipt = state.writeX402Receipt.bind(state);
  state.writeX402Receipt = async () => { throw new Error("receipt write crash cut"); };
  const crashed = await fixture.core.execute({ command: "operation.resume", operationId: fixture.operationId });
  assert.equal(crashed.ok, false);
  state.writeX402Receipt = originalWriteReceipt;
  const preterminal = await operation(fixture);
  assert.equal(preterminal.terminal, false);
  assert.equal(preterminal.settlementEvidence?.schemaVersion, "apn.x402.settlement-evidence.v2");

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

  assert.equal(fixture.native.calls.length, nativeCalls);
  const exposed = await operation(fixture);
  const settlement = configureSettlement(fixture.rpc, exposed);

  const recovered = await fixture.core.execute({ command: "operation.resume", operationId: fixture.operationId });
  assert.equal(
    (recovered.operation as { readonly state?: unknown } | null)?.state,
    "failed_settled_without_result",
    JSON.stringify(recovered),
  );
  assert.equal(fixture.native.calls.length, nativeCalls);
  assert.equal(fixture.http.calls.length, 2);
});

test("response-backed settlement without seller result commits spent receipt; unmatched logs only drop the transaction name", async (t) => {
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
      // The used nonce proves this payment; a receipt with duplicate logs cannot name it, so no transaction is recorded.
      const resumed = await ambiguous.core.execute({ command: "operation.resume", operationId: ambiguous.operationId });
      assert.equal((resumed.operation as { readonly state?: unknown } | null)?.state, "failed_settled_without_result");
      const settled = await operation(ambiguous);
      assert.equal(settled.settlementEvidence?.schemaVersion, "apn.x402.settlement-evidence.v2");
      assert.equal(settled.settlementEvidence?.transactionHash, undefined);
    });
  }
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

  const expired = await fixture.core.execute({ command: "operation.resume", operationId: fixture.operationId });
  assert.equal((expired.operation as { readonly state?: unknown } | null)?.state, "failed_expired_unused", JSON.stringify(expired));
  assert.equal(fixture.http.calls.length, 1, "expired material cannot expose the paid HTTP request");
  assert.deepEqual(fixture.native.calls, [], "finalized expiry is classified before any optional pre-send material read");
});

test("post-exposure expiry requires a finalized block at or after validBefore with the nonce unused", async (t) => {
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
  const expired = await fixture.core.execute({ command: "operation.resume", operationId: fixture.operationId });
  assert.equal((expired.operation as { readonly state?: unknown } | null)?.state, "failed_expired_unused", JSON.stringify(expired));
  const terminal = await operation(fixture);
  const unused = terminal.unusedExpiryEvidence;
  assert.equal(unused?.schemaVersion, "apn.x402.unused-expiry-evidence.v2");
  assert.equal(unused?.finalizedHead.timestamp, current.authorization.validBefore);
  assert.equal(fixture.rpc.x402Calls.some((call) => call.startsWith("logs:")), false);
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
  const exposed = await operation(fixture);
  const settlement = configureSettlement(fixture.rpc, exposed);
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
  const exposed = await operation(fixture);
  const settlement = configureSettlement(fixture.rpc, exposed);
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
  const exposed = await operation(fixture);
  const settlement = configureSettlement(fixture.rpc, exposed);

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

test("cached-result non-success and transport outcomes persist one attempt then close spent; a malformed header keeps the body", async (t) => {
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
      const exposed = await operation(fixture);
      const settlement = configureSettlement(fixture.rpc, exposed);
      const resumed = await fixture.core.execute({ command: "operation.resume", operationId: fixture.operationId });
      // A recovered 200 body beside a malformed PAYMENT-RESPONSE is the purchase: kept, and the chain proof completes it.
      const expected = item.label === "malformed" ? "completed" : "failed_settled_without_result";
      assert.equal((resumed.operation as { readonly state?: unknown } | null)?.state, expected, JSON.stringify(resumed));
      const terminal = await operation(fixture);
      assert.equal(terminal.attempts.filter((attempt) => attempt.purpose === "result_recovery").length, 1);
      assert.equal(terminal.attempts.at(-1)?.phase, item.label === "transport" ? "ambiguous" : "observed");
      if ("classification" in item) {
        assert.equal(terminal.settlementResponseObservation?.classification, item.classification);
        assert.equal(terminal.transactionHint?.source, "payment_response");
      }
      const receipt = await fixture.core.context.state.loadX402Receipt(terminal.profileHash, terminal.operationId);
      assert.equal(receipt?.terminalState, expected);
      assert.equal(receipt?.result !== undefined, item.label === "malformed");
    });
  }
});

test("orphan terminal receipt restarts without ports and preserves predecessor linkage", async (t) => {
  const fixture = await authorizedFixture(t, { idempotencyKey: "receipt-crash" });
  await fixture.core.execute({ command: "operation.resume", operationId: fixture.operationId });
  const exposed = await operation(fixture);
  const settlement = configureSettlement(fixture.rpc, exposed);

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
