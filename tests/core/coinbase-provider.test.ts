import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import {
  AWAL_BIN,
  AWAL_INTEGRITY,
  AWAL_PROCESS_TIMEOUT_MS,
  AWAL_PROVIDER_ID,
  AWAL_SHASUM,
  AWAL_VERSION,
  AwalProcessAdapter,
  NodeAwalProcessRunner,
  resolveAwalBin,
  type AwalLaunchPort,
  type AwalProcessResult,
  type AwalProcessRunnerPort,
} from "../../src/awal-process-adapter.js";
import { AwalDirectAdapter, type AwalSendLaunchPort } from "../../src/awal-direct-adapter.js";
import { runCli } from "../../src/cli.js";
import type { OutputEnvelope } from "../../src/commands.js";
import {
  TtyForegroundAuthentication,
  readSecretLine,
  type AuthTerminal,
} from "../../src/foreground-auth.js";
import { createMcpServer } from "../../src/mcp-server.js";
import { ApnCore } from "../../src/core.js";
import type {
  DirectExecutionPort,
  ForegroundAuthenticationPort,
  ProviderRegistryPort,
} from "../../src/provider-ports.js";
import type { HttpPort, RpcReceipt } from "../../src/ports.js";
import { ProviderRegistry } from "../../src/provider-registry.js";
import { capabilityHash, lifecycleReadOnlyCapabilitySnapshot } from "../../src/provider-profile.js";
import { canonicalJson, sha256 } from "../../src/canonical.js";
import { BASE_USDC, TRANSFER_TOPIC } from "../../src/constants.js";
import type { Hex, OperationRecord, ReceiptRecord } from "../../src/model.js";
import { StateProfileRepository } from "../../src/profile-repository.js";
import { StateStore } from "../../src/state.js";
import type { TransferApprovalIntent, TransferApprovalPort } from "../../src/tty-approval.js";
import { TestNative, TestRpc, WALLET, makeCore, temporaryState } from "./helpers.js";

const ADDRESS_A = "0x1111111111111111111111111111111111111111" as const;
const ADDRESS_B = "0x2222222222222222222222222222222222222222" as const;
const OBSERVED_AT = "2026-08-30T00:00:00.000Z";
const PROVIDER_TRANSACTION_HASH = `0x${"e".repeat(64)}` as Hex;

class FixtureRunner implements AwalProcessRunnerPort {
  readonly calls: Array<{ readonly argv: readonly string[]; readonly sensitive: boolean }> = [];
  address: `0x${string}` = ADDRESS_A;
  authExitCode = 0;
  loginDisposition: AwalProcessResult["loginDisposition"];
  balanceStdout: Buffer | null = null;
  addressExitCode = 0;
  addressOptionalFailure: AwalProcessResult["optionalFailure"];
  async run(argv: readonly string[], sensitive: boolean): Promise<AwalProcessResult> {
    this.calls.push({ argv: [...argv], sensitive });
    if (argv[0] === "balance") {
      if (this.balanceStdout !== null) return { exitCode: 0, stdout: Buffer.from(this.balanceStdout) };
      return {
        exitCode: 0,
        stdout: Buffer.from(JSON.stringify({
          address: this.address,
          chain: "Base",
          balances: { USDC: { raw: "1230000", formatted: "1.23 USDC", decimals: 6 } },
          timestamp: OBSERVED_AT,
        })),
      };
    }
    if (argv[0] === "address") return {
      exitCode: this.addressExitCode,
      stdout: Buffer.from(this.address),
      ...(this.addressOptionalFailure === undefined ? {} : { optionalFailure: this.addressOptionalFailure }),
    };
    return {
      exitCode: argv[0] === "auth" ? this.authExitCode : 0,
      stdout: Buffer.alloc(0),
      ...(argv[0] === "auth" && argv[1] === "login" && this.loginDisposition !== undefined
        ? { loginDisposition: this.loginDisposition }
        : {}),
    };
  }
}

class FixtureForeground implements ForegroundAuthenticationPort {
  readonly identityCanary = "protected" + String.fromCharCode(64) + "example.invalid";
  readonly challengeCanary = [7, 3, 9, 1, 4, 8].join("");
  confirmations = 0;
  identityReads = 0;
  challengeReads = 0;
  confirm = true;
  async readIdentity(): Promise<string> { this.identityReads += 1; return this.identityCanary; }
  async readChallengeResponse(): Promise<string> { this.challengeReads += 1; return this.challengeCanary; }
  async confirmRebind(): Promise<boolean> { this.confirmations += 1; return this.confirm; }
}

class BlockingRpc extends TestRpc {
  readonly started: Promise<void>;
  private readonly released: Promise<void>;
  private markStarted!: () => void;
  private releaseRead!: () => void;

  constructor() {
    super();
    this.started = new Promise<void>((resolveStarted) => { this.markStarted = resolveStarted; });
    this.released = new Promise<void>((resolveReleased) => { this.releaseRead = resolveReleased; });
  }

  release(): void { this.releaseRead(); }

  override async getBalances(address: `0x${string}`) {
    this.balanceCalls += 1;
    this.markStarted();
    await this.released;
    return { ...this.balances, address };
  }
}

class FixtureDirect implements DirectExecutionPort {
  readonly mode = "provider_atomic_send" as const;
  readonly calls: Array<{
    readonly amountDecimal: string;
    readonly recipient: `0x${string}`;
    readonly sender: `0x${string}`;
  }> = [];
  result: Awaited<ReturnType<NonNullable<DirectExecutionPort["execute"]>>> = {
    disposition: "acknowledged",
    transactionHash: PROVIDER_TRANSACTION_HASH,
  };
  onExecute: (() => Promise<void>) | undefined;
  async execute(input: {
    readonly amountDecimal: string;
    readonly recipient: `0x${string}`;
    readonly sender: `0x${string}`;
  }) {
    this.calls.push(input);
    await this.onExecute?.();
    return this.result;
  }
}

class FixtureApproval implements TransferApprovalPort {
  readonly calls: TransferApprovalIntent[] = [];
  async approve(intent: TransferApprovalIntent): Promise<void> { this.calls.push(intent); }
}

class CountingReceiptRpc extends TestRpc {
  receiptCalls = 0;
  unavailable = false;

  override async getReceipt(transactionHash: Hex): Promise<RpcReceipt | null> {
    this.receiptCalls += 1;
    if (this.unavailable) throw new Error("RPC_PROTECTED_CANARY");
    return await super.getReceipt(transactionHash);
  }
}

class FailingDirectState extends StateStore {
  failOperationState: OperationRecord["state"] | undefined;
  failReceiptState: ReceiptRecord["state"] | undefined;

  override async writeOperation(operation: OperationRecord): Promise<void> {
    if (operation.state === this.failOperationState) {
      this.failOperationState = undefined;
      throw new Error("injected operation store failure");
    }
    await super.writeOperation(operation);
  }

  override async writeReceipt(profileHash: string, receipt: ReceiptRecord): Promise<void> {
    if (receipt.state === this.failReceiptState) {
      this.failReceiptState = undefined;
      throw new Error("injected receipt store failure");
    }
    await super.writeReceipt(profileHash, receipt);
  }
}

function registry(runner: FixtureRunner, direct: DirectExecutionPort = new FixtureDirect()): ProviderRegistry {
  return new ProviderRegistry([{
    provider_id: AWAL_PROVIDER_ID,
    create: () => new AwalProcessAdapter(runner, direct).bundle(),
  }]);
}

test("exact awal identity, declared bin and Node-plus-script closed argv are immutable", async () => {
  const manifest = JSON.parse(await readFile(resolve("package.json"), "utf8")) as {
    dependencies?: Record<string, string>;
  };
  const lock = JSON.parse(await readFile(resolve("npm-shrinkwrap.json"), "utf8")) as {
    packages?: Record<string, { version?: string; integrity?: string; bin?: Record<string, string>; engines?: { node?: string } }>;
  };
  assert.equal(manifest.dependencies?.awal, AWAL_VERSION);
  assert.deepEqual(await readFile(resolve("package-lock.json")), await readFile(resolve("npm-shrinkwrap.json")));
  assert.equal(lock.packages?.["node_modules/awal"]?.version, AWAL_VERSION);
  assert.equal(lock.packages?.["node_modules/awal"]?.integrity, AWAL_INTEGRITY);
  assert.equal(lock.packages?.["node_modules/awal"]?.bin?.awal, AWAL_BIN);
  assert.equal(lock.packages?.["node_modules/awal"]?.engines?.node, ">=18");
  assert.equal(AWAL_SHASUM, "9c4c077983d608e278ed84053199427026ebbaa8");
  assert.match(await resolveAwalBin(), /node_modules\/awal\/dist\/index\.js$/u);

  const launches: Array<{ executable: string; args: readonly string[]; options: unknown }> = [];
  const launch: AwalLaunchPort = (executable, args, options) => {
    launches.push({ executable, args: [...args], options });
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
      kill(): boolean;
    };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => true;
    queueMicrotask(() => child.emit("close", 0));
    return child;
  };
  const runner = new NodeAwalProcessRunner(async () => "/exact/node_modules/awal/dist/index.js", launch);
  await runner.run(["status", "--json"], true);
  assert.deepEqual(launches, [{
    executable: process.execPath,
    args: ["/exact/node_modules/awal/dist/index.js", "status", "--json"],
    options: { shell: false, stdio: ["ignore", "pipe", "pipe"] },
  }]);

  const fixture = new FixtureRunner();
  const adapter = new AwalProcessAdapter(fixture);
  await adapter.probeStatus();
  await adapter.crossCheckAddress(ADDRESS_A);
  await adapter.logout();
  assert.deepEqual(fixture.calls, [
    { argv: ["status", "--json"], sensitive: true },
    { argv: ["address", "--chain", "base"], sensitive: false },
    { argv: ["auth", "logout", "--json"], sensitive: true },
  ]);
});

