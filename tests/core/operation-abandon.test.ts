import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { ApnCore } from "../../src/core.js";
import { BASE_USDC, CHAIN_ID, STATE_VERSION } from "../../src/constants.js";
import { ApnError } from "../../src/errors.js";
import type { OperationRecord, ProviderDirectBinding, ReceiptRecord } from "../../src/model.js";
import {
  operationAbandonPhrase,
  TtyOperationAbandonApproval,
  type OperationAbandonApprovalPort,
  type OperationAbandonIntent,
} from "../../src/operation-abandon-approval.js";
import { OperationService } from "../../src/operation-service.js";
import { providerDirectReceipt, recoverProviderTerminalOperation } from "../../src/provider-direct-receipt.js";
import { createMcpServer } from "../../src/mcp-server.js";
import { appendTransition, sealOperation, sealReceipt, StateStore } from "../../src/state.js";
import { validateOperation } from "../../src/state-integrity.js";
import { RECIPIENT, TestClock, WALLET, temporaryState } from "./helpers.js";

const PROFILE = "owner-abandon";
const PROVIDER = "metamask-agent-wallet";
const IDEMPOTENCY = "owner-abandon-old-001";
const AT = "2026-09-10T06:00:00.000Z";

class Approval implements OperationAbandonApprovalPort {
  readonly calls: OperationAbandonIntent[] = [];
  constructor(private readonly refusal?: Error) {}
  async approve(intent: OperationAbandonIntent): Promise<void> {
    this.calls.push(intent);
    if (this.refusal !== undefined) throw this.refusal;
  }
}

class FailTerminalOperationWrite extends StateStore {
  fail = true;
  override async writeOperation(operation: OperationRecord): Promise<void> {
    if (this.fail && operation.state === "abandoned_unknown") {
      this.fail = false;
      throw new Error("simulated operation-link interruption");
    }
    await super.writeOperation(operation);
  }
}

class ReceiptReadCountingState extends StateStore {
  receiptReads = 0;
  override async loadReceipt(profileHash: string, operationId: string): Promise<ReceiptRecord | null> {
    this.receiptReads += 1;
    return await super.loadReceipt(profileHash, operationId);
  }
}

test("eligible owner abandonment is receipt-first, releases the prepare gate and preserves old idempotency", async (t) => {
  const temporary = await temporaryState();
  t.after(temporary.cleanup);
  const state = new StateStore(temporary.root);
  await state.initialize();
  const ambiguous = await seedProviderOperation(state);
  const approval = new Approval();
  const core = new ApnCore({ state, operationAbandonApproval: approval, clock: new TestClock() });

  const result = await core.execute({ command: "operation.abandon", operationId: ambiguous.operationId });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(approval.calls, [{
    operationId: ambiguous.operationId,
    fingerprint: ambiguous.fingerprint,
    profile: ambiguous.profile,
    providerId: PROVIDER,
    walletAddress: WALLET,
    recipient: RECIPIENT,
    amountAtomic: "1000000",
    amountDecimal: "1",
    chainLabel: "Base (8453)", assetLabel: "canonical Base USDC", unit: "USDC", outcomeNote: "Financial outcome: UNKNOWN. The provider may already have sent this transfer.",
  }]);
  const publicOperation = result.operation as Record<string, unknown>;
  assert.equal(publicOperation.state, "abandoned_unknown");
  assert.equal(publicOperation.terminal, true);
  assert.equal(publicOperation.reason, "owner_acknowledged_unresolved_effect");
  assert.equal(publicOperation.proof_class, "owner_acknowledgement_only");
  assert.equal(publicOperation.transaction_hash, undefined);

  const durable = await state.findOperation(ambiguous.operationId);
  assert.equal(durable?.transitions.length, ambiguous.transitions.length + 1);
  assert.deepEqual(durable?.transitions.slice(0, ambiguous.transitions.length), ambiguous.transitions);
  assertFrozen(ambiguous, durable!);
  const receipt = await state.loadReceipt(ambiguous.profileHash, ambiguous.operationId);
  assert.equal(receipt?.state, "abandoned_unknown");
  assert.equal(receipt?.reason, "owner_acknowledged_unresolved_effect");
  assert.equal(receipt?.proofClass, "owner_acknowledgement_only");
  assert.equal(receipt?.transactionHash, undefined);
  assert.equal(receipt?.blockNumberAtomic, undefined);
  assert.equal(receipt?.operationIntegrityHash, durable?.integrityHash);

});

