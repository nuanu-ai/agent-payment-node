import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { keccak256 } from "viem";
import { hashObject, sha256 } from "../../src/canonical.js";
import type { GaslessTransport } from "../../src/gasless/https.js";
import type { Address, Hex } from "../../src/model.js";
import { addressWord, MM_INCREASED_COUNT_TOPIC, MM_TRANSFER_TOPIC } from
  "../../src/metamask-gasless/chain/abi.js";
import { MetaMaskGaslessRpc, metaMaskGaslessRpcFactory } from "../../src/metamask-gasless/chain/rpc.js";
import { validateMetaMaskGaslessSnapshot } from "../../src/metamask-gasless/chain/snapshot.js";
import { mmQuoteHash } from "../../src/metamask-gasless/economics.js";
import { mmWalletIdentityHash } from "../../src/metamask-gasless/identity.js";
import { MM_CHAINS, type MetaMaskGaslessChainId, type MetaMaskGaslessChainState,
  type MetaMaskGaslessIntent } from "../../src/metamask-gasless/model.js";
import { MM_RPC_ENV, mmRegistry } from "../../src/metamask-gasless/registry.js";

type Json = Record<string, any>;
const RUNTIME_PATH = "tests/core/metamask-gasless-chain-fixtures/runtime-code.json";
const VECTOR_PATH = "tests/core/metamask-gasless-chain-fixtures/base-signed-vector.json";
const runtimeText = readFileSync(RUNTIME_PATH, "utf8"), runtime = JSON.parse(runtimeText) as Json;
const vector = JSON.parse(readFileSync(VECTOR_PATH, "utf8")) as Json;
const RPC_URL = "https://rpc.example/private-path";
const now = { now: () => new Date("2026-09-09T00:01:00.000Z") };
const quantity = (value: bigint | number): Hex => `0x${BigInt(value).toString(16)}`;
const word = (value: bigint): Hex => `0x${value.toString(16).padStart(64, "0")}`;
const blockHash = (chainId: number, number: bigint): Hex => `0x${sha256(`mm-rpc-${chainId}-${number}`)}`;

interface FakeOptions {
  readonly finality?: bigint;
  readonly head?: bigint;
  readonly counter?: (blockNumber: bigint) => bigint;
  readonly corruptProtocol?: boolean;
  readonly transaction?: Json;
  readonly receipt?: Json;
  readonly scanLogs?: readonly Json[];
  /** Refuses one eth_getLogs range: an HTTP status, or a JSON-RPC error inside a 200 response. */
  readonly refuseLogs?: (from: bigint, to: bigint) => { readonly status?: number; readonly error?: Json } | undefined;
  readonly reorgBlock?: bigint;
  readonly ownerCode?: "pinned" | "empty" | "foreign";
}

