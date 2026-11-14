import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { ApnCore } from "../../src/core.js";
import { BASE_USDC, TRANSFER_TOPIC } from "../../src/constants.js";
import { ApnError } from "../../src/errors.js";
import { MetaMaskDirectAdapter } from "../../src/metamask-direct-adapter.js";
import {
  METAMASK_AGENT_WALLET_PROVIDER_ID,
  MetaMaskProcessAdapter,
} from "../../src/metamask-process-adapter.js";
import type { MetaMaskProcessResult, MetaMaskProcessRunnerPort } from "../../src/metamask-process-runner.js";
import type { Address, Hex } from "../../src/model.js";
import type { ForegroundAuthenticationPort } from "../../src/provider-ports.js";
import { ProviderRegistry } from "../../src/provider-registry.js";
import { providerDirectReceipt } from "../../src/provider-direct-receipt.js";
import { EncryptedProviderRequestReferenceStore, providerRequestReferenceHash } from "../../src/provider-request-reference-store.js";
import { StateProfileRepository } from "../../src/profile-repository.js";
import { appendTransition, sealOperation, StateStore } from "../../src/state.js";
import type { TransferApprovalIntent, TransferApprovalPort } from "../../src/tty-approval.js";
import { TestClock, TestRpc, temporaryState } from "./helpers.js";
import { ReferenceTestSecret, flipped, rewrite, stateFiles } from "./provider-request-reference-helpers.js";

const SENDER = "0x1111111111111111111111111111111111111111" as Address;
const RECIPIENT = "0x2222222222222222222222222222222222222222" as Address;
const TX_HASH = `0x${"e".repeat(64)}` as Hex;
const TOKEN = "request-01234567";
const PROFILE = "metamask-direct";
const IDEMPOTENCY = "metamask-direct-001";
/** What output and a sealing record show in place of the MetaMask request id (QA F26). */
const TOKEN_HASH = providerRequestReferenceHash(METAMASK_AGENT_WALLET_PROVIDER_ID, TOKEN);

class FixtureRunner implements MetaMaskProcessRunnerPort {
  readonly calls: Array<{ readonly argv: readonly string[]; readonly timeoutMs?: number }> = [];
  addressMode = "server";
  chainNamespace = "evm";
  transfer: MetaMaskProcessResult = success({
    mode: "server",
    address: SENDER,
    status: "AWAITING_MFA",
    pollingId: TOKEN,
  });
  watch: MetaMaskProcessResult = success({
    request: { pollingId: TOKEN, kind: "transaction", namespace: "eip155", chainId: 8453 },
    status: { kind: "transaction", status: "CONFIRMED", txHash: TX_HASH },
  });
  throwTransfer = false;

  async runJson(argv: readonly string[], timeoutMs?: number): Promise<MetaMaskProcessResult> {
    this.calls.push({ argv: [...argv], ...(timeoutMs === undefined ? {} : { timeoutMs }) });
    if (argv[0] === "doctor") return success({
      cli: "6.1.5", env: "prod", authenticated: true, initialized: true,
    });
    if (argv[0] === "wallet" && argv[1] === "select") return success({ selected: SENDER });
    if (argv[0] === "wallet" && argv[1] === "address") return success({
      mode: this.addressMode, chainNamespace: this.chainNamespace, address: SENDER,
    });
    if (argv[0] === "transfer") {
      if (this.throwTransfer) throw new Error("provider process lost");
      return clone(this.transfer);
    }
    if (argv[0] === "wallet" && argv[1] === "requests" && argv[2] === "watch") return clone(this.watch);
    if (argv[0] === "logout") return success({ success: true });
    throw new Error(`unexpected MetaMask fixture command: ${argv.join(" ")}`);
  }

  async runForeground(): Promise<number> { return 0; }
}