test("abandoned terminal bytes stay immutable across abandon, status, receipt, approve and resume", async (t) => {
  const temporary = await temporaryState();
  t.after(temporary.cleanup);
  const state = new StateStore(temporary.root);
  await state.initialize();
  const ambiguous = await seedProviderOperation(state);
  const approval = new Approval();
  const core = new ApnCore({ state, operationAbandonApproval: approval, clock: new TestClock() });
  assert.equal((await core.execute({ command: "operation.abandon", operationId: ambiguous.operationId })).ok, true);
  const paths = statePaths(temporary.root, ambiguous);
  const before = await Promise.all([readFile(paths.operation), readFile(paths.receipt)]);

  for (const request of [
    { command: "operation.abandon", operationId: ambiguous.operationId },
    { command: "operation.status", operationId: ambiguous.operationId },
    { command: "receipt.get", operationId: ambiguous.operationId },
    { command: "transfer.approve", operationId: ambiguous.operationId },
    { command: "operation.resume", operationId: ambiguous.operationId },
  ] as const) {
    const result = await core.execute(request);
    assert.equal(result.ok, true, `${request.command}: ${JSON.stringify(result)}`);
  }
  const after = await Promise.all([readFile(paths.operation), readFile(paths.receipt)]);
  assert.deepEqual(after, before);
  assert.equal(approval.calls.length, 1);

  const operations = new OperationService(state);
  await operations.assertProfileAvailable(ambiguous.profileHash);
  assert.equal(await operations.resolvePrepare({
    kind: "direct_transfer",
    profileHash: ambiguous.profileHash,
    operationId: state.operationId(PROFILE, "owner-abandon-fresh-002"),
    idempotencyHash: state.idempotencyHash("owner-abandon-fresh-002"),
    requestHash: "f".repeat(64),
  }), null);
  const old = await operations.resolvePrepare({
    kind: "direct_transfer",
    profileHash: ambiguous.profileHash,
    operationId: ambiguous.operationId,
    idempotencyHash: ambiguous.idempotencyHash,
    requestHash: ambiguous.requestHash,
  });
  assert.equal(old?.record.operationId, ambiguous.operationId);
  assert.equal(old?.record.state, "abandoned_unknown");
});

test("refusal and ineligible direct families produce no state write, receipt recovery or external effect", async (t) => {
  const temporary = await temporaryState();
  t.after(temporary.cleanup);
  const state = new ReceiptReadCountingState(temporary.root);
  await state.initialize();
  const ambiguous = await seedProviderOperation(state);
  const paths = statePaths(temporary.root, ambiguous);
  const before = await Promise.all([readFile(paths.operation), readFile(paths.receipt).catch(() => null)]);
  const refused = new Approval(new ApnError("APN_NATIVE_REJECTED", "wrong confirmation"));
  const core = new ApnCore({ state, operationAbandonApproval: refused, clock: new TestClock() });
  const result = await core.execute({ command: "operation.abandon", operationId: ambiguous.operationId });
  assert.equal(result.error?.code, "APN_NATIVE_REJECTED");
  assert.deepEqual(await Promise.all([readFile(paths.operation), readFile(paths.receipt).catch(() => null)]), before);

  const nonambiguous = await seedProviderOperation(state, { profile: "abandon-nonambiguous", state: "started" });
  await seedProviderChildNotCreatedOrphan(state, nonambiguous);
  const cases = [
    await seedProviderOperation(state, { profile: "abandon-delegated", mode: "delegated_session_transaction" }),
    await seedProviderOperation(state, { profile: "abandon-reference", providerEffect: true }),
    await seedProviderOperation(state, { profile: "abandon-hash", transactionHash: true }),
    nonambiguous,
    await seedLocalOperation(state, "abandon-local"),
  ];
  const durableBytes = async (operation: OperationRecord) => {
    const paths = statePaths(temporary.root, operation);
    return await Promise.all([readFile(paths.operation), readFile(paths.receipt).catch(() => null)]);
  };
  const untouched = await Promise.all(cases.map(durableBytes));
  for (const [index, operation] of cases.entries()) {
    const receiptReads = state.receiptReads;
    const blocked = await core.execute({ command: "operation.abandon", operationId: operation.operationId });
    assert.equal(blocked.error?.code, "APN_OPERATION_BLOCKED", `${index}: ${JSON.stringify(blocked)}`);
    assert.equal(state.receiptReads, receiptReads, "ineligible operations are rejected before receipt recovery");
  }
  assert.deepEqual(await Promise.all(cases.map(durableBytes)), untouched);
  assert.equal(refused.calls.length, 1, "ineligible operations never reach confirmation");
});

