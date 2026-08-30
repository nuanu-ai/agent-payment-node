import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { canonicalJson, sha256 } from "../../src/canonical.js";
import type { OutputEnvelope } from "../../src/commands.js";
import type { Hex } from "../../src/model.js";
import { successEnvelope } from "../../src/output.js";
import { StateStore } from "../../src/state.js";
import {
  appendX402Transition,
  publicX402Operation,
  sealX402Operation,
  sealX402Receipt,
  x402OperationBindingHash,
  type X402OperationRecord,
  type X402State,
} from "../../src/x402-state-integrity.js";
import { makeCore, temporaryState, TestClock } from "./helpers.js";
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
} from "./x402-vectors.js";

const SELLER_BODY_CANARY = "SELLER_BODY_CANARY_CP6";
const QUERY_CANARY = "QUERY_CANARY_CP6";
const IDEMPOTENCY_CANARY = "IDEMPOTENCY_CANARY_CP6";
const PROFILE_CANARY = "profile_canary_cp6";
const TERMINAL_KEYS = [
  "version", "request_id", "command", "ok", "proof_class", "data", "operation", "receipt", "error", "next_actions",
] as const;

interface JourneyFixture {
  readonly root: string;
  readonly core: ReturnType<typeof makeCore>;
  readonly operationId: string;
  readonly native: ExactX402Native;
  readonly rpc: RecoveryRpc;
  readonly http: QueuedHttp;
  readonly clock: TestClock;
}

function x402Url(withCanary = false): string {
  return withCanary ? `https://seller.example/resource?secret=${QUERY_CANARY}` : X402_URL;
}

function challengeFor(url: string) {
  return challengeObservation({
    finalUrl: url,
    header: canonicalPaymentRequiredHeader({
      ...X402_PAYMENT_REQUIRED,
      resource: { ...X402_PAYMENT_REQUIRED.resource, url },
    }),
  });
}

function successfulPaidResponse(url: string, bodyText = `{"forecast":"${SELLER_BODY_CANARY}"}`) {
  return paidObservation({
    finalUrl: url,
    bodyText,
    paymentResponseHeader: canonicalPaymentResponseHeader({
      success: true,
      transaction: X402_TRANSACTION,
      network: "eip155:8453",
      payer: X402_TEST_ACCOUNT.address.toLowerCase(),
      amount: "1250000",
    }),
  });
}

async function preparedFixture(t: TestContext, input: {
  readonly idempotencyKey: string;
  readonly profile?: string;
  readonly url?: string;
  readonly paidOutcomes?: readonly (ReturnType<typeof paidObservation> | Error)[];
  readonly inspectFirst?: boolean;
}): Promise<JourneyFixture> {
  const temporary = await temporaryState();
  t.after(temporary.cleanup);
  const url = input.url ?? X402_URL;
  const challenge = challengeFor(url);
  const http = new QueuedHttp([
    ...(input.inspectFirst === true ? [challenge] : []),
    challenge,
    ...(input.paidOutcomes ?? []),
  ]);
  const native = new ExactX402Native();
  const rpc = new RecoveryRpc();
  rpc.x402Evidence = { ...rpc.x402Evidence, address: X402_TEST_ACCOUNT.address };
  const clock = new TestClock();
  const core = makeCore({ root: temporary.root, native, rpc, http, clock });
  if (input.inspectFirst === true) {
    const inspected = await core.execute({ command: "x402.inspect", url });
    assert.equal(inspected.ok, true, JSON.stringify(inspected));
    assert.equal((inspected.data as { readonly kind?: unknown } | null)?.kind, "x402_inspection");
    assert.equal(inspected.operation, null);
    assert.equal(inspected.receipt, null);
  }
  const profile = input.profile ?? "default";
  assert.equal((await core.execute({ command: "wallet.ensure", profile })).ok, true);
  const prepared = await core.execute({
    command: "x402.fetch.prepare",
    profile,
    url,
    maxAmountAtomic: "2000000",
    idempotencyKey: input.idempotencyKey,
  });
  assert.equal(prepared.ok, true, JSON.stringify(prepared));
  const operationId = (prepared.operation as { readonly operationId?: unknown } | null)?.operationId;
  assert.equal(typeof operationId, "string", JSON.stringify(prepared));
  return { root: temporary.root, core, operationId: operationId as string, native, rpc, http, clock };
}

async function approve(fixture: JourneyFixture): Promise<OutputEnvelope> {
  const approved = await fixture.core.execute({ command: "x402.fetch.approve", operationId: fixture.operationId });
  assert.equal(approved.ok, true, JSON.stringify(approved));
  return approved;
}