class FakeRpcTransport implements GaslessTransport {
  readonly calls: Array<{ readonly method: string; readonly params: readonly unknown[] }> = [];
  readonly chainId: MetaMaskGaslessChainId;
  private readonly deployment;
  private readonly codes: Json;
  private readonly served = new Map<string, bigint>();
  constructor(chainId: MetaMaskGaslessChainId, private readonly options: FakeOptions = {}) {
    this.chainId = chainId; this.deployment = mmRegistry(chainId).row;
    const refs = runtime.rows.find((item: Json) => item.chainId === chainId) as Json;
    assert.ok(refs); this.codes = { protocol: Object.fromEntries(Object.entries(refs.protocol)
      .map(([name, ref]) => [name, runtime.codes[String(ref)]])),
    tokenProxyCode: runtime.codes[refs.tokenProxyCode], tokenImplementationCode: runtime.codes[refs.tokenImplementationCode] };
  }
  async request(endpoint: string, method: "POST" | "GET", body: string | null, maxBytes: number,
    code: "APN_RPC_CONFIG" | "APN_HTTP_CONFIG") {
    assert.equal(endpoint, RPC_URL); assert.equal(method, "POST"); assert.notEqual(body, null);
    assert.equal(maxBytes, 4 * 1024 * 1024); assert.equal(code, "APN_RPC_CONFIG");
    const request = JSON.parse(body!) as Json;
    this.calls.push({ method: request.method, params: request.params });
    if (request.method === "eth_getLogs") {
      const refused = this.options.refuseLogs?.(BigInt(request.params[0].fromBlock), BigInt(request.params[0].toBlock));
      if (refused?.status !== undefined) return { status: refused.status, body: "" };
      if (refused?.error !== undefined) return { status: 200, body: JSON.stringify({ jsonrpc: "2.0", id: request.id, error: refused.error }) };
    }
    const result = this.respond(request.method, request.params);
    return { status: 200, body: JSON.stringify({ jsonrpc: "2.0", id: request.id, result }) };
  }
  private respond(method: string, params: readonly unknown[]): unknown {
    if (method === "eth_chainId") return quantity(this.chainId);
    if (method === "eth_getBlockByNumber") return this.rawBlock(params[0] as string);
    if (method === "eth_getCode") return this.code(params[0] as string, this.blockNumber(params.at(-1)));
    if (method === "eth_getStorageAt") return addressWord(this.deployment.tokenImplementationAddress);
    if (method === "eth_call") {
      const call = params[0] as Json, selector = String(call.data).slice(0, 10);
      if (selector === "0x313ce567") return word(6n);
      if (selector === "0x70a08231") return word(1_000_000n);
      if (call.to.toLowerCase() === this.deployment.protocol.limitedCalls.address) {
        return word(this.options.counter?.(this.blockNumber(params.at(-1))) ?? 0n);
      }
      throw new Error(`unexpected eth_call ${selector}`);
    }
    if (method === "eth_getTransactionByHash") return this.options.transaction ?? null;
    if (method === "eth_getTransactionReceipt") return this.options.receipt ?? null;
    if (method === "eth_getLogs") {
      const filter = params[0] as Json, from = BigInt(filter.fromBlock), to = BigInt(filter.toBlock);
      return (this.options.scanLogs ?? []).filter(log => !this.options.refuseLogs ||
        (BigInt(log.blockNumber) >= from && BigInt(log.blockNumber) <= to));
    }
    throw new Error(`unexpected write or unknown RPC method ${method}`);
  }
  private rawBlock(tag: string): Json {
    const number = tag === "safe" || tag === "finalized" ? (this.options.finality ?? 100n) :
      tag === "latest" ? (this.options.head ?? this.options.finality ?? 101n) : BigInt(tag);
    const hash = this.options.reorgBlock === number ? `0x${"f".repeat(64)}` : blockHash(this.chainId, number);
    this.served.set(hash, number);
    const transactions = this.options.transaction?.blockNumber === quantity(number) ?
      [this.options.transaction.hash] : [];
    return { number: quantity(number), hash, timestamp: quantity(1_788_912_000n + number), transactions };
  }
  /** EIP-1898 pinned reads resolve to the height of a header this fake served; legacy fixed heights stay known. */
  private blockNumber(value: unknown): bigint {
    if (typeof value === "object" && value !== null && "blockHash" in value) {
      const served = this.served.get((value as Json).blockHash);
      if (served !== undefined) return served;
    }
    return blockNumber(value);
  }
  private code(addressInput: string, _blockNumber: bigint): Hex {
    const address = addressInput.toLowerCase(), row = this.deployment;
    for (const [name, pin] of Object.entries(row.protocol)) if (address === pin.address) {
      const code = this.codes.protocol[name] as Hex;
      return this.options.corruptProtocol && name === "manager" ? `${code.slice(0, -2)}00` as Hex : code;
    }
    if (address === row.token) return this.codes.tokenProxyCode as Hex;
    if (address === row.tokenImplementationAddress) return this.codes.tokenImplementationCode as Hex;
    if (address === vector.owner) {
      if (this.options.ownerCode === "empty") return "0x";
      if (this.options.ownerCode === "foreign") return "0x6000";
      return `0xef0100${row.protocol.delegate.address.slice(2)}` as Hex;
    }
    return "0x";
  }
}

test("static runtime fixture drives fixed EIP-1898 snapshots for all eight registry rows", async () => {
  assert.equal(sha256(runtimeText), "f37646220871b16931912855b8e5eb0a6627318378e7c132dabd165815364682");
  for (const chainId of MM_CHAINS) {
    const transport = new FakeRpcTransport(chainId);
    const rpc = new MetaMaskGaslessRpc({ chainId, rpcUrl: RPC_URL, clock: now, transport });
    const snapshot = await rpc.snapshot({ owner: vector.owner, delegationHash: vector.delegationHash,
      grossAtomic: "1000000" });
    assert.equal(snapshot.chainId, chainId); assert.equal(snapshot.safeState.counterAtomic, "0");
    assert.equal(snapshot.headState.designation, "pinned");
    assert.ok(transport.calls.every(call => readMethods.has(call.method)));
    const pinned = transport.calls.filter(call => ["eth_getCode", "eth_getStorageAt", "eth_call"].includes(call.method));
    assert.ok(pinned.every(call => (call.params.at(-1) as Json).requireCanonical === true));
  }
});

