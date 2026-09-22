import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { decodeFunctionData, encodeFunctionResult, keccak256, parseTransaction, type TransactionSerializable } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { canonicalJson, hashObject, sha256 } from "../../src/canonical.js";
import { EvmRpc } from "../../src/evm-rpc.js";
import type { EvmRpcCall } from "../../src/evm-ports.js";
import type { Hex } from "../../src/model.js";
import { BridgeRpc, RpcReadSession, bridgeRpcCall, bridgeRpcFactory, type BridgeRpcRequestTrace } from "../../src/lifi/rpc.js";
import { BASE_FEE_CONTRACT, bridgeActualFees } from "../../src/lifi/rpc-fees.js";
import { evmTransactionSignatureScalar, verifyRpcTransaction } from "../../src/lifi/rpc-transaction.js";
import { verifyBridgeSigned } from "../../src/lifi/transaction.js";
import { BRIDGE_DIAMOND } from "../../src/lifi/validation.js";
import type { BridgeEnvelope } from "../../src/lifi/model.js";
import { BRIDGE_ASSET_REGISTRY } from "../../src/lifi/asset-registry.js";
import { bridgeDeployment } from "../../src/lifi/deployments.js";
import { BridgeObservation } from "../../src/lifi/observation.js";
import type { BridgeOperationRecord } from "../../src/lifi/operation-model.js";
import { MULTICALL3_ABI } from "../../src/portfolio/evm-reader.js";
import { MULTICALL3_ADDRESS } from "../../src/portfolio/registry.js";
import { LIFI_RECIPIENT, LIFI_SYNTHETIC_KEY, LIFI_SYNTHETIC_SENDER, lifiFixture } from "./lifi-helpers.js";
import { temporaryState } from "./helpers.js";

type Json = Record<string, any>;
const word = (n: bigint): Hex => `0x${n.toString(16).padStart(64, "0")}`, quantity = (n: bigint | number) => `0x${n.toString(16)}`;
const TYPES = ["legacy", "eip2930", "eip1559", "eip4844", "eip7702"] as const;
async function signedRpcTransaction(index = 2, nonce = 7, chainId = 1) {
  const type = TYPES[index]!, account = privateKeyToAccount(LIFI_SYNTHETIC_KEY);
  const common = { chainId, to: BRIDGE_DIAMOND, nonce, gas: 400000n, value: 0n, data: "0x12345678" as Hex };
  const fees = { maxFeePerGas: 2000000000n, maxPriorityFeePerGas: 0n };
  let transaction: TransactionSerializable;
  if (type === "legacy") transaction = { ...common, type, gasPrice: 2000000000n };
  else if (type === "eip2930") transaction = { ...common, type, gasPrice: 2000000000n, accessList: [{ address: LIFI_RECIPIENT, storageKeys: [word(5n) as Hex] }] };
  else if (type === "eip1559") transaction = { ...common, ...fees, type, accessList: [] };
  else if (type === "eip4844") transaction = { ...common, ...fees, type, maxFeePerBlobGas: 100n, blobVersionedHashes: [`0x01${"67".repeat(31)}`], accessList: [] };
  else transaction = { ...common, ...fees, type, accessList: [], authorizationList: [await account.signAuthorization({ chainId: 1, contractAddress: LIFI_RECIPIENT, nonce: 0 })] };
  const raw = await account.signTransaction(transaction), parsed = parseTransaction(raw) as Json, hash = keccak256(raw);
  const rpc: Json = { hash, chainId: quantity(chainId), type: quantity(index), nonce: quantity(nonce), from: account.address, to: common.to,
    gas: quantity(common.gas), value: "0x0", input: common.data, r: parsed.r, s: parsed.s, v: quantity(parsed.v ?? BigInt(parsed.yParity)),
    ...(index === 0 ? {} : { yParity: quantity(parsed.yParity), accessList: parsed.accessList ?? [] }),
    ...(index < 2 ? { gasPrice: "0x77359400" } : { maxFeePerGas: "0x77359400", maxPriorityFeePerGas: "0x0" }),
    ...(index === 3 ? { maxFeePerBlobGas: "0x64", blobVersionedHashes: parsed.blobVersionedHashes } : {}),
    ...(index === 4 ? { authorizationList: parsed.authorizationList.map((a: Json) => ({ ...a, chainId: quantity(a.chainId), nonce: quantity(a.nonce ?? 0), yParity: quantity(a.yParity) })) } : {}) };
  return { raw, hash, rpc };
}

for (let type = 0; type < TYPES.length; type++) test(`LI.FI RPC reconstructs and verifies destination ${TYPES[type]} signature and hash`, async () => {
  const s = await signedRpcTransaction(type);
  const verified = await verifyRpcTransaction(s.rpc, 1, s.hash); assert.equal(verified.from, LIFI_SYNTHETIC_SENDER);
  assert.equal(verified.dataHash, sha256(Buffer.from("12345678", "hex")));
  for (const mutation of [{ from: LIFI_RECIPIENT }, { input: "0x12345679" }, { chainId: "0x2105" }, { value: "0x1" }, { gas: "0x61a81" }, { r: word(0n) }]) {
    await assert.rejects(verifyRpcTransaction({ ...s.rpc, ...mutation }, 1, s.hash), { code: "APN_RPC_PROTOCOL" });
  }
});

