import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { runCli } from "../../src/cli.js";
import type { ForegroundAuthenticationPort } from "../../src/provider-ports.js";
import { ProviderRegistry } from "../../src/provider-registry.js";
import {
  METAMASK_AGENT_WALLET_PROVIDER_ID,
  MetaMaskProcessAdapter,
} from "../../src/metamask-process-adapter.js";
import {
  NodeMetaMaskProcessRunner,
  type MetaMaskCapturedLaunchPort,
  type MetaMaskForegroundLaunchPort,
  type MetaMaskProcessResult,
  type MetaMaskProcessRunnerPort,
} from "../../src/metamask-process-runner.js";
import {
  METAMASK_AGENT_WALLET_BIN,
  METAMASK_AGENT_WALLET_INTEGRITY,
  METAMASK_AGENT_WALLET_SHASUM,
  METAMASK_AGENT_WALLET_VERSION,
  resolveMetaMaskBin,
} from "../../src/metamask-package.js";
import { TestRpc, temporaryState } from "./helpers.js";

const ADDRESS_A = "0x1111111111111111111111111111111111111111" as const;
const ADDRESS_B = "0x2222222222222222222222222222222222222222" as const;

class FixtureRunner implements MetaMaskProcessRunnerPort {
  readonly jsonCalls: readonly string[][] = [];
  readonly foregroundCalls: readonly string[][] = [];
  authenticated = true;
  initialized = true;
  address: `0x${string}` = ADDRESS_A;
  foregroundExitCode = 0;
  malformedCommand: string | undefined;

  async runJson(argv: readonly string[]): Promise<MetaMaskProcessResult> {
    (this.jsonCalls as string[][]).push([...argv]);
    const command = argv.slice(0, 2).join(" ");
    if (command === this.malformedCommand) return { exitCode: 0, stdout: Buffer.from("not-json") };
    if (argv[0] === "doctor") return success({
      cli: METAMASK_AGENT_WALLET_VERSION,
      env: "prod",
      authenticated: this.authenticated,
      initialized: this.initialized,
      recommendedSkills: {},
      compatible: null,
      hints: [],
    });
    if (argv[0] === "init") {
      this.initialized = true;
      return success({ walletMode: "server-wallet", tradingMode: "guard" });
    }
    if (argv[0] === "logout") {
      this.authenticated = false;
      this.initialized = false;
      return success({ success: true });
    }
    if (command === "wallet address") return success({
      mode: "server-wallet",
      chainNamespace: "eip155",
      address: this.address,
    });
    throw new Error(`unexpected fixture command: ${argv.join(" ")}`);
  }

  async runForeground(argv: readonly string[]): Promise<number> {
    (this.foregroundCalls as string[][]).push([...argv]);
    if (this.foregroundExitCode === 0) this.authenticated = true;
    return this.foregroundExitCode;
  }
}

const foreground: ForegroundAuthenticationPort = {
  readIdentity: async () => { throw new Error("MetaMask must own its foreground login"); },
  readChallengeResponse: async () => { throw new Error("MetaMask must own its foreground login"); },
  confirmRebind: async () => true,
};

function success(data: Record<string, unknown>): MetaMaskProcessResult {
  return { exitCode: 0, stdout: Buffer.from(JSON.stringify({ ok: true, data })) };
}

function registry(runner: FixtureRunner, exclusive = async <T>(work: () => Promise<T>): Promise<T> => await work()): ProviderRegistry {
  return new ProviderRegistry([{
    provider_id: METAMASK_AGENT_WALLET_PROVIDER_ID,
    create: () => new MetaMaskProcessAdapter(runner, exclusive, () => new Date("2026-09-02T00:00:00.000Z")).bundle(),
  }]);
}

test("exact MetaMask Agent Wallet package identity and declared binary are pinned", async () => {
  const manifest = JSON.parse(await readFile(resolve("package.json"), "utf8")) as { dependencies?: Record<string, string> };
  const lock = JSON.parse(await readFile(resolve("npm-shrinkwrap.json"), "utf8")) as {
    packages?: Record<string, { version?: string; integrity?: string; bin?: Record<string, string>; engines?: Record<string, string> }>;
  };
  assert.equal(manifest.dependencies?.["@metamask/agent-wallet"], METAMASK_AGENT_WALLET_VERSION);
  assert.equal(lock.packages?.["node_modules/@metamask/agent-wallet"]?.version, METAMASK_AGENT_WALLET_VERSION);
  assert.equal(lock.packages?.["node_modules/@metamask/agent-wallet"]?.integrity, METAMASK_AGENT_WALLET_INTEGRITY);
  assert.equal(lock.packages?.["node_modules/@metamask/agent-wallet"]?.bin?.mm, METAMASK_AGENT_WALLET_BIN);
  assert.equal(lock.packages?.["node_modules/@metamask/agent-wallet"]?.engines?.node, ">=22.18");
  assert.equal(METAMASK_AGENT_WALLET_SHASUM, "6fcfb2d3b376a9495ef053b2d6b98cecf842e29a");
  assert.match(await resolveMetaMaskBin(), /node_modules\/@metamask\/agent-wallet\/dist\/index\.js$/u);
});

