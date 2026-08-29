import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFile, writeFile } from "node:fs/promises";
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
import { runCli } from "../../src/cli.js";
import type { OutputEnvelope } from "../../src/commands.js";
import {
  TtyForegroundAuthentication,
  readSecretLine,
  type AuthTerminal,
} from "../../src/foreground-auth.js";
import { createMcpServer } from "../../src/mcp-server.js";
import type {
  ForegroundAuthenticationPort,
  ProviderRegistryPort,
} from "../../src/provider-ports.js";
import type { HttpPort } from "../../src/ports.js";
import { ProviderRegistry } from "../../src/provider-registry.js";
import { lifecycleReadOnlyCapabilitySnapshot } from "../../src/provider-profile.js";
import { canonicalJson, sha256 } from "../../src/canonical.js";
import { TestNative, TestRpc, WALLET, makeCore, temporaryState } from "./helpers.js";

const ADDRESS_A = "0x1111111111111111111111111111111111111111" as const;
const ADDRESS_B = "0x2222222222222222222222222222222222222222" as const;
const OBSERVED_AT = "2026-08-30T00:00:00.000Z";

class FixtureRunner implements AwalProcessRunnerPort {
  readonly calls: Array<{ readonly argv: readonly string[]; readonly sensitive: boolean }> = [];
  address: `0x${string}` = ADDRESS_A;
  authExitCode = 0;
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
          chain: "base",
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
    return { exitCode: argv[0] === "auth" ? this.authExitCode : 0, stdout: Buffer.alloc(0) };
  }
}

class FixtureForeground implements ForegroundAuthenticationPort {
  readonly identityCanary = "protected" + String.fromCharCode(64) + "example.invalid";
  readonly challengeCanary = [7, 3, 9, 1, 4, 8].join("");
  confirmations = 0;
  confirm = true;
  async readIdentity(): Promise<string> { return this.identityCanary; }
  async readChallengeResponse(): Promise<string> { return this.challengeCanary; }
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

function registry(runner: FixtureRunner): ProviderRegistry {
  return new ProviderRegistry([{
    provider_id: AWAL_PROVIDER_ID,
    create: () => new AwalProcessAdapter(runner).bundle(),
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
  const reused = await runCli([
    "wallet", "connect", "--profile", "provider-one", "--provider", AWAL_PROVIDER_ID,
  ], {}, {
    stateRoot: temporary.root,
    providerRegistry: registry(restartedRunner),
    foregroundAuthentication: new FixtureForeground(),
  });
  assert.equal(reused.ok, true, JSON.stringify(reused));
  assert.equal((reused.data as Record<string, unknown>).reused, true);
  assert.equal((reused.data as Record<string, unknown>).revision, 1);
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
    ["auth", "login"], ["auth", "verify"], ["balance", "--chain"],
  ]);
  assert.equal(restartedRunner.calls[0]?.sensitive, true);
  assert.equal(restartedRunner.calls[1]?.sensitive, true);
  assert.equal(restartedRunner.calls[2]?.sensitive, false);

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

test("malformed provider balance and failed authentication fail without a partial profile write", async (t) => {
  const malformed = new FixtureRunner();
  malformed.balanceStdout = Buffer.from(JSON.stringify({ address: ADDRESS_A, chain: "base", balances: {} }));
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
  assert.deepEqual(envelope.next_actions, [handoff]);
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