test("snapshot shares only an identical safe and head block, retaining distinct pinned reads otherwise", async () => {
  for (const [head, count, stateReads] of [[100n, 15, 11], [101n, 27, 22]] as const) {
    const transport = new FakeRpcTransport(8453, { finality: 100n, head });
    const rpc = new MetaMaskGaslessRpc({ chainId: 8453, rpcUrl: RPC_URL, clock: now, transport });
    const snapshot = await rpc.snapshot({ owner: vector.owner, delegationHash: vector.delegationHash,
      grossAtomic: "1000000" });
    assert.equal(transport.calls.length, count);
    assert.equal(transport.calls.filter(call => ["eth_getCode", "eth_getStorageAt", "eth_call"].includes(call.method)).length,
      stateReads);
    assert.equal(snapshot.safeBlock.hash === snapshot.headBlock.hash, head === 100n);
    assert.equal(snapshot.safeState.counterAtomic, "0");
    assert.equal(snapshot.headState.counterAtomic, "0");
  }
});

test("lazy factory binds exact endpoints and protocol drift fails closed", async () => {
  const environment: Record<string, string> = {};
  for (const chainId of MM_CHAINS) environment[MM_RPC_ENV[chainId]] = RPC_URL;
  const transport = new FakeRpcTransport(8453), factory = metaMaskGaslessRpcFactory(environment, now, transport);
  assert.equal(transport.calls.length, 0); assert.equal(factory(8453), factory(8453));
  assert.equal(factory(8453).endpointHash, sha256(RPC_URL)); assert.equal(factory(8453).endpointOrigin, "https://rpc.example");
  const drift = new MetaMaskGaslessRpc({ chainId: 8453, rpcUrl: RPC_URL, clock: now,
    transport: new FakeRpcTransport(8453, { corruptProtocol: true }) });
  await assert.rejects(drift.snapshot({ owner: vector.owner, delegationHash: vector.delegationHash,
    grossAtomic: "1000000" }), protocolError);
});

test("same-height snapshot blocks must have identical hash and timestamp", () => {
  const snapshot = intent(block(8453, 100n)).initialSnapshot;
  assert.equal(validateMetaMaskGaslessSnapshot(snapshot, { chainId: 8453, endpointHash: sha256(RPC_URL),
    endpointOrigin: "https://rpc.example", grossAtomic: "1000000" }).headBlock.hash, snapshot.safeBlock.hash);
  assert.throws(() => validateMetaMaskGaslessSnapshot({ ...snapshot,
    headBlock: { ...snapshot.headBlock, hash: `0x${"e".repeat(64)}` } }, { chainId: 8453,
    endpointHash: sha256(RPC_URL), endpointOrigin: "https://rpc.example", grossAtomic: "1000000" }), protocolError);
  assert.throws(() => validateMetaMaskGaslessSnapshot({ ...snapshot,
    headBlock: { ...snapshot.headBlock, timestampAtomic: "1788912101" } }, { chainId: 8453,
    endpointHash: sha256(RPC_URL), endpointOrigin: "https://rpc.example", grossAtomic: "1000000" }), protocolError);
});

test("a zero redemption counter at safe moves the cursor to safe without a log query and keeps it on a later reorg", async () => {
  const transport = new FakeRpcTransport(8453, { finality: 2500n, head: 2501n });
  const rpc = new MetaMaskGaslessRpc({ chainId: 8453, rpcUrl: RPC_URL, clock: now, transport });
  const value = intent(block(8453, 100n));
  const initial = { startBlock: value.initialSnapshot.safeBlock, nextBlockAtomic: "100", previousEndBlock: null };
  const first = await rpc.observe(value, initial, null);
  assert.equal(first.observation.phase, "pending"); assert.equal(first.observation.reason, "mm_gasless_pending");
  assert.equal(first.cursor.nextBlockAtomic, "2501"); assert.deepEqual(first.cursor.previousEndBlock, block(8453, 2500n));
  assert.equal(transport.calls.some(call => call.method === "eth_getLogs"), false);
  const counter = transport.calls.find(call => call.method === "eth_call")!;
  const row = mmRegistry(8453).row;
  assert.equal((counter.params[0] as Json).to, row.protocol.limitedCalls.address);
  assert.equal((counter.params[0] as Json).data, `0x19054d89${addressWord(row.protocol.manager.address).slice(2)}${value.delegationHash.slice(2)}`);
  assert.deepEqual(counter.params[1], { blockHash: block(8453, 2500n).hash, requireCanonical: true });
  const code = transport.calls.find(call => call.method === "eth_getCode")!;
  assert.deepEqual(code.params, [row.protocol.limitedCalls.address, { blockHash: block(8453, 2500n).hash, requireCanonical: true }]);
  const reorgRpc = new MetaMaskGaslessRpc({ chainId: 8453, rpcUrl: RPC_URL, clock: now,
    transport: new FakeRpcTransport(8453, { finality: 2600n, reorgBlock: 2500n }) });
  const second = await reorgRpc.observe(value, first.cursor, null);
  assert.equal(second.observation.phase, "reorg"); assert.deepEqual(second.cursor, first.cursor);
  // A rate-limited or range-limited eth_getLogs does not matter while the counter is still zero.
  const limited = new FakeRpcTransport(8453, { finality: 2500n, refuseLogs: () => ({ status: 429 }) });
  const shortcut = await new MetaMaskGaslessRpc({ chainId: 8453, rpcUrl: RPC_URL, clock: now, transport: limited }).observe(value, initial, null);
  assert.equal(shortcut.cursor.nextBlockAtomic, "2501"); assert.equal(limited.calls.some(call => call.method === "eth_getLogs"), false);
});