test("process runner uses Node plus closed argv and isolates foreground output on the terminal", async () => {
  const captured: Array<{ executable: string; args: readonly string[]; options: unknown }> = [];
  const foregroundLaunches: Array<{ executable: string; args: readonly string[]; options: unknown }> = [];
  const capturedLaunch: MetaMaskCapturedLaunchPort = (executable, args, options) => {
    captured.push({ executable, args: [...args], options });
    const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; kill(): boolean };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => true;
    queueMicrotask(() => {
      child.stdout.emit("data", Buffer.from(JSON.stringify({ ok: true, data: {} })));
      child.emit("close", 0);
    });
    return child;
  };
  const foregroundLaunch: MetaMaskForegroundLaunchPort = (executable, args, options) => {
    foregroundLaunches.push({ executable, args: [...args], options });
    const child = new EventEmitter() as EventEmitter & { kill(): boolean };
    child.kill = () => true;
    queueMicrotask(() => child.emit("close", 0));
    return child;
  };
  const closed: number[] = [];
  const runner = new NodeMetaMaskProcessRunner(
    async () => "/exact/node_modules/@metamask/agent-wallet/dist/index.js",
    capturedLaunch,
    foregroundLaunch,
    1000,
    1000,
    () => 42,
    (fd) => { closed.push(fd); },
  );
  const json = await runner.runJson(["doctor", "--json"]);
  json.stdout.fill(0);
  assert.equal(await runner.runForeground(["login", "qr"]), 0);
  assert.deepEqual(captured, [{
    executable: process.execPath,
    args: ["/exact/node_modules/@metamask/agent-wallet/dist/index.js", "doctor", "--json"],
    options: { shell: false, stdio: ["ignore", "pipe", "pipe"] },
  }]);
  assert.deepEqual(foregroundLaunches, [{
    executable: process.execPath,
    args: ["/exact/node_modules/@metamask/agent-wallet/dist/index.js", "login", "qr"],
    options: { shell: false, stdio: [42, 42, 42] },
  }]);
  assert.deepEqual(closed, [42]);
});

test("connect performs only required provider-native QR login and Guard server-wallet init", async () => {
  const runner = new FixtureRunner();
  runner.authenticated = false;
  runner.initialized = false;
  const adapter = new MetaMaskProcessAdapter(runner);
  await adapter.connect(foreground);
  assert.deepEqual(runner.foregroundCalls, [["login", "qr"]]);
  assert.deepEqual(runner.jsonCalls, [
    ["doctor", "--json"],
    ["doctor", "--json"],
    ["init", "--wallet", "server-wallet", "--mode", "guard", "--json"],
    ["doctor", "--json"],
    ["wallet", "address", "--chain-namespace", "eip155", "--json"],
  ]);
});

test("connected session is reused without login or reinitialization", async () => {
  const runner = new FixtureRunner();
  const adapter = new MetaMaskProcessAdapter(runner);
  await adapter.connect(foreground);
  assert.deepEqual(runner.foregroundCalls, []);
  assert.deepEqual(runner.jsonCalls, [
    ["doctor", "--json"],
    ["wallet", "address", "--chain-namespace", "eip155", "--json"],
  ]);
});