test("LI.FI RPC normalizes the live-shaped 63-nibble Linea signature scalar only", () => {
  assert.equal(
    evmTransactionSignatureScalar("0xa14cfaff82b616ed2005432c18914f1eb8992902de9c8282859eb186c9413aa"),
    "0x0a14cfaff82b616ed2005432c18914f1eb8992902de9c8282859eb186c9413aa",
  );
  const canonical = `0x${"12".repeat(32)}`;
  assert.equal(evmTransactionSignatureScalar(canonical), canonical);
  const order = "fffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141";
  for (const invalid of [undefined, "", "0x", "0x0", "0x00", "0xg", `0x${"1".repeat(65)}`, `0x${order}`, `0x${"f".repeat(64)}`]) {
    assert.throws(() => evmTransactionSignatureScalar(invalid), { code: "APN_RPC_PROTOCOL" });
  }
});

test("LI.FI RPC reconstructs the exact transaction hash and sender from a short signature scalar", async () => {
  let selected: Awaited<ReturnType<typeof signedRpcTransaction>> | undefined;
  for (let nonce = 0; nonce < 256; nonce++) {
    const candidate = await signedRpcTransaction(2, nonce);
    if ((candidate.rpc.s as string).startsWith("0x0")) { selected = candidate; break; }
  }
  assert.ok(selected, "deterministic signing fixture must produce a leading-zero s scalar");
  const shortened = { ...selected.rpc, s: `0x${(selected.rpc.s as string).slice(3)}` };
  assert.equal((shortened.s as string).length, 65);
  const verified = await verifyRpcTransaction(shortened, 1, selected.hash);
  assert.equal(verified.from, LIFI_SYNTHETIC_SENDER);
  assert.equal(keccak256(selected.raw), selected.hash);
});

test("LI.FI source signature validation accepts canonical zero nonce and priority while rejecting any frozen-field change", async () => {
  const s = await signedRpcTransaction(2, 0);
  const e = { role: "bridge", chainId: 1, from: LIFI_SYNTHETIC_SENDER, to: BRIDGE_DIAMOND, data: "0x12345678", valueAtomic: "0",
    economics: { nonceAtomic: "0", gasLimitAtomic: "400000", maxFeePerGasAtomic: "2000000000", maxPriorityFeePerGasAtomic: "0", maximumGasCostAtomic: "800000000000000" } } as unknown as BridgeEnvelope;
  await verifyBridgeSigned(s.raw, s.hash, e); await verifyRpcTransaction(s.rpc, 1, s.hash, e);
  await assert.rejects(verifyBridgeSigned(s.raw, s.hash, { ...e, valueAtomic: "1" }), { code: "APN_PROVIDER_EFFECT_UNAVAILABLE" });
  await assert.rejects(verifyBridgeSigned(s.raw, s.hash, { ...e, economics: { ...e.economics, nonceAtomic: "1" } }), { code: "APN_PROVIDER_EFFECT_UNAVAILABLE" });
});

async function rpcObservation(chainId = 1) {
  const s = await signedRpcTransaction(2, 7, chainId), blockHash = `0x${"ab".repeat(32)}` as Hex;
  const block: Json = { number: "0x7d0", hash: blockHash, timestamp: "0x6aa004bb", baseFeePerGas: "0x1", transactions: [s.hash] };
  const tx: Json = { ...s.rpc, blockNumber: block.number, blockHash, transactionIndex: "0x0" };
  const receipt: Json = { transactionHash: s.hash, blockNumber: block.number, blockHash, transactionIndex: "0x0", from: tx.from, to: tx.to,
    type: "0x2", status: "0x1", gasUsed: "0x5208", effectiveGasPrice: "0x3b9aca00", logs: [{ address: LIFI_RECIPIENT,
      blockHash, blockNumber: block.number, transactionHash: s.hash, transactionIndex: "0x0", logIndex: "0x0", removed: false, topics: [word(2n)], data: "0x" }] };
  const methods: string[] = [];
  const call: EvmRpcCall = async (method) => {
    methods.push(method);
    if (method === "eth_chainId") return quantity(chainId);
    if (method === "eth_getBlockByNumber") return block;
    if (method === "eth_getTransactionByHash") return tx;
    if (method === "eth_getTransactionReceipt") return receipt;
    throw new Error(`unexpected method: ${method}`);
  };
  return { ...s, tx, receipt, block, methods, rpcAdapter: new BridgeRpc(chainId as 1 | 8453, "https://ethereum.example", call) };
}

test("LI.FI bridge destination observation excludes relayer fee evidence and Base oracle reads", async () => {
  const s = await rpcObservation(8453), observed = await s.rpcAdapter.observeDestination(s.hash); assert.ok(observed);
  assert.equal(Object.hasOwn(observed.transaction, "actualTotalFeeWei"), false);
  assert.equal(Object.hasOwn(observed.transaction, "feeEvidence"), false);
  assert.equal(s.methods.some((method) => ["eth_getCode", "eth_getStorageAt", "eth_call"].includes(method)), false);
  assert.ok(s.methods.includes("eth_getTransactionReceipt")); assert.ok(s.methods.includes("eth_getBlockByNumber"));
  assert.equal(s.methods.includes("eth_getLogs"), false);
});

for (const missing of ["transaction", "receipt"] as const) test(`LI.FI missing destination ${missing} remains unavailable without a log scan`, async () => {
  const s = await rpcObservation(), methods: string[] = [];
  const rpc = new BridgeRpc(1, "https://ethereum.example", async (method) => {
    methods.push(method);
    if (method === "eth_chainId") return "0x1";
    if (method === "eth_getTransactionByHash") return missing === "transaction" ? null : s.tx;
    if (method === "eth_getTransactionReceipt") return missing === "receipt" ? null : s.receipt;
    throw new Error(`unexpected method: ${method}`);
  });
  assert.equal(await rpc.observeDestination(s.hash), null); assert.equal(methods.includes("eth_getLogs"), false);
});