class Approval implements TransferApprovalPort {
  readonly calls: TransferApprovalIntent[] = [];
  async approve(intent: TransferApprovalIntent): Promise<void> { this.calls.push(intent); }
}

const foreground: ForegroundAuthenticationPort = {
  readIdentity: async () => { throw new Error("MetaMask owns login"); },
  readChallengeResponse: async () => { throw new Error("MetaMask owns login"); },
  confirmRebind: async () => true,
};

test("MetaMask direct adapter uses exact sender, canonical Base USDC argv and same MFA request", async () => {
  const runner = new FixtureRunner();
  const adapter = new MetaMaskDirectAdapter(runner);
  assert.deepEqual(await adapter.execute({ sender: SENDER, recipient: RECIPIENT, amountDecimal: "1" }), {
    disposition: "pending",
    recoveryToken: TOKEN,
    providerState: "AWAITING_MFA",
  });
  assert.deepEqual(runner.calls.map((call) => call.argv), [
    ["wallet", "select", SENDER, "--chain-namespace", "evm", "--json"],
    ["wallet", "address", "--chain-namespace", "evm", "--json"],
    ["transfer", "--to", RECIPIENT, "--amount", "1", "--chain-id", "8453", "--token", BASE_USDC, "--json"],
  ]);

  assert.deepEqual(await adapter.observe({ recoveryToken: TOKEN, sender: SENDER, waitSeconds: 30 }), {
    disposition: "acknowledged",
    transactionHash: TX_HASH,
  });
  assert.deepEqual(runner.calls.at(-1), {
    argv: ["wallet", "requests", "watch", TOKEN, "--wallet-timeout", "30", "--json"],
    timeoutMs: 35_000,
  });
});

test("MetaMask direct adapter accepts the official notice-summary stream and notice-only watch timeout", async () => {
  const runner = new FixtureRunner();
  runner.transfer = streamed(
    [{ kind: "AWAITING_MFA", source: "transfer", pollingId: TOKEN }],
    { mode: "server", address: SENDER, status: "AWAITING_MFA", pollingId: TOKEN },
  );
  assert.deepEqual(await new MetaMaskDirectAdapter(runner).execute({
    sender: SENDER, recipient: RECIPIENT, amountDecimal: "0.001",
  }), { disposition: "pending", recoveryToken: TOKEN, providerState: "AWAITING_MFA" });

  runner.watch = streamed(
    [{ kind: "AWAITING_MFA", source: "wallet:requests:watch", pollingId: TOKEN }],
    undefined,
    1,
  );
  assert.deepEqual(await new MetaMaskDirectAdapter(runner).observe({
    recoveryToken: TOKEN, sender: SENDER, waitSeconds: 1,
  }), { disposition: "pending", recoveryToken: TOKEN, providerState: "AWAITING_MFA" });
});

test("MetaMask direct adapter rejects conflicting or unknown streaming records", async () => {
  const conflict = new FixtureRunner();
  conflict.transfer = streamed(
    [{ kind: "AWAITING_MFA", pollingId: TOKEN }],
    { mode: "server", address: SENDER, status: "AWAITING_MFA", pollingId: "other-request-01234567" },
  );
  assert.deepEqual(await new MetaMaskDirectAdapter(conflict).execute({
    sender: SENDER, recipient: RECIPIENT, amountDecimal: "0.001",
  }), { disposition: "ambiguous", reason: "provider_recovery_identity_mismatch" });

  const malformed = new FixtureRunner();
  malformed.transfer = { exitCode: 0, stdout: Buffer.from('{"_unknown":{}}') };
  assert.deepEqual(await new MetaMaskDirectAdapter(malformed).execute({
    sender: SENDER, recipient: RECIPIENT, amountDecimal: "0.001",
  }), { disposition: "ambiguous", reason: "provider_response_malformed" });
});

