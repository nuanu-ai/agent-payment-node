import assert from "node:assert/strict";
import test from "node:test";
import { keccak256 } from "viem";
import type { GaslessTransport } from "../../src/gasless/https.js";
import { sha256 } from "../../src/canonical.js";
import type { Hex } from "../../src/model.js";
import { readCurrentAllowance, readCurrentNonce } from "../../src/smart-account-gasless/chain/allowance.js";
import { initialSmartAccountGaslessCursor } from "../../src/smart-account-gasless/chain/scan.js";
import { captureSmartAccountGaslessSnapshot, recheckSmartAccountPreparation } from
  "../../src/smart-account-gasless/chain/snapshot.js";
import { SmartAccountGaslessRpc, smartAccountGaslessRpcFactory,
  type SmartAccountGaslessRpcPacing } from "../../src/smart-account-gasless/chain/rpc.js";
import { SA_PROTOCOL_NAMES } from "../../src/smart-account-gasless/model.js";
import { saRegistry } from "../../src/smart-account-gasless/registry.js";
import { SA_TEST_AT, saTestIntent } from "./smart-account-gasless-fixtures.js";
import { SA_RUNTIME_CODES, SA_RUNTIME_EVIDENCE_SHA256, saRawBlock, saRedemptionFixture, saTestBlock, saWord, type Json } from
  "./smart-account-gasless-chain-fixtures.js";

const RPC_URL = "https://rpc.example/private-path";
const clock = { now: () => new Date(SA_TEST_AT) };
const rejected = { message: /Smart Account gasless operation could not advance safely/u };

function pacingTimeline(minimumIntervalMs = 1_000) {
  let now = 0; const sleeps: number[] = [];
  const pacing: SmartAccountGaslessRpcPacing = { minimumIntervalMs, monotonicNow: () => now,
    sleep: async milliseconds => { sleeps.push(milliseconds); now += milliseconds; } };
  return { pacing, sleeps, now: () => now };
}
const fastPacing = (): SmartAccountGaslessRpcPacing => ({ minimumIntervalMs: 0,
  monotonicNow: () => 0, sleep: async () => {} });

class ReplyTransport implements GaslessTransport {
  readonly calls: Json[] = [];
  constructor(private readonly reply: (request: Json, call: number) => unknown) {}
  async request(endpoint: string, method: "POST" | "GET", body: string | null, maximum: number,
    code: "APN_RPC_CONFIG" | "APN_HTTP_CONFIG") {
    assert.equal(endpoint, RPC_URL); assert.equal(method, "POST"); assert.equal(maximum, 4 * 1024 * 1024);
    assert.equal(code, "APN_RPC_CONFIG");
    const request = JSON.parse(body!) as Json; this.calls.push(request);
    const response = this.reply(request, this.calls.length);
    if (typeof response === "object" && response !== null && ("jsonrpc" in response || "status" in response)) {
      if ("status" in response) return response as { status: number; body: string };
      return { status: 200, body: JSON.stringify(response) };
    }
    return { status: 200, body: JSON.stringify({ jsonrpc: "2.0", id: request.id, result: response }) };
  }
}

function unspentRpc(spent: bigint, reorg = false) {
  const fixture = saRedemptionFixture(), safe = saTestBlock(50_000_020n);
  const transport = new ReplyTransport(request => {
    if (request.method === "eth_chainId") return "0x2105";
    if (request.method === "eth_call") {
      assert.equal(request.params[1], "0x2faf094");
      assert.equal(request.params[0].to, saRegistry(8453).protocol.amount.address);
      assert.match(request.params[0].data, /^0x9dd5d9ab/u);
      return saWord(spent);
    }
    if (request.method === "eth_getBlockByNumber") {
      const block = reorg ? { ...safe, hash: saWord(500n) } : safe;
      return saRawBlock(block);
    }
    throw new Error(`unexpected ${request.method}`);
  });
  return { fixture, safe, transport, rpc: new SmartAccountGaslessRpc({ chainId: 8453, rpcUrl: RPC_URL,
    clock, validator: fixture.validator, transport, pacing: fastPacing() }) };
}