async function routedArchiveObservation(useArchive: boolean) {
  const s = await rpcObservation(), calls: Array<{ host: string; method: string; params: readonly unknown[] }> = [];
  const transport = { request: async (endpoint: string, _verb: string, body: string | null) => {
    const request = JSON.parse(body!) as { id: string; method: string; params: readonly unknown[] };
    calls.push({ host: new URL(endpoint).host, method: request.method, params: request.params });
    let result: unknown;
    if (request.method === "eth_chainId") result = "0x1";
    else if (request.method === "eth_getTransactionByHash") result = s.tx;
    else if (request.method === "eth_getTransactionReceipt") result = s.receipt;
    else if (request.method === "eth_getBlockByNumber") result = s.block;
    else throw new Error(`unexpected method: ${request.method}`);
    return { status: 200, body: JSON.stringify({ jsonrpc: "2.0", id: request.id, result }) };
  } };
  const environment = { APN_ETHEREUM_RPC_URL: "https://primary.example",
    ...(useArchive ? { APN_ETHEREUM_ARCHIVE_RPC_URL: "https://archive.example" } : {}) };
  const descriptor = bridgeRpcCall(1, environment, { transport, wait: async () => {} });
  return { ...s, calls, rpcAdapter: new BridgeRpc(1, descriptor.origin, descriptor.call) };
}

test("LI.FI observation keeps a successful receipt on the primary canonical RPC", async () => {
  const s = await routedArchiveObservation(true), observed = await s.rpcAdapter.observe(s.hash); assert.ok(observed);
  assert.equal(observed.transaction.rpcOrigin, "https://primary.example");
  assert.deepEqual(s.calls.filter((call) => call.method === "eth_getTransactionReceipt"), [
    { host: "primary.example", method: "eth_getTransactionReceipt", params: [s.hash] },
  ]);
  assert.ok(s.calls.some((call) => call.host === "primary.example" && call.method === "eth_getBlockByNumber" && call.params[0] === s.block.number));
  assert.equal(s.calls.some((call) => call.host === "archive.example"), false);
  assert.equal(s.calls.some((call) => call.method.includes("send")), false);
});

test("LI.FI archive receipt observation rejects forged transaction and noncanonical block identities", async () => {
  const forgedTransaction = await routedArchiveObservation(true);
  forgedTransaction.receipt.transactionHash = word(1n);
  await assert.rejects(forgedTransaction.rpcAdapter.observe(forgedTransaction.hash), { code: "APN_RPC_PROTOCOL" });

  const forgedBlock = await routedArchiveObservation(true), forgedHash = word(9n);
  forgedBlock.receipt.blockHash = forgedHash; forgedBlock.tx.blockHash = forgedHash;
  await assert.rejects(forgedBlock.rpcAdapter.observe(forgedBlock.hash), { code: "APN_RPC_PROTOCOL" });
});

test("LI.FI receipt observation remains on the frozen primary RPC when no archive is configured", async () => {
  const s = await routedArchiveObservation(false), observed = await s.rpcAdapter.observe(s.hash); assert.ok(observed);
  assert.equal(observed.transaction.rpcOrigin, "https://primary.example");
  assert.deepEqual(s.calls.filter((call) => call.method === "eth_getTransactionReceipt").map((call) => call.host), ["primary.example"]);
  assert.equal(s.calls.some((call) => call.host === "archive.example"), false);
});

for (const fallback of [false, true]) test(`LI.FI bounded observation uses scalar primary reads and ${fallback ? "seven requests with" : "six requests without"} receipt fallback`, async () => {
  const s = await rpcObservation(), safe = { ...s.block, number: "0x7d1", hash: `0x${"cd".repeat(32)}`, transactions: [] };
  const calls: Array<{ host: string; request: Json | Json[] }> = [];
  const transport = { request: async (endpoint: string, _verb: string, body: string | null) => {
    const request = JSON.parse(body!) as Json | Json[], rows = Array.isArray(request) ? request : [request], host = new URL(endpoint).host;
    calls.push({ host, request });
    const responses = rows.map((row) => {
      let result: unknown;
      if (row.method === "eth_chainId") result = "0x1";
      else if (row.method === "eth_getTransactionByHash") result = s.tx;
      else if (row.method === "eth_getTransactionReceipt") result = host === "primary.example" && fallback ? null : s.receipt;
      else if (row.method === "eth_getBlockByNumber") result = row.params[0] === safe.number || row.params[0] === "safe" ? safe : s.block;
      else throw new Error(`unexpected method: ${row.method}`);
      return { jsonrpc: "2.0", id: row.id, result };
    });
    return { status: 200, body: JSON.stringify(Array.isArray(request) ? responses : responses[0]) };
  } };
  const session = new RpcReadSession({ wait: async () => {} });
  const rpc = bridgeRpcFactory({ APN_ETHEREUM_RPC_URL: "https://primary.example", APN_ETHEREUM_ARCHIVE_RPC_URL: "https://archive.example" },
    { transport, wait: async () => {} })(1, session);
  const observed = await rpc.observe(s.hash); assert.ok(observed); assert.equal(observed.transaction.rpcOrigin, "https://primary.example");
  const primary = calls.filter((call) => call.host === "primary.example");
  assert.equal(primary.length, 5); assert.ok(primary.every((call) => !Array.isArray(call.request)));
  assert.deepEqual(primary.map((call) => (call.request as Json).method), ["eth_chainId", "eth_getTransactionByHash", "eth_getTransactionReceipt",
    "eth_getBlockByNumber", "eth_getBlockByNumber"]);
  const archive = calls.filter((call) => call.host === "archive.example");
  assert.equal(calls.length, fallback ? 7 : 6);
  assert.deepEqual(archive.map((call) => (call.request as Json[]).map((row) => row.method)), fallback
    ? [["eth_chainId", "eth_getTransactionReceipt"], ["eth_getBlockByNumber", "eth_getBlockByNumber"]]
    : [["eth_chainId", "eth_getBlockByNumber", "eth_getBlockByNumber"]]);
  assert.equal(archive.flatMap((call) => call.request as Json[]).some((row) => ["eth_sendRawTransaction", "eth_estimateGas", "eth_getLogs"].includes(row.method)), false);
});

