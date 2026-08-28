import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { closeSync, fstatSync, openSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir, userInfo } from "node:os";
import { join, resolve } from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";
import { effectiveStateRoot, parseArgv, runCli } from "../../src/cli.js";
import { ApnError } from "../../src/errors.js";
import { InheritedNativeIpc, decodeSingleFrame, encodeFrame, readFrameStream } from "../../src/native-ipc.js";
import { HttpsBaseRpc, isPublicIp } from "../../src/rpc.js";

const REQUEST_ID = "12345678-1234-4234-8234-123456789abc";
const OPERATION_ID = "a".repeat(64);

test("IPC framing is four-byte big-endian, bounded, exact, and strict JSON", () => {
  const value = { version: "apn.native.v1", requestId: REQUEST_ID };
  const frame = encodeFrame(value);
  assert.equal(frame.readUInt32BE(0), frame.length - 4);
  assert.deepEqual(decodeSingleFrame(frame), value);
  assert.throws(() => decodeSingleFrame(Buffer.concat([frame, Buffer.from([0])])), ApnError);
  assert.throws(() => decodeSingleFrame(Buffer.from([0, 0, 0, 2, 0xff, 0xff])), ApnError);
  const oversized = Buffer.alloc(4);
  oversized.writeUInt32BE(65 * 1024, 0);
  assert.throws(() => decodeSingleFrame(oversized), ApnError);
});

test("IPC response supports fragmentation, waits for EOF, and rejects a second frame", async () => {
  const frame = encodeFrame({ version: "apn.native.v1", requestId: REQUEST_ID, ok: true, result: { found: false } });
  const fragmented = new PassThrough();
  let settled = false;
  const decoded = readFrameStream(fragmented, 1_000).finally(() => { settled = true; });
  fragmented.write(frame.subarray(0, 2));
  fragmented.write(frame.subarray(2, 11));
  fragmented.write(frame.subarray(11));
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(settled, false, "a complete declared frame is not accepted until native closes its writer");
  fragmented.end();
  assert.deepEqual(await decoded, { version: "apn.native.v1", requestId: REQUEST_ID, ok: true, result: { found: false } });

  const secondFrame = new PassThrough();
  const rejected = readFrameStream(secondFrame, 1_000);
  secondFrame.end(Buffer.concat([frame, frame]));
  await assert.rejects(rejected, /trailing data|second frame/);
});

test("native IPC refuses absent, aliased, invalid, or non-UUID request identity", async () => {
  assert.throws(() => InheritedNativeIpc.fromEnvironment({}), /signed native host/);
  assert.throws(() => InheritedNativeIpc.fromEnvironment({
    APN_NATIVE_REQUEST_FD: "2",
    APN_NATIVE_RESPONSE_FD: "4",
  }), ApnError);
  assert.throws(() => new InheritedNativeIpc(4, 4), /distinct/);

  const invalid = new InheritedNativeIpc(10, 11);
  await assert.rejects(invalid.request({
    version: "apn.native.v1",
    requestId: "not-a-uuid",
    operation: "wallet.describe",
    payload: { profile: "default" },
  }), /bounded schema/);
});

test("IPC closes the sole request writer and consumes one EOF-terminated response", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "apn-ipc-"));
  t.after(async () => await rm(directory, { recursive: true, force: true }));
  const requestPath = join(directory, "request.bin");
  const responsePath = join(directory, "response.bin");
  writeFileSync(responsePath, encodeFrame({ version: "apn.native.v1", requestId: REQUEST_ID, ok: true, result: { found: false } }));
  const requestFd = openSync(requestPath, "w");
  const responseFd = openSync(responsePath, "r");
  const ipc = new InheritedNativeIpc(requestFd, responseFd, 1_000);
  const result = await ipc.request({
    version: "apn.native.v1",
    requestId: REQUEST_ID,
    operation: "wallet.describe",
    payload: { profile: "default" },
  });
  assert.deepEqual(result, { found: false });
  assert.throws(() => fstatSync(requestFd), /bad file descriptor/i);
  try { closeSync(responseFd); } catch { /* read stream owns this descriptor */ }
});