test("MetaMask direct adapter accepts both observed and documented EVM namespace forms", async () => {
  const observed = new FixtureRunner();
  observed.chainNamespace = "evm";
  assert.equal((await new MetaMaskDirectAdapter(observed).execute({
    sender: SENDER, recipient: RECIPIENT, amountDecimal: "0.0005",
  })).disposition, "pending");

  const documented = new FixtureRunner();
  documented.chainNamespace = "eip155";
  assert.equal((await new MetaMaskDirectAdapter(documented).execute({
    sender: SENDER, recipient: RECIPIENT, amountDecimal: "0.0005",
  })).disposition, "pending");
});

test("MetaMask direct adapter fails safely before transfer on server-mode or namespace drift", async () => {
  const runner = new FixtureRunner();
  runner.addressMode = "server-wallet";
  assert.deepEqual(await new MetaMaskDirectAdapter(runner).execute({
    sender: SENDER, recipient: RECIPIENT, amountDecimal: "0.0005",
  }), { disposition: "not_started", reason: "provider_child_not_created" });
  assert.equal(runner.calls.filter((call) => call.argv[0] === "transfer").length, 0);

  const namespaceDrift = new FixtureRunner();
  namespaceDrift.chainNamespace = "solana";
  assert.deepEqual(await new MetaMaskDirectAdapter(namespaceDrift).execute({
    sender: SENDER, recipient: RECIPIENT, amountDecimal: "0.0005",
  }), { disposition: "not_started", reason: "provider_child_not_created" });
  assert.equal(namespaceDrift.calls.filter((call) => call.argv[0] === "transfer").length, 0);
});

test("MetaMask direct adapter classifies denial, timeout and unsafe terminal uncertainty without replay", async () => {
  const denied = new FixtureRunner();
  denied.transfer = success({ mode: "server", address: SENDER, status: "DENIED" });
  assert.deepEqual(await new MetaMaskDirectAdapter(denied).execute({
    sender: SENDER, recipient: RECIPIENT, amountDecimal: "0.01",
  }), { disposition: "rejected", reason: "provider_denied" });

  const timedOut = new FixtureRunner();
  timedOut.watch = failure("JOB_TIMEOUT");
  assert.deepEqual(await new MetaMaskDirectAdapter(timedOut).observe({
    recoveryToken: TOKEN, sender: SENDER, waitSeconds: 1,
  }), { disposition: "pending", recoveryToken: TOKEN, providerState: "WATCH_TIMEOUT" });

  const unsafe = new FixtureRunner();
  unsafe.watch = success({
    request: { pollingId: TOKEN, kind: "transaction" },
    status: { kind: "transaction", status: "BROADCAST_FAILED" },
  });
  assert.deepEqual(await new MetaMaskDirectAdapter(unsafe).observe({ recoveryToken: TOKEN, sender: SENDER }), {
    disposition: "ambiguous",
    reason: "provider_terminal_state_without_transaction_identity",
  });
});

