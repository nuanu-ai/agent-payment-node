import assert from "node:assert/strict";
import test from "node:test";
import { ApnCore } from "../../src/core.js";
import { BASE_USDC, TRANSFER_TOPIC } from "../../src/constants.js";
import { MetaMaskDirectAdapter } from "../../src/metamask-direct-adapter.js";
import {
  METAMASK_AGENT_WALLET_PROVIDER_ID,
  MetaMaskProcessAdapter,
} from "../../src/metamask-process-adapter.js";
import type { MetaMaskProcessResult, MetaMaskProcessRunnerPort } from "../../src/metamask-process-runner.js";
import type { Address, Hex } from "../../src/model.js";
import type { ForegroundAuthenticationPort } from "../../src/provider-ports.js";
import { ProviderRegistry } from "../../src/provider-registry.js";
import { StateProfileRepository } from "../../src/profile-repository.js";
import { StateStore } from "../../src/state.js";
import type { TransferApprovalIntent, TransferApprovalPort } from "../../src/tty-approval.js";
import { TestClock, TestRpc, temporaryState } from "./helpers.js";

const SENDER = "0x1111111111111111111111111111111111111111" as Address;
const RECIPIENT = "0x2222222222222222222222222222222222222222" as Address;
const TX_HASH = `0x${"e".repeat(64)}` as Hex;
const TOKEN = "request-01234567";
const PROFILE = "metamask-direct";
const IDEMPOTENCY = "metamask-direct-001";

class FixtureRunner implements MetaMaskProcessRunnerPort {
  readonly calls: Array<{ readonly argv: readonly string[]; readonly timeoutMs?: number }> = [];
  addressMode = "server";
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
      mode: this.addressMode, chainNamespace: "eip155", address: SENDER,
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

test("MetaMask direct adapter accepts the exact 6.1.5 server mode and fails safely before transfer on drift", async () => {
  const runner = new FixtureRunner();
  runner.addressMode = "server-wallet";
  assert.deepEqual(await new MetaMaskDirectAdapter(runner).execute({
    sender: SENDER, recipient: RECIPIENT, amountDecimal: "0.0005",
  }), { disposition: "not_started", reason: "provider_child_not_created" });
  assert.equal(runner.calls.filter((call) => call.argv[0] === "transfer").length, 0);
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
  assert.equal(initialRunner.calls.filter((call) => call.argv[0] === "transfer").length, 1);
  assert.equal(approval.calls.length, 1);

  const durable = await new StateStore(temporary.root).findOperation(operationId);
  assert.equal(durable?.providerEffect?.recoveryToken, TOKEN);
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
  const resumed = await core(lostState.root, restartedRunner, new TestRpc(), new Approval()).execute({
    command: "operation.resume", operationId: lostId,
  });
  assert.equal((resumed.operation as { state?: unknown }).state, "ambiguous_effect");
  assert.equal(restartedRunner.calls.filter((call) => call.argv[0] === "transfer").length, 0);
});

function core(root: string, runner: FixtureRunner, rpc: TestRpc, approval: Approval): ApnCore {
  const state = new StateStore(root, { lockWaitMs: 1_000 });
  return new ApnCore({
    state,
    profileRepository: new StateProfileRepository(state),
    providerRegistry: new ProviderRegistry([{
      provider_id: METAMASK_AGENT_WALLET_PROVIDER_ID,
      create: () => new MetaMaskProcessAdapter(runner, async (work) => await work(), () => new Date("2026-09-02T00:00:00.000Z")).bundle(),
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

function clone(value: MetaMaskProcessResult): MetaMaskProcessResult {
  return { exitCode: value.exitCode, stdout: Buffer.from(value.stdout) };
}