test("LI.FI explicit receipt routing uses six requests while primary remains authoritative for transaction and finality", async () => {
  const s = await rpcObservation(), safe = { ...s.block, number: "0x7d1", hash: `0x${"cd".repeat(32)}`, transactions: [] };
  const calls: Array<{ host: string; request: Json | Json[] }> = [];
  const transport = { request: async (endpoint: string, _verb: string, body: string | null) => {
    const request = JSON.parse(body!) as Json | Json[], rows = Array.isArray(request) ? request : [request], host = new URL(endpoint).host;
    calls.push({ host, request });
    const responses = rows.map((row) => {
      let result: unknown;
      if (row.method === "eth_chainId") result = "0x1";
      else if (row.method === "eth_getTransactionByHash") result = s.tx;
      else if (row.method === "eth_getTransactionReceipt") result = s.receipt;
      else if (row.method === "eth_getBlockByNumber") result = row.params[0] === safe.number || row.params[0] === "safe" ? safe : s.block;
      else throw new Error(`unexpected method: ${row.method}`);
      return { jsonrpc: "2.0", id: row.id, result };
    });
    return { status: 200, body: JSON.stringify(Array.isArray(request) ? responses : responses[0]) };
  } };
  const session = new RpcReadSession({ wait: async () => {}, maxHttpRequests: 16, maxHttpAttempts: 16 });
  const rpc = bridgeRpcFactory({ APN_ETHEREUM_RPC_URL: "https://primary.example", APN_ETHEREUM_ARCHIVE_RPC_URL: "https://archive.example",
    APN_ETHEREUM_RECEIPT_RPC_URL: "https://receipt.example" }, { transport, wait: async () => {} })(1, session);
  const observed = await rpc.observe(s.hash); assert.ok(observed); assert.equal(observed.transaction.rpcOrigin, "https://primary.example");
  assert.equal(calls.length, 6); assert.equal(session.telemetry().httpRequests, 6);
  const primary = calls.filter((call) => call.host === "primary.example");
  assert.deepEqual(primary.map((call) => (call.request as Json).method), ["eth_chainId", "eth_getTransactionByHash",
    "eth_getBlockByNumber", "eth_getBlockByNumber"]);
  assert.equal(primary.some((call) => (call.request as Json).method === "eth_getTransactionReceipt"), false);
  assert.deepEqual(calls.filter((call) => call.host === "receipt.example").map((call) =>
    (call.request as Json[]).map((row) => row.method)), [["eth_chainId", "eth_getTransactionReceipt"]]);
});

test("LI.FI RPC requires signed transaction, canonical block membership, receipt and log identity before safe proof", async () => {
  const s = await rpcObservation(), observed = await s.rpcAdapter.observe(s.hash); assert.ok(observed);
  assert.equal(observed.transaction.safeBlock!.hash, s.block.hash); assert.equal(observed.transaction.actualTotalFeeWei, "21000000000000");
  assert.ok(s.methods.filter((m) => m === "eth_getBlockByNumber").length >= 4); assert.ok(!s.methods.some((m) => m.includes("send")));
  const mutations: Array<(s: Awaited<ReturnType<typeof rpcObservation>>) => void> = [
    (s) => { s.receipt.transactionHash = word(1n); }, (s) => { s.tx.blockHash = word(1n); },
    (s) => { s.receipt.transactionIndex = "0x1"; }, (s) => { s.block.transactions = [word(1n)]; },
    (s) => { s.receipt.type = "0x1"; }, (s) => { s.receipt.from = LIFI_RECIPIENT; },
    (s) => { s.receipt.gasUsed = "0x61a81"; }, (s) => { s.receipt.effectiveGasPrice = "0x77359401"; },
    (s) => { s.receipt.logs[0].transactionIndex = "0x1"; }, (s) => { s.receipt.logs[0].removed = true; },
    (s) => { s.receipt.logs.push(structuredClone(s.receipt.logs[0])); }, (s) => { s.receipt.logs[0].blockNumber = "0x7cf"; },
    (s) => { s.receipt.logs[0].transactionHash = word(1n); }, (s) => { s.receipt.logs[0].blockHash = word(1n); },
    (s) => { s.receipt.logs[0].logIndex = "malformed"; }, (s) => { s.receipt.logs[0].address = "0x01"; },
    (s) => { s.receipt.logs[0].topics = ["0x01"]; }, (s) => { s.receipt.logs[0].data = "0x0"; },
  ];
  for (const mutate of mutations) { const s = await rpcObservation(); mutate(s); await assert.rejects(s.rpcAdapter.observe(s.hash), { code: "APN_RPC_PROTOCOL" }); }
});

test("LI.FI receipt logs accept omitted removed and preserve unrelated exact-receipt logs without a network log read", async () => {
  const s = await rpcObservation(); delete s.receipt.logs[0].removed;
  s.receipt.logs.push({ ...structuredClone(s.receipt.logs[0]), address: BRIDGE_DIAMOND, logIndex: "0x1", topics: [], data: "0x1234" });
  const observed = await s.rpcAdapter.observeDestination(s.hash); assert.ok(observed);
  assert.equal(observed.receipt.logs.length, 2); assert.equal(s.methods.includes("eth_getLogs"), false);
});