test("AWAL runner bounds hung processes, kills and cleans listeners with one stable safe error", async () => {
  assert.equal(AWAL_PROCESS_TIMEOUT_MS, 30_000);
  let kills = 0;
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill(): boolean;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => { kills += 1; return true; };
  const runner = new NodeAwalProcessRunner(
    async () => "/exact/node_modules/awal/dist/index.js",
    () => child,
    5,
  );
  await assert.rejects(runner.run(["status", "--json"], true), (error: unknown) => {
    const safe = error as { readonly code?: unknown; readonly message?: unknown };
    assert.equal(safe.code, "APN_PROVIDER_UNAVAILABLE");
    assert.equal(safe.message, "The wallet provider process timed out safely.");
    return true;
  });
  assert.equal(kills, 1);
  assert.equal(child.listenerCount("error"), 0);
  assert.equal(child.listenerCount("close"), 0);
  assert.equal(child.stdout.listenerCount("data"), 0);
  assert.equal(child.stderr.listenerCount("data"), 0);
});

test("AWAL runner classifies only a successful exact login reuse signal without retaining protected output", async () => {
  const execute = async (
    argv: readonly string[],
    exitCode: number,
    stdoutValues: readonly string[],
    stderrValues: readonly string[] = [],
  ): Promise<{ readonly result: AwalProcessResult; readonly emitted: readonly Buffer[] }> => {
    const stdout = stdoutValues.map((value) => Buffer.from(value));
    const stderr = stderrValues.map((value) => Buffer.from(value));
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
      kill(): boolean;
    };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => true;
    const runner = new NodeAwalProcessRunner(
      async () => "/exact/node_modules/awal/dist/index.js",
      () => {
        queueMicrotask(() => {
          for (const value of stdout) child.stdout.emit("data", value);
          for (const value of stderr) child.stderr.emit("data", value);
          child.emit("close", exitCode);
        });
        return child;
      },
      1_000,
    );
    return { result: await runner.run(argv, true), emitted: [...stdout, ...stderr] };
  };

  const identityCanary = "protected" + String.fromCharCode(64) + "example.invalid";
  const stdoutReuse = await execute(
    ["auth", "login", identityCanary, "--json"],
    0,
    ["You are AlReAdY si", "gned In. No reauthentication is needed."],
  );
  assert.equal(stdoutReuse.result.loginDisposition, "already_authenticated");
  assert.equal(stdoutReuse.result.stdout.length, 0);
  assert.equal(JSON.stringify(stdoutReuse.result).includes(identityCanary), false);
  for (const emitted of stdoutReuse.emitted) assert.equal(emitted.every((byte) => byte === 0), true);

  const stderrReuse = await execute(
    ["auth", "login", identityCanary, "--json"],
    0,
    [],
    ["- Sending verification code...\n", "Already signed in\n"],
  );
  assert.equal(stderrReuse.result.loginDisposition, "already_authenticated");
  for (const emitted of stderrReuse.emitted) assert.equal(emitted.every((byte) => byte === 0), true);

  for (const [argv, exitCode] of [
    [["auth", "verify", "739148", "--json"], 0],
    [["status", "--json"], 0],
    [["auth", "login", identityCanary, "--json"], 1],
  ] as const) {
    const ignored = await execute(argv, exitCode, ["Already signed in"]);
    assert.equal(ignored.result.loginDisposition, undefined);
    assert.equal(ignored.result.stdout.length, 0);
  }

  const flowCanary = "flow-" + "canary-should-not-survive";
  const fresh = await execute(
    ["auth", "login", identityCanary, "--json"],
    0,
    [JSON.stringify({ flowId: flowCanary, message: "Verification code sent" })],
  );
  assert.equal(fresh.result.loginDisposition, undefined);
  assert.equal(fresh.result.stdout.length, 0);
  assert.equal(JSON.stringify(fresh.result).includes(flowCanary), false);
});

test("optional address failures are narrow while malformed and mismatched successful output fails closed", async () => {
  for (const optionalFailure of ["unsupported", "unavailable"] as const) {
    const runner: AwalProcessRunnerPort = {
      run: async () => ({ exitCode: 1, stdout: Buffer.alloc(0), optionalFailure }),
    };
    await new AwalProcessAdapter(runner).crossCheckAddress(ADDRESS_A);
  }
  const arbitraryFailure: AwalProcessRunnerPort = {
    run: async () => ({ exitCode: 1, stdout: Buffer.alloc(0) }),
  };
  await assert.rejects(
    new AwalProcessAdapter(arbitraryFailure).crossCheckAddress(ADDRESS_A),
    (error: unknown) => (error as { readonly code?: unknown }).code === "APN_PROVIDER_SESSION_REQUIRED",
  );
  for (const stdout of [Buffer.from("not-an-address"), Buffer.from(ADDRESS_B)]) {
    const runner: AwalProcessRunnerPort = { run: async () => ({ exitCode: 0, stdout: Buffer.from(stdout) }) };
    await assert.rejects(
      new AwalProcessAdapter(runner).crossCheckAddress(ADDRESS_A),
      (error: unknown) => (error as { readonly code?: unknown }).code === "APN_PROVIDER_PROTOCOL",
    );
  }

  const launched = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill(): boolean;
  };
  launched.stdout = new EventEmitter();
  launched.stderr = new EventEmitter();
  launched.kill = () => true;
  const productionRunner = new NodeAwalProcessRunner(
    async () => "/exact/node_modules/awal/dist/index.js",
    () => {
      queueMicrotask(() => {
        launched.stderr.emit("data", Buffer.from("error: unknown command 'address'\n"));
        launched.emit("close", 1);
      });
      return launched;
    },
    1_000,
  );
  const classified = await productionRunner.run(["address", "--chain", "base"], false);
  assert.equal(classified.optionalFailure, "unsupported");
  classified.stdout.fill(0);
});

test("OTP uses the raw secret path and terminal mode is restored on success, error and SIGINT", async () => {
  let plainReads = 0;
  let secretReads = 0;
  let closes = 0;
  const writes: string[] = [];
  const terminal: AuthTerminal = {
    fd: 42,
    write: async (contents) => { writes.push(contents); },
    readLine: async () => { plainReads += 1; return Buffer.from("must-not-run"); },
    readSecretLine: async () => { secretReads += 1; return Buffer.from("739148"); },
    close: async () => { closes += 1; },
  };
  const authentication = new TtyForegroundAuthentication({
    openTerminal: async () => terminal,
    isTerminal: () => true,
  });
  assert.equal(await authentication.readChallengeResponse(), "739148");
  assert.equal(plainReads, 0);
  assert.equal(secretReads, 1);
  assert.equal(closes, 1);
  assert.deepEqual(writes, ["Provider one-time verification code: ", "\n"]);

  const exercise = async (outcome: "success" | "error" | "SIGINT"): Promise<void> => {
    const input = new EventEmitter() as EventEmitter & {
      isRaw: boolean;
      modes: boolean[];
      setRawMode(mode: boolean): void;
      resume(): void;
      pause(): void;
    };
    input.isRaw = false;
    input.modes = [];
    input.setRawMode = (mode) => { input.modes.push(mode); input.isRaw = mode; };
    input.resume = () => {};
    input.pause = () => {};
    const signals = new EventEmitter();
    const pending = readSecretLine(
      input as unknown as NodeJS.ReadStream,
      signals as unknown as Pick<NodeJS.Process, "once" | "off">,
    );
    const secret = Buffer.from("739148\n");
    queueMicrotask(() => {
      if (outcome === "success") input.emit("data", secret);
      else if (outcome === "error") input.emit("error", new Error("terminal failed"));
      else signals.emit("SIGINT");
    });
    if (outcome === "success") {
      const value = await pending;
      assert.equal(value.toString("utf8"), "739148");
      value.fill(0);
    } else {
      await assert.rejects(pending, /foreground terminal/u);
    }
    assert.deepEqual(input.modes, [true, false]);
  };
  await exercise("success");
  await exercise("error");
  await exercise("SIGINT");
});

test("generic foreground connect creates, reuses and restarts one safe provider profile", async (t) => {
  const temporary = await temporaryState();
  t.after(temporary.cleanup);
  const runner = new FixtureRunner();
  const foreground = new FixtureForeground();
  const first = await runCli([
    "wallet", "connect", "--profile", "provider-one", "--provider", AWAL_PROVIDER_ID,
  ], {}, {
    stateRoot: temporary.root,
    providerRegistry: registry(runner),
    foregroundAuthentication: foreground,
  });
  assert.equal(first.ok, true, JSON.stringify(first));
  const created = first.data as Record<string, unknown>;
  assert.equal(created.provider, AWAL_PROVIDER_ID);
  assert.equal(created.address, ADDRESS_A);
  assert.equal(created.revision, 1);
  assert.equal(created.status, "bound");
  assert.equal(created.reused, false);
  assert.equal(created.trust_class, "provider_managed_non_custodial_tee");
  assert.equal(first.proof_class, "provider_profile_binding");
  const profileHash = sha256("profile\0provider-one");
  const profilePath = join(temporary.root, "profiles", profileHash, "profile.json");
  const persisted = JSON.parse(await readFile(profilePath, "utf8")) as Record<string, unknown>;
  assert.equal(persisted.provider_id, AWAL_PROVIDER_ID);
  assert.equal(persisted.public_address, ADDRESS_A);
  assert.equal(persisted.revision, 1);
  const protectedValues = [foreground.identityCanary, foreground.challengeCanary];
  for (const value of protectedValues) {
    assert.equal(JSON.stringify(first).includes(value), false);
    assert.equal(JSON.stringify(persisted).includes(value), false);
  }

  const restartedRunner = new FixtureRunner();
  restartedRunner.loginDisposition = "already_authenticated";
  const restartedForeground = new FixtureForeground();
  const reused = await runCli([
    "wallet", "connect", "--profile", "provider-one", "--provider", AWAL_PROVIDER_ID,
  ], {}, {
    stateRoot: temporary.root,
    providerRegistry: registry(restartedRunner),
    foregroundAuthentication: restartedForeground,
  });
  assert.equal(reused.ok, true, JSON.stringify(reused));
  assert.equal((reused.data as Record<string, unknown>).reused, true);
  assert.equal((reused.data as Record<string, unknown>).revision, 1);
  assert.equal(restartedForeground.identityReads, 1);
  assert.equal(restartedForeground.challengeReads, 0);
  const statusRunner = new FixtureRunner();
  const status = await runCli(["wallet", "status", "--profile", "provider-one"], {}, {
    stateRoot: temporary.root,
    providerRegistry: registry(statusRunner),
  });
  assert.equal(status.ok, true, JSON.stringify(status));
  assert.equal(status.proof_class, "provider_profile_binding");
  assert.equal((status.data as Record<string, unknown>).address, ADDRESS_A);
  assert.equal((status.data as Record<string, unknown>).proof_class, "provider_profile_binding");
  assert.equal((status.data as Record<string, unknown>).capability_hash, created.capability_hash);
  assert.deepEqual(statusRunner.calls, [
    { argv: ["status", "--json"], sensitive: true },
    { argv: ["balance", "--chain", "base", "--asset", "usdc", "--json"], sensitive: false },
    { argv: ["address", "--chain", "base"], sensitive: false },
  ]);
  assert.deepEqual(restartedRunner.calls.map((call) => call.argv.slice(0, 2)), [
    ["auth", "login"], ["balance", "--chain"],
  ]);
  assert.equal(restartedRunner.calls[0]?.sensitive, true);
  assert.equal(restartedRunner.calls[1]?.sensitive, false);

  const mcpRunner = new FixtureRunner();
  const server = createMcpServer({ stateRoot: temporary.root, providerRegistry: registry(mcpRunner) });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "provider-status-test", version: "1.0.0" });
  await client.connect(clientTransport);
  t.after(async () => { await client.close(); await server.close(); });
  const mcpStatus = (await client.callTool({
    name: "apn_wallet_status",
    arguments: { profile: "provider-one" },
  })).structuredContent as unknown as OutputEnvelope;
  assert.equal(mcpStatus.ok, true, JSON.stringify(mcpStatus));
  assert.equal(mcpStatus.proof_class, "provider_profile_binding");
  assert.equal((mcpStatus.data as Record<string, unknown>).proof_class, "provider_profile_binding");
});