test("Smart Account RPC binds the full endpoint and performs a numeric-block unspent guard", async () => {
  const { fixture, safe, rpc, transport } = unspentRpc(0n);
  assert.equal(rpc.endpointOrigin, "https://rpc.example"); assert.equal(rpc.endpointHash, sha256(RPC_URL));
  await rpc.assertUnspent({ binding: fixture.intent.binding, material: fixture.material, safeBlock: safe });
  assert.deepEqual(transport.calls.map(call => call.method), ["eth_chainId", "eth_call", "eth_getBlockByNumber"]);
  assert.ok(transport.calls.every(call => call.jsonrpc === "2.0" && typeof call.id === "string"));
});

test("later snapshots re-read the immutable numeric preparation anchor against current latest", async () => {
  const expected = saTestBlock(50_000_000n), current = saTestBlock(50_000_010n), calls: unknown[][] = [];
  await recheckSmartAccountPreparation(async (method, params) => {
    assert.equal(method, "eth_getBlockByNumber"); calls.push([...params]); return saRawBlock(expected);
  }, expected, current);
  assert.deepEqual(calls, [["0x2faf080", false]]);
  await assert.rejects(recheckSmartAccountPreparation(async () => saRawBlock({ ...expected, hash: saWord(999n) }),
    expected, current), rejected);
  await assert.rejects(recheckSmartAccountPreparation(async () => saRawBlock(expected), current, expected), rejected);
});

test("snapshot accepts every exact runtime preimage and canonical safe-state ABI read", async () => {
  const intent = saTestIntent(), registry = saRegistry(8453), preparation = intent.initialSnapshot.preparationBlock,
    safe = intent.initialSnapshot.safeBlock;
  assert.equal(SA_RUNTIME_EVIDENCE_SHA256, "dede9d085919f4d1c8bc39c9d730e8f602be44c34d4a75f1071762bfc848cbb5");
  for (const [address, code] of Object.entries(SA_RUNTIME_CODES)) {
    const protocol = Object.values(registry.protocol).find(pin => pin.address === address);
    const expected = protocol?.codeHash ?? (address === registry.token.address ? registry.token.proxyCodeHash :
      registry.token.implementationCodeHash);
    assert.equal(keccak256(code), expected, address);
  }
  const transport = new ReplyTransport(request => {
    if (request.method === "eth_chainId") return "0x2105";
    if (request.method === "eth_getBlockByNumber") {
      const tag = request.params[0] as string;
      return saRawBlock(tag === "latest" || (tag !== "safe" && BigInt(tag) === BigInt(preparation.numberAtomic))
        ? preparation : safe);
    }
    if (request.method === "eth_getCode") {
      const address = String(request.params[0]).toLowerCase();
      if (address === intent.binding.ownerAddress) return registry.ownerDesignationCode;
      if (address === intent.binding.sessionAddress) return "0x";
      const code = (SA_RUNTIME_CODES as Readonly<Record<string, Hex>>)[address];
      if (code === undefined) throw new Error(`missing code ${address}`); return code;
    }
    if (request.method === "eth_getStorageAt") return saWord(BigInt(registry.token.implementationAddress));
    if (request.method === "eth_getBalance") return "0x0";
    if (request.method === "eth_call") {
      const selector = String(request.params[0].data).slice(0, 10);
      if (selector === "0x313ce567") return saWord(6n);
      if (selector === "0x3644e515") return registry.token.domainSeparator;
      if (selector === "0x70a08231") return saWord(2_000_000n);
      if (selector === "0x6a9843f6") return `${saWord(1_000_000n)}${saWord(1n).slice(2)}${saWord(1n).slice(2)}`;
      if (selector === "0x2bd4ed21") return saWord(0n);
    }
    throw new Error(`unexpected ${request.method}`);
  });
  const timeline = pacingTimeline();
  const rpc = new SmartAccountGaslessRpc({ chainId: 8453, rpcUrl: RPC_URL, clock,
    validator: saRedemptionFixture().validator, transport, pacing: timeline.pacing });
  const snapshot = await rpc.snapshot(intent.binding, preparation);
  assert.equal(snapshot.safeState.availableAtomic, "1000000"); assert.equal(snapshot.safeState.currentNonceAtomic, "0");
  assert.equal(snapshot.safeState.ownerCodeHash, registry.ownerDesignationCodeHash);
  assert.ok(transport.calls.length <= 64);
  assert.equal(transport.calls.length, 27);
  assert.equal(timeline.now(), 26_000);
  assert.ok(transport.calls.filter(call => ["eth_getCode", "eth_getStorageAt", "eth_call", "eth_getBalance"]
    .includes(call.method)).every(call => call.params.at(-1) === "0x2faf06c"));
});