async function baseFeeFixture() {
  const bytes = await readFile(resolve("tests/core/lifi-fixtures/base-fee-rpc-20260908.json"));
  assert.equal(sha256(bytes), "112c4f84df7b6d2b0439f0ca4814611608f4d5c03a5baf575629c95f4c30b79c");
  const fixture = JSON.parse(bytes.toString()) as Json, entries = fixture.rpcEntries as Json[];
  const rawBlock = entries.find((e) => e.label === "final.blockByNumber")!.result;
  const block = { numberAtomic: BigInt(rawBlock.number).toString(), hash: rawBlock.hash as Hex, timestampAtomic: BigInt(rawBlock.timestamp).toString() };
  const receipt = entries.find((e) => e.label === "receipt")!.result as Json;
  const observed: Json[] = [];
  const call: EvmRpcCall = async (method, params) => {
    assert.deepEqual(params.at(-1), { blockHash: block.hash, requireCanonical: true });
    const expected = entries.find((e) => e.request.method === method && canonicalJson(e.request.params).toLowerCase() === canonicalJson(params).toLowerCase());
    assert.ok(expected, `unexpected fee proof call ${method} ${canonicalJson(params)}`); observed.push(expected); return expected.result;
  };
  return { fixture, entries, block, receipt, observed, call };
}

async function baseApprovalObservation(mode: "success" | "missing" | "reverted" | "retry429" | "terminal429" |
  "multicallMalformed" | "multicallRevert" | "multicallOrder" | "multicallCode",
  limits: { maxHttpRequests: number; maxHttpAttempts: number } = { maxHttpRequests: 14, maxHttpAttempts: 16 }) {
  const s = await rpcObservation(8453), fee = await baseFeeFixture();
  const deploymentFixture = JSON.parse(await readFile(resolve("tests/core/lifi-fixtures/deployment-rpc-20260908.json"), "utf8")) as Json;
  const deploymentCapture = (deploymentFixture.chains as Json[]).find((chain) => chain.chainId === 8453)!;
  const multicallCode = (await readFile(resolve("tests/core/fixtures/multicall3-runtime-code.hex"), "utf8")).trim();
  Object.assign(s.receipt, { gasUsed: fee.receipt.gasUsed, effectiveGasPrice: fee.receipt.effectiveGasPrice,
    l1Fee: fee.receipt.l1Fee, daFootprintGasScalar: fee.receipt.daFootprintGasScalar,
    status: mode === "reverted" ? "0x0" : "0x1" });
  const safe = { ...s.block, number: "0x7d1", hash: `0x${"cd".repeat(32)}`, transactions: [] };
  let now = 0, limited = 0;
  const traces: BridgeRpcRequestTrace[] = [], calls: Array<{ readonly host: string; readonly rows: readonly Json[] }> = [];
  const feeResult = (row: Json) => fee.entries.find((entry) => entry.request.method === row.method &&
    canonicalJson(entry.request.params.slice(0, -1)).toLowerCase() === canonicalJson(row.params.slice(0, -1)).toLowerCase())?.result;
  const deploymentResult = (row: Json): unknown => {
    if (row.method === "eth_getBlockByNumber") return s.block;
    if (row.method === "eth_getCode" && String(row.params[0]).toLowerCase() === MULTICALL3_ADDRESS.toLowerCase()) return mode === "multicallCode" ? "0x6000" : multicallCode;
    if (row.method === "eth_call" && String(row.params[0]?.to).toLowerCase() === MULTICALL3_ADDRESS.toLowerCase()) {
      const decoded = decodeFunctionData({ abi: MULTICALL3_ABI, data: row.params[0].data as Hex });
      assert.equal(decoded.functionName, "aggregate3");
      if (mode === "multicallMalformed") return "0x1234";
      const results = decoded.args[0].map((inner) => ({
        success: true, returnData: deploymentResult({ method: "eth_call", params: [{ to: inner.target, data: inner.callData }, row.params[1]] }) as Hex,
      }));
      if (mode === "multicallRevert" && results[0] !== undefined) results[0] = { success: false, returnData: "0x" };
      if (mode === "multicallOrder") results.reverse();
      return encodeFunctionResult({ abi: MULTICALL3_ABI, functionName: "aggregate3", result: results });
    }
    const comparable = (params: unknown[]) => params.slice(0, -1);
    return (deploymentCapture.requests as Json[]).find((entry) => entry.request.method === row.method &&
      canonicalJson(comparable(entry.request.params)).toLowerCase() === canonicalJson(comparable(row.params)).toLowerCase())?.response.result;
  };
  const transport = { request: async (endpoint: string, _verb: string, body: string | null) => {
    const request = JSON.parse(body!) as Json | Json[], rows = Array.isArray(request) ? request : [request], host = new URL(endpoint).host;
    calls.push({ host, rows });
    if (host === "base.drpc.org" && rows.some((row) => row.method === "eth_getCode") &&
      (mode === "terminal429" || mode === "retry429" && limited === 0)) {
      limited += 1; return { status: 429, body: "", headers: { "retry-after": "1" } };
    }
    const responses = rows.map((row) => {
      let result: unknown;
      if (row.method === "eth_chainId") result = "0x2105";
      else if (row.method === "eth_getTransactionByHash") result = s.tx;
      else if (row.method === "eth_getTransactionReceipt") result = mode === "missing" ? null : s.receipt;
      else if (row.method === "eth_getBlockByNumber") result = row.params[0] === "safe" || row.params[0] === safe.number ? safe : s.block;
      else result = typeof row.params.at(-1) === "object" ? feeResult(row) ?? deploymentResult(row) : deploymentResult(row);
      assert.notEqual(result, undefined, `unexpected observation read ${row.method} ${canonicalJson(row.params)}`);
      return { jsonrpc: "2.0", id: row.id, result };
    });
    return { status: 200, body: JSON.stringify(Array.isArray(request) ? responses : responses[0]) };
  } };
  const session = new RpcReadSession({ archiveDeploymentBatchMaxItems: 3, ...limits,
    now: () => now, wait: async (milliseconds) => { now += milliseconds; } });
  const rpc = bridgeRpcFactory({ APN_BASE_RPC_URL: "https://base-rpc.publicnode.com", APN_BASE_ARCHIVE_RPC_URL: "https://base.drpc.org",
    APN_BASE_RECEIPT_RPC_URL: "https://mainnet.base.org" }, { transport, wait: async () => {}, onRequest: (trace) => traces.push(trace) })(8453, session);
  const expected = { role: "approval", chainId: 8453, from: s.rpc.from, to: s.rpc.to, data: s.rpc.input,
    valueAtomic: BigInt(s.rpc.value).toString(), economics: { nonceAtomic: BigInt(s.rpc.nonce).toString(), gasLimitAtomic: BigInt(s.rpc.gas).toString(),
      maxFeePerGasAtomic: BigInt(s.rpc.maxFeePerGas).toString(), maxPriorityFeePerGasAtomic: BigInt(s.rpc.maxPriorityFeePerGas).toString(),
      maximumGasCostAtomic: (BigInt(s.rpc.gas) * BigInt(s.rpc.maxFeePerGas)).toString() } } as BridgeEnvelope;
  return { s, calls, traces, session, rpc, expected, observe: async () => await rpc.observe(s.hash, expected) };
}