test("provider direct operation survives restart, watches one request and completes only on exact RPC evidence", async (t) => {
  const temporary = await temporaryState();
  t.after(temporary.cleanup);
  const initialRunner = new FixtureRunner();
  const initialRpc = new TestRpc();
  const approval = new Approval();
  const initial = core(temporary.root, initialRunner, initialRpc, approval);
  await connect(initial);
  const prepared = await initial.execute({
    command: "transfer.prepare",
    profile: PROFILE,
    idempotencyKey: IDEMPOTENCY,
    recipient: RECIPIENT,
    amount: "1",
  });
  assert.equal(prepared.ok, true, JSON.stringify(prepared));
  const operationId = requiredOperationId(prepared);
  const approved = await initial.execute({ command: "transfer.approve", operationId });
  assert.equal(approved.ok, true, JSON.stringify(approved));
  assert.equal((approved.operation as { state?: unknown }).state, "provider_pending");
  assert.equal(JSON.stringify(approved).includes(TOKEN), false, "public output must not expose provider recovery token");
  assert.equal((approved.operation as { provider_request_reference_hash?: unknown }).provider_request_reference_hash, TOKEN_HASH);
  assert.equal(initialRunner.calls.filter((call) => call.argv[0] === "transfer").length, 1);
  assert.equal(approval.calls.length, 1);

  // QA F26: the record keeps only the request id's hash; the id itself is sealed apart, and no state file names it.
  const durable = await new StateStore(temporary.root).findOperation(operationId);
  assert.deepEqual(durable?.providerEffect, { schemaVersion: "apn.provider-effect-reference.v2", kind: "transaction",
    recoveryTokenHash: TOKEN_HASH, providerState: "AWAITING_MFA" });
  for (const [path, text] of await stateFiles(temporary.root)) assert.equal(text.includes(TOKEN), false, `${path} keeps the request id in plaintext`);
  const restartedRunner = new FixtureRunner();
  const restartedRpc = new TestRpc();
  restartedRpc.receipt = exactReceipt();
  const restarted = core(temporary.root, restartedRunner, restartedRpc, new Approval());
  const resumed = await restarted.execute({ command: "operation.resume", operationId, waitSeconds: 30 });
  assert.equal(resumed.ok, true, JSON.stringify(resumed));
  assert.equal((resumed.operation as { state?: unknown }).state, "completed");
  assert.equal((resumed.operation as { transaction_hash?: unknown }).transaction_hash, TX_HASH);
  assert.equal(restartedRunner.calls.filter((call) => call.argv[0] === "transfer").length, 0);
  assert.equal(restartedRunner.calls.filter((call) => call.argv[2] === "watch").length, 1);
  assert.equal(restartedRunner.calls.find((call) => call.argv[2] === "watch")?.argv[3], TOKEN, "resume watches the sealed id itself");

  const receipt = await restarted.execute({ command: "receipt.get", operationId });
  assert.equal((receipt.receipt as { exact_transfer_log?: unknown }).exact_transfer_log, true);
  const replay = await restarted.execute({
    command: "transfer.prepare", profile: PROFILE, idempotencyKey: IDEMPOTENCY, recipient: RECIPIENT, amount: "1",
  });
  assert.equal(requiredOperationId(replay), operationId);
  assert.equal(restartedRunner.calls.filter((call) => call.argv[0] === "transfer").length, 0);
});