test("already authenticated AWAL connect reuses the session without identity or OTP prompts", async () => {
  const runner = new FixtureRunner();
  runner.loginDisposition = "already_authenticated";
  const foreground = new FixtureForeground();
  await new AwalProcessAdapter(runner).connect(foreground);
  assert.equal(foreground.identityReads, 1);
  assert.equal(foreground.challengeReads, 0);
  assert.deepEqual(runner.calls, [
    { argv: ["auth", "login", foreground.identityCanary, "--json"], sensitive: true },
  ]);

  const nonLoginDisposition: AwalProcessRunnerPort = {
    run: async () => ({ exitCode: 0, stdout: Buffer.alloc(0), loginDisposition: "already_authenticated" }),
  };
  await assert.rejects(
    new AwalProcessAdapter(nonLoginDisposition).probeStatus(),
    (error: unknown) => (error as { readonly code?: unknown }).code === "APN_PROVIDER_PROTOCOL",
  );

  const failedReuseLookalike: AwalProcessRunnerPort = {
    run: async () => ({ exitCode: 1, stdout: Buffer.alloc(0), loginDisposition: "already_authenticated" }),
  };
  await assert.rejects(
    new AwalProcessAdapter(failedReuseLookalike).connect(foreground),
    (error: unknown) => (error as { readonly code?: unknown }).code === "APN_PROVIDER_UNAVAILABLE",
  );
});

test("provider-specific authentication methods are rejected before Coinbase access", async (t) => {
  const temporary = await temporaryState();
  t.after(temporary.cleanup);
  const runner = new FixtureRunner();
  const foreground = new FixtureForeground();
  const result = await runCli([
    "wallet", "connect", "--profile", "provider-one", "--provider", AWAL_PROVIDER_ID,
    "--auth-method", "browser",
  ], {}, {
    stateRoot: temporary.root,
    providerRegistry: registry(runner),
    foregroundAuthentication: foreground,
  });
  assert.equal(result.ok, false);
  assert.equal(result.error?.code, "APN_INVALID_INPUT");
  assert.deepEqual(runner.calls, []);
  assert.equal(foreground.identityReads, 0);
  assert.equal(foreground.challengeReads, 0);
});

test("malformed provider balance and failed authentication fail without a partial profile write", async (t) => {
  const malformed = new FixtureRunner();
  malformed.balanceStdout = Buffer.from(JSON.stringify({ address: ADDRESS_A, chain: "base", balances: {} }));
  await assert.rejects(
    new AwalProcessAdapter(malformed).observeBalance(),
    (error: unknown) => (error as { readonly code?: unknown }).code === "APN_PROVIDER_PROTOCOL",
  );
  malformed.balanceStdout = Buffer.from(JSON.stringify({
    address: ADDRESS_A,
    chain: "BASE",
    balances: { USDC: { raw: "0", formatted: "0", decimals: 6 } },
    timestamp: OBSERVED_AT,
  }));
  await assert.rejects(
    new AwalProcessAdapter(malformed).observeBalance(),
    (error: unknown) => (error as { readonly code?: unknown }).code === "APN_PROVIDER_PROTOCOL",
  );

  const temporary = await temporaryState();
  t.after(temporary.cleanup);
  const failed = new FixtureRunner();
  failed.authExitCode = 1;
  const result = await runCli([
    "wallet", "connect", "--profile", "auth-failure", "--provider", AWAL_PROVIDER_ID,
  ], {}, {
    stateRoot: temporary.root,
    providerRegistry: registry(failed),
    foregroundAuthentication: new FixtureForeground(),
  });
  assert.equal(result.error?.code, "APN_PROVIDER_UNAVAILABLE");
  const profileHash = sha256("profile\0auth-failure");
  await assert.rejects(readFile(join(temporary.root, "profiles", profileHash, "profile.json")), (error: unknown) => {
    return (error as NodeJS.ErrnoException).code === "ENOENT";
  });
});

test("tampered provider profile fails before provider process access", async (t) => {
  const temporary = await temporaryState();
  t.after(temporary.cleanup);
  const connected = await runCli([
    "wallet", "connect", "--profile", "tampered", "--provider", AWAL_PROVIDER_ID,
  ], {}, {
    stateRoot: temporary.root,
    providerRegistry: registry(new FixtureRunner()),
    foregroundAuthentication: new FixtureForeground(),
  });
  assert.equal(connected.ok, true, JSON.stringify(connected));
  const profileHash = sha256("profile\0tampered");
  const profilePath = join(temporary.root, "profiles", profileHash, "profile.json");
  const record = JSON.parse(await readFile(profilePath, "utf8")) as Record<string, unknown>;
  record.capability_hash = "0".repeat(64);
  await writeFile(profilePath, `${canonicalJson(record)}\n`, { mode: 0o600 });
  const statusRunner = new FixtureRunner();
  const status = await runCli(["wallet", "status", "--profile", "tampered"], {}, {
    stateRoot: temporary.root,
    providerRegistry: registry(statusRunner),
  });
  assert.equal(status.error?.code, "APN_STATE_CORRUPT");
  assert.equal(statusRunner.calls.length, 0);
});

test("MCP connect returns the exact foreground handoff before provider composition", async (t) => {
  let resolves = 0;
  const providerRegistry: ProviderRegistryPort = {
    resolve: () => { resolves += 1; throw new Error("provider must not be reached"); },
  };
  const server = createMcpServer({ providerRegistry });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "provider-connect-test", version: "1.0.0" });
  await client.connect(clientTransport);
  t.after(async () => { await client.close(); await server.close(); });
  const result = await client.callTool({
    name: "apn_wallet_connect",
    arguments: { profile: "provider-one", provider: AWAL_PROVIDER_ID, expected_revision: "4" },
  });
  const envelope = result.structuredContent as unknown as OutputEnvelope;
  const handoff = `apn wallet connect --profile provider-one --provider ${AWAL_PROVIDER_ID} --expected-revision 4`;
  assert.equal(envelope.error?.code, "APN_FOREGROUND_AUTH_REQUIRED");
  assert.equal(envelope.error?.details?.cli_handoff, handoff);
  assert.deepEqual(envelope.error?.details?.cli_handoff_argv, handoff.split(" "));
  assert.deepEqual(envelope.next_actions, [handoff]);
  const browserResult = await client.callTool({
    name: "apn_wallet_connect",
    arguments: { profile: "metamask", provider: "metamask-agent-wallet", auth_method: "browser" },
  });
  const browserEnvelope = browserResult.structuredContent as unknown as OutputEnvelope;
  const browserHandoff = "apn wallet connect --profile metamask --provider metamask-agent-wallet --auth-method browser";
  assert.equal(browserEnvelope.error?.code, "APN_FOREGROUND_AUTH_REQUIRED");
  assert.equal(browserEnvelope.error?.details?.cli_handoff, browserHandoff);
  assert.deepEqual(browserEnvelope.error?.details?.cli_handoff_argv, browserHandoff.split(" "));
  assert.deepEqual(browserEnvelope.next_actions, [browserHandoff]);
  assert.equal(resolves, 0);
});