async function productionBaseObservation(root: string, mode: "success" | "terminal429", limits?: { maxHttpRequests: number; maxHttpAttempts: number }) {
  const fixture = await lifiFixture(root, "base-arb"), prepared = (await fixture.prepare("stargateV2")).operation;
  const run = await baseApprovalObservation(mode, limits), materialization = { ...prepared.intent.materialization,
    sender: run.expected.from, approvalAddress: run.expected.to };
  const token = BRIDGE_ASSET_REGISTRY[8453].tokens.find((row) => row.symbol === "USDC")!.address;
  const deployment = bridgeDeployment(8453, 42161, "stargateV2", token), code = [...deployment.code, ...BASE_FEE_CONTRACT.code];
  const sourceDeployment = { ...prepared.intent.sourceDeployment, rpcOrigin: "https://base-rpc.publicnode.com",
    contractHash: hashObject({ protocol: deployment, feeContract: BASE_FEE_CONTRACT }),
    codeHash: hashObject(code.map((row) => ({ address: row.address, codeHash: row.codeHash }))),
    configurationHash: hashObject([...deployment.reads, ...BASE_FEE_CONTRACT.reads].map((row) => ({ ...row, expected: row.expected }))) };
  const approval = prepared.effects[0]!;
  let operation = { ...prepared, state: "unknown_finality", terminal: false, failure: null,
    intent: { ...prepared.intent, materialization, sourceDeployment }, effects: [{ ...approval, envelope: run.expected,
      transactionHash: run.s.hash, submittedAt: prepared.createdAt, submissionAttempts: 1, phase: "unknown_finality", includedProof: null, safeProof: null },
    prepared.effects[1]!] } as BridgeOperationRecord;
  run.s.receipt.logs = [{ address: token, topics: [keccak256(Buffer.from("Approval(address,address,uint256)")),
    `0x${"0".repeat(24)}${materialization.sender.slice(2).toLowerCase()}`,
    `0x${"0".repeat(24)}${materialization.approvalAddress.slice(2).toLowerCase()}`], data: word(BigInt(materialization.request.amountAtomic)),
    blockNumber: run.s.receipt.blockNumber, transactionHash: run.s.hash, transactionIndex: "0x0", blockHash: run.s.receipt.blockHash, logIndex: "0x0", removed: false }];
  const observer = new BridgeObservation(run.rpc, fixture.destination, fixture.provider, async (_previous, patch) => {
    operation = { ...operation, ...patch } as BridgeOperationRecord; return operation;
  });
  return { fixture, run, execute: async () => { const result = await observer.sources(operation); operation = result.operation; return { ...result, operation }; } };
}