test("provider denial is terminal with a durable receipt; lost initial outcome stays ambiguous and is never replayed", async (t) => {
  const deniedState = await temporaryState();
  const lostState = await temporaryState();
  t.after(async () => { await deniedState.cleanup(); await lostState.cleanup(); });

  const deniedRunner = new FixtureRunner();
  deniedRunner.transfer = success({ mode: "server", address: SENDER, status: "DENIED" });
  const deniedCore = core(deniedState.root, deniedRunner, new TestRpc(), new Approval());
  await connect(deniedCore);
  const deniedId = await prepare(deniedCore, "metamask-denial-001");
  const denied = await deniedCore.execute({ command: "transfer.approve", operationId: deniedId });
  assert.equal((denied.operation as { state?: unknown }).state, "failed_provider_rejected");
  const deniedReceipt = await deniedCore.execute({ command: "receipt.get", operationId: deniedId });
  assert.equal((deniedReceipt.receipt as { proof_class?: unknown }).proof_class, "provider_terminal_no_transaction");

  const lostRunner = new FixtureRunner();
  lostRunner.throwTransfer = true;
  const lostCore = core(lostState.root, lostRunner, new TestRpc(), new Approval());
  await connect(lostCore);
  const lostId = await prepare(lostCore, "metamask-process-loss-001");
  const lost = await lostCore.execute({ command: "transfer.approve", operationId: lostId });
  assert.equal((lost.operation as { state?: unknown }).state, "ambiguous_effect");
  const restartedRunner = new FixtureRunner();
  const recoveryRpc = new TestRpc();
  recoveryRpc.receipt = exactReceipt();
  const restartedCore = core(lostState.root, restartedRunner, recoveryRpc, new Approval());
  const resumed = await restartedCore.execute({
    command: "operation.resume", operationId: lostId,
  });
  assert.equal((resumed.operation as { state?: unknown }).state, "ambiguous_effect");
  assert.equal(restartedRunner.calls.filter((call) => call.argv[0] === "transfer").length, 0);

  const reference = await restartedCore.execute({
    command: "operation.recover-provider-request", operationId: lostId, providerRequestId: TOKEN,
  });
  assert.equal(reference.ok, true, JSON.stringify(reference));
  assert.equal((reference.operation as { state?: unknown }).state, "provider_pending");
  assert.equal(JSON.stringify(reference).includes(TOKEN), false);
  // The owner's recovered request id is sealed too: the record keeps its hash only.
  assert.equal((await new StateStore(lostState.root).findOperation(lostId))?.providerEffect?.schemaVersion, "apn.provider-effect-reference.v2");
  for (const [path, text] of await stateFiles(lostState.root)) assert.equal(text.includes(TOKEN), false, `${path} keeps the request id in plaintext`);
  const duplicate = await restartedCore.execute({
    command: "operation.recover-provider-request", operationId: lostId, providerRequestId: TOKEN,
  });
  assert.equal((duplicate.operation as { state?: unknown }).state, "provider_pending");
  const conflict = await restartedCore.execute({
    command: "operation.recover-provider-request", operationId: lostId, providerRequestId: "other-request-01234567",
  });
  assert.equal(conflict.error?.code, "APN_IDEMPOTENCY_CONFLICT");

  const recovered = await restartedCore.execute({ command: "operation.resume", operationId: lostId, waitSeconds: 1 });
  assert.equal((recovered.operation as { state?: unknown }).state, "completed");
  assert.equal((recovered.operation as { transaction_hash?: unknown }).transaction_hash, TX_HASH);
  assert.equal(restartedRunner.calls.filter((call) => call.argv[0] === "transfer").length, 0);
});

/** The pending MetaMask request of a direct transfer, approved once; the record keeps only its request id's hash. */
async function pendingTransfer(root: string, wrapping: ReferenceTestSecret): Promise<string> {
  const initial = core(root, new FixtureRunner(), new TestRpc(), new Approval(), wrapping);
  await connect(initial);
  const operationId = await prepare(initial, IDEMPOTENCY);
  const approved = await initial.execute({ command: "transfer.approve", operationId });
  assert.equal((approved.operation as { state?: unknown }).state, "provider_pending", JSON.stringify(approved));
  return operationId;
}
const operationPath = (root: string, operationId: string) =>
  join(root, "operations", new StateStore(root).profileHash(PROFILE), `${operationId}.json`);
const sealedPath = (root: string, operationId: string) =>
  join(root, "provider-direct-request-references", new StateStore(root).profileHash(PROFILE), `${operationId}.json`);