test("a counter of one scans several bounded windows per resume from the cursor and stops at the budget", async () => {
  const value = intent(block(8453, 100n));
  const cursor = { startBlock: value.initialSnapshot.safeBlock, nextBlockAtomic: "100", previousEndBlock: null };
  const transport = new FakeRpcTransport(8453, { finality: 30_000n, counter: () => 1n });
  const observed = await new MetaMaskGaslessRpc({ chainId: 8453, rpcUrl: RPC_URL, clock: now, transport }).observe(value, cursor, null);
  assert.equal(observed.observation.phase, "pending");
  const filters = transport.calls.filter(call => call.method === "eth_getLogs").map(call => call.params[0] as Json);
  assert.equal(filters.length, 8);
  assert.deepEqual(filters.map(filter => [BigInt(filter.fromBlock), BigInt(filter.toBlock)]),
    Array.from({ length: 8 }, (_, index) => [100n + BigInt(index) * 2000n, 2099n + BigInt(index) * 2000n]));
  assert.equal(observed.cursor.nextBlockAtomic, "16100"); assert.deepEqual(observed.cursor.previousEndBlock, block(8453, 16099n));
  // The next resume continues from the saved cursor and stops at the window that holds the event.
  const event = { ...rawSettlementLogs(value, block(8453, 29_000n))[0]!, blockNumber: quantity(29_000n) };
  const next = new FakeRpcTransport(8453, { finality: 30_000n, counter: () => 1n, scanLogs: [event], refuseLogs: () => undefined });
  const resumed = await new MetaMaskGaslessRpc({ chainId: 8453, rpcUrl: RPC_URL, clock: now, transport: next })
    .observe(value, observed.cursor, null);
  assert.equal(resumed.observation.phase, "pending"); assert.equal(resumed.cursor.nextBlockAtomic, "28100");
  assert.equal(BigInt((next.calls.find(call => call.method === "eth_getLogs")!.params[0] as Json).fromBlock), 16_100n);
});

test("a counter of one with no event anywhere up to finality is contradictory evidence and keeps the cursor", async () => {
  const value = intent(block(8453, 100n));
  const cursor = { startBlock: value.initialSnapshot.safeBlock, nextBlockAtomic: "100", previousEndBlock: null };
  const transport = new FakeRpcTransport(8453, { finality: 3000n, counter: () => 1n });
  const observed = await new MetaMaskGaslessRpc({ chainId: 8453, rpcUrl: RPC_URL, clock: now, transport }).observe(value, cursor, null);
  assert.equal(observed.observation.phase, "invalid"); assert.equal(observed.observation.reason, "mm_gasless_evidence_invalid");
  assert.deepEqual(observed.cursor, cursor);
  for (const counter of [2n]) {
    const over = await new MetaMaskGaslessRpc({ chainId: 8453, rpcUrl: RPC_URL, clock: now,
      transport: new FakeRpcTransport(8453, { finality: 3000n, counter: () => counter }) }).observe(value, cursor, null);
    assert.equal(over.observation.phase, "invalid"); assert.deepEqual(over.cursor, cursor);
  }
});

test("a refused log range is halved within the budget and the redemption window is still found", async () => {
  const value = intent(block(8453, 100n));
  const cursor = { startBlock: value.initialSnapshot.safeBlock, nextBlockAtomic: "100", previousEndBlock: null };
  const event = { ...rawSettlementLogs(value, block(8453, 2500n))[0]!, blockNumber: quantity(2500n) };
  const transport = new FakeRpcTransport(8453, { finality: 3000n, counter: () => 1n, scanLogs: [event],
    refuseLogs: (from, to) => to - from + 1n > 1000n ? { error: { code: -32602,
      message: "Block range too large for public access: maximum 1000 blocks. Try with this block range [0x1, 0x2]" } } : undefined });
  const observed = await new MetaMaskGaslessRpc({ chainId: 8453, rpcUrl: RPC_URL, clock: now, transport }).observe(value, cursor, null);
  const ranges = transport.calls.filter(call => call.method === "eth_getLogs").map(call => {
    const filter = call.params[0] as Json; return [BigInt(filter.fromBlock), BigInt(filter.toBlock)];
  });
  assert.deepEqual(ranges, [[100n, 2099n], [100n, 1099n], [1100n, 2099n], [2100n, 3000n]]);
  assert.equal(observed.observation.phase, "pending");
  assert.equal(observed.cursor.nextBlockAtomic, "2100"); assert.deepEqual(observed.cursor.previousEndBlock, block(8453, 2099n));
  assert.equal(transport.calls.filter(call => call.method === "eth_getTransactionByHash").length, 1);
});