test("Smart Account RPC serializes concurrent starts with one-second spacing", async () => {
  const fixture = saRedemptionFixture(), timeline = pacingTimeline(), starts: number[] = [];
  let active = 0, maximumActive = 0;
  const transport: GaslessTransport = { request: async (_endpoint, _method, body) => {
    starts.push(timeline.now()); active++; maximumActive = Math.max(maximumActive, active);
    await Promise.resolve(); active--;
    const request = JSON.parse(body!) as Json;
    return { status: 200, body: JSON.stringify({ jsonrpc: "2.0", id: request.id, result: "0x2105" }) };
  } };
  const rpc = new SmartAccountGaslessRpc({ chainId: 8453, rpcUrl: RPC_URL, clock,
    validator: fixture.validator, transport, pacing: timeline.pacing });
  const pass = (rpc as unknown as { pass(): (method: "eth_chainId", params: readonly unknown[]) => Promise<unknown> }).pass();
  assert.deepEqual(await Promise.all([pass("eth_chainId", []), pass("eth_chainId", []), pass("eth_chainId", [])]),
    ["0x2105", "0x2105", "0x2105"]);
  assert.deepEqual(starts, [0, 1_000, 2_000]);
  assert.deepEqual(timeline.sleeps, [1_000, 1_000]);
  assert.equal(maximumActive, 1);
});

test("one failed pass cancels its queued starts without retry and does not poison a later pass", async () => {
  const fixture = saRedemptionFixture(), timeline = pacingTimeline(), starts: number[] = [];
  const transport = new ReplyTransport((request, call) => {
    starts.push(timeline.now());
    if (call === 1) return { status: 429, body: "rate limited" };
    return { jsonrpc: "2.0", id: request.id, result: "0x2105" };
  });
  const rpc = new SmartAccountGaslessRpc({ chainId: 8453, rpcUrl: RPC_URL, clock,
    validator: fixture.validator, transport, pacing: timeline.pacing });
  const first = (rpc as unknown as { pass(): (method: "eth_chainId", params: readonly unknown[]) => Promise<unknown> }).pass();
  const failed = await Promise.allSettled([first("eth_chainId", []), first("eth_chainId", [])]);
  assert.deepEqual(failed.map(result => result.status), ["rejected", "rejected"]);
  assert.equal(transport.calls.length, 1);
  const second = (rpc as unknown as { pass(): (method: "eth_chainId", params: readonly unknown[]) => Promise<unknown> }).pass();
  assert.equal(await second("eth_chainId", []), "0x2105");
  assert.equal(transport.calls.length, 2);
  assert.deepEqual(starts, [0, 1_000]);
});

test("bounded log-range reduction remains usable after a range rejection", async () => {
  const fixture = saRedemptionFixture(), timeline = pacingTimeline();
  const transport = new ReplyTransport((_request, call) => call === 1 ? { status: 429, body: "range rejected" } : "0x2105");
  const rpc = new SmartAccountGaslessRpc({ chainId: 8453, rpcUrl: RPC_URL, clock,
    validator: fixture.validator, transport, pacing: timeline.pacing });
  const pass = (rpc as unknown as { pass(): (method: "eth_getLogs" | "eth_chainId",
    params: readonly unknown[]) => Promise<unknown> }).pass();
  await assert.rejects(pass("eth_getLogs", [{}]));
  assert.equal(await pass("eth_chainId", []), "0x2105");
  assert.equal(transport.calls.length, 2); assert.equal(timeline.now(), 1_000);
});