test("identity drift blocks direct and x402 before every effect and explicit revision rebind is atomic", async (t) => {
  const temporary = await temporaryState();
  t.after(temporary.cleanup);
  const runner = new FixtureRunner();
  const foreground = new FixtureForeground();
  const connected = await runCli([
    "wallet", "connect", "--profile", "provider-one", "--provider", AWAL_PROVIDER_ID,
  ], {}, { stateRoot: temporary.root, providerRegistry: registry(runner), foregroundAuthentication: foreground });
  assert.equal(connected.ok, true, JSON.stringify(connected));

  runner.address = ADDRESS_B;
  const drift = await runCli(["wallet", "status", "--profile", "provider-one"], {}, {
    stateRoot: temporary.root,
    providerRegistry: registry(runner),
  });
  assert.equal(drift.ok, true, JSON.stringify(drift));
  assert.equal((drift.data as Record<string, unknown>).status, "drift_blocked");
  assert.equal((drift.data as Record<string, unknown>).address, ADDRESS_A, "status must preserve the bound identity");

  const driftBalance = await runCli([
    "wallet", "balance", "--profile", "provider-one", "--rpc-url", "https://rpc.example/",
  ], {}, { stateRoot: temporary.root, providerRegistry: registry(runner), rpc: new TestRpc() });
  assert.equal(driftBalance.ok, true, JSON.stringify(driftBalance));
  const driftBalanceData = driftBalance.data as Record<string, unknown>;
  assert.equal(driftBalanceData.status, "drift_blocked");
  assert.equal(driftBalanceData.funding_address, ADDRESS_A);
  assert.equal("funding_guidance" in driftBalanceData, false);
  assert.deepEqual(driftBalanceData.next_actions, [
    `apn wallet connect --profile provider-one --provider ${AWAL_PROVIDER_ID} --expected-revision 1`,
  ]);

  const rpc = new TestRpc();
  const direct = await runCli([
    "pay", "transfer", "prepare", "--profile", "provider-one", "--idempotency-key", "provider-direct-001",
    "--to", ADDRESS_A, "--amount-usdc", "1", "--rpc-url", "https://rpc.example/",
  ], {}, { stateRoot: temporary.root, rpc, providerRegistry: registry(runner) });
  assert.equal(direct.error?.code, "APN_PROFILE_DRIFT");
  assert.equal(rpc.balanceCalls, 0);
  assert.equal(rpc.nonceCalls, 0);

  let httpCalls = 0;
  const http: HttpPort = {
    get: async () => { httpCalls += 1; throw new Error("HTTP must not be reached"); },
  };
  const x402 = await runCli([
    "x402", "fetch", "prepare", "--profile", "provider-one", "--url", "https://seller.example/resource",
    "--idempotency-key", "provider-x402-001", "--rpc-url", "https://rpc.example/",
  ], {}, { stateRoot: temporary.root, rpc, http, providerRegistry: registry(runner) });
  assert.equal(x402.error?.code, "APN_PROFILE_DRIFT");
  assert.equal(httpCalls, 0);
  assert.equal(rpc.x402PrepareCalls, 0);

  const staleRunner = new FixtureRunner();
  staleRunner.address = ADDRESS_B;
  const stale = await runCli([
    "wallet", "connect", "--profile", "provider-one", "--provider", AWAL_PROVIDER_ID, "--expected-revision", "2",
  ], {}, {
    stateRoot: temporary.root,
    providerRegistry: registry(staleRunner),
    foregroundAuthentication: new FixtureForeground(),
  });
  assert.equal(stale.error?.code, "APN_PROFILE_REVISION_CONFLICT");
  assert.equal(staleRunner.calls.length, 0, "stale revision must fail before authentication process access");

  const cancelForeground = new FixtureForeground();
  cancelForeground.confirm = false;
  const canceled = await runCli([
    "wallet", "connect", "--profile", "provider-one", "--provider", AWAL_PROVIDER_ID, "--expected-revision", "1",
  ], {}, {
    stateRoot: temporary.root,
    providerRegistry: registry(runner),
    foregroundAuthentication: cancelForeground,
  });
  assert.equal(canceled.error?.code, "APN_PROFILE_DRIFT");
  assert.equal(cancelForeground.confirmations, 1);
  const canceledProfile = JSON.parse(await readFile(
    join(temporary.root, "profiles", sha256("profile\0provider-one"), "profile.json"),
    "utf8",
  )) as { readonly revision: number; readonly public_address: string; readonly drift: { readonly state: string } };
  assert.equal(canceledProfile.revision, 1);
  assert.equal(canceledProfile.public_address, ADDRESS_A);
  assert.equal(canceledProfile.drift.state, "drift_blocked");

  const rebindForeground = new FixtureForeground();
  const rebound = await runCli([
    "wallet", "connect", "--profile", "provider-one", "--provider", AWAL_PROVIDER_ID, "--expected-revision", "1",
  ], {}, {
    stateRoot: temporary.root,
    providerRegistry: registry(runner),
    foregroundAuthentication: rebindForeground,
  });
  assert.equal(rebound.ok, true, JSON.stringify(rebound));
  assert.equal((rebound.data as Record<string, unknown>).address, ADDRESS_B);
  assert.equal((rebound.data as Record<string, unknown>).revision, 2);
  assert.equal(rebindForeground.confirmations, 1);
});

test("provider balance stays an explicit Base RPC read and funding guidance has no effect claim", async (t) => {
  const temporary = await temporaryState();
  t.after(temporary.cleanup);
  const runner = new FixtureRunner();
  const connected = await runCli([
    "wallet", "connect", "--profile", "provider-one", "--provider", AWAL_PROVIDER_ID,
  ], {}, {
    stateRoot: temporary.root,
    providerRegistry: registry(runner),
    foregroundAuthentication: new FixtureForeground(),
  });
  assert.equal(connected.ok, true, JSON.stringify(connected));
  const providerCalls = runner.calls.length;
  const rpc = new TestRpc();
  const balance = await runCli([
    "wallet", "balance", "--profile", "provider-one", "--rpc-url", "https://rpc.example/",
  ], {}, { stateRoot: temporary.root, providerRegistry: registry(runner), rpc });
  assert.equal(balance.ok, true, JSON.stringify(balance));
  assert.equal(rpc.balanceCalls, 1);
  assert.equal(runner.calls.length, providerCalls, "public balance must not substitute a provider observation for explicit RPC");
  const output = balance.data as Record<string, unknown>;
  assert.equal(output.funding_address, ADDRESS_A);
  assert.match(JSON.stringify(output.funding_guidance), /performs no onramp|no onramp/iu);
  assert.match(JSON.stringify(output.funding_guidance), /proves no finality, sufficiency or spending authority/iu);
});

test("provider balance holds the profile lock so concurrent rebind cannot stale its RPC address", async (t) => {
  const temporary = await temporaryState();
  t.after(temporary.cleanup);
  const runner = new FixtureRunner();
  const connected = await runCli([
    "wallet", "connect", "--profile", "concurrent", "--provider", AWAL_PROVIDER_ID,
  ], {}, {
    stateRoot: temporary.root,
    providerRegistry: registry(runner),
    foregroundAuthentication: new FixtureForeground(),
  });
  assert.equal(connected.ok, true, JSON.stringify(connected));
  const callsBefore = runner.calls.length;
  const rpc = new BlockingRpc();
  const balancePending = runCli([
    "wallet", "balance", "--profile", "concurrent", "--rpc-url", "https://rpc.example/",
  ], {}, { stateRoot: temporary.root, providerRegistry: registry(runner), rpc });
  await rpc.started;

  runner.address = ADDRESS_B;
  const rebindPending = runCli([
    "wallet", "connect", "--profile", "concurrent", "--provider", AWAL_PROVIDER_ID, "--expected-revision", "1",
  ], {}, {
    stateRoot: temporary.root,
    providerRegistry: registry(runner),
    foregroundAuthentication: new FixtureForeground(),
  });
  await new Promise<void>((resolveImmediate) => setImmediate(resolveImmediate));
  await new Promise<void>((resolveImmediate) => setImmediate(resolveImmediate));
  assert.equal(runner.calls.length, callsBefore, "rebind process access must wait behind the balance profile lock");

  rpc.release();
  const balance = await balancePending;
  const rebound = await rebindPending;
  assert.equal(balance.ok, true, JSON.stringify(balance));
  assert.equal((balance.data as Record<string, unknown>).funding_address, ADDRESS_A);
  assert.equal(rebound.ok, true, JSON.stringify(rebound));
  assert.equal((rebound.data as Record<string, unknown>).address, ADDRESS_B);
  assert.equal((rebound.data as Record<string, unknown>).revision, 2);
});

test("legacy local wallet projection adds only profile state and keeps accepted wallet bytes unchanged", async (t) => {
  const temporary = await temporaryState();
  t.after(temporary.cleanup);
  const native = new TestNative();
  const legacy = makeCore({ root: temporary.root, native });
  const ensured = await legacy.execute({ command: "wallet.ensure", profile: "default" });
  assert.equal(ensured.ok, true, JSON.stringify(ensured));
  const profileHash = sha256("profile\0default");
  const walletPath = join(temporary.root, "wallets", profileHash, "wallet.json");
  const before = await readFile(walletPath);
  const migrated = await runCli(["wallet", "ensure", "--profile", "default"], {}, {
    stateRoot: temporary.root,
    native: new TestNative(),
  });
  assert.equal(migrated.ok, true, JSON.stringify(migrated));
  assert.deepEqual(await readFile(walletPath), before);
  const profile = JSON.parse(await readFile(join(temporary.root, "profiles", profileHash, "profile.json"), "utf8")) as Record<string, unknown>;
  assert.equal(profile.provider_id, "local");
  assert.equal(profile.public_address, WALLET);
  assert.equal(profile.revision, 1);
});

test("provider capability model records four distinct ownership modes without enabling provider effects", () => {
  const capability = lifecycleReadOnlyCapabilitySnapshot();
  assert.deepEqual(capability.direct, {
    available: false,
    mode: "provider_atomic_send",
    execution_owner: "provider",
    retry_owner: "apn_outer_no_replay_journal",
  });
  assert.deepEqual(capability.x402, {
    available: false,
    mode: "provider_atomic_paid_fetch",
    execution_owner: "provider",
    retry_owner: "apn_outer_no_replay_journal",
  });
  assert.notEqual(capability.direct.mode, "local_raw_transaction_apn_submit");
  assert.notEqual(capability.x402.mode, "local_detached_eip3009_apn_paid_retry");
});