test("a sealed request id that cannot be opened refuses resume precisely: nothing is watched and the record is unchanged", async (t) => {
  const refused = (code: string, reason?: string) => (error: unknown) =>
    (error as { code?: unknown } | undefined)?.code === code &&
    (reason === undefined || (error as { details?: { reason?: unknown } } | undefined)?.details?.reason === reason);
  const cases: ReadonlyArray<readonly [string, (root: string, operationId: string, wrapping: ReferenceTestSecret) => Promise<void>,
    (error: unknown) => boolean]> = [
    ["ciphertext changed", async (root, id) => { await rewrite(sealedPath(root, id), v => ({ ...v, cipher: { ...v.cipher, ciphertext: flipped(v.cipher.ciphertext) } })); },
      refused("APN_STATE_CORRUPT", "provider_request_reference_unmatched")],
    ["binding changed", async (root, id) => { await rewrite(sealedPath(root, id), v => ({ ...v, binding: { ...v.binding, operationId: "e".repeat(64) } })); },
      refused("APN_STATE_CORRUPT", "provider_request_reference_unmatched")],
    ["another wrapping secret", async (_root, _id, wrapping) => { wrapping.secret = Buffer.alloc(32, 9); },
      refused("APN_STATE_CORRUPT", "provider_request_reference_unmatched")],
    ["wrapping secret gone", async (_root, _id, wrapping) => { wrapping.secret = null; }, refused("APN_STATE_CORRUPT", "wrapping_secret_missing")],
    ["Keychain refused", async (_root, _id, wrapping) => { wrapping.failure = new ApnError("APN_NATIVE_REJECTED", "The APN login-Keychain wrapping secret is unavailable."); },
      refused("APN_NATIVE_REJECTED")],
  ];
  for (const [name, damage, expected] of cases) await t.test(name, async (sub) => {
    const temporary = await temporaryState(); sub.after(temporary.cleanup);
    const wrapping = new ReferenceTestSecret(), operationId = await pendingTransfer(temporary.root, wrapping);
    const sealed = await readFile(sealedPath(temporary.root, operationId));
    await damage(temporary.root, operationId, wrapping);
    const before = await readFile(operationPath(temporary.root, operationId));
    const runner = new FixtureRunner(), rpc = new TestRpc(); rpc.receipt = exactReceipt();
    const resumed = await core(temporary.root, runner, rpc, new Approval(), wrapping).execute({ command: "operation.resume", operationId, waitSeconds: 1 });
    assert.equal(resumed.ok, false, JSON.stringify(resumed));
    assert.ok(expected(resumed.error), JSON.stringify(resumed.error));
    assert.equal(runner.calls.filter((call) => call.argv[2] === "watch").length, 0, "no request is read without its own id");
    assert.deepEqual(await readFile(operationPath(temporary.root, operationId)), before, "the operation never advances");
    const status = await core(temporary.root, new FixtureRunner(), new TestRpc(), new Approval(), wrapping).execute({ command: "operation.status", operationId });
    assert.equal((status.operation as { state?: unknown }).state, "provider_pending", "status never opens the seal");
    // Once the seal and its secret are back, the same request is read and the transfer completes, never sent again.
    await writeFile(sealedPath(temporary.root, operationId), sealed, { mode: 0o600 });
    wrapping.secret = Buffer.alloc(32, 7); wrapping.failure = undefined;
    const healed = await core(temporary.root, runner, rpc, new Approval(), wrapping).execute({ command: "operation.resume", operationId, waitSeconds: 1 });
    assert.equal((healed.operation as { state?: unknown }).state, "completed", JSON.stringify(healed));
    assert.equal(runner.calls.filter((call) => call.argv[0] === "transfer").length, 0);
  });
});

test("a Keychain that refuses is met before the owner is asked: the transfer stays awaiting approval and nothing is sent", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const wrapping = new ReferenceTestSecret(), runner = new FixtureRunner(), approval = new Approval();
  const first = core(temporary.root, runner, new TestRpc(), approval, wrapping);
  await connect(first);
  const operationId = await prepare(first, IDEMPOTENCY);
  wrapping.failure = new ApnError("APN_NATIVE_REJECTED", "The APN login-Keychain wrapping secret is unavailable.");
  const refusedApprove = await first.execute({ command: "transfer.approve", operationId });
  assert.equal(refusedApprove.error?.code, "APN_NATIVE_REJECTED", JSON.stringify(refusedApprove));
  assert.equal(approval.calls.length, 0, "the owner is never asked to approve before the wrapping secret is read");
  assert.equal(runner.calls.filter((call) => call.argv[0] === "transfer").length, 0, "nothing is handed to MetaMask");
  const untouched = await new StateStore(temporary.root).findOperation(operationId);
  assert.equal(untouched?.state, "awaiting_approval"); assert.equal(untouched?.transitions.length, 1, "a refusal changes no state");
  wrapping.failure = undefined;
  const approved = await core(temporary.root, runner, new TestRpc(), approval, wrapping).execute({ command: "transfer.approve", operationId });
  assert.equal((approved.operation as { state?: unknown }).state, "provider_pending", JSON.stringify(approved));
  assert.equal(runner.calls.filter((call) => call.argv[0] === "transfer").length, 1, "one hand-off in all");
  assert.equal(approval.calls.length, 1);
  const again = await core(temporary.root, runner, new TestRpc(), approval, wrapping).execute({ command: "transfer.approve", operationId });
  assert.equal((again.operation as { state?: unknown }).state, "provider_pending");
  assert.equal(runner.calls.filter((call) => call.argv[0] === "transfer").length, 1, "restart once-only: an approved transfer is never sent again");
  assert.equal(approval.calls.length, 1);
});