test("CLI argv preserves Slice 1, adds bounded x402 commands, and contains no approval bypass", async () => {
  assert.deepEqual(parseArgv(["--version"]), { request: { command: "version" } });
  assert.deepEqual(parseArgv(["doctor", "keychain"]), { request: { command: "doctor.keychain" } });
  assert.deepEqual(parseArgv(["wallet", "ensure"]), { request: { command: "wallet.ensure", profile: "default" } });
  assert.deepEqual(parseArgv(["wallet", "status", "--profile", "bot_1"]), { request: { command: "wallet.status", profile: "bot_1" } });
  assert.deepEqual(parseArgv(["wallet", "balance", "--rpc-url", "https://rpc.example/private?token=redacted"]), {
    request: { command: "wallet.balance", profile: "default" },
    rpcUrl: "https://rpc.example/private?token=redacted",
  });
  assert.deepEqual(parseArgv([
    "pay", "transfer", "prepare", "--profile", "default", "--idempotency-key", "payment-001", "--to",
    "0x2222222222222222222222222222222222222222", "--amount-usdc", "1.25", "--rpc-url", "https://rpc.example",
  ]), {
    request: {
      command: "transfer.prepare",
      profile: "default",
      idempotencyKey: "payment-001",
      recipient: "0x2222222222222222222222222222222222222222",
      amount: "1.25",
    },
    rpcUrl: "https://rpc.example",
  });
  assert.deepEqual(parseArgv(["pay", "transfer", "approve", "--operation", OPERATION_ID, "--rpc-url", "https://rpc.example"]), {
    request: { command: "transfer.approve", operationId: OPERATION_ID },
    rpcUrl: "https://rpc.example",
  });
  assert.deepEqual(parseArgv(["operation", "status", "--operation", OPERATION_ID]), {
    request: { command: "operation.status", operationId: OPERATION_ID },
  });
  assert.deepEqual(parseArgv(["operation", "resume", "--operation", OPERATION_ID, "--rpc-url", "https://rpc.example"]), {
    request: { command: "operation.resume", operationId: OPERATION_ID },
    rpcUrl: "https://rpc.example",
  });
  assert.deepEqual(parseArgv([
    "operation", "resume", "--operation", OPERATION_ID, "--rpc-url", "https://rpc.example", "--wait-seconds", "300",
  ]), {
    request: { command: "operation.resume", operationId: OPERATION_ID, waitSeconds: 300 },
    rpcUrl: "https://rpc.example",
  });
  for (const value of ["0", "301", "01", "1.0", "-1"]) {
    assert.throws(() => parseArgv([
      "operation", "resume", "--operation", OPERATION_ID, "--rpc-url", "https://rpc.example", "--wait-seconds", value,
    ]), ApnError);
  }
  assert.deepEqual(parseArgv(["receipt", "get", "--operation", OPERATION_ID]), {
    request: { command: "receipt.get", operationId: OPERATION_ID },
  });
  assert.deepEqual(parseArgv(["x402", "inspect", "--url", "https://seller.example/resource"]), {
    request: { command: "x402.inspect", url: "https://seller.example/resource" },
  });
  assert.deepEqual(parseArgv([
    "x402", "fetch", "prepare", "--profile", "default", "--url", "https://seller.example/resource",
    "--max-amount-atomic", "1250000", "--idempotency-key", "x402-001", "--rpc-url", "https://rpc.example",
  ]), {
    request: {
      command: "x402.fetch.prepare",
      profile: "default",
      url: "https://seller.example/resource",
      maxAmountAtomic: "1250000",
      idempotencyKey: "x402-001",
    },
    rpcUrl: "https://rpc.example",
  });
  assert.deepEqual(parseArgv([
    "x402", "fetch", "approve", "--operation", OPERATION_ID, "--rpc-url", "https://rpc.example",
  ]), {
    request: { command: "x402.fetch.approve", operationId: OPERATION_ID },
    rpcUrl: "https://rpc.example",
  });

  assert.throws(() => parseArgv(["transfer", "prepare"]));
  assert.throws(() => parseArgv(["pay", "transfer", "prepare", "--yes", "true"]));
  assert.throws(() => parseArgv(["x402", "fetch", "approve", "--operation", OPERATION_ID, "--yes", "true"]));
  assert.throws(() => parseArgv(["wallet", "export"]));
});

test("zero-native version command returns one clean apn.cli.v1 result", async () => {
  const result = await runCli(["--version"], {});
  assert.equal(result.version, "apn.cli.v1");
  assert.equal(result.command, "version");
  assert.equal(result.ok, true);
  assert.equal(result.error, null);
  assert.equal(result.operation, null);
  assert.equal(result.receipt, null);
  assert.equal((result.data as Record<string, unknown>).product, "agent-payment-node");
});