test("LI.FI production source observation uses the complete ordered physical trace with no resend", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const prepared = await productionBaseObservation(temporary.root, "success"), { run, fixture } = prepared;
  const result = await prepared.execute(), operation = result.operation; assert.equal(result.reliable, true);
  assert.equal(run.session.telemetry().httpRequests, 14); assert.equal(run.session.telemetry().httpAttempts, 14);
  assert.equal(run.calls.length, 14);
  assert.deepEqual(Object.fromEntries(["base-rpc.publicnode.com", "mainnet.base.org", "base.drpc.org"].map((host) =>
    [host, run.calls.filter((call) => call.host === host).length])),
  { "base-rpc.publicnode.com": 4, "mainnet.base.org": 2, "base.drpc.org": 8 });
  assert.deepEqual(run.traces.filter((call) => call.endpointRole === "receipt").map((call) => call.methods),
    [["eth_chainId"], ["eth_getTransactionReceipt"]]);
  assert.ok(run.traces.filter((call) => call.endpointRole === "archive").every((call) => call.batchSize <= 3));
  assert.equal(run.calls.flatMap((call) => call.rows).some((row) => row.method === "eth_sendRawTransaction"), false);
  const trace = (origin: string, endpointRole: "primary" | "archive" | "receipt", methods: string[]) =>
    ({ origin, endpointRole, methods, batchSize: methods.length });
  const primary = "https://base-rpc.publicnode.com", receipt = "https://mainnet.base.org", archive = "https://base.drpc.org";
  assert.deepEqual(run.traces, [
    trace(primary, "primary", ["eth_chainId"]), trace(receipt, "receipt", ["eth_chainId"]),
    trace(primary, "primary", ["eth_getTransactionByHash"]), trace(receipt, "receipt", ["eth_getTransactionReceipt"]),
    trace(primary, "primary", ["eth_getBlockByNumber"]), trace(primary, "primary", ["eth_getBlockByNumber"]),
    trace(archive, "archive", ["eth_chainId", "eth_getCode", "eth_getCode"]),
    trace(archive, "archive", ["eth_getCode", "eth_getStorageAt", "eth_getStorageAt"]),
    trace(archive, "archive", ["eth_call", "eth_call", "eth_call"]),
    trace(archive, "archive", ["eth_call", "eth_getBlockByNumber", "eth_getBlockByNumber"]),
    trace(archive, "archive", ["eth_getCode", "eth_getCode", "eth_getCode"]),
    trace(archive, "archive", ["eth_getCode", "eth_getCode", "eth_getCode"]),
    trace(archive, "archive", ["eth_getCode", "eth_getCode", "eth_getStorageAt"]),
    trace(archive, "archive", ["eth_getStorageAt", "eth_call", "eth_call"]),
  ]);
  assert.deepEqual(run.traces[10], trace(archive, "archive", ["eth_getCode", "eth_getCode", "eth_getCode"]));
  assert.deepEqual(operation.effects.map((effect) => [effect.role, effect.phase, effect.submissionAttempts]),
    [["approval", "safe_success", 1], ["bridge", "unsealed", 0]]);
  assert.ok(operation.effects[0]!.safeProof); assert.equal(fixture.source.submissions.length, 0);
  assert.deepEqual(operation.observationTelemetry?.at(-1), {
    schemaVersion: "apn.bridge-observation-telemetry.v1", stage: "source_observation", effectRole: "approval", outcome: "success",
    physicalRequests: 14, httpAttempts: 14, logicalRpcItems: 30, batchCount: 8, maxBatchSize: 3,
    budgetRejectedBeforeTransport: 0, attemptsByEndpointRole: { primary: 4, receipt: 2, archive: 8 },
    attemptsByMethodClass: { block: 4, call: 6, chain: 3, code: 11, receipt: 1, storage: 4, transaction: 1 },
  });
});

test("LI.FI production observation persists exact retry and zero-transport budget telemetry", async (t) => {
  const limitedState = await temporaryState(); t.after(limitedState.cleanup);
  const limited = await productionBaseObservation(limitedState.root, "terminal429"), limitedResult = await limited.execute();
  assert.equal(limitedResult.reliable, false);
  assert.deepEqual(limitedResult.operation.observationTelemetry?.at(-1), {
    schemaVersion: "apn.bridge-observation-telemetry.v1", stage: "source_observation", effectRole: "approval", outcome: "failure",
    physicalRequests: 7, httpAttempts: 8, logicalRpcItems: 18, batchCount: 1, maxBatchSize: 3,
    budgetRejectedBeforeTransport: 0, attemptsByEndpointRole: { primary: 4, receipt: 2, archive: 2 },
    attemptsByMethodClass: { block: 2, chain: 4, code: 4, receipt: 1, transaction: 1 },
  });
  const budgetState = await temporaryState(); t.after(budgetState.cleanup);
  const budget = await productionBaseObservation(budgetState.root, "success", { maxHttpRequests: 6, maxHttpAttempts: 8 }), budgetResult = await budget.execute();
  assert.equal(budgetResult.reliable, false);
  assert.deepEqual(budgetResult.operation.observationTelemetry?.at(-1), {
    schemaVersion: "apn.bridge-observation-telemetry.v1", stage: "source_observation", effectRole: "approval", outcome: "failure",
    physicalRequests: 6, httpAttempts: 6, logicalRpcItems: 18, batchCount: 0, maxBatchSize: 1,
    budgetRejectedBeforeTransport: 1, attemptsByEndpointRole: { primary: 4, receipt: 2, archive: 0 },
    attemptsByMethodClass: { block: 2, chain: 2, receipt: 1, transaction: 1 },
  });
  for (const execution of [limited, budget]) {
    assert.equal(execution.run.calls.flatMap((call) => call.rows).some((row) => row.method === "eth_sendRawTransaction"), false);
    assert.equal(execution.fixture.source.submissions.length, 0);
  }
});

test("LI.FI Base approval observation keeps missing, reverted and 429 outcomes bounded", async () => {
  const missing = await baseApprovalObservation("missing"); assert.equal(await missing.observe(), null);
  assert.equal(missing.session.telemetry().httpRequests, 4); assert.equal(missing.session.telemetry().httpAttempts, 4);
  const reverted = await baseApprovalObservation("reverted"), revertedProof = await reverted.observe();
  assert.equal(revertedProof?.transaction.status, "reverted"); assert.equal(reverted.session.telemetry().httpRequests, 10);
  const retried = await baseApprovalObservation("retry429"), recovered = await retried.observe(); assert.ok(recovered);
  assert.equal(retried.session.telemetry().httpRequests, 10); assert.equal(retried.session.telemetry().httpAttempts, 11);
  const limited = await baseApprovalObservation("terminal429");
  await assert.rejects(limited.observe(), (error: unknown) => error instanceof Error && (error as { code?: string }).code === "APN_RPC_RATE_LIMITED");
  assert.equal(limited.session.telemetry().httpRequests, 7); assert.equal(limited.session.telemetry().httpAttempts, 8);
  for (const run of [missing, reverted, retried, limited]) {
    assert.equal(run.calls.flatMap((call) => call.rows).some((row) => row.method === "eth_sendRawTransaction"), false);
    assert.ok(run.traces.filter((call) => call.endpointRole === "archive").every((call) => call.batchSize <= 3));
  }
});