async function durableOperation(fixture: JourneyFixture): Promise<X402OperationRecord> {
  const found = await fixture.core.context.state.findX402Operation(fixture.operationId);
  assert.notEqual(found, null);
  return found as X402OperationRecord;
}

function armSettlement(rpc: RecoveryRpc, operation: X402OperationRecord): void {
  const blockNumber = rpc.safeHead.number;
  const blockHash = rpc.safeHead.hash;
  const transactionHash = X402_TRANSACTION as Hex;
  rpc.blockHashes.set(blockNumber, blockHash);
  rpc.authorizationStateValue = true;
  const authorization = authorizationUsedLog({
    authorizer: operation.wallet,
    nonce: operation.authorization.nonce,
    transactionHash,
    blockNumber,
    blockHash,
  });
  const transfer = transferLog({
    from: operation.wallet,
    to: operation.payee,
    value: operation.amountAtomic,
    transactionHash,
    blockNumber,
    blockHash,
  });
  rpc.x402Receipt = {
    transactionHash,
    status: "success",
    blockNumber,
    blockHash,
    logs: [authorization, transfer],
    observedAt: rpc.safeHead.observedAt,
    rpcOrigin: rpc.rpcOrigin,
  };
}

async function completeJourney(t: TestContext, withCanaries = false): Promise<JourneyFixture & { readonly completed: OutputEnvelope }> {
  const url = x402Url(withCanaries);
  const fixture = await preparedFixture(t, {
    idempotencyKey: withCanaries ? IDEMPOTENCY_CANARY : "x402-output-completed",
    profile: withCanaries ? PROFILE_CANARY : "default",
    url,
    paidOutcomes: [successfulPaidResponse(url)],
    inspectFirst: true,
  });
  const approved = await approve(fixture);
  assert.equal((approved.operation as { readonly state?: unknown } | null)?.state, "authorized_not_sent");
  const sent = await fixture.core.execute({ command: "operation.resume", operationId: fixture.operationId });
  assert.equal(sent.ok, true, JSON.stringify(sent));
  assert.equal((sent.operation as { readonly state?: unknown } | null)?.state, "settlement_pending");
  assert.equal(sent.data, null, "a non-terminal result link must not expose seller content");
  armSettlement(fixture.rpc, await durableOperation(fixture));
  const completed = await fixture.core.execute({ command: "operation.resume", operationId: fixture.operationId });
  assert.equal(completed.ok, true, JSON.stringify(completed));
  assert.equal((completed.operation as { readonly state?: unknown } | null)?.state, "completed");
  return { ...fixture, completed };
}

function assertTerminalEnvelope(envelope: OutputEnvelope, state: string, hasResult: boolean): void {
  assert.deepEqual(Object.keys(envelope), [...TERMINAL_KEYS]);
  assert.equal(envelope.ok, true);
  assert.equal(envelope.error, null);
  assert.equal((envelope.operation as { readonly state?: unknown } | null)?.state, state);
  assert.equal((envelope.operation as { readonly terminal?: unknown } | null)?.terminal, true);
  assert.equal((envelope.receipt as { readonly terminalState?: unknown } | null)?.terminalState, state);
  assert.equal(envelope.data !== null, hasResult);
  assert.deepEqual(envelope.next_actions, ["receipt.get"]);
}

test("compiled core journey returns completed seller data, safe operation, and receipt in one exact envelope", async (t) => {
  const fixture = await completeJourney(t, true);
  const completed = fixture.completed;
  assertTerminalEnvelope(completed, "completed", true);
  assert.equal(completed.proof_class, "x402_safe_settlement");
  assert.deepEqual(completed.data, {
    kind: "x402_result",
    media_type: "application/json",
    body: { forecast: SELLER_BODY_CANARY },
    sha256: (completed.operation as { readonly result?: { readonly resultHash?: unknown } }).result?.resultHash,
    byte_length: Buffer.byteLength(`{"forecast":"${SELLER_BODY_CANARY}"}`, "utf8").toString(),
  });

  const withoutData = { ...completed, data: null };
  const publicText = JSON.stringify(withoutData);
  for (const canary of [SELLER_BODY_CANARY, QUERY_CANARY, IDEMPOTENCY_CANARY, PROFILE_CANARY]) {
    assert.equal(publicText.includes(canary), false, canary);
  }
  assert.equal(JSON.stringify(completed.operation).includes("canonicalUrl"), false);
  assert.equal(JSON.stringify(completed.receipt).includes("bodyText"), false);
  assert.equal((completed.receipt as { readonly schemaVersion?: unknown } | null)?.schemaVersion, "apn.x402.receipt.v1");
});