test("compiled CLI emits exactly one envelope line and exits from envelope status", () => {
  const entrypoint = resolve("dist-test/src/bin.js");
  const version = spawnSync(process.execPath, [entrypoint, "--version"], { encoding: "utf8" });
  assert.equal(version.status, 0);
  assert.equal(version.stderr, "");
  const versionLines = version.stdout.trimEnd().split("\n");
  assert.equal(versionLines.length, 1);
  assert.equal((JSON.parse(versionLines[0] ?? "null") as { readonly version?: unknown }).version, "apn.cli.v1");

  const invalid = spawnSync(process.execPath, [entrypoint, "wallet", "export"], { encoding: "utf8" });
  assert.equal(invalid.status, 1);
  assert.equal(invalid.stderr, "");
  const invalidLines = invalid.stdout.trimEnd().split("\n");
  assert.equal(invalidLines.length, 1);
  assert.equal((JSON.parse(invalidLines[0] ?? "null") as { readonly error?: { readonly code?: unknown } }).error?.code, "APN_UNSUPPORTED_COMMAND");

  const invalidX402 = spawnSync(process.execPath, [entrypoint, "x402", "fetch", "prepare"], { encoding: "utf8" });
  assert.equal(invalidX402.status, 1);
  assert.equal(invalidX402.stderr, "");
  const invalidX402Lines = invalidX402.stdout.trimEnd().split("\n");
  assert.equal(invalidX402Lines.length, 1);
  const invalidX402Envelope = JSON.parse(invalidX402Lines[0] ?? "null") as Record<string, unknown>;
  assert.deepEqual(Object.keys(invalidX402Envelope), [
    "version", "request_id", "command", "ok", "proof_class", "data", "operation", "receipt", "error", "next_actions",
  ]);
  assert.equal((invalidX402Envelope.error as { readonly code?: unknown } | null)?.code, "APN_INVALID_INPUT");
});

test("state root uses effective-user OS home and ignores caller HOME", () => {
  const original = process.env.HOME;
  process.env.HOME = "/tmp/caller-controlled-home";
  try {
    assert.equal(effectiveStateRoot(), resolve(userInfo().homedir, ".apn"));
    assert.equal(effectiveStateRoot().startsWith("/tmp/caller-controlled-home"), false);
  } finally {
    if (original === undefined) delete process.env.HOME;
    else process.env.HOME = original;
  }
});

test("shipping RPC accepts only credential-free public HTTPS and redacts path/query provenance", () => {
  for (const endpoint of [
    "http://rpc.example",
    "https://user:secret@rpc.example",
    "https://rpc.example/path#fragment",
    "https://0.0.0.0",
    "https://127.0.0.1",
    "https://10.0.0.1",
    "https://169.254.1.1",
    "https://172.16.0.1",
    "https://192.168.0.1",
    "https://224.0.0.1",
    "https://[::]",
    "https://[::1]",
    "https://[fe80::1]",
    "https://[fc00::1]",
    "https://[ff02::1]",
  ]) assert.throws(() => new HttpsBaseRpc(endpoint), ApnError, endpoint);

  for (const address of ["0.0.0.0", "127.0.0.1", "10.0.0.1", "169.254.1.1", "192.168.0.1", "::", "::1", "fe80::1", "fc00::1", "ff02::1"] as const) {
    assert.equal(isPublicIp(address), false, address);
  }
  assert.equal(isPublicIp("1.1.1.1"), true);
  assert.equal(isPublicIp("2606:4700:4700::1111"), true);
  assert.equal(new HttpsBaseRpc("https://rpc.example/secret/path?api_key=CANARY").rpcOrigin, "https://rpc.example");
});

test("shipping balance RPC decodes ERC-20 balanceOf as 32-byte ABI data", async () => {
  const rpc = new HttpsBaseRpc("https://rpc.example");
  const calls: [string, readonly unknown[]][] = [];
  (rpc as unknown as { call(method: string, params: readonly unknown[]): Promise<unknown> }).call = async (method, params) => {
    calls.push([method, params]);
    if (method === "eth_chainId") return "0x2105";
    if (method === "eth_getBlockByNumber") return { number: "0x1", hash: `0x${"1".repeat(64)}` };
    if (method === "eth_getBalance") return "0x0";
    if (method === "eth_call") return `0x${"0".repeat(64)}`;
    throw new Error(`unexpected RPC method ${method}`);
  };

  const address = "0x1111111111111111111111111111111111111111";
  const snapshot = await rpc.getBalances(address);
  assert.equal(snapshot.ethAtomic, "0");
  assert.equal(snapshot.usdcAtomic, "0");
  assert.equal(snapshot.blockNumberAtomic, "1");
  assert.deepEqual(calls.map(([method]) => method), [
    "eth_chainId", "eth_getBlockByNumber", "eth_getBalance", "eth_call",
  ]);
  assert.equal(calls[2]?.[1][1], "0x1");
  assert.equal(calls[3]?.[1][1], "0x1");
});