test("a persisted pre-0.3.2 provider profile stays provider-routed and fails closed before local or provider effects", async (t) => {
  const temporary = await temporaryState();
  t.after(temporary.cleanup);
  const runner = new FixtureRunner();
  const direct = new FixtureDirect();
  const providerRegistry = registry(runner, direct);
  const profile = "provider-old-capability";
  const connected = await runCli([
    "wallet", "connect", "--profile", profile, "--provider", AWAL_PROVIDER_ID,
  ], {}, { stateRoot: temporary.root, providerRegistry, foregroundAuthentication: new FixtureForeground() });
  assert.equal(connected.ok, true, JSON.stringify(connected));
  const providerCallsBefore = runner.calls.length;
  const profileHash = sha256(`profile\0${profile}`);
  const profilePath = join(temporary.root, "profiles", profileHash, "profile.json");
  const record = JSON.parse(await readFile(profilePath, "utf8")) as Record<string, unknown>;
  const oldCapability = lifecycleReadOnlyCapabilitySnapshot();
  record.capability_snapshot = oldCapability;
  record.capability_hash = capabilityHash(oldCapability);
  await writeFile(profilePath, `${canonicalJson(record)}\n`, { mode: 0o600 });

  const native = new TestNative();
  const rpc = new TestRpc();
  let keychainCalls = 0;
  const prepared = await runCli([
    "pay", "transfer", "prepare", "--profile", profile, "--idempotency-key", "old-capability-001",
    "--to", ADDRESS_B, "--amount-usdc", "1", "--rpc-url", "https://rpc.example/old-capability",
  ], {}, {
    stateRoot: temporary.root,
    providerRegistry,
    native,
    rpc,
    wrappingSecret: {
      load: async () => { keychainCalls += 1; return null; },
      create: async () => { keychainCalls += 1; return Buffer.alloc(32); },
    },
  });
  assert.equal(prepared.error?.code, "APN_PROFILE_DRIFT", JSON.stringify(prepared));
  assert.equal(keychainCalls, 0);
  assert.equal(native.calls.length, 0);
  assert.equal(rpc.balanceCalls, 0);
  assert.equal(rpc.nonceCalls, 0);
  assert.equal(rpc.x402PrepareCalls, 0);
  assert.equal(rpc.submissions.length, 0);
  assert.equal(runner.calls.length, providerCallsBefore);
  assert.equal(direct.calls.length, 0);
  await assert.rejects(readdir(join(temporary.root, "operations", profileHash)));
});

test("Coinbase direct adapter uses one closed send argv and classifies every possible post-child uncertainty as ambiguous", async () => {
  const launches: Array<{ readonly executable: string; readonly args: readonly string[]; readonly options: unknown }> = [];
  const stdout = Buffer.from(JSON.stringify({
    transactionHash: PROVIDER_TRANSACTION_HASH,
    chain: "base",
    protectedProviderField: "MUST_NOT_PERSIST",
  }));
  const stderr = Buffer.from("PROTECTED_PROVIDER_STDERR");
  const launch: AwalSendLaunchPort = (executable, args, options) => {
    launches.push({ executable, args: [...args], options });
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
      kill(): boolean;
    };
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
  const adapter = new AwalDirectAdapter(async () => "/exact/node_modules/awal/dist/index.js", launch, 1_000);
  const result = await adapter.execute({ amountDecimal: "1.25", recipient: ADDRESS_B, sender: ADDRESS_A });
  assert.deepEqual(result, { disposition: "acknowledged", transactionHash: PROVIDER_TRANSACTION_HASH });
  assert.deepEqual(launches, [{
    executable: process.execPath,
    args: [
      "/exact/node_modules/awal/dist/index.js", "send", "1.25", ADDRESS_B,
      "--chain", "base", "--asset", "usdc", "--json",
    ],
    options: { shell: false, stdio: ["ignore", "pipe", "pipe"] },
  }]);
  assert.equal(stdout.every((byte) => byte === 0), true);
  assert.equal(stderr.every((byte) => byte === 0), true);

  for (const compatible of [
    { amountAtomic: "1", amountDecimal: "0.000001" },
    { amountAtomic: "1250000", amountDecimal: "1.25" },
    { amountAtomic: "1234567", amountDecimal: "1.234567" },
    { amountAtomic: "100000000", amountDecimal: "100" },
    { amountAtomic: "100000001", amountDecimal: "100.000001" },
    { amountAtomic: "101000001", amountDecimal: "101.000001" },
  ]) {
    adapter.assertCompatibleIntent({ ...compatible, recipient: ADDRESS_B });
  }
  for (const incompatible of [
    { amountAtomic: "249", amountDecimal: "0.000249" },
    { amountAtomic: "1000001", amountDecimal: "1.000001" },
    { amountAtomic: "101000000", amountDecimal: "101" },
    { amountAtomic: "9007199254740991", amountDecimal: "9007199254.740991" },
  ]) {
    assert.throws(
      () => adapter.assertCompatibleIntent({ ...incompatible, recipient: ADDRESS_B }),
      (error: unknown) => (error as { readonly code?: unknown }).code === "APN_PROVIDER_PROTOCOL",
      incompatible.amountDecimal,
    );
  }

  let resolverLaunches = 0;
  const missingBinary = new AwalDirectAdapter(
    async () => { throw new Error("missing"); },
    () => { resolverLaunches += 1; throw new Error("must not launch"); },
  );
  assert.deepEqual(await missingBinary.execute({ amountDecimal: "1", recipient: ADDRESS_B, sender: ADDRESS_A }), {
    disposition: "not_started",
    reason: "provider_binary_unavailable",
  });
  assert.equal(resolverLaunches, 0);

  const launchFailure = new AwalDirectAdapter(
    async () => "/exact/node_modules/awal/dist/index.js",
    () => { throw new Error("synchronous launch failure"); },
  );
  assert.deepEqual(await launchFailure.execute({ amountDecimal: "1", recipient: ADDRESS_B, sender: ADDRESS_A }), {
    disposition: "not_started",
    reason: "provider_child_not_created",
  });

  const ambiguousCase = async (kind: "nonzero" | "malformed" | "missing_hash" | "error" | "timeout") => {
    let kills = 0;
    const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; kill(): boolean };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => { kills += 1; return true; };
    const direct = new AwalDirectAdapter(async () => "/exact/node_modules/awal/dist/index.js", () => {
      queueMicrotask(() => {
        child.emit("spawn");
        if (kind === "nonzero") child.emit("close", 7);
        if (kind === "malformed") { child.stdout.emit("data", Buffer.from("{")); child.emit("close", 0); }
        if (kind === "missing_hash") { child.stdout.emit("data", Buffer.from("{}")); child.emit("close", 0); }
        if (kind === "error") child.emit("error", new Error("lost"));
      });
      return child;
    }, 5);
    const classified = await direct.execute({ amountDecimal: "1", recipient: ADDRESS_B, sender: ADDRESS_A });
    assert.equal(classified.disposition, "ambiguous", kind);
    if (kind === "timeout") assert.equal(kills, 1);
    assert.equal(child.listenerCount("spawn"), 0);
    assert.equal(child.listenerCount("error"), 0);
    assert.equal(child.listenerCount("close"), 0);
    assert.equal(child.stdout.listenerCount("data"), 0);
    assert.equal(child.stderr.listenerCount("data"), 0);
  };
  await ambiguousCase("nonzero");
  await ambiguousCase("malformed");
  await ambiguousCase("missing_hash");
  await ambiguousCase("error");
  await ambiguousCase("timeout");
});