test("Smart Account RPC rechecks the pass deadline at actual transport start", async () => {
  const fixture = saRedemptionFixture(), timeline = pacingTimeline(45_000);
  const transport = new ReplyTransport(() => "0x2105");
  const rpc = new SmartAccountGaslessRpc({ chainId: 8453, rpcUrl: RPC_URL, clock,
    validator: fixture.validator, transport, pacing: timeline.pacing });
  const pass = (rpc as unknown as { pass(): (method: "eth_chainId", params: readonly unknown[]) => Promise<unknown> }).pass();
  const results = await Promise.allSettled([pass("eth_chainId", []), pass("eth_chainId", [])]);
  assert.equal(results[0]?.status, "fulfilled"); assert.equal(results[1]?.status, "rejected");
  assert.equal(transport.calls.length, 1); assert.equal(timeline.now(), 45_000);
});

test("observation returns its unchanged cursor when spacing exhausts the pass budget", async () => {
  const fixture = saRedemptionFixture(), timeline = pacingTimeline(45_000);
  const intent = { ...fixture.intent, initialSnapshot: { ...fixture.intent.initialSnapshot,
    endpointOrigin: "https://rpc.example", endpointHash: sha256(RPC_URL) } };
  const transport = new ReplyTransport(() => "0x2105");
  const rpc = new SmartAccountGaslessRpc({ chainId: 8453, rpcUrl: RPC_URL, clock,
    validator: fixture.validator, transport, pacing: timeline.pacing });
  const cursor = initialSmartAccountGaslessCursor(intent);
  const result = await rpc.observe({ operationId: "sa-paced-observe", fingerprint: "6".repeat(64), intent,
    material: fixture.material, cursor, transactionHint: null });
  assert.deepEqual(result.cursor, cursor); assert.equal(result.observation.phase, "pending");
  assert.equal(result.observation.reason, "sa_gasless_partial"); assert.equal(result.settlement, null);
  assert.equal(result.unusedProof, null); assert.equal(transport.calls.length, 1);
});

test("Smart Account unspent guard rejects nonzero spend, changed anchor and changed material identity", async () => {
  for (const setup of [unspentRpc(1n), unspentRpc(0n, true)]) {
    await assert.rejects(setup.rpc.assertUnspent({ binding: setup.fixture.intent.binding,
      material: setup.fixture.material, safeBlock: setup.safe }), rejected);
  }
  const setup = unspentRpc(0n);
  await assert.rejects(setup.rpc.assertUnspent({ binding: setup.fixture.intent.binding,
    material: { ...setup.fixture.material, childDelegationHash: "0x1234" as Hex }, safeBlock: setup.safe }), rejected);
});

test("Smart Account RPC rejects noncanonical JSON-RPC envelopes and enforces its pass call budget", async () => {
  const fixture = saRedemptionFixture(), badTransport = new ReplyTransport(request => ({ jsonrpc: "2.0",
    id: request.id, result: "0x2105", error: { code: -1 } }));
  const bad = new SmartAccountGaslessRpc({ chainId: 8453, rpcUrl: RPC_URL, clock,
    validator: fixture.validator, transport: badTransport, pacing: fastPacing() });
  await assert.rejects(bad.assertUnspent({ binding: fixture.intent.binding, material: fixture.material,
    safeBlock: saTestBlock(50_000_020n) }), rejected);

  let monotonic = 0;
  const expired = new SmartAccountGaslessRpc({ chainId: 8453, rpcUrl: RPC_URL, clock,
    validator: fixture.validator, transport: new ReplyTransport(() => "0x2105"),
    pacing: { minimumIntervalMs: 0, monotonicNow: () => { monotonic += 45_000; return monotonic; },
      sleep: async () => {} } });
  await assert.rejects(expired.assertUnspent({ binding: fixture.intent.binding, material: fixture.material,
    safeBlock: saTestBlock(50_000_020n) }));
});