test("a provider-atomic send whose provider cannot observe a request seals nothing and keeps no id, without reading the Keychain", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const wrapping = new ReferenceTestSecret(), runner = new FixtureRunner();
  const blind = core(temporary.root, runner, new TestRpc(), new Approval(), wrapping, false);
  await connect(blind);
  const operationId = await prepare(blind, IDEMPOTENCY);
  const approved = await blind.execute({ command: "transfer.approve", operationId });
  assert.equal((approved.operation as { state?: unknown }).state, "ambiguous_effect", JSON.stringify(approved));
  const saved = await new StateStore(temporary.root).findOperation(operationId);
  assert.equal(saved?.reason, "provider_recovery_unavailable"); assert.equal(saved?.providerEffect, undefined);
  assert.equal(wrapping.loads, 0, "readiness and seal follow one condition: nothing is sealed, so nothing is read");
  assert.equal(runner.calls.filter((call) => call.argv[0] === "transfer").length, 1);
  for (const [path, text] of await stateFiles(temporary.root)) assert.equal(text.includes(TOKEN), false, `${path} keeps the request id in plaintext`);
});

test("a reference 0.5.106 wrote keeps its plaintext id: it projects the same hash, resumes with that id and needs no wrapping secret", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const lostRunner = new FixtureRunner(); lostRunner.throwTransfer = true;
  const lostCore = core(temporary.root, lostRunner, new TestRpc(), new Approval());
  await connect(lostCore);
  const operationId = await prepare(lostCore, "metamask-legacy-reference-001");
  assert.equal(((await lostCore.execute({ command: "transfer.approve", operationId })).operation as { state?: unknown }).state, "ambiguous_effect");
  // As `operation recover-provider-request` of 0.5.106 wrote it: the request id itself in the record.
  const state = new StateStore(temporary.root), lost = (await state.findOperation(operationId))!;
  const transition = { at: lost.transitions.at(-1)!.at, state: "provider_pending" as const, terminal: false,
    reason: "provider_request_reference_recovered", proofClass: "provider_request_reference" };
  const { integrityHash: _lost, ...base } = lost;
  const legacy = sealOperation({ ...base, providerEffect: { schemaVersion: "apn.provider-effect-reference.v1", kind: "transaction",
    recoveryToken: TOKEN, providerState: "RECOVERED" }, state: transition.state, terminal: transition.terminal, reason: transition.reason,
    proofClass: transition.proofClass, transitions: appendTransition(lost.transitions, transition) });
  await state.writeOperation(legacy);
  await state.writeReceipt(legacy.profileHash, providerDirectReceipt(legacy));
  const bytes = await readFile(operationPath(temporary.root, operationId));
  const untouched = new ReferenceTestSecret(); untouched.failure = new Error("TEST the Keychain must not be read");
  const status = await core(temporary.root, new FixtureRunner(), new TestRpc(), new Approval(), untouched).execute({ command: "operation.status", operationId });
  assert.equal((status.operation as { provider_request_reference_hash?: unknown }).provider_request_reference_hash, TOKEN_HASH,
    "an earlier release's reference projects the same hash a sealed one keeps");
  assert.deepEqual(await readFile(operationPath(temporary.root, operationId)), bytes, "a read never rewrites an earlier release's record");
  const runner = new FixtureRunner(), rpc = new TestRpc(); rpc.receipt = exactReceipt();
  const resumed = await core(temporary.root, runner, rpc, new Approval(), untouched).execute({ command: "operation.resume", operationId, waitSeconds: 1 });
  assert.equal((resumed.operation as { state?: unknown }).state, "completed", JSON.stringify(resumed));
  assert.equal(runner.calls.find((call) => call.argv[2] === "watch")?.argv[3], TOKEN);
  assert.equal(untouched.loads, 0, "an earlier release's reference needs no wrapping secret");
  assert.deepEqual((await state.findOperation(operationId))?.providerEffect, legacy.providerEffect, "it is never migrated");
});