for (const mode of ["multicallMalformed", "multicallRevert", "multicallOrder", "multicallCode"] as const) {
  test(`LI.FI Base pinned fee Multicall fails closed on ${mode}`, async () => {
    const run = await baseApprovalObservation(mode);
    await assert.rejects(run.observe(), (error: unknown) => error instanceof Error &&
      ["APN_RPC_PROTOCOL", "APN_PROVIDER_PROTOCOL"].includes((error as { code?: string }).code ?? ""));
    assert.equal(run.calls.flatMap((call) => call.rows).some((row) => row.method === "eth_sendRawTransaction"), false);
  });
}

test("LI.FI Base actual fee proves operator zero at receipt block and includes explicit L1 fee without counting DA footprint as a charge", async () => {
  const s = await baseFeeFixture(); assert.equal(s.receipt.operatorFeeScalar, undefined);
  const actual = await bridgeActualFees(8453, s.receipt, s.block, s.call);
  const execution = BigInt(s.receipt.gasUsed) * BigInt(s.receipt.effectiveGasPrice);
  assert.equal(actual.actualTotalFeeWei, (execution + BigInt(s.receipt.l1Fee)).toString());
  assert.equal(actual.blobFeeWei, "0"); assert.equal(actual.operatorFeeWei, "0"); assert.equal(actual.feeEvidence.baseOracle!.blockHash, s.block.hash);
  assert.equal(s.observed.length, 11); assert.ok(s.observed.filter((r) => r.request.method === "eth_getCode").every((r) => r.result.length > 1000));
});

test("LI.FI Base unknown or inconsistent fee evidence fails closed instead of assuming zero", async () => {
  const mutations: Array<(s: Awaited<ReturnType<typeof baseFeeFixture>>) => void> = [
    (s) => { delete s.receipt.l1Fee; }, (s) => { delete s.receipt.daFootprintGasScalar; },
    (s) => { s.receipt.operatorFeeScalar = "0x0"; }, (s) => { s.receipt.operatorFeeScalar = "0x1"; s.receipt.operatorFeeConstant = "0x0"; },
    (s) => { s.entries.find((r) => r.label === "gpo.implementationCode")!.result = "0x6000"; },
    (s) => { s.entries.find((r) => r.label === "gpo.proxyImplementationSlot")!.result = word(1n); },
    (s) => { s.entries.find((r) => r.label === "gpo.version")!.result = "0x"; },
    (s) => { s.entries.find((r) => r.label === "gpo.isJovian")!.result = word(0n); },
    (s) => { s.entries.find((r) => r.label === "gpo.getOperatorFee.gasUsed67773")!.result = word(1n); },
    (s) => { s.entries.find((r) => r.label === "l1Block.operatorFeeScalar")!.result = word(1n << 32n); },
  ];
  for (const mutate of mutations) { const s = await baseFeeFixture(); mutate(s); await assert.rejects(bridgeActualFees(8453, s.receipt, s.block, s.call), { code: "APN_RPC_PROTOCOL" }); }
  const s = await baseFeeFixture(); s.receipt.l1Fee = "0x0"; s.receipt.operatorFeeScalar = "0x0"; s.receipt.operatorFeeConstant = "0x0";
  assert.equal((await bridgeActualFees(8453, s.receipt, s.block, s.call)).l1DataFeeWei, "0");
});

test("LI.FI actual fee arithmetic counts Arbitrum poster gas once and Ethereum type-3 blob gas separately", async () => {
  const block = { numberAtomic: "1", hash: word(1n) as Hex, timestampAtomic: "1" }, noCall: EvmRpcCall = async () => { throw new Error("no oracle for this chain"); };
  const receipt = { gasUsed: "0x64", effectiveGasPrice: "0xa", type: "0x2", gasUsedForL1: "0x14" };
  const arb = await bridgeActualFees(42161, receipt, block, noCall); assert.equal(arb.actualTotalFeeWei, "1000"); assert.equal(arb.l1DataFeeWei, "0"); assert.equal(arb.feeEvidence.arbitrumPosterGasAtomic, "20");
  await assert.rejects(bridgeActualFees(42161, { ...receipt, gasUsedForL1: "0x65" }, block, noCall), { code: "APN_RPC_PROTOCOL" });
  const eth = await bridgeActualFees(1, { ...receipt, type: "0x3", blobGasUsed: "0x2", blobGasPrice: "0x3" }, block, noCall);
  assert.equal(eth.actualTotalFeeWei, "1006"); assert.equal(eth.blobFeeWei, "6");
  await assert.rejects(bridgeActualFees(1, { ...receipt, type: "0x3" }, block, noCall), { code: "APN_RPC_PROTOCOL" });
});

test("LI.FI Base fee quote budgets 16 KiB signed bytes while existing direct-transfer quote retains 512 bytes", async () => {
  const inputs: Hex[] = [], call: EvmRpcCall = async (method, params) => {
    if (method === "eth_chainId") return "0x2105";
    if (method === "eth_getBlockByNumber") return { number: "0x1", hash: word(1n) };
    assert.equal(method, "eth_call"); inputs.push((params[0] as { data: Hex }).data); return word(0n);
  };
  const economics = { nonceAtomic: "0", gasLimitAtomic: "400000", maxFeePerGasAtomic: "2", maxPriorityFeePerGasAtomic: "0", maximumGasCostAtomic: "800000" };
  await new EvmRpc(call, "https://base.example").feeQuote(8453, economics); const direct = inputs[0]!;
  inputs.length = 0; await new BridgeRpc(8453, "https://base.example", call).feeQuote({ economics });
  assert.equal(BigInt(`0x${direct.slice(-64)}`), 512n); assert.equal(BigInt(`0x${inputs[0]!.slice(-64)}`), 16384n); assert.equal(direct.slice(0, 10), inputs[0]!.slice(0, 10));
});
