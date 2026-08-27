import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import type { Hex } from "../../src/model.js";
import type { HttpObservation } from "../../src/x402-model.js";
import type { X402RpcReceipt } from "../../src/ports.js";
import type { X402OperationRecord } from "../../src/x402-state-integrity.js";
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
  ]);
  const native = new ExactX402Native();
  const rpc = new RecoveryRpc();
  rpc.x402Evidence = { ...rpc.x402Evidence, address: X402_TEST_ACCOUNT.address };
  const clock = input.clock ?? new TestClock();
  const core = makeCore({ root: temporary.root, native, rpc, http, clock });
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

async function operation(fixture: Fixture): Promise<X402OperationRecord> {
  return await fixture.core.context.state.findX402Operation(fixture.operationId) as X402OperationRecord;
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
  assert.deepEqual(fixture.rpc.x402Calls, ["chain", "safe", "receipt", "block:12345", "state:safe", "safe"]);
  const terminal = await operation(fixture);
  const receipt = await fixture.core.context.state.loadX402Receipt(terminal.profileHash, terminal.operationId);
  assert.equal(receipt?.previousLinkHash, terminal.transitions.at(-1)?.previousHash);
  assert.equal(receipt?.settlementResponseHash, terminal.settlementResponseObservation?.settlementResponseHash);
  assert.equal(fixture.rpc.submissions.length, 0);
});

test("a completed unique AuthorizationUsed scan produces a bound hint and scan-backed spent receipt", async (t) => {
  const fixture = await authorizedFixture(t, { idempotencyKey: "scan-happy" });
  assert.equal((await fixture.core.execute({ command: "operation.resume", operationId: fixture.operationId })).ok, true);
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
    "chain", "safe", "safe", "logs:12345-12345", "block:12345", "safe",
    "receipt", "block:12345", "state:safe", "safe",
  ]);
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

test("partial, pruned, range-unavailable, multiple, and used-with-zero evidence stay nonterminal", async (t) => {
  for (const kind of ["pruned", "range_unavailable"] as const) {
    await t.test(kind, async (nested) => {
      const fixture = await authorizedFixture(nested, { idempotencyKey: `unavailable-${kind}` });
      await fixture.core.execute({ command: "operation.resume", operationId: fixture.operationId });
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
    const current = await operation(fixture);
    fixture.rpc.logOutcomes.push({
      kind: "complete",
      logs: [authorizationUsedLog({
        authorizer: current.wallet,
        nonce: current.authorization.nonce,
        transactionHash: X402_TRANSACTION as Hex,
        blockNumber: "12346",
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
    const current = await operation(fixture);
    const first = authorizationUsedLog({
      authorizer: current.wallet,
      nonce: current.authorization.nonce,
      transactionHash: X402_TRANSACTION as Hex,
      blockNumber: "12345",
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

test("safe-head reorg discards candidates and cursor, returns, and scans only next invocation", async (t) => {
  const fixture = await authorizedFixture(t, {
    paidOutcomes: [new Error("initial ambiguity"), new Error("bounded retry")],
    idempotencyKey: "reorg-reset",
  });
  await fixture.core.execute({ command: "operation.resume", operationId: fixture.operationId });
  fixture.rpc.safeHead = { ...fixture.rpc.safeHead, number: "15345", hash: `0x${"e".repeat(64)}` };
  fixture.rpc.logOutcomes.push({ kind: "complete", logs: [] });
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

test("expiry requires finalized timestamp, false state, and complete zero scan", async (t) => {
  const fixture = await authorizedFixture(t, { idempotencyKey: "expiry-positive" });
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
});

test("one cached-result retry can complete scan-discovered settlement", async (t) => {
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
    idempotencyKey: "cached-result-retry",
  });
  await fixture.core.execute({ command: "operation.resume", operationId: fixture.operationId });
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
  const exposed = await operation(fixture);
  const settlement = configureSettlement(fixture.rpc, exposed);
  fixture.rpc.logOutcomes.push({ kind: "complete", logs: [settlement.logs[0]!] });
  const resumed = await fixture.core.execute({ command: "operation.resume", operationId: fixture.operationId });
  assert.equal((resumed.operation as { readonly state?: unknown } | null)?.state, "effect_unknown");
  const durable = await operation(fixture);
  assert.equal(durable.transactionHint?.transactionHash, X402_TRANSACTION);
  assert.equal(durable.transactionHint?.source, "authorization_used_log");
  assert.equal(durable.resultLink, undefined);
});

test("orphan terminal receipt restarts without ports and preserves predecessor linkage", async (t) => {
  const fixture = await authorizedFixture(t, { idempotencyKey: "receipt-crash" });
  await fixture.core.execute({ command: "operation.resume", operationId: fixture.operationId });
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