/** `observable` false: the same provider without `observe`, which can never be asked about a request it returned. */
function core(root: string, runner: FixtureRunner, rpc: TestRpc, approval: Approval,
  wrapping: ReferenceTestSecret = new ReferenceTestSecret(), observable = true): ApnCore {
  const state = new StateStore(root, { lockWaitMs: 1_000 });
  return new ApnCore({
    state,
    providerRequestReferences: new EncryptedProviderRequestReferenceStore(state, wrapping),
    profileRepository: new StateProfileRepository(state),
    providerRegistry: new ProviderRegistry([{
      provider_id: METAMASK_AGENT_WALLET_PROVIDER_ID,
      create: () => {
        const bundle = new MetaMaskProcessAdapter(runner, async (work) => await work(), () => new Date("2026-09-02T00:00:00.000Z")).bundle();
        const direct = bundle.direct!;
        return observable ? bundle : { ...bundle, direct: { mode: direct.mode, execute: async (input) => await direct.execute!(input) } };
      },
    }]),
    foregroundAuthentication: foreground,
    transferApproval: approval,
    rpc,
    rpcUrl: "https://rpc.example/",
    clock: new TestClock(),
  });
}

async function connect(coreInstance: ApnCore): Promise<void> {
  const result = await coreInstance.execute({
    command: "wallet.connect", profile: PROFILE, providerId: METAMASK_AGENT_WALLET_PROVIDER_ID,
  });
  assert.equal(result.ok, true, JSON.stringify(result));
}

async function prepare(coreInstance: ApnCore, idempotencyKey: string): Promise<string> {
  const result = await coreInstance.execute({
    command: "transfer.prepare", profile: PROFILE, idempotencyKey, recipient: RECIPIENT, amount: "1",
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  return requiredOperationId(result);
}

function requiredOperationId(value: { readonly operation?: unknown }): string {
  const operation = value.operation as { readonly operation_id?: unknown } | null;
  if (typeof operation?.operation_id !== "string") throw new Error("operation id is missing");
  return operation.operation_id;
}

function exactReceipt() {
  return {
    transactionHash: TX_HASH,
    status: "success" as const,
    blockNumberAtomic: "12350",
    observedAt: "2026-09-02T00:01:00.000Z",
    rpcOrigin: "https://rpc.example",
    logs: [{
      address: BASE_USDC,
      topics: [
        TRANSFER_TOPIC,
        `0x${SENDER.slice(2).padStart(64, "0")}` as Hex,
        `0x${RECIPIENT.slice(2).padStart(64, "0")}` as Hex,
      ],
      data: `0x${(1_000_000n).toString(16).padStart(64, "0")}` as Hex,
    }],
  };
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

function clone(value: MetaMaskProcessResult): MetaMaskProcessResult {
  return { exitCode: value.exitCode, stdout: Buffer.from(value.stdout) };
}