test("generic APN profile binds, restarts and reads independent Base balance", async (t) => {
  const temporary = await temporaryState();
  t.after(temporary.cleanup);
  const runner = new FixtureRunner();
  const connected = await runCli([
    "wallet", "connect", "--profile", "metamask", "--provider", METAMASK_AGENT_WALLET_PROVIDER_ID,
  ], {}, {
    stateRoot: temporary.root,
    providerRegistry: registry(runner),
    foregroundAuthentication: foreground,
  });
  assert.equal(connected.ok, true, JSON.stringify(connected));
  assert.deepEqual(connected.data, {
    profile: "metamask",
    provider: METAMASK_AGENT_WALLET_PROVIDER_ID,
    status: "bound",
    address: ADDRESS_A,
    account_binding_hash: (connected.data as Record<string, unknown>).account_binding_hash,
    trust_class: "provider_managed_non_custodial_signer",
    revision: 1,
    capability_hash: (connected.data as Record<string, unknown>).capability_hash,
    observed_at: "2026-09-02T00:00:00.000Z",
    reused: false,
    proof_class: "provider_profile_binding",
    funding_guidance: { network: "Base", asset: "USDC", address: ADDRESS_A, action: "Fund manually only; APN performs no funding action." },
    next_actions: ["Use apn wallet balance with an explicit Base RPC URL"],
  });

  const restarted = new FixtureRunner();
  const status = await runCli(["wallet", "status", "--profile", "metamask"], {}, {
    stateRoot: temporary.root,
    providerRegistry: registry(restarted),
  });
  assert.equal(status.ok, true, JSON.stringify(status));
  assert.equal((status.data as Record<string, unknown>).address, ADDRESS_A);
  assert.equal((status.data as Record<string, unknown>).reused, true);

  const rpc = new TestRpc();
  const balance = await runCli([
    "wallet", "balance", "--profile", "metamask", "--rpc-url", "https://rpc.example/",
  ], {}, { stateRoot: temporary.root, providerRegistry: registry(restarted), rpc });
  assert.equal(balance.ok, true, JSON.stringify(balance));
  assert.equal((balance.data as Record<string, unknown>).funding_address, ADDRESS_A);
  assert.equal((balance.data as Record<string, unknown>).proof_class, "chain_verified_public_read");
  assert.equal(rpc.balanceCalls, 1);
});

test("read-only Slice advertises no direct or x402 effect", () => {
  const capabilities = new MetaMaskProcessAdapter(new FixtureRunner()).capabilities;
  assert.equal(capabilities.direct.available, false);
  assert.equal(capabilities.x402.available, false);
  assert.equal(capabilities.lifecycle.connect, true);
  assert.equal(capabilities.read.address, true);
});

test("auth, init, malformed JSON and changed address fail closed", async (t) => {
  const failedLogin = new FixtureRunner();
  failedLogin.authenticated = false;
  failedLogin.initialized = false;
  failedLogin.foregroundExitCode = 1;
  await assert.rejects(
    new MetaMaskProcessAdapter(failedLogin).connect(foreground),
    (error: unknown) => (error as { code?: unknown }).code === "APN_PROVIDER_SESSION_REQUIRED",
  );

  const malformed = new FixtureRunner();
  malformed.malformedCommand = "wallet address";
  await assert.rejects(
    new MetaMaskProcessAdapter(malformed).observeBalance(),
    (error: unknown) => (error as { code?: unknown }).code === "APN_PROVIDER_PROTOCOL",
  );

  const temporary = await temporaryState();
  t.after(temporary.cleanup);
  const runner = new FixtureRunner();
  const connected = await runCli([
    "wallet", "connect", "--profile", "metamask", "--provider", METAMASK_AGENT_WALLET_PROVIDER_ID,
  ], {}, { stateRoot: temporary.root, providerRegistry: registry(runner), foregroundAuthentication: foreground });
  assert.equal(connected.ok, true, JSON.stringify(connected));
  runner.address = ADDRESS_B;
  const status = await runCli(["wallet", "status", "--profile", "metamask"], {}, {
    stateRoot: temporary.root,
    providerRegistry: registry(runner),
  });
  assert.equal(status.ok, true, JSON.stringify(status));
  assert.equal((status.data as Record<string, unknown>).status, "drift_blocked");
  assert.equal((status.data as Record<string, unknown>).address, ADDRESS_A);
});

test("adapter serializes all MetaMask session access", async () => {
  const runner = new FixtureRunner();
  let active = 0;
  let maximum = 0;
  const exclusive = async <T>(work: () => Promise<T>): Promise<T> => {
    assert.equal(active, 0);
    active += 1;
    maximum = Math.max(maximum, active);
    try { return await work(); }
    finally { active -= 1; }
  };
  const adapter = new MetaMaskProcessAdapter(runner, exclusive);
  await adapter.probeStatus();
  await adapter.observeBalance();
  await adapter.crossCheckAddress(ADDRESS_A);
  assert.equal(maximum, 1);
});