test("log refusals at the narrowest window are classified, bounded and keep only proved progress", async () => {
  const value = intent(block(8453, 100n));
  const cursor = { startBlock: value.initialSnapshot.safeBlock, nextBlockAtomic: "100", previousEndBlock: null };
  const cases = [
    ["mm_gasless_rpc_log_range", () => ({ error: { code: -32005, message: "query returned more than 10000 results" } })],
    ["mm_gasless_rpc_rate_limited", () => ({ status: 429 })],
    ["mm_gasless_rpc_rate_limited", () => ({ error: { code: -32011, message: "request limit reached" } })],
  ] as const;
  for (const [reason, refuse] of cases) {
    const transport = new FakeRpcTransport(8453, { finality: 30_000n, counter: () => 1n, refuseLogs: refuse });
    const observed = await new MetaMaskGaslessRpc({ chainId: 8453, rpcUrl: RPC_URL, clock: now, transport }).observe(value, cursor, null);
    assert.equal(observed.observation.phase, "unavailable", reason); assert.equal(observed.observation.reason, reason);
    assert.deepEqual(observed.cursor, cursor);
    const widths = transport.calls.filter(call => call.method === "eth_getLogs").map(call => {
      const filter = call.params[0] as Json; return BigInt(filter.toBlock) - BigInt(filter.fromBlock) + 1n;
    });
    assert.deepEqual(widths, [2000n, 1000n, 500n, 250n, 125n, 62n]);
  }
  const transient = new FakeRpcTransport(8453, { finality: 30_000n, counter: () => 1n,
    refuseLogs: from => from >= 4100n ? { error: { code: -32000, message: "header not found" } } : undefined });
  const partial = await new MetaMaskGaslessRpc({ chainId: 8453, rpcUrl: RPC_URL, clock: now, transport: transient }).observe(value, cursor, null);
  assert.equal(partial.observation.phase, "unavailable"); assert.equal(partial.observation.reason, "mm_gasless_rpc_unavailable");
  assert.equal(partial.cursor.nextBlockAtomic, "4100"); assert.deepEqual(partial.cursor.previousEndBlock, block(8453, 4099n));
  assert.equal(transient.calls.filter(call => call.method === "eth_getLogs").length, 3);
});

test("scan rejects a provider result from the 2001st block without truncation or cursor advance", async () => {
  const value = intent(block(8453, 100n));
  const cursor = { startBlock: value.initialSnapshot.safeBlock, nextBlockAtomic: "100", previousEndBlock: null };
  const outside = { ...rawSettlementLogs(value, block(8453, 2100n))[0]!, blockNumber: quantity(2100n) };
  const transport = new FakeRpcTransport(8453, { finality: 2500n, scanLogs: [outside], counter: () => 1n });
  const rpc = new MetaMaskGaslessRpc({ chainId: 8453, rpcUrl: RPC_URL, clock: now, transport });
  const denied = await rpc.observe(value, cursor, null);
  assert.equal(denied.observation.phase, "invalid");
  assert.equal(denied.observation.reason, "mm_gasless_evidence_invalid");
  assert.deepEqual(denied.cursor, cursor); assert.equal(denied.settlement, null);
  const filter = transport.calls.find(call => call.method === "eth_getLogs")!.params[0] as Json;
  assert.equal(BigInt(filter.toBlock) - BigInt(filter.fromBlock) + 1n, 2000n);
  assert.equal(transport.calls.some(call => call.method === "eth_getTransactionByHash"), false);
});