test("explicit command outcomes preserve falsy data without changing envelope slots", () => {
  const operation = { state: "completed" };
  const receipt = { terminalState: "completed" };
  const envelope = successEnvelope({ command: "version" }, "request-falsy", {
    proofClass: "explicit_test",
    data: 0,
    operation,
    receipt,
    nextActions: [],
  });
  assert.equal(envelope.data, 0);
  assert.equal(envelope.operation, operation);
  assert.equal(envelope.receipt, receipt);
});

test("completed text result returns exact protected UTF-8 text only in command data", async (t) => {
  const bodyText = `plain ${SELLER_BODY_CANARY}`;
  const fixture = await preparedFixture(t, {
    idempotencyKey: "x402-output-text",
    paidOutcomes: [paidObservation({
      bodyText,
      mediaType: "text/plain",
      paymentResponseHeader: canonicalPaymentResponseHeader({
        success: true,
        transaction: X402_TRANSACTION,
        network: "eip155:8453",
        payer: X402_TEST_ACCOUNT.address.toLowerCase(),
        amount: "1250000",
      }),
    })],
  });
  await approve(fixture);
  await fixture.core.execute({ command: "operation.resume", operationId: fixture.operationId });
  armSettlement(fixture.rpc, await durableOperation(fixture));
  const completed = await fixture.core.execute({ command: "operation.resume", operationId: fixture.operationId });
  assertTerminalEnvelope(completed, "completed", true);
  assert.equal((completed.data as { readonly media_type?: unknown }).media_type, "text/plain");
  assert.equal((completed.data as { readonly body?: unknown }).body, bodyText);
  assert.equal(JSON.stringify({ ...completed, data: null }).includes(SELLER_BODY_CANARY), false);
});

test("completed status and receipt are body-free, while terminal approve/resume replay is effect-free and re-returns data", async (t) => {
  const fixture = await completeJourney(t);
  const operation = await durableOperation(fixture);
  const operationPath = join(fixture.root, "x402-operations", operation.profileHash, `${operation.operationId}.json`);
  const resultPath = join(fixture.root, "x402-results", operation.profileHash, `${operation.operationId}.json`);
  const receiptPath = join(fixture.root, "x402-receipts", operation.profileHash, `${operation.operationId}.json`);
  const before = await Promise.all([readFile(operationPath), readFile(resultPath), readFile(receiptPath)]);

  const cold = makeCore({ root: fixture.root, clock: fixture.clock });
  const status = await cold.execute({ command: "operation.status", operationId: fixture.operationId });
  assert.equal(status.ok, true, JSON.stringify(status));
  assert.equal(status.data, null);
  assert.equal(status.receipt, null);
  assert.equal((status.operation as { readonly result?: { readonly resultHash?: unknown } }).result?.resultHash,
    (fixture.completed.data as { readonly sha256?: unknown }).sha256);
  assert.equal(JSON.stringify(status).includes(SELLER_BODY_CANARY), false);

  const receipt = await cold.execute({ command: "receipt.get", operationId: fixture.operationId });
  assert.equal(receipt.ok, true, JSON.stringify(receipt));
  assert.equal(receipt.data, null);
  assert.equal(receipt.operation, null);
  assert.equal((receipt.receipt as { readonly terminalState?: unknown } | null)?.terminalState, "completed");
  assert.equal(JSON.stringify(receipt).includes(SELLER_BODY_CANARY), false);

  const liveLockPath = join(fixture.root, "locks", `${sha256(`lock\0profile:${operation.profileHash}`)}.lock`);
  const liveLock = canonicalJson({
    pid: process.pid.toString(),
    createdAtMs: Date.now().toString(),
    token: "terminal-replay-contention-canary",
  });
  await writeFile(liveLockPath, liveLock, { mode: 0o600 });
  for (const replay of [
    await cold.execute({ command: "operation.resume", operationId: fixture.operationId }),
    await cold.execute({ command: "x402.fetch.approve", operationId: fixture.operationId }),
  ]) {
    assertTerminalEnvelope(replay, "completed", true);
    assert.deepEqual(replay.data, fixture.completed.data);
    assert.deepEqual(replay.operation, fixture.completed.operation);
    assert.deepEqual(replay.receipt, fixture.completed.receipt);
  }
  assert.equal(await readFile(liveLockPath, "utf8"), liveLock, "terminal replay must neither wait on nor mutate a live money lock");
  const after = await Promise.all([readFile(operationPath), readFile(resultPath), readFile(receiptPath)]);
  assert.deepEqual(after, before, "terminal reads and replay must not rewrite durable artifacts");
});

