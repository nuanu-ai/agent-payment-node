import assert from "node:assert/strict";
import test from "node:test";
import { hashObject, sha256 } from "../../src/canonical.js";
import type { Address, Hex } from "../../src/model.js";
import { addressWord } from "../../src/metamask-gasless/chain/abi.js";
import { MetaMaskGaslessRpc, metaMaskGaslessRpcFactory } from "../../src/metamask-gasless/chain/rpc.js";
import { validateMetaMaskGaslessSnapshot } from "../../src/metamask-gasless/chain/snapshot.js";
import { MM_CHAINS } from "../../src/metamask-gasless/model.js";
import { MM_RPC_ENV, mmRegistry } from "../../src/metamask-gasless/registry.js";
import { blockHash, block, blockNumber, FakeRpcTransport, intent, now, quantity, rawSettlementLogs, RPC_URL, runtime,
  runtimeText, vector, type Json } from "./metamask-gasless-rpc-fake.js";

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
  // Reads are pinned by block hash with requireCanonical, so no header is rechecked after them (was 15 and 27).
  for (const [head, count, stateReads] of [[100n, 14, 11], [101n, 25, 22]] as const) {
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
  // A range refusal narrows the window; a rate limit stops at once and never re-asks a narrower window.
  const halved = [2000n, 1000n, 500n, 250n, 125n, 62n], once = [2000n];
  const cases = [
    ["mm_gasless_rpc_log_range", () => ({ error: { code: -32005, message: "query returned more than 10000 results" } }), halved],
    ["mm_gasless_rpc_rate_limited", () => ({ status: 429 }), once],
    ["mm_gasless_rpc_rate_limited", () => ({ error: { code: -32011, message: "request limit reached" } }), once],
  ] as const;
  for (const [reason, refuse, expectedWidths] of cases) {
    const transport = new FakeRpcTransport(8453, { finality: 30_000n, counter: () => 1n, refuseLogs: refuse });
    const observed = await new MetaMaskGaslessRpc({ chainId: 8453, rpcUrl: RPC_URL, clock: now, transport }).observe(value, cursor, null);
    assert.equal(observed.observation.phase, "unavailable", reason); assert.equal(observed.observation.reason, reason);
    assert.deepEqual(observed.cursor, cursor);
    const widths = transport.calls.filter(call => call.method === "eth_getLogs").map(call => {
      const filter = call.params[0] as Json; return BigInt(filter.toBlock) - BigInt(filter.fromBlock) + 1n;
    });
    assert.deepEqual(widths, expectedWidths, reason);
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
  const transport = new FakeRpcTransport(8453, options);
  const pinned = new MetaMaskGaslessRpc({ chainId: 8453, rpcUrl: RPC_URL, clock: now, transport });
  assert.equal((await pinned.observe(value, cursor, provider)).observation.phase, "success");
  // The success proof reads no state at the inclusion block (an archive read once the operation is old).
  const pinnedTo = (params: readonly unknown[]) => (params.at(-1) as { blockHash?: string } | null)?.blockHash;
  assert.equal(transport.calls.some(call => ["eth_getCode", "eth_call", "eth_getStorageAt"].includes(call.method) &&
    pinnedTo(call.params) === txBlock.hash), false);
  // Any endpoint of the chain may observe; it proves the frozen safe anchor first.
  const rotatedUrl = "https://rotated.example/other-path";
  const rotated = new MetaMaskGaslessRpc({ chainId: 8453, rpcUrl: rotatedUrl, clock: now,
    transport: new FakeRpcTransport(8453, { ...options, endpoint: rotatedUrl }) });
  assert.equal((await rotated.observe(value, cursor, provider)).observation.phase, "success");
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

test("observation proves a saved operation against its own token, manager, enforcer and code pins (owner rule)", async () => {
  const { mmObservedDeployment } = await import("../../src/metamask-gasless/recorded.js");
  const saved = intent(block(8453, 100n)), today = mmRegistry(8453);
  // A later release moved every pin; the saved operation still names what it was sent with.
  const moved = { deploymentEvidenceHash: "f".repeat(64), row: { ...today.row, token: "0x1111111111111111111111111111111111111111" as Address,
    tokenImplementationCodeHash: `0x${"2".repeat(64)}` as Hex, protocol: {
      manager: { address: "0x3333333333333333333333333333333333333333" as Address, codeHash: `0x${"3".repeat(64)}` as Hex },
      delegate: today.row.protocol.delegate,
      limitedCalls: { address: "0x4444444444444444444444444444444444444444" as Address, codeHash: `0x${"4".repeat(64)}` as Hex },
      exactBatch: { address: "0x5555555555555555555555555555555555555555" as Address, codeHash: `0x${"5".repeat(64)}` as Hex } } } };
  const observed = mmObservedDeployment(saved, moved);
  assert.equal(observed.deploymentEvidenceHash, saved.deploymentEvidenceHash);
  assert.equal(observed.row.token, saved.token); assert.equal(observed.row.protocol.manager.address, saved.relayTo);
  assert.equal(observed.row.protocol.limitedCalls.address, saved.unsignedDelegation.caveats[0].enforcer);
  assert.equal(observed.row.protocol.exactBatch.address, saved.unsignedDelegation.caveats[1].enforcer);
  assert.equal(observed.row.protocol.limitedCalls.codeHash, saved.initialSnapshot.safeState.protocolCodeHashes.limitedCalls);
  assert.equal(observed.row.tokenImplementationCodeHash, saved.initialSnapshot.safeState.tokenImplementationCodeHash);
  assert.equal(observed.row.finalityTag, today.row.finalityTag, "chain facts stay the chain's");
});