test("scan inspects at most eight hashes and denies a ninth before candidate reads", async () => {
  const value = intent(block(8453, 100n));
  const cursor = { startBlock: value.initialSnapshot.safeBlock, nextBlockAtomic: "100", previousEndBlock: null };
  const countLog = rawSettlementLogs(value, block(8453, 101n))[0]!;
  for (const count of [8, 9]) {
    const scanLogs = Array.from({ length: count }, (_, index) => ({ ...countLog,
      logIndex: quantity(index), transactionHash: `0x${sha256(`candidate-${index}`)}` }));
    const transport = new FakeRpcTransport(8453, { finality: 102n, scanLogs, counter: () => 1n });
    const rpc = new MetaMaskGaslessRpc({ chainId: 8453, rpcUrl: RPC_URL, clock: now, transport });
    const denied = await rpc.observe(value, cursor, null);
    assert.equal(denied.observation.phase, "invalid");
    assert.equal(denied.observation.reason, "mm_gasless_evidence_invalid");
    assert.deepEqual(denied.cursor, cursor); assert.equal(denied.settlement, null);
    for (const method of ["eth_getTransactionByHash", "eth_getTransactionReceipt"]) {
      assert.equal(transport.calls.filter(call => call.method === method).length, count === 8 ? 8 : 0);
    }
    assert.ok(transport.calls.every(call => readMethods.has(call.method)));
  }
});

test("complete 512-log receipt validates and its 513th log denies the same scan without advancing", async () => {
  const value = intent(block(8453, 100n)), txBlock = block(8453, 101n);
  const cursor = { startBlock: value.initialSnapshot.safeBlock, nextBlockAtomic: "100", previousEndBlock: null };
  const transaction = { ...vector.type2.raw, blockNumber: "0x65", blockHash: txBlock.hash, transactionIndex: "0x0" };
  for (const hint of [false, true]) for (const count of [512, 513]) {
    const logs = rawSettlementLogs(value, txBlock);
    for (let index = logs.length; index < count; index += 1) logs.push({ ...logs[0], logIndex: quantity(index),
      address: "0x4444444444444444444444444444444444444444", topics: [`0x${sha256("UnrelatedEvent()")}`], data: "0x" });
    const receipt = { transactionHash: vector.type2.hash, blockNumber: "0x65", blockHash: txBlock.hash,
      transactionIndex: "0x0", type: "0x2", from: vector.relayer, to: value.relayTo, status: "0x1", logs };
    const transport = new FakeRpcTransport(8453, { finality: 102n, head: 102n, transaction, receipt,
      scanLogs: hint ? [] : [logs[0]!], counter: number => number >= 101n ? 1n : 0n });
    const rpc = new MetaMaskGaslessRpc({ chainId: 8453, rpcUrl: RPC_URL, clock: now, transport });
    const observed = await rpc.observe(value, cursor, hint ? { observedAt: "2026-09-09T00:00:30.000Z",
      requestIdHash: hashObject({ request: "receipt-boundary" }), status: "confirmed", txHash: vector.type2.hash } : null);
    assert.equal(observed.observation.phase, count === 512 ? "success" : "invalid");
    assert.deepEqual(observed.cursor, cursor, `receipt_logs=${count} provider_hint=${hint}`);
    assert.equal(observed.settlement?.debitAtomic ?? null, count === 512 ? "1000000" : null);
    assert.equal(observed.observation.reason, count === 512 ? "mm_gasless_success" : "mm_gasless_evidence_invalid");
    for (const method of ["eth_getTransactionByHash", "eth_getTransactionReceipt"]) {
      assert.equal(transport.calls.filter(call => call.method === method).length, 1);
    }
    assert.ok(transport.calls.every(call => readMethods.has(call.method)));
  }
});

test("full chain proof wins when provider reports failed", async () => {
  const value = intent(block(8453, 100n));
  const txBlock = block(8453, 101n), finality = block(8453, 102n);
  const transaction = { ...vector.type2.raw, blockNumber: "0x65", blockHash: txBlock.hash, transactionIndex: "0x0" };
  const receipt = { transactionHash: vector.type2.hash, blockNumber: "0x65", blockHash: txBlock.hash,
    transactionIndex: "0x0", type: "0x2", from: vector.relayer, to: value.relayTo, status: "0x1",
    logs: rawSettlementLogs(value, txBlock) };
  const transport = new FakeRpcTransport(8453, { finality: 102n, head: 102n, transaction, receipt,
    counter: number => number >= 101n ? 1n : 0n });
  let tick = 0;
  const advancingClock = { now: () => new Date(Date.parse("2026-09-09T00:01:00.000Z") + tick++ * 1000) };
  const rpc = new MetaMaskGaslessRpc({ chainId: 8453, rpcUrl: RPC_URL, clock: advancingClock, transport });
  const observed = await rpc.observe(value, { startBlock: value.initialSnapshot.safeBlock,
    nextBlockAtomic: "100", previousEndBlock: null }, { observedAt: "2026-09-09T00:00:30.000Z",
    requestIdHash: hashObject({ request: "synthetic" }), status: "failed", txHash: vector.type2.hash });
  assert.equal(observed.observation.phase, "success"); assert.equal(observed.settlement?.debitAtomic, "1000000");
  assert.equal(observed.observation.observedAt, observed.settlement?.observedAt);
  assert.equal(observed.settlement?.outerSender, vector.relayer); assert.deepEqual(observed.settlement?.finalityBlock, finality);
  assert.ok(transport.calls.every(call => readMethods.has(call.method)));
});