test("response-backed spent-without-result is ok:true with operation and receipt but no seller data", async (t) => {
  const response = paidObservation({
    status: 402,
    bodyText: SELLER_BODY_CANARY,
    paymentResponseHeader: canonicalPaymentResponseHeader({
      success: true,
      transaction: X402_TRANSACTION,
      network: "eip155:8453",
      payer: X402_TEST_ACCOUNT.address.toLowerCase(),
      amount: "1250000",
    }),
  });
  const fixture = await preparedFixture(t, {
    idempotencyKey: "x402-output-spent",
    paidOutcomes: [response],
  });
  await approve(fixture);
  const sent = await fixture.core.execute({ command: "operation.resume", operationId: fixture.operationId });
  assert.equal((sent.operation as { readonly state?: unknown } | null)?.state, "settlement_pending");
  armSettlement(fixture.rpc, await durableOperation(fixture));
  const settled = await fixture.core.execute({ command: "operation.resume", operationId: fixture.operationId });
  assertTerminalEnvelope(settled, "failed_settled_without_result", false);
  assert.equal(settled.proof_class, "x402_settled_result_unavailable");
  assert.equal(JSON.stringify(settled).includes(SELLER_BODY_CANARY), false);
});

test("finalized unused expiry is ok:true with its terminal receipt and no paid request", async (t) => {
  const fixture = await preparedFixture(t, { idempotencyKey: "x402-output-expired" });
  await approve(fixture);
  const current = await durableOperation(fixture);
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
  assertTerminalEnvelope(expired, "failed_expired_unused", false);
  assert.equal(expired.proof_class, "x402_expired_unused_finalized");
  assert.equal(fixture.http.calls.length, 1, "only the unpaid prepare challenge is allowed");
});

test("failed-before-effect terminal graph is routed by kind and exposed as a safe business outcome", async (t) => {
  const fixture = await preparedFixture(t, { idempotencyKey: "x402-output-before-effect" });
  const operation = await durableOperation(fixture);
  const at = operation.updatedAt;
  const receipt = sealX402Receipt({
    schemaVersion: "apn.x402.receipt.v1",
    kind: "x402_fetch",
    operationId: operation.operationId,
    terminalState: "failed_before_effect",
    reason: "x402_failed_before_effect",
    proofClass: "x402_proven_no_effect",
    resource: {
      origin: operation.resource.origin,
      path: operation.resource.path,
      urlHash: operation.resource.urlHash,
    },
    fingerprint: operation.fingerprint,
    offerHash: operation.selectedOffer.offerHash,
    payer: operation.wallet,
    payee: operation.payee,
    amountAtomic: operation.amountAtomic,
    network: operation.network,
    token: operation.token,
    ...(operation.paymentIdentifier === undefined ? {} : { paymentIdentifier: operation.paymentIdentifier.value }),
    operationBindingHash: x402OperationBindingHash(operation),
    previousLinkHash: operation.transitions.at(-1)?.hash as string,
    createdAt: at,
  });
  await fixture.core.context.state.writeX402Receipt(operation.profileHash, receipt);
  const { integrityHash: _integrityHash, ...withoutIntegrity } = operation;
  const terminal = sealX402Operation({
    ...withoutIntegrity,
    receiptLink: { receiptIntegrityHash: receipt.integrityHash },
    state: "failed_before_effect",
    finalityClass: "terminal",
    terminal: true,
    reason: "x402_failed_before_effect",
    proofClass: "x402_proven_no_effect",
    nextActions: ["receipt.get"],
    updatedAt: at,
    transitions: appendX402Transition(operation.transitions, {
      at,
      state: "failed_before_effect",
      terminal: true,
      reason: "x402_failed_before_effect",
      proofClass: "x402_proven_no_effect",
    }),
  });
  await fixture.core.context.state.writeX402Operation(terminal);

  const cold = makeCore({ root: fixture.root, clock: fixture.clock });
  const resumed = await cold.execute({ command: "operation.resume", operationId: fixture.operationId });
  assertTerminalEnvelope(resumed, "failed_before_effect", false);
  assert.equal(resumed.proof_class, "x402_proven_no_effect");
  const fetched = await cold.execute({ command: "receipt.get", operationId: fixture.operationId });
  assert.equal((fetched.receipt as { readonly terminalState?: unknown } | null)?.terminalState, "failed_before_effect");
});