test("provider direct prepare is complete and atomic, MCP stops at exact handoff, and one foreground effect completes only on exact Base receipt", async (t) => {
  const temporary = await temporaryState();
  t.after(temporary.cleanup);
  const runner = new FixtureRunner();
  const direct = new FixtureDirect();
  const providerRegistry = registry(runner, direct);
  const connected = await runCli([
    "wallet", "connect", "--profile", "provider-direct", "--provider", AWAL_PROVIDER_ID,
  ], {}, {
    stateRoot: temporary.root,
    providerRegistry,
    foregroundAuthentication: new FixtureForeground(),
  });
  assert.equal(connected.ok, true, JSON.stringify(connected));
  const rpc = new TestRpc();
  const rpcUrl = "https://rpc.example/provider-direct";
  const prepareArgv = [
    "pay", "transfer", "prepare", "--profile", "provider-direct", "--idempotency-key", "provider-direct-001",
    "--to", ADDRESS_B, "--amount-usdc", "1.25", "--rpc-url", rpcUrl,
  ] as const;
  const providerCallsBeforePrepare = runner.calls.length;
  const preparedBatch = await Promise.all(Array.from({ length: 4 }, async () => await runCli(
    prepareArgv, {}, { stateRoot: temporary.root, providerRegistry, rpc },
  )));
  for (const prepared of preparedBatch) assert.equal(prepared.ok, true, JSON.stringify(prepared));
  const operation = preparedBatch[0]?.operation as Record<string, unknown>;
  const operationId = operation.operation_id as string;
  assert.equal(preparedBatch.every((item) => (item.operation as Record<string, unknown>).operation_id === operationId), true);
  assert.equal(operation.provider, AWAL_PROVIDER_ID);
  assert.equal(operation.profile_revision, 1);
  assert.equal(operation.wallet_address, ADDRESS_A);
  assert.equal(operation.recipient, ADDRESS_B);
  assert.deepEqual(operation.amount, { atomic: "1250000", decimal: "1.25", decimals: 6 });
  assert.equal((operation.policy as Record<string, unknown>).foreground_approval_required, true);
  assert.equal(runner.calls.length, providerCallsBeforePrepare, "prepare must not access the provider");
  assert.equal(direct.calls.length, 0);
  const profileHash = sha256("profile\0provider-direct");
  assert.deepEqual(await readdir(join(temporary.root, "operations", profileHash)), [`${operationId}.json`]);
  const durablePath = join(temporary.root, "operations", profileHash, `${operationId}.json`);
  const durable = JSON.parse(await readFile(durablePath, "utf8")) as Record<string, unknown>;
  const binding = durable.providerDirect as Record<string, unknown>;
  assert.equal(binding.providerId, AWAL_PROVIDER_ID);
  assert.equal(binding.profileRevision, 1);
  assert.equal(binding.capabilityHash, (connected.data as Record<string, unknown>).capability_hash);
  assert.equal(binding.executionOwner, "provider");
  assert.equal(binding.retryOwner, "apn_outer_no_replay_journal");
  assert.equal(typeof binding.rpcBindingHash, "string");
  assert.equal("economics" in durable, false);
  assert.equal("transactionData" in durable, false);

  const conflict = await runCli([
    ...prepareArgv.slice(0, 8), ADDRESS_A, ...prepareArgv.slice(9),
  ], {}, { stateRoot: temporary.root, providerRegistry, rpc });
  assert.equal(conflict.error?.code, "APN_IDEMPOTENCY_CONFLICT");
  assert.equal(runner.calls.length, providerCallsBeforePrepare);
  assert.equal(direct.calls.length, 0);

  const server = createMcpServer({ stateRoot: temporary.root, providerRegistry, rpc });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "provider-direct-mcp", version: "1.0.0" });
  await client.connect(clientTransport);
  t.after(async () => { await client.close(); await server.close(); });
  const mcpApproval = (await client.callTool({
    name: "apn_pay_transfer_approve",
    arguments: { operation: operationId, rpc_url: rpcUrl },
  })).structuredContent as unknown as OutputEnvelope;
  const handoff = `apn pay transfer approve --operation ${operationId} --rpc-url ${rpcUrl}`;
  assert.equal(mcpApproval.error?.code, "APN_FOREGROUND_APPROVAL_REQUIRED");
  assert.equal(mcpApproval.error?.details?.cli_handoff, handoff);
  assert.deepEqual(mcpApproval.next_actions, [handoff]);
  assert.equal(runner.calls.length, providerCallsBeforePrepare, "MCP approval must stop before provider access");
  assert.equal(direct.calls.length, 0);

  const approval = new FixtureApproval();
  direct.onExecute = async () => {
    const started = JSON.parse(await readFile(durablePath, "utf8")) as Record<string, unknown>;
    assert.equal(started.state, "started", "durable started must precede the provider call");
  };
  const approved = await Promise.all([
    runCli(["pay", "transfer", "approve", "--operation", operationId, "--rpc-url", rpcUrl], {}, {
      stateRoot: temporary.root, providerRegistry, rpc, approval,
    }),
    runCli(["pay", "transfer", "approve", "--operation", operationId, "--rpc-url", rpcUrl], {}, {
      stateRoot: temporary.root, providerRegistry, rpc, approval,
    }),
  ]);
  assert.equal(approved.every((item) => item.ok), true, JSON.stringify(approved));
  assert.equal(approved.every((item) => (item.operation as Record<string, unknown>).operation_id === operationId), true);
  assert.equal((approved[0]?.operation as Record<string, unknown>).state, "evidence_pending");
  assert.equal(approval.calls.length, 1);
  assert.equal(direct.calls.length, 1);
  assert.deepEqual(direct.calls[0], { amountDecimal: "1.25", recipient: ADDRESS_B, sender: ADDRESS_A });

  rpc.receipt = exactProviderReceipt();
  const resumed = await runCli([
    "operation", "resume", "--operation", operationId, "--rpc-url", rpcUrl,
  ], {}, { stateRoot: temporary.root, providerRegistry, rpc });
  assert.equal(resumed.ok, true, JSON.stringify(resumed));
  assert.equal((resumed.operation as Record<string, unknown>).state, "completed");
  assert.equal(direct.calls.length, 1, "receipt observation must never resend");
  const receipt = await runCli(["receipt", "get", "--operation", operationId], {}, {
    stateRoot: temporary.root,
    providerRegistry,
  });
  assert.equal(receipt.ok, true, JSON.stringify(receipt));
  assert.equal((receipt.receipt as Record<string, unknown>).exact_transfer_log, true);
  assert.equal(JSON.stringify(receipt).includes("MUST_NOT_PERSIST"), false);
});

test("store failures before started block provider spawn and an orphan terminal receipt recovers without resend", async (t) => {
  const temporary = await temporaryState();
  t.after(temporary.cleanup);
  const runner = new FixtureRunner();
  const direct = new FixtureDirect();
  const providerRegistry = registry(runner, direct);
  assert.equal((await runCli([
    "wallet", "connect", "--profile", "provider-store-failure", "--provider", AWAL_PROVIDER_ID,
  ], {}, {
    stateRoot: temporary.root,
    providerRegistry,
    foregroundAuthentication: new FixtureForeground(),
  })).ok, true);
  const rpc = new TestRpc();
  rpc.receipt = exactProviderReceipt();
  const rpcUrl = "https://rpc.example/provider-store-failure";
  const prepared = await runCli([
    "pay", "transfer", "prepare", "--profile", "provider-store-failure",
    "--idempotency-key", "provider-store-failure-001", "--to", ADDRESS_B,
    "--amount-usdc", "1.25", "--rpc-url", rpcUrl,
  ], {}, { stateRoot: temporary.root, providerRegistry, rpc });
  const operationId = (prepared.operation as Record<string, unknown>).operation_id as string;
  const operationPath = join(
    temporary.root,
    "operations",
    sha256("profile\0provider-store-failure"),
    `${operationId}.json`,
  );

  const startFailureState = new FailingDirectState(temporary.root);
  startFailureState.failOperationState = "started";
  const startFailure = await new ApnCore({
    state: startFailureState,
    profileRepository: new StateProfileRepository(startFailureState),
    providerRegistry,
    rpc,
    rpcUrl,
    transferApproval: new FixtureApproval(),
  }).execute({ command: "transfer.approve", operationId });
  assert.equal(startFailure.error?.code, "APN_INTERNAL");
  assert.equal(direct.calls.length, 0, "provider effect must not start when the durable start journal fails");
  assert.equal((JSON.parse(await readFile(operationPath, "utf8")) as Record<string, unknown>).state, "awaiting_approval");

  const terminalFailureState = new FailingDirectState(temporary.root);
  terminalFailureState.failOperationState = "completed";
  const terminalFailure = await new ApnCore({
    state: terminalFailureState,
    profileRepository: new StateProfileRepository(terminalFailureState),
    providerRegistry,
    rpc,
    rpcUrl,
    transferApproval: new FixtureApproval(),
  }).execute({ command: "transfer.approve", operationId });
  assert.equal(terminalFailure.error?.code, "APN_INTERNAL");
  assert.equal(direct.calls.length, 1);
  assert.equal((JSON.parse(await readFile(operationPath, "utf8")) as Record<string, unknown>).state, "provider_acknowledged");

  const restartState = new StateStore(temporary.root);
  const restartDirect = new FixtureDirect();
  const restartRpc = new CountingReceiptRpc();
  restartRpc.unavailable = true;
  const restarted = new ApnCore({
    state: restartState,
    profileRepository: new StateProfileRepository(restartState),
    providerRegistry: registry(new FixtureRunner(), restartDirect),
    rpc: restartRpc,
    rpcUrl,
  });
  const recovered = await restarted.execute({ command: "operation.resume", operationId });
  assert.equal(recovered.ok, true, JSON.stringify(recovered));
  assert.equal((recovered.operation as Record<string, unknown>).state, "completed");
  assert.equal(restartDirect.calls.length, 0);
  assert.equal(restartRpc.receiptCalls, 0, "receipt-first recovery must not require provider or RPC replay");
  const receipt = await restarted.execute({ command: "receipt.get", operationId });
  assert.equal(receipt.ok, true, JSON.stringify(receipt));
  assert.equal((receipt.receipt as Record<string, unknown>).exact_transfer_log, true);

  await unlink(join(
    temporary.root,
    "receipts",
    sha256("profile\0provider-store-failure"),
    `${operationId}.json`,
  ));
  const missingReceiptStatus = await restarted.execute({ command: "operation.status", operationId });
  assert.equal(missingReceiptStatus.error?.code, "APN_STATE_CORRUPT");
  const idempotentReplay = await restarted.execute({
    command: "transfer.prepare",
    profile: "provider-store-failure",
    idempotencyKey: "provider-store-failure-001",
    recipient: ADDRESS_B,
    amount: "1.25",
  });
  assert.equal(idempotentReplay.error?.code, "APN_STATE_CORRUPT");
  assert.equal(direct.calls.length, 1);
  assert.equal(restartDirect.calls.length, 0);
});

test("provider ambiguity, restart, status, resume and approval replay never invoke send again", async (t) => {
  const temporary = await temporaryState();
  t.after(temporary.cleanup);
  const runner = new FixtureRunner();
  const direct = new FixtureDirect();
  direct.result = { disposition: "ambiguous", reason: "provider_response_malformed" };
  const providerRegistry = registry(runner, direct);
  assert.equal((await runCli([
    "wallet", "connect", "--profile", "provider-ambiguous", "--provider", AWAL_PROVIDER_ID,
  ], {}, { stateRoot: temporary.root, providerRegistry, foregroundAuthentication: new FixtureForeground() })).ok, true);
  const rpc = new TestRpc();
  const prepared = await runCli([
    "pay", "transfer", "prepare", "--profile", "provider-ambiguous", "--idempotency-key", "provider-ambiguous-001",
    "--to", ADDRESS_B, "--amount-usdc", "1", "--rpc-url", "https://rpc.example/ambiguous",
  ], {}, { stateRoot: temporary.root, providerRegistry, rpc });
  const operationId = (prepared.operation as Record<string, unknown>).operation_id as string;
  const approved = await runCli([
    "pay", "transfer", "approve", "--operation", operationId, "--rpc-url", "https://rpc.example/ambiguous",
  ], {}, { stateRoot: temporary.root, providerRegistry, rpc, approval: new FixtureApproval() });
  assert.equal((approved.operation as Record<string, unknown>).state, "ambiguous_effect");
  assert.equal(direct.calls.length, 1);
  const replay = await runCli([
    "pay", "transfer", "approve", "--operation", operationId, "--rpc-url", "https://rpc.example/ambiguous",
  ], {}, { stateRoot: temporary.root, providerRegistry, rpc, approval: new FixtureApproval() });
  assert.equal((replay.operation as Record<string, unknown>).state, "ambiguous_effect");
  const status = await runCli(["operation", "status", "--operation", operationId], {}, {
    stateRoot: temporary.root,
    providerRegistry,
  });
  assert.equal((status.operation as Record<string, unknown>).state, "ambiguous_effect");
  const restartedDirect = new FixtureDirect();
  const resumed = await runCli([
    "operation", "resume", "--operation", operationId, "--rpc-url", "https://rpc.example/ambiguous",
  ], {}, { stateRoot: temporary.root, providerRegistry: registry(new FixtureRunner(), restartedDirect), rpc });
  assert.equal((resumed.operation as Record<string, unknown>).state, "ambiguous_effect");
  assert.equal(direct.calls.length, 1);
  assert.equal(restartedDirect.calls.length, 0);
});