test("confirmed provider hash stays private when RPC has no transaction or receipt", async () => {
  const value = intent(block(8453, 100n));
  const rpc = new MetaMaskGaslessRpc({ chainId: 8453, rpcUrl: RPC_URL, clock: now,
    transport: new FakeRpcTransport(8453, { finality: 100n, head: 101n }) });
  const observed = await rpc.observe(value, { startBlock: value.initialSnapshot.safeBlock,
    nextBlockAtomic: "100", previousEndBlock: null }, { observedAt: "2026-09-09T00:00:30.000Z",
    requestIdHash: hashObject({ request: "synthetic" }), status: "confirmed", txHash: vector.type2.hash });
  assert.equal(observed.observation.phase, "pending"); assert.equal(observed.observation.reason, "mm_gasless_pending");
  assert.equal(observed.observation.candidateTxHash, null); assert.equal(observed.settlement, null);
});

test("late type2 redemption uses receipt-block designation instead of frozen prepare designation", async () => {
  const value = intent(block(8453, 100n), "empty"), txBlock = block(8453, 101n);
  const transaction = { ...vector.type2.raw, blockNumber: "0x65", blockHash: txBlock.hash, transactionIndex: "0x0" };
  const receipt = { transactionHash: vector.type2.hash, blockNumber: "0x65", blockHash: txBlock.hash,
    transactionIndex: "0x0", type: "0x2", from: vector.relayer, to: value.relayTo, status: "0x1",
    logs: rawSettlementLogs(value, txBlock) };
  const provider = { observedAt: "2026-09-09T00:00:30.000Z", requestIdHash: hashObject({ request: "late" }),
    status: "confirmed" as const, txHash: vector.type2.hash as Hex };
  const cursor = { startBlock: value.initialSnapshot.safeBlock, nextBlockAtomic: "100", previousEndBlock: null };
  const options = { finality: 102n, head: 102n, transaction, receipt,
    counter: (number: bigint) => number >= 101n ? 1n : 0n };
  const pinned = new MetaMaskGaslessRpc({ chainId: 8453, rpcUrl: RPC_URL, clock: now,
    transport: new FakeRpcTransport(8453, options) });
  assert.equal((await pinned.observe(value, cursor, provider)).observation.phase, "success");
  for (const ownerCode of ["empty", "foreign"] as const) {
    const rejected = new MetaMaskGaslessRpc({ chainId: 8453, rpcUrl: RPC_URL, clock: now,
      transport: new FakeRpcTransport(8453, { ...options, ownerCode }) });
    const observation = await rejected.observe(value, cursor, provider);
    assert.notEqual(observation.observation.phase, "success"); assert.equal(observation.observation.candidateTxHash, null);
  }
  const pending = new MetaMaskGaslessRpc({ chainId: 8453, rpcUrl: RPC_URL, clock: now,
    transport: new FakeRpcTransport(8453, { ...options, finality: 100n, head: 101n }) });
  const beforeFinality = await pending.observe(value, cursor, provider);
  assert.equal(beforeFinality.observation.phase, "pending");
  assert.equal(beforeFinality.observation.candidateTxHash, vector.type2.hash);
});

function intent(start: ReturnType<typeof block>, designation: "empty" | "pinned" = "pinned"): MetaMaskGaslessIntent {
  const deployment = mmRegistry(8453), row = deployment.row;
  const executions = vector.executions as MetaMaskGaslessIntent["quote"]["executions"];
  const quote = { netAtomic: "900000", feeAtomic: "100000", feeRecipient: vector.feeRecipient as Address,
    executions, hash: "" }; quote.hash = mmQuoteHash(quote);
  const state = chainState("0", designation);
  return { profile: "synthetic", request: { chainId: 8453, recipient: vector.recipient,
    grossAtomic: "1000000", maxFeeAtomic: "100000", minReceivedAtomic: "900000" },
    binding: { providerId: "metamask-agent-wallet", address: vector.owner,
      accountBindingHash: "2".repeat(64), capabilityHash: "3".repeat(64), revision: 1,
      projectHash: "4".repeat(64), walletReferenceHash: "5".repeat(64), walletIdHash: mmWalletIdentityHash(vector.owner),
      namespace: "eip155", mode: "server", environment: "prod" }, token: row.token, decimals: 6,
    deploymentEvidenceHash: deployment.deploymentEvidenceHash, initialSnapshot: { chainId: 8453,
      endpointHash: sha256(RPC_URL), endpointOrigin: "https://rpc.example", observedAt: "2026-09-09T00:00:00.000Z",
      safeBlock: start, headBlock: start, safeState: state, headState: state }, quote,
    requestId: "synthetic-request", preparedAt: "2026-09-09T00:00:00.000Z",
    expiresAt: "2026-09-09T00:05:00.000Z", policyHash: "6".repeat(64),
    unsignedDelegation: vector.unsignedDelegation, delegationHash: vector.delegationHash,
    signingDigest: vector.signingDigest, relayTo: row.protocol.manager.address, mode: vector.mode } as MetaMaskGaslessIntent;
}