test("public x402 projection snapshots every state tuple and excludes protected members", async (t) => {
  const fixture = await preparedFixture(t, {
    idempotencyKey: IDEMPOTENCY_CANARY,
    profile: PROFILE_CANARY,
    url: x402Url(true),
  });
  const base = await durableOperation(fixture);
  const cases: Readonly<Record<X402State, readonly [string, string, readonly string[], string]>> = {
    awaiting_approval: ["pre_effect", "x402_awaiting_authorization", ["x402.fetch.approve", "operation.status"], "x402_frozen_offer"],
    authorization_material_pending: ["pre_effect", "x402_authorization_material_pending", ["operation.resume", "operation.status"], "x402_authorization_recovery"],
    authorized_not_sent: ["pre_effect", "x402_authorized_not_sent", ["operation.resume", "operation.status"], "x402_authorization_verified"],
    paid_request_pending: ["unknown_finality", "x402_paid_request_pending", ["operation.resume", "operation.status"], "x402_unknown_finality"],
    settlement_pending: ["unknown_finality", "x402_settlement_pending", ["operation.resume", "operation.status"], "x402_unknown_finality"],
    effect_unknown: ["unknown_finality", "x402_effect_unknown", ["operation.resume", "operation.status"], "x402_unknown_finality"],
    seller_result_recovery_pending: ["known_settled", "x402_seller_result_recovery_pending", ["operation.resume", "operation.status"], "x402_settlement_verified_result_pending"],
    completed: ["terminal", "x402_completed", ["receipt.get"], "x402_safe_settlement"],
    failed_before_effect: ["terminal", "x402_failed_before_effect", ["receipt.get"], "x402_proven_no_effect"],
    failed_expired_unused: ["terminal", "x402_failed_expired_unused", ["receipt.get"], "x402_expired_unused_finalized"],
    failed_settled_without_result: ["terminal", "x402_failed_settled_without_result", ["receipt.get"], "x402_settled_result_unavailable"],
  };
  for (const [state, [finalityClass, reason, nextActions, proofClass]] of Object.entries(cases) as Array<[
    X402State,
    readonly [string, string, readonly string[], string],
  ]>) {
    const projected = publicX402Operation({
      ...base,
      state,
      finalityClass: finalityClass as X402OperationRecord["finalityClass"],
      terminal: finalityClass === "terminal",
      reason: reason as X402OperationRecord["reason"],
      proofClass: proofClass as X402OperationRecord["proofClass"],
      nextActions: nextActions as X402OperationRecord["nextActions"],
    }) as Record<string, unknown>;
    assert.equal(projected.state, state);
    assert.equal(projected.finalityClass, finalityClass);
    assert.equal(projected.reason, reason);
    assert.equal(projected.proofClass, proofClass);
    assert.deepEqual(projected.nextActions, nextActions);
    const text = JSON.stringify(projected);
    for (const canary of [QUERY_CANARY, IDEMPOTENCY_CANARY, PROFILE_CANARY]) assert.equal(text.includes(canary), false, `${state}:${canary}`);
    for (const protectedKey of ["canonicalUrl", "sellerWire", "authorization", "attempts", "signatureHash", "paymentHeaderHash"]) {
      assert.equal(protectedKey in projected, false, `${state}:${protectedKey}`);
    }
  }
});

test("terminal result or receipt tamper fails closed without a partial projection or protected body", async (t) => {
  const fixture = await completeJourney(t);
  const operation = await durableOperation(fixture);
  const resultPath = join(fixture.root, "x402-results", operation.profileHash, `${operation.operationId}.json`);
  const stored = JSON.parse(await readFile(resultPath, "utf8")) as Record<string, unknown>;
  await writeFile(resultPath, `${canonicalJson({ ...stored, bodyText: "TAMPERED_SELLER_BODY_CANARY" })}\n`, { mode: 0o600 });
  const cold = makeCore({ root: fixture.root, clock: fixture.clock });
  const status = await cold.execute({ command: "operation.status", operationId: fixture.operationId });
  assert.equal(status.ok, false);
  assert.equal(status.error?.code, "APN_STATE_CORRUPT");
  assert.equal(status.data, null);
  assert.equal(status.operation, null);
  assert.equal(status.receipt, null);
  assert.equal(JSON.stringify(status).includes("TAMPERED_SELLER_BODY_CANARY"), false);
});

test("x402 receipt lookup never falls through to the direct-transfer store", async (t) => {
  const fixture = await completeJourney(t);
  const fromCore = await fixture.core.execute({ command: "receipt.get", operationId: fixture.operationId });
  assert.equal(fromCore.ok, true, JSON.stringify(fromCore));
  assert.equal((fromCore.receipt as { readonly kind?: unknown } | null)?.kind, "x402_fetch");

  const directStore = new StateStore(fixture.root);
  await directStore.initialize();
  assert.equal(await directStore.loadReceipt((await durableOperation(fixture)).profileHash, fixture.operationId), null);
});