test("pinned AWAL float encoding incompatibility is a monotonic pre-effect failure while exact amounts remain executable", async (t) => {
  const temporary = await temporaryState();
  t.after(temporary.cleanup);
  const runner = new FixtureRunner();
  const effect = new FixtureDirect();
  const guard = new AwalDirectAdapter(async () => "/exact/node_modules/awal/dist/index.js", () => {
    throw new Error("compatibility validation must precede launch");
  });
  const direct: DirectExecutionPort = {
    mode: "provider_atomic_send",
    assertCompatibleIntent: (input) => guard.assertCompatibleIntent(input),
    execute: async (input) => await effect.execute(input),
  };
  const providerRegistry = registry(runner, direct);
  assert.equal((await runCli([
    "wallet", "connect", "--profile", "provider-encoding", "--provider", AWAL_PROVIDER_ID,
  ], {}, { stateRoot: temporary.root, providerRegistry, foregroundAuthentication: new FixtureForeground() })).ok, true);
  const rpc = new TestRpc();
  const incompatible = await runCli([
    "pay", "transfer", "prepare", "--profile", "provider-encoding", "--idempotency-key", "provider-encoding-float",
    "--to", ADDRESS_B, "--amount-usdc", "0.000249", "--rpc-url", "https://rpc.example/encoding",
  ], {}, { stateRoot: temporary.root, providerRegistry, rpc });
  const incompatibleId = (incompatible.operation as Record<string, unknown>).operation_id as string;
  const failed = await runCli([
    "pay", "transfer", "approve", "--operation", incompatibleId, "--rpc-url", "https://rpc.example/encoding",
  ], {}, { stateRoot: temporary.root, providerRegistry, rpc, approval: new FixtureApproval() });
  assert.equal(failed.error?.code, "APN_PROVIDER_PROTOCOL");
  assert.equal(effect.calls.length, 0);
  const status = await runCli(["operation", "status", "--operation", incompatibleId], {}, {
    stateRoot: temporary.root,
    providerRegistry,
  });
  assert.equal((status.operation as Record<string, unknown>).state, "failed_before_effect");
  const durable = JSON.parse(await readFile(join(
    temporary.root, "operations", sha256("profile\0provider-encoding"), `${incompatibleId}.json`,
  ), "utf8")) as { readonly transitions: readonly { readonly state: string }[] };
  assert.deepEqual(durable.transitions.map((transition) => transition.state), ["awaiting_approval", "failed_before_effect"]);
  const replay = await runCli([
    "pay", "transfer", "approve", "--operation", incompatibleId, "--rpc-url", "https://rpc.example/encoding",
  ], {}, { stateRoot: temporary.root, providerRegistry, rpc, approval: new FixtureApproval() });
  assert.equal((replay.operation as Record<string, unknown>).state, "failed_before_effect");
  assert.equal(effect.calls.length, 0);

  const exactHundred = await runCli([
    "pay", "transfer", "prepare", "--profile", "provider-encoding", "--idempotency-key", "provider-encoding-100",
    "--to", ADDRESS_B, "--amount-usdc", "100", "--rpc-url", "https://rpc.example/encoding",
  ], {}, { stateRoot: temporary.root, providerRegistry, rpc });
  const hundredId = (exactHundred.operation as Record<string, unknown>).operation_id as string;
  const hundredApproved = await runCli([
    "pay", "transfer", "approve", "--operation", hundredId, "--rpc-url", "https://rpc.example/encoding",
  ], {}, { stateRoot: temporary.root, providerRegistry, rpc, approval: new FixtureApproval() });
  assert.equal(hundredApproved.ok, true, JSON.stringify(hundredApproved));
  assert.deepEqual(effect.calls, [{ amountDecimal: "100", recipient: ADDRESS_B, sender: ADDRESS_A }]);
});

test("provider receipt adversaries and unavailable evidence never complete or resend", async () => {
  const vectors: Array<{
    readonly name: string;
    readonly receipt: RpcReceipt | null;
    readonly unavailable?: boolean;
    readonly expected: string;
  }> = [
    { name: "pending", receipt: null, expected: "evidence_pending" },
    { name: "unavailable", receipt: null, unavailable: true, expected: "evidence_pending" },
    { name: "revert", receipt: { ...exactProviderReceipt(), status: "reverted" }, expected: "failed_confirmed_revert" },
    { name: "wrong-hash", receipt: { ...exactProviderReceipt(), transactionHash: `0x${"d".repeat(64)}` as Hex }, expected: "ambiguous_effect" },
    { name: "wrong-origin", receipt: { ...exactProviderReceipt(), rpcOrigin: "https://other.example" }, expected: "ambiguous_effect" },
    { name: "missing-log", receipt: { ...exactProviderReceipt(), logs: [] }, expected: "ambiguous_effect" },
    { name: "wrong-token", receipt: mutateReceiptLog({ address: ADDRESS_A }), expected: "ambiguous_effect" },
    { name: "wrong-from", receipt: mutateReceiptLog({ topics: [TRANSFER_TOPIC, addressTopic(ADDRESS_B), addressTopic(ADDRESS_B)] }), expected: "ambiguous_effect" },
    { name: "wrong-to", receipt: mutateReceiptLog({ topics: [TRANSFER_TOPIC, addressTopic(ADDRESS_A), addressTopic(ADDRESS_A)] }), expected: "ambiguous_effect" },
    { name: "wrong-amount", receipt: mutateReceiptLog({ data: `0x${BigInt(1_250_001).toString(16).padStart(64, "0")}` as Hex }), expected: "ambiguous_effect" },
  ];
  for (const vector of vectors) {
    const temporary = await temporaryState();
    try {
      const runner = new FixtureRunner();
      const direct = new FixtureDirect();
      const providerRegistry = registry(runner, direct);
      assert.equal((await runCli([
        "wallet", "connect", "--profile", `receipt-${vector.name}`, "--provider", AWAL_PROVIDER_ID,
      ], {}, { stateRoot: temporary.root, providerRegistry, foregroundAuthentication: new FixtureForeground() })).ok, true);
      const rpc = new CountingReceiptRpc();
      rpc.receipt = vector.receipt;
      rpc.unavailable = vector.unavailable === true;
      const rpcUrl = `https://rpc.example/${vector.name}`;
      const prepared = await runCli([
        "pay", "transfer", "prepare", "--profile", `receipt-${vector.name}`,
        "--idempotency-key", `receipt-vector-${vector.name}`, "--to", ADDRESS_B,
        "--amount-usdc", "1.25", "--rpc-url", rpcUrl,
      ], {}, { stateRoot: temporary.root, providerRegistry, rpc });
      const operationId = (prepared.operation as Record<string, unknown>).operation_id as string;
      const approved = await runCli([
        "pay", "transfer", "approve", "--operation", operationId, "--rpc-url", rpcUrl,
      ], {}, { stateRoot: temporary.root, providerRegistry, rpc, approval: new FixtureApproval() });
      assert.equal((approved.operation as Record<string, unknown>).state, vector.expected, vector.name);
      assert.notEqual((approved.operation as Record<string, unknown>).state, "completed", vector.name);
      assert.equal(direct.calls.length, 1, vector.name);
      const operationPath = join(
        temporary.root, "operations", sha256(`profile\0receipt-${vector.name}`), `${operationId}.json`,
      );
      const beforeResume = JSON.parse(await readFile(operationPath, "utf8")) as {
        readonly transitions: readonly { readonly hash: string }[];
      };
      const resumed = await runCli([
        "operation", "resume", "--operation", operationId, "--rpc-url", rpcUrl,
      ], {}, { stateRoot: temporary.root, providerRegistry, rpc });
      assert.notEqual((resumed.operation as Record<string, unknown>).state, "completed", vector.name);
      assert.equal(direct.calls.length, 1, vector.name);
      assert.equal(JSON.stringify(resumed).includes("RPC_PROTECTED_CANARY"), false);
      const afterResume = JSON.parse(await readFile(operationPath, "utf8")) as {
        readonly transitions: readonly { readonly hash: string }[];
      };
      assert.equal(afterResume.transitions.length, beforeResume.transitions.length, vector.name);
      assert.equal(afterResume.transitions.at(-1)?.hash, beforeResume.transitions.at(-1)?.hash, vector.name);
    } finally {
      await temporary.cleanup();
    }
  }
});