test("Smart Account RPC rejects duplicate JSON-RPC member names before accepting evidence", async () => {
  const fixture = saRedemptionFixture();
  for (const duplicate of [
    (id: string) => `{"jsonrpc":"2.0","id":"${id}","id":"${id}","result":"0x2105"}`,
    (id: string) => `{"jsonrpc":"2.0","id":"${id}","result":"0x2105","result":"0x2105"}`,
  ]) {
    const transport = new ReplyTransport(request => ({ status: 200, body: duplicate(String(request.id)) }));
    const rpc = new SmartAccountGaslessRpc({ chainId: 8453, rpcUrl: RPC_URL, clock,
      validator: fixture.validator, transport, pacing: fastPacing() });
    await assert.rejects(rpc.assertUnspent({ binding: fixture.intent.binding, material: fixture.material,
      safeBlock: saTestBlock(50_000_020n) }), rejected);
    assert.equal(transport.calls.length, 1);
  }
});

test("allowance and nonce reads use the same numeric block, exact selectors and strict return words", async () => {
  const intent = saTestIntent(), block = intent.initialSnapshot.safeBlock, calls: Array<[string, readonly unknown[]]> = [];
  const call = async (method: any, params: readonly unknown[]) => {
    calls.push([method, params]); const data = String((params[0] as Json).data);
    if (data.startsWith("0x6a9843f6")) return `${saWord(20_000n)}${saWord(1n).slice(2)}${saWord(9n).slice(2)}`;
    if (data.startsWith("0x2bd4ed21")) return saWord(0n);
    throw new Error("unexpected call");
  };
  const allowance = await readCurrentAllowance(call, intent.binding, block);
  assert.deepEqual(allowance, { availableAtomic: "20000", isNewPeriod: true, currentPeriodAtomic: "9" });
  assert.equal(await readCurrentNonce(call, intent.binding, block), "0");
  assert.ok(calls.every(([, params]) => params[1] === "0x2faf06c"));
  const bad = async () => `${saWord(20_000n)}${saWord(2n).slice(2)}${saWord(9n).slice(2)}`;
  await assert.rejects(readCurrentAllowance(bad, intent.binding, block), rejected);
  await assert.rejects(readCurrentNonce(async () => "0x00", intent.binding, block), rejected);
});

test("snapshot attempts all nine runtime pins at its captured numeric safe block and rejects mutation", async () => {
  const intent = saTestIntent(), safe = intent.initialSnapshot.safeBlock,
    latest = intent.initialSnapshot.preparationBlock, calls: Array<[string, readonly unknown[]]> = [];
  const call = async (method: any, params: readonly unknown[]) => {
    calls.push([method, params]);
    if (method === "eth_getBlockByNumber") return saRawBlock(params[0] === "latest" ? latest : safe);
    if (method === "eth_getCode") return "0x6000";
    if (method === "eth_getStorageAt") return saWord(BigInt(saRegistry(8453).token.implementationAddress));
    if (method === "eth_getBalance") return "0x0";
    if (method === "eth_call") return saWord(0n);
    throw new Error(`unexpected ${method}`);
  };
  await assert.rejects(captureSmartAccountGaslessSnapshot(call, 8453, "https://rpc.example",
    sha256(RPC_URL), clock, intent.binding), rejected);
  const pins = calls.filter(([method]) => method === "eth_getCode").map(([, params]) => params[0]);
  for (const name of SA_PROTOCOL_NAMES) assert.ok(pins.includes(saRegistry(8453).protocol[name].address));
  assert.ok(calls.filter(([method]) => ["eth_getCode", "eth_getStorageAt", "eth_call", "eth_getBalance"].includes(method))
    .every(([, params]) => params.at(-1) === "0x2faf06c"));
});

test("Smart Account RPC factory is lazy, cached and closed to non-Base chains", () => {
  const fixture = saRedemptionFixture(), factory = smartAccountGaslessRpcFactory({ APN_BASE_RPC_URL: RPC_URL },
    clock, fixture.validator, new ReplyTransport(() => "0x2105"));
  assert.equal(factory(8453), factory(8453));
  assert.throws(() => (factory as (chainId: number) => unknown)(1), rejected);
});