test("authentic orphan receipt repairs once while forged abandonment state or proof is rejected", async (t) => {
  const temporary = await temporaryState();
  t.after(temporary.cleanup);
  const seed = new StateStore(temporary.root);
  await seed.initialize();
  const ambiguous = await seedProviderOperation(seed);
  const interrupted = new FailTerminalOperationWrite(temporary.root);
  const failed = await new ApnCore({
    state: interrupted,
    operationAbandonApproval: new Approval(),
    clock: new TestClock(),
  }).execute({ command: "operation.abandon", operationId: ambiguous.operationId });
  assert.equal(failed.error?.code, "APN_INTERNAL");
  assert.equal((await seed.findOperation(ambiguous.operationId))?.state, "ambiguous_effect");
  assert.equal((await seed.loadReceipt(ambiguous.profileHash, ambiguous.operationId))?.state, "abandoned_unknown");

  const restarted = new ApnCore({ state: new StateStore(temporary.root), clock: new TestClock() });
  const repaired = await restarted.execute({ command: "operation.status", operationId: ambiguous.operationId });
  assert.equal(repaired.ok, true, JSON.stringify(repaired));
  assert.equal((repaired.operation as { state?: unknown }).state, "abandoned_unknown");
  const repairedBytes = await readFile(statePaths(temporary.root, ambiguous).operation);
  assert.deepEqual(await readFile(statePaths(temporary.root, ambiguous).operation), repairedBytes);

  const wrongTransition = appendTransition(ambiguous.transitions, {
    at: AT,
    state: "abandoned_unknown",
    terminal: true,
    reason: "invented_no_effect",
    proofClass: "confirmed_receipt",
  });
  const { integrityHash: _old, ...base } = ambiguous;
  assert.throws(() => sealAndValidate({ ...base, state: "abandoned_unknown", terminal: true,
    reason: "invented_no_effect", proofClass: "confirmed_receipt", transitions: wrongTransition }),
  { code: "APN_STATE_CORRUPT" });

  const forgedReceipt = sealReceipt({
    schemaVersion: STATE_VERSION,
    operationId: ambiguous.operationId,
    state: "abandoned_unknown",
    terminal: true,
    reason: "owner_acknowledged_unresolved_effect",
    proofClass: "confirmed_no_effect",
    createdAt: AT,
    operationIntegrityHash: "a".repeat(64),
  });
  assert.throws(() => recoverProviderTerminalOperation(ambiguous, forgedReceipt), { code: "APN_STATE_CORRUPT" });
});

test("TTY renders exact unknown-risk identity, and wrong or non-TTY confirmation is refused", async () => {
  const intent = abandonIntent();
  const expected = operationAbandonPhrase(intent.fingerprint);
  let rendered = "";
  let closed = 0;
  const terminal = (input: string) => ({
    fd: 7,
    write: async (contents: string) => { rendered += contents; },
    read: async function* () { yield Buffer.from(`${input}\n`, "ascii"); },
    close: async () => { closed += 1; },
  });
  await new TtyOperationAbandonApproval({ openTerminal: async () => terminal(expected), isTerminal: () => true }).approve(intent);
  for (const value of [intent.operationId, intent.fingerprint, intent.profile, intent.providerId,
    intent.walletAddress, intent.recipient, intent.amountAtomic, expected, "Financial outcome: UNKNOWN"]) assert.match(rendered, new RegExp(value));
  assert.equal(closed, 1);

  await assert.rejects(new TtyOperationAbandonApproval({
    openTerminal: async () => terminal("wrong phrase"), isTerminal: () => true,
  }).approve(intent), { code: "APN_NATIVE_REJECTED" });
  await assert.rejects(new TtyOperationAbandonApproval({
    openTerminal: async () => terminal(expected), isTerminal: () => false,
  }).approve(intent), { code: "APN_NATIVE_REJECTED" });
});