function chainState(counterAtomic: string, designation: "empty" | "pinned" = "pinned"): MetaMaskGaslessChainState {
  const row = mmRegistry(8453).row, code = designation === "empty" ? "0x" as Hex :
    `0xef0100${row.protocol.delegate.address.slice(2)}` as Hex;
  return { protocolCodeHashes: Object.fromEntries(Object.entries(row.protocol).map(([name, pin]) =>
    [name, pin.codeHash])) as MetaMaskGaslessChainState["protocolCodeHashes"], tokenProxyCodeHash: row.tokenProxyCodeHash,
    tokenImplementationAddress: row.tokenImplementationAddress, tokenImplementationCodeHash: row.tokenImplementationCodeHash,
    tokenDecimals: 6, ownerCodeHash: keccak256(code), designation, usdcBalanceAtomic: "1000000", counterAtomic };
}

function block(chainId: number, number: bigint) {
  return { numberAtomic: number.toString(), hash: blockHash(chainId, number),
    timestampAtomic: (1_788_912_000n + number).toString() };
}

function blockNumber(value: unknown): bigint {
  if (typeof value === "object" && value !== null && "blockHash" in value) {
    for (const number of [100n, 101n, 102n, 2099n, 2500n, 2501n])
      if ((value as Json).blockHash === blockHash(8453, number)) return number;
  }
  return 0n;
}

function rawSettlementLogs(value: MetaMaskGaslessIntent, at: ReturnType<typeof block>): Json[] {
  const row = mmRegistry(8453).row, common = { transactionHash: vector.type2.hash, blockHash: at.hash,
    blockNumber: "0x65", transactionIndex: "0x0", removed: false };
  return [{ ...common, address: row.protocol.limitedCalls.address, logIndex: "0x0",
    topics: [MM_INCREASED_COUNT_TOPIC, addressWord(row.protocol.manager.address), addressWord(vector.relayer),
      value.delegationHash], data: `${word(1n)}${word(1n).slice(2)}` },
  { ...common, address: row.token, logIndex: "0x1",
    topics: [MM_TRANSFER_TOPIC, addressWord(vector.owner), addressWord(vector.recipient)], data: word(900000n) },
  { ...common, address: row.token, logIndex: "0x2",
    topics: [MM_TRANSFER_TOPIC, addressWord(vector.owner), addressWord(vector.feeRecipient)], data: word(100000n) }];
}

const readMethods = new Set(["eth_chainId", "eth_getBlockByNumber", "eth_getCode", "eth_getStorageAt",
  "eth_call", "eth_getTransactionByHash", "eth_getTransactionReceipt", "eth_getLogs"]);
const protocolError = { code: "APN_RPC_PROTOCOL" };


test("closed snapshot diagnostics identify public counter and balance failures without downgrading refusal", () => {
  const original = intent(block(8453, 100n)).initialSnapshot;
  const expected = { chainId: 8453 as const, endpointHash: sha256(RPC_URL), endpointOrigin: "https://rpc.example", grossAtomic: "1000000" };
  for (const [predicate, state] of [["counter", { ...original.safeState, counterAtomic: "1" }],
    ["balance", { ...original.safeState, usdcBalanceAtomic: "999999" }]] as const) {
    assert.throws(() => validateMetaMaskGaslessSnapshot({ ...original, safeState: state }, expected),
      { code: "APN_RPC_PROTOCOL", details: { reason: "mm_gasless_evidence_invalid", evidenceStage: "safe", evidencePredicate: predicate, evidenceMethod: "eth_call" } });
  }
});

test("production snapshot reports SAFE protocol pin mismatch with no endpoint or raw body disclosure", async () => {
  const transport = new FakeRpcTransport(8453, { corruptProtocol: true });
  const rpc = new MetaMaskGaslessRpc({ chainId: 8453, rpcUrl: RPC_URL, clock: now, transport });
  await assert.rejects(rpc.snapshot({ owner: vector.owner, delegationHash: vector.delegationHash, grossAtomic: "1000000" }),
    { code: "APN_RPC_PROTOCOL", details: { reason: "mm_gasless_evidence_invalid", evidenceStage: "safe", evidencePredicate: "protocol_code_pin", evidenceMethod: "eth_getCode" } });
});