test("receipt observation requires the full frozen RPC URL and never resends", async (t) => {
  const temporary = await temporaryState();
  t.after(temporary.cleanup);
  const runner = new FixtureRunner();
  const direct = new FixtureDirect();
  const providerRegistry = registry(runner, direct);
  const profile = "receipt-rpc-binding";
  assert.equal((await runCli([
    "wallet", "connect", "--profile", profile, "--provider", AWAL_PROVIDER_ID,
  ], {}, { stateRoot: temporary.root, providerRegistry, foregroundAuthentication: new FixtureForeground() })).ok, true);
  const rpc = new CountingReceiptRpc();
  const rpcUrl = "https://rpc.example/frozen-receipt-path";
  const prepared = await runCli([
    "pay", "transfer", "prepare", "--profile", profile, "--idempotency-key", "receipt-rpc-binding-001",
    "--to", ADDRESS_B, "--amount-usdc", "1.25", "--rpc-url", rpcUrl,
  ], {}, { stateRoot: temporary.root, providerRegistry, rpc });
  const operationId = (prepared.operation as Record<string, unknown>).operation_id as string;
  const approved = await runCli([
    "pay", "transfer", "approve", "--operation", operationId, "--rpc-url", rpcUrl,
  ], {}, { stateRoot: temporary.root, providerRegistry, rpc, approval: new FixtureApproval() });
  assert.equal((approved.operation as Record<string, unknown>).state, "evidence_pending");
  assert.equal(direct.calls.length, 1);
  const receiptCallsBeforeDrift = rpc.receiptCalls;
  const transitionHash = (approved.operation as Record<string, unknown>).transition_hash;
  rpc.receipt = exactProviderReceipt();
  const drifted = await runCli([
    "operation", "resume", "--operation", operationId, "--rpc-url", `${rpcUrl}/changed`,
  ], {}, { stateRoot: temporary.root, providerRegistry, rpc });
  assert.equal((drifted.operation as Record<string, unknown>).state, "evidence_pending");
  assert.equal((drifted.operation as Record<string, unknown>).transition_hash, transitionHash);
  assert.equal(rpc.receiptCalls, receiptCallsBeforeDrift, "a changed raw RPC URL must not supply evidence");
  assert.equal(direct.calls.length, 1);
  const completed = await runCli([
    "operation", "resume", "--operation", operationId, "--rpc-url", rpcUrl,
  ], {}, { stateRoot: temporary.root, providerRegistry, rpc });
  assert.equal((completed.operation as Record<string, unknown>).state, "completed");
  assert.equal(rpc.receiptCalls, receiptCallsBeforeDrift + 1);
  assert.equal(direct.calls.length, 1);
});

test("exact independent evidence may resolve ambiguity without another provider call", async (t) => {
  const temporary = await temporaryState();
  t.after(temporary.cleanup);
  const runner = new FixtureRunner();
  const direct = new FixtureDirect();
  const providerRegistry = registry(runner, direct);
  assert.equal((await runCli([
    "wallet", "connect", "--profile", "receipt-resolve-ambiguity", "--provider", AWAL_PROVIDER_ID,
  ], {}, { stateRoot: temporary.root, providerRegistry, foregroundAuthentication: new FixtureForeground() })).ok, true);
  const rpc = new CountingReceiptRpc();
  rpc.receipt = mutateReceiptLog({ data: `0x${BigInt(1).toString(16).padStart(64, "0")}` as Hex });
  const rpcUrl = "https://rpc.example/resolve-ambiguity";
  const prepared = await runCli([
    "pay", "transfer", "prepare", "--profile", "receipt-resolve-ambiguity",
    "--idempotency-key", "receipt-resolve-ambiguity-001", "--to", ADDRESS_B,
    "--amount-usdc", "1.25", "--rpc-url", rpcUrl,
  ], {}, { stateRoot: temporary.root, providerRegistry, rpc });
  const operationId = (prepared.operation as Record<string, unknown>).operation_id as string;
  const ambiguous = await runCli([
    "pay", "transfer", "approve", "--operation", operationId, "--rpc-url", rpcUrl,
  ], {}, { stateRoot: temporary.root, providerRegistry, rpc, approval: new FixtureApproval() });
  assert.equal((ambiguous.operation as Record<string, unknown>).state, "ambiguous_effect");
  rpc.receipt = exactProviderReceipt();
  const completed = await runCli([
    "operation", "resume", "--operation", operationId, "--rpc-url", rpcUrl,
  ], {}, { stateRoot: temporary.root, providerRegistry, rpc });
  assert.equal((completed.operation as Record<string, unknown>).state, "completed");
  assert.equal(direct.calls.length, 1);
});

test("profile revision, capability, observed sender and RPC drift all stop before started and send", async () => {
  for (const drift of ["revision", "capability", "sender", "rpc"] as const) {
    const temporary = await temporaryState();
    try {
      const runner = new FixtureRunner();
      const direct = new FixtureDirect();
      const providerRegistry = registry(runner, direct);
      const profile = `drift-${drift}`;
      assert.equal((await runCli([
        "wallet", "connect", "--profile", profile, "--provider", AWAL_PROVIDER_ID,
      ], {}, { stateRoot: temporary.root, providerRegistry, foregroundAuthentication: new FixtureForeground() })).ok, true);
      const rpc = new TestRpc();
      const rpcUrl = `https://rpc.example/${drift}`;
      const prepared = await runCli([
        "pay", "transfer", "prepare", "--profile", profile, "--idempotency-key", `drift-check-${drift}`,
        "--to", ADDRESS_B, "--amount-usdc", "1", "--rpc-url", rpcUrl,
      ], {}, { stateRoot: temporary.root, providerRegistry, rpc });
      const operationId = (prepared.operation as Record<string, unknown>).operation_id as string;
      const profilePath = join(temporary.root, "profiles", sha256(`profile\0${profile}`), "profile.json");
      if (drift === "revision") {
        runner.address = ADDRESS_B;
        const rebound = await runCli([
          "wallet", "connect", "--profile", profile, "--provider", AWAL_PROVIDER_ID, "--expected-revision", "1",
        ], {}, { stateRoot: temporary.root, providerRegistry, foregroundAuthentication: new FixtureForeground() });
        assert.equal(rebound.ok, true, JSON.stringify(rebound));
      }
      if (drift === "capability") {
        const record = JSON.parse(await readFile(profilePath, "utf8")) as Record<string, unknown>;
        const snapshot = record.capability_snapshot as ReturnType<typeof lifecycleReadOnlyCapabilitySnapshot>;
        const changed = { ...snapshot, lifecycle: { ...snapshot.lifecycle, logout: !snapshot.lifecycle.logout } };
        record.capability_snapshot = changed;
        record.capability_hash = capabilityHash(changed);
        await writeFile(profilePath, `${canonicalJson(record)}\n`, { mode: 0o600 });
      }
      if (drift === "sender") runner.address = ADDRESS_B;
      const approval = new FixtureApproval();
      const approved = await runCli([
        "pay", "transfer", "approve", "--operation", operationId, "--rpc-url",
        drift === "rpc" ? `${rpcUrl}/changed` : rpcUrl,
      ], {}, { stateRoot: temporary.root, providerRegistry, rpc, approval });
      assert.equal(approved.ok, false, drift);
      assert.equal(direct.calls.length, 0, drift);
      const durable = JSON.parse(await readFile(join(
        temporary.root, "operations", sha256(`profile\0${profile}`), `${operationId}.json`,
      ), "utf8")) as { readonly state: string; readonly transitions: readonly { readonly state: string }[] };
      assert.equal(durable.state, "failed_before_effect", drift);
      assert.equal(durable.transitions.some((transition) => transition.state === "started"), false, drift);
      if (drift === "revision" || drift === "capability" || drift === "rpc") assert.equal(approval.calls.length, 0, drift);
      if (drift === "sender") {
        assert.equal(approval.calls.length, 1, drift);
        const rebindHandoff = `apn wallet connect --profile ${profile} --provider ${AWAL_PROVIDER_ID} --expected-revision 1`;
        assert.equal(approved.error?.code, "APN_PROFILE_DRIFT");
        assert.equal(approved.error?.details?.cli_handoff, rebindHandoff);
        assert.deepEqual(approved.error?.details?.cli_handoff_argv, rebindHandoff.split(" "));
        assert.deepEqual(approved.next_actions, [rebindHandoff]);
        const driftedProfile = JSON.parse(await readFile(profilePath, "utf8")) as {
          readonly revision: number;
          readonly drift: { readonly state: string; readonly observed_address?: string };
        };
        assert.equal(driftedProfile.drift.state, "drift_blocked");
        assert.equal(driftedProfile.drift.observed_address, ADDRESS_B);
        const status = await runCli(["operation", "status", "--operation", operationId], {}, {
          stateRoot: temporary.root,
          providerRegistry,
        });
        assert.deepEqual((status.operation as Record<string, unknown>).next_actions, [rebindHandoff]);
        const foreground = new FixtureForeground();
        const rebound = await runCli([
          "wallet", "connect", "--profile", profile, "--provider", AWAL_PROVIDER_ID,
          "--expected-revision", "1",
        ], {}, { stateRoot: temporary.root, providerRegistry, foregroundAuthentication: foreground });
        assert.equal(rebound.ok, true, JSON.stringify(rebound));
        assert.equal((rebound.data as Record<string, unknown>).revision, 2);
        assert.equal((rebound.data as Record<string, unknown>).address, ADDRESS_B);
        assert.equal(foreground.confirmations, 1);
        const reprepared = await runCli([
          "pay", "transfer", "prepare", "--profile", profile,
          "--idempotency-key", "drift-check-sender-rebound", "--to", ADDRESS_A,
          "--amount-usdc", "1", "--rpc-url", rpcUrl,
        ], {}, { stateRoot: temporary.root, providerRegistry, rpc });
        assert.equal(reprepared.ok, true, JSON.stringify(reprepared));
        assert.equal((reprepared.operation as Record<string, unknown>).wallet_address, ADDRESS_B);
        assert.equal(direct.calls.length, 0);
      }
    } finally {
      await temporary.cleanup();
    }
  }
});

function exactProviderReceipt(): RpcReceipt {
  const topic = (address: string): Hex => `0x${address.slice(2).toLowerCase().padStart(64, "0")}` as Hex;
  return {
    transactionHash: PROVIDER_TRANSACTION_HASH,
    status: "success",
    blockNumberAtomic: "400",
    logs: [{
      address: BASE_USDC,
      topics: [TRANSFER_TOPIC, topic(ADDRESS_A), topic(ADDRESS_B)],
      data: `0x${BigInt(1_250_000).toString(16).padStart(64, "0")}` as Hex,
    }],
    observedAt: OBSERVED_AT,
    rpcOrigin: "https://rpc.example",
  };
}

function addressTopic(address: string): Hex {
  return `0x${address.slice(2).toLowerCase().padStart(64, "0")}` as Hex;
}

function mutateReceiptLog(input: Partial<RpcReceipt["logs"][number]>): RpcReceipt {
  const receipt = exactProviderReceipt();
  return { ...receipt, logs: [{ ...receipt.logs[0]!, ...input }] };
}