test("MCP abandon exposes only a canonical foreground CLI handoff", async () => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer();
  const client = new Client({ name: "operation-abandon-test", version: "1.0.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const result = await client.callTool({ name: "apn_operation_abandon", arguments: { operation: "a".repeat(64) } });
    const envelope = result.structuredContent as unknown as { error?: { code?: string; details?: Record<string, unknown> } };
    assert.equal(envelope.error?.code, "APN_FOREGROUND_APPROVAL_REQUIRED");
    assert.deepEqual(envelope.error?.details?.cli_handoff_argv, ["apn", "operation", "abandon", "--operation", "a".repeat(64)]);
    assert.equal(envelope.error?.details?.foreground_auth, true);
  } finally {
    await client.close();
    await server.close();
  }
});

async function seedProviderOperation(state: StateStore, options: {
  readonly profile?: string;
  readonly mode?: ProviderDirectBinding["executionMode"];
  readonly providerEffect?: boolean;
  readonly transactionHash?: boolean;
  readonly state?: "started" | "ambiguous_effect";
} = {}): Promise<OperationRecord> {
  const profile = options.profile ?? PROFILE;
  const mode = options.mode ?? "provider_atomic_send";
  const idempotency = `${IDEMPOTENCY}-${profile}`;
  const profileHash = state.profileHash(profile);
  const operationId = state.operationId(profile, idempotency);
  const binding: ProviderDirectBinding = mode === "provider_atomic_send" ? {
    ...bindingBase(), executionMode: mode, executionOwner: "provider", retryOwner: "apn_outer_no_replay_journal",
  } : {
    ...bindingBase(), executionMode: mode, executionOwner: "apn", retryOwner: "apn_operation_state",
    permissionRevision: 1, rootGrantFingerprint: "7".repeat(64), sessionAddress: WALLET,
    delegationManager: RECIPIENT, permissionExpiresAtUnix: 2_000_000_000,
  };
  const initial = appendTransition([], { at: AT, state: "awaiting_approval", terminal: false,
    reason: "prepared_provider_atomic_send", proofClass: "durable_provider_intent" });
  let operation = sealOperation({
    schemaVersion: STATE_VERSION, operationId, idempotencyHash: state.idempotencyHash(idempotency),
    profile, profileHash, requestHash: "1".repeat(64), fingerprint: "2".repeat(48) + operationId.slice(-16),
    walletAddress: WALLET, recipient: RECIPIENT, amountAtomic: "1000000", amountDecimal: "1",
    chainId: CHAIN_ID, token: BASE_USDC, providerDirect: binding, preparedAt: AT,
    expiresAt: "2026-09-10T06:01:00.000Z", state: "awaiting_approval", terminal: false,
    reason: "prepared_provider_atomic_send", proofClass: "durable_provider_intent", transitions: initial,
  });
  await state.writeOperation(operation);
  const started = appendTransition(operation.transitions, { at: AT, state: "started", terminal: false,
    reason: "provider_effect_started", proofClass: "durable_provider_no_replay" });
  const { integrityHash: _initial, ...initialBase } = operation;
  operation = sealOperation({ ...initialBase, state: "started", terminal: false,
    reason: "provider_effect_started", proofClass: "durable_provider_no_replay", transitions: started });
  await state.writeOperation(operation);
  if (options.state === "started") return operation;
  const ambiguous = appendTransition(operation.transitions, { at: AT, state: "ambiguous_effect", terminal: false,
    reason: "provider_invocation_outcome_unknown", proofClass: "provider_effect_no_replay" });
  const { integrityHash: _started, ...startedBase } = operation;
  operation = sealOperation({ ...startedBase,
    ...(options.providerEffect === true ? { providerEffect: { schemaVersion: "apn.provider-effect-reference.v1" as const,
      kind: "transaction" as const, recoveryToken: "request-01234567", providerState: "RECOVERED" } } : {}),
    ...(options.transactionHash === true ? { transactionHash: `0x${"e".repeat(64)}` as const } : {}),
    state: "ambiguous_effect", terminal: false, reason: "provider_invocation_outcome_unknown",
    proofClass: "provider_effect_no_replay", transitions: ambiguous });
  await state.writeOperation(operation);
  return operation;
}

async function seedLocalOperation(state: StateStore, profile: string): Promise<OperationRecord> {
  const profileHash = state.profileHash(profile);
  const operationId = state.operationId(profile, "local-owner-abandon-001");
  const transition = appendTransition([], { at: AT, state: "awaiting_approval", terminal: false,
    reason: "prepared_and_frozen", proofClass: "durable_pre_effect" });
  const operation = sealOperation({
    schemaVersion: STATE_VERSION, operationId, idempotencyHash: state.idempotencyHash("local-owner-abandon-001"),
    profile, profileHash, requestHash: "3".repeat(64), fingerprint: "4".repeat(64), walletAddress: WALLET,
    recipient: RECIPIENT, amountAtomic: "1", amountDecimal: "0.000001", chainId: CHAIN_ID,
    token: BASE_USDC, transactionData: "0x", economics: { nonceAtomic: "0", gasLimitAtomic: "21000",
      maxFeePerGasAtomic: "1", maxPriorityFeePerGasAtomic: "0", maximumGasCostAtomic: "21000" },
    preparedBlockNumberAtomic: "1", preparedAt: AT, expiresAt: "2026-09-10T06:01:00.000Z",
    state: "awaiting_approval", terminal: false, reason: "prepared_and_frozen",
    proofClass: "durable_pre_effect", transitions: transition,
  });
  await state.writeOperation(operation);
  return operation;
}

async function seedProviderChildNotCreatedOrphan(state: StateStore, operation: OperationRecord): Promise<void> {
  const transitions = appendTransition(operation.transitions, {
    at: AT,
    state: "failed_before_effect",
    terminal: true,
    reason: "provider_child_not_created",
    proofClass: "provider_child_not_created",
  });
  const { integrityHash: _old, ...base } = operation;
  const terminal = sealOperation({
    ...base,
    state: "failed_before_effect",
    terminal: true,
    reason: "provider_child_not_created",
    proofClass: "provider_child_not_created",
    transitions,
  });
  await state.writeReceipt(operation.profileHash, providerDirectReceipt(terminal));
}

function bindingBase() {
  return {
    schemaVersion: "apn.provider-direct.v1" as const, providerId: PROVIDER, profileRevision: 1,
    capabilityHash: "5".repeat(64), accountBindingHash: "6".repeat(64), rpcBindingHash: "8".repeat(64),
    rpcOriginHash: "9".repeat(64), policy: { identity: "apn.direct.foreground-approval.v1" as const,
      verdict: "foreground_approval_required" as const, foregroundApprovalRequired: true as const },
  };
}

function statePaths(root: string, operation: OperationRecord) {
  return {
    operation: join(root, "operations", operation.profileHash, `${operation.operationId}.json`),
    receipt: join(root, "receipts", operation.profileHash, `${operation.operationId}.json`),
  };
}

function assertFrozen(before: OperationRecord, after: OperationRecord): void {
  const mutable = new Set(["state", "terminal", "reason", "proofClass", "transitions", "integrityHash"]);
  for (const key of Object.keys(before) as Array<keyof OperationRecord>) {
    if (!mutable.has(key)) assert.deepEqual(after[key], before[key], String(key));
  }
}

function abandonIntent(): OperationAbandonIntent {
  return {
    operationId: "a".repeat(64), fingerprint: "b".repeat(64), profile: PROFILE,
    providerId: PROVIDER, walletAddress: WALLET, recipient: RECIPIENT,
    amountAtomic: "1000000", amountDecimal: "1",
    chainLabel: "Base (8453)", assetLabel: "canonical Base USDC", unit: "USDC", outcomeNote: "Financial outcome: UNKNOWN. The provider may already have sent this transfer.",
  };
}

function sealAndValidate(value: Omit<OperationRecord, "integrityHash">): OperationRecord {
  const operation = sealOperation(value);
  return validateOperation(operation);
}
