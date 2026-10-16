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
import { BASE_FEE_CONTRACT, BRIDGE_RECEIPT_FEE_RULE_HASH, bridgeActualFees, legacyBridgeActualFees } from "../../src/lifi/rpc-fees.js";
import { evmTransactionSignatureScalar, verifyRpcTransaction } from "../../src/lifi/rpc-transaction.js";
import { verifyBridgeSigned } from "../../src/lifi/transaction.js";
import { BRIDGE_DIAMOND } from "../../src/lifi/validation.js";
import type { BridgeEnvelope } from "../../src/lifi/model.js";
import { BRIDGE_ASSET_REGISTRY } from "../../src/lifi/asset-registry.js";
import { bridgeDeployment } from "../../src/lifi/deployments.js";
import { BridgeObservation } from "../../src/lifi/observation.js";
import type { BridgeOperationRecord } from "../../src/lifi/operation-model.js";
import { bridgeReceipt } from "../../src/lifi/receipt.js";
import { transitionBridge } from "../../src/lifi/transitions.js";
import { MULTICALL3_ABI } from "../../src/portfolio/evm-reader.js";
import { MULTICALL3_ADDRESS } from "../../src/portfolio/registry.js";
import { LIFI_RECIPIENT, LIFI_SYNTHETIC_KEY, LIFI_SYNTHETIC_SENDER, lifiFixture } from "./lifi-helpers.js";
import { temporaryState } from "./helpers.js";

type Json = Record<string, any>;
const word = (n: bigint): Hex => `0x${n.toString(16).padStart(64, "0")}`, quantity = (n: bigint | number) => `0x${n.toString(16)}`;
const TYPES = ["legacy", "eip2930", "eip1559", "eip4844", "eip7702"] as const;
async function signedRpcTransaction(index = 2, nonce = 7, chainId = 1, authorizationNonce = 0) {
  const type = TYPES[index]!, account = privateKeyToAccount(LIFI_SYNTHETIC_KEY);
  const common = { chainId, to: BRIDGE_DIAMOND, nonce, gas: 400000n, value: 0n, data: "0x12345678" as Hex };
  const fees = { maxFeePerGas: 2000000000n, maxPriorityFeePerGas: 0n };
  let transaction: TransactionSerializable;
  if (type === "legacy") transaction = { ...common, type, gasPrice: 2000000000n };
  else if (type === "eip2930") transaction = { ...common, type, gasPrice: 2000000000n, accessList: [{ address: LIFI_RECIPIENT, storageKeys: [word(5n) as Hex] }] };
  else if (type === "eip1559") transaction = { ...common, ...fees, type, accessList: [] };
  else if (type === "eip4844") transaction = { ...common, ...fees, type, maxFeePerBlobGas: 100n, blobVersionedHashes: [`0x01${"67".repeat(31)}`], accessList: [] };
  else transaction = { ...common, ...fees, type, accessList: [], authorizationList: [await account.signAuthorization({ chainId: 1, contractAddress: LIFI_RECIPIENT, nonce: authorizationNonce })] };
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

test("LI.FI RPC reconstructs type-4 authorizations whose r or s is a QUANTITY without a leading zero nibble", async () => {
  const found = new Map<"r" | "s", Awaited<ReturnType<typeof signedRpcTransaction>>>();
  for (let authorizationNonce = 0; authorizationNonce < 256 && found.size < 2; authorizationNonce++) {
    const candidate = await signedRpcTransaction(4, 7, 1, authorizationNonce), authorization = candidate.rpc.authorizationList[0] as Json;
    for (const field of ["r", "s"] as const) if (!found.has(field) && BigInt(authorization[field]) < 1n << 252n) found.set(field, candidate);
  }
  assert.equal(found.size, 2, "deterministic signing fixture must produce leading-zero authorization r and s");
  for (const [field, signed] of found) {
    const authorization = signed.rpc.authorizationList[0] as Json, short = quantity(BigInt(authorization[field]));
    const withScalar = (value: string) => ({ ...signed.rpc, authorizationList: [{ ...authorization, [field]: value }] });
    assert.ok(short.length < 66);
    assert.equal((await verifyRpcTransaction(withScalar(short), 1, signed.hash)).from, LIFI_SYNTHETIC_SENDER);
    for (const invalid of [`0x0${short.slice(2)}`.length === 66 ? `0x00${short.slice(2)}` : `0x0${short.slice(2)}`, "0x", `0x${"g".repeat(64)}`, `0x1${"0".repeat(64)}`]) {
      await assert.rejects(verifyRpcTransaction(withScalar(invalid), 1, signed.hash), { code: "APN_RPC_PROTOCOL" });
    }
    await assert.rejects(verifyRpcTransaction(withScalar(quantity(BigInt(short) ^ 1n)), 1, signed.hash), { code: "APN_RPC_PROTOCOL" });
  }
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
    if (method === "eth_getBlockByNumber") return s.block;
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

for (const fallback of [false, true]) test(`LI.FI bounded observation reads one primary batch and the inclusion header${fallback ? ", with the archive receipt fallback" : ""}`, async () => {
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
  const methods = (call: { request: Json | Json[] }) => (Array.isArray(call.request) ? call.request : [call.request]).map((row) => row.method);
  const primary = calls.filter((call) => call.host === "primary.example");
  assert.deepEqual(primary.map(methods), [["eth_chainId", "eth_getTransactionByHash", "eth_getTransactionReceipt", "eth_getBlockByNumber"],
    ["eth_getBlockByNumber"]]);
  const archive = calls.filter((call) => call.host === "archive.example");
  assert.equal(calls.length, fallback ? 3 : 2);
  assert.deepEqual(archive.map(methods), fallback ? [["eth_chainId", "eth_getTransactionReceipt"]] : []);
  assert.equal(archive.flatMap(methods).some((method) => ["eth_sendRawTransaction", "eth_estimateGas", "eth_getLogs"].includes(method)), false);
});

test("LI.FI explicit receipt routing reads the receipt from its reader while the primary stays authoritative for transaction and finality", async () => {
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
  assert.equal(calls.length, 3); assert.equal(session.telemetry().httpRequests, 3);
  const methods = (call: { request: Json | Json[] }) => (Array.isArray(call.request) ? call.request : [call.request]).map((row) => row.method);
  assert.deepEqual(calls.filter((call) => call.host === "primary.example").map(methods),
    [["eth_chainId", "eth_getTransactionByHash", "eth_getBlockByNumber"], ["eth_getBlockByNumber"]]);
  assert.deepEqual(calls.filter((call) => call.host === "receipt.example").map(methods), [["eth_chainId", "eth_getTransactionReceipt"]]);
});

test("LI.FI RPC requires signed transaction, canonical block membership, receipt and log identity before safe proof", async () => {
  const s = await rpcObservation(), observed = await s.rpcAdapter.observe(s.hash); assert.ok(observed);
  assert.equal(observed.transaction.safeBlock!.hash, s.block.hash); assert.equal(observed.transaction.actualTotalFeeWei, "21000000000000");
  // The safe head and the inclusion header: no recheck of either once read in this invocation.
  assert.equal(s.methods.filter((m) => m === "eth_getBlockByNumber").length, 2); assert.ok(!s.methods.some((m) => m.includes("send")));
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

type BaseObservationMode = "success" | "missing" | "reverted" | "first429" | "retry503" | "terminal429" | "approvalEvent";
async function baseApprovalObservation(mode: BaseObservationMode,
  limits: { maxHttpRequests: number; maxHttpAttempts: number } = { maxHttpRequests: 4, maxHttpAttempts: 6 }) {
  const s = await rpcObservation(8453), fee = await baseFeeFixture();
  Object.assign(s.receipt, { gasUsed: fee.receipt.gasUsed, effectiveGasPrice: fee.receipt.effectiveGasPrice,
    l1Fee: fee.receipt.l1Fee, daFootprintGasScalar: fee.receipt.daFootprintGasScalar,
    status: mode === "reverted" ? "0x0" : "0x1" });
  const safe = { ...s.block, number: "0x7d1", hash: `0x${"cd".repeat(32)}`, transactions: [] };
  let now = 0, limited = 0;
  const traces: BridgeRpcRequestTrace[] = [], calls: Array<{ readonly host: string; readonly rows: readonly Json[] }> = [];
  const transport = { request: async (endpoint: string, _verb: string, body: string | null) => {
    const request = JSON.parse(body!) as Json | Json[], rows = Array.isArray(request) ? request : [request], host = new URL(endpoint).host;
    calls.push({ host, rows });
    // Rate limits hit the first primary batch; a transient 503 hits the inclusion header read once.
    const first = host === "base-rpc.publicnode.com" && rows.some((row) => row.method === "eth_getTransactionByHash");
    const header = host === "base-rpc.publicnode.com" && rows.some((row) => row.method === "eth_getBlockByNumber" && row.params[0] === s.block.number);
    if ((mode === "terminal429" && first) || (mode === "first429" && first && limited === 0) || (mode === "retry503" && header && limited === 0)) {
      limited += 1; return { status: mode === "retry503" ? 503 : 429, body: "", headers: { "retry-after": "1" } };
    }
    const responses = rows.map((row) => {
      let result: unknown;
      if (row.method === "eth_chainId") result = "0x2105";
      else if (row.method === "eth_getTransactionByHash") result = s.tx;
      else if (row.method === "eth_getTransactionReceipt") result = mode === "missing" ? null : s.receipt;
      else if (row.method === "eth_getBlockByNumber") result = row.params[0] === "safe" || row.params[0] === safe.number ? safe : s.block;
      assert.notEqual(result, undefined, `unexpected observation read ${row.method} ${canonicalJson(row.params)}`);
      return { jsonrpc: "2.0", id: row.id, result };
    });
    return { status: 200, body: JSON.stringify(Array.isArray(request) ? responses : responses[0]) };
  } };
  const session = new RpcReadSession({ ...limits, now: () => now, wait: async (milliseconds) => { now += milliseconds; } });
  const rpc = bridgeRpcFactory({ APN_BASE_RPC_URL: "https://base-rpc.publicnode.com", APN_BASE_ARCHIVE_RPC_URL: "https://base.drpc.org",
    APN_BASE_RECEIPT_RPC_URL: "https://mainnet.base.org" }, { transport, wait: async () => {}, onRequest: (trace) => traces.push(trace) })(8453, session);
  const expected = { role: "approval", chainId: 8453, from: s.rpc.from, to: s.rpc.to, data: s.rpc.input,
    valueAtomic: BigInt(s.rpc.value).toString(), economics: { nonceAtomic: BigInt(s.rpc.nonce).toString(), gasLimitAtomic: BigInt(s.rpc.gas).toString(),
      maxFeePerGasAtomic: BigInt(s.rpc.maxFeePerGas).toString(), maxPriorityFeePerGasAtomic: BigInt(s.rpc.maxPriorityFeePerGas).toString(),
      maximumGasCostAtomic: (BigInt(s.rpc.gas) * BigInt(s.rpc.maxFeePerGas)).toString() } } as BridgeEnvelope;
  return { s, calls, traces, session, rpc, expected, observe: async () => await rpc.observe(s.hash, expected) };
}

async function productionBaseObservation(root: string, mode: BaseObservationMode, limits?: { maxHttpRequests: number; maxHttpAttempts: number },
  effectRole: "approval" | "bridge" = "approval") {
  const fixture = await lifiFixture(root, "base-arb"), prepared = (await fixture.prepare("stargateV2")).operation;
  const run = await baseApprovalObservation(mode, limits), materialization = { ...prepared.intent.materialization,
    sender: run.expected.from, approvalAddress: run.expected.to };
  const token = BRIDGE_ASSET_REGISTRY[8453].tokens.find((row) => row.symbol === "USDC")!.address;
  const selected = prepared.effects.find((effect) => effect.role === effectRole)!, expected = { ...run.expected, role: effectRole } as BridgeEnvelope;
  let operation = { ...prepared, state: "unknown_finality", terminal: false, failure: null,
    intent: { ...prepared.intent, materialization }, effects: prepared.effects.map((effect) => effect.role === effectRole ? { ...selected, envelope: expected,
      transactionHash: run.s.hash, submittedAt: prepared.createdAt, submissionAttempts: 1, phase: "unknown_finality", includedProof: null, safeProof: null } : effect) } as BridgeOperationRecord;
  run.s.receipt.logs = effectRole === "bridge" ? [] : [{ address: token, topics: [keccak256(Buffer.from("Approval(address,address,uint256)")),
    `0x${"0".repeat(24)}${materialization.sender.slice(2).toLowerCase()}`,
    `0x${"0".repeat(24)}${materialization.approvalAddress.slice(2).toLowerCase()}`], data: word(BigInt(materialization.request.amountAtomic)),
    blockNumber: run.s.receipt.blockNumber, transactionHash: run.s.hash, transactionIndex: "0x0", blockHash: run.s.receipt.blockHash, logIndex: "0x0", removed: false }];
  if (mode === "approvalEvent" && run.s.receipt.logs[0] !== undefined) run.s.receipt.logs[0].data = word(0n);
  const observer = new BridgeObservation(run.rpc, fixture.destination, fixture.provider, async (_previous, patch) => {
    operation = { ...operation, ...patch } as BridgeOperationRecord; return operation;
  });
  return { fixture, run, template: prepared,
    execute: async () => { const result = await observer.sources(operation); operation = result.operation; return { ...result, operation }; } };
}

const TRACE_TELEMETRY = { physicalRequests: 4, httpAttempts: 4, logicalRpcItems: 6, batchCount: 1, maxBatchSize: 3,
  budgetRejectedBeforeTransport: 0, attemptsByEndpointRole: { primary: 2, receipt: 2, archive: 0 },
  attemptsByMethodClass: { block: 2, chain: 2, receipt: 1, transaction: 1 } };

test("LI.FI production source observation uses the complete ordered physical trace with no resend", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const prepared = await productionBaseObservation(temporary.root, "success"), { run, fixture } = prepared;
  const result = await prepared.execute(), operation = result.operation; assert.equal(result.reliable, true);
  assert.equal(run.session.telemetry().httpRequests, 4); assert.equal(run.session.telemetry().httpAttempts, 4);
  assert.equal(run.calls.flatMap((call) => call.rows).some((row) => row.method === "eth_sendRawTransaction"), false);
  const trace = (origin: string, endpointRole: "primary" | "archive" | "receipt", methods: string[]) =>
    ({ origin, endpointRole, methods, batchSize: methods.length });
  const primary = "https://base-rpc.publicnode.com", receipt = "https://mainnet.base.org";
  // One primary batch, the one-item receipt reader's chain identity and receipt, then the inclusion header. Fees come from
  // the receipt; nothing is read at a historical block and no deployment is re-proved after the effect landed.
  assert.deepEqual(run.traces, [
    trace(primary, "primary", ["eth_chainId", "eth_getTransactionByHash", "eth_getBlockByNumber"]),
    trace(receipt, "receipt", ["eth_chainId"]), trace(receipt, "receipt", ["eth_getTransactionReceipt"]),
    trace(primary, "primary", ["eth_getBlockByNumber"]),
  ]);
  assert.deepEqual(operation.effects.map((effect) => [effect.role, effect.phase, effect.submissionAttempts]),
    [["approval", "safe_success", 1], ["bridge", "unsealed", 0]]);
  assert.ok(operation.effects[0]!.safeProof); assert.equal(fixture.source.submissions.length, 0);
  assert.equal(operation.effects[0]!.safeProof!.feeEvidence.ruleHash, BRIDGE_RECEIPT_FEE_RULE_HASH);
  assert.deepEqual(operation.observationTelemetry?.at(-1), { schemaVersion: "apn.bridge-observation-telemetry.v1",
    stage: "source_observation", effectRole: "approval", outcome: "success", ...TRACE_TELEMETRY });
});

test("LI.FI production observation persists first-429 and zero-transport budget telemetry", async (t) => {
  const limitedState = await temporaryState(); t.after(limitedState.cleanup);
  const limited = await productionBaseObservation(limitedState.root, "terminal429"), limitedResult = await limited.execute();
  assert.equal(limitedResult.reliable, false);
  assert.equal(limitedResult.operation.failure?.observationRpc?.code, "APN_RPC_RATE_LIMITED");
  assert.equal(limitedResult.operation.failure?.observationRpc?.endpointRole, "primary");
  assert.equal(limited.run.session.telemetry().retryAfterMs, 1_000);
  assert.deepEqual(limitedResult.operation.observationTelemetry?.at(-1), {
    schemaVersion: "apn.bridge-observation-telemetry.v1", stage: "source_observation", effectRole: "approval", outcome: "failure",
    physicalRequests: 1, httpAttempts: 1, logicalRpcItems: 3, batchCount: 1, maxBatchSize: 3,
    budgetRejectedBeforeTransport: 0, attemptsByEndpointRole: { primary: 1, receipt: 0, archive: 0 },
    attemptsByMethodClass: { block: 1, chain: 1, transaction: 1 },
  });
  // An exhausted request or attempt budget is a deferral: the journal keeps its state, no telemetry-only transition is written,
  // and the session still accounts for the rejected read.
  const budgetState = await temporaryState(); t.after(budgetState.cleanup);
  const budget = await productionBaseObservation(budgetState.root, "success", { maxHttpRequests: 3, maxHttpAttempts: 5 }), budgetResult = await budget.execute();
  assert.equal(budgetResult.reliable, false); assert.equal(budgetResult.operation.failure, null);
  assert.deepEqual(budgetResult.operation.observationTelemetry, []);
  assert.equal(budget.run.session.telemetry().budgetRejectedBeforeTransport, 1); assert.equal(budget.run.session.telemetry().httpRequests, 3);
  const attemptState = await temporaryState(); t.after(attemptState.cleanup);
  const attemptBudget = await productionBaseObservation(attemptState.root, "success", { maxHttpRequests: 4, maxHttpAttempts: 2 });
  const attemptResult = await attemptBudget.execute();
  assert.equal(attemptResult.reliable, false); assert.equal(attemptBudget.run.session.telemetry().httpRequests, 3);
  assert.equal(attemptResult.operation.failure, null); assert.deepEqual(attemptResult.operation.observationTelemetry, []);
  assert.equal(attemptBudget.run.session.telemetry().budgetRejectedBeforeTransport, 1);
  for (const execution of [limited, budget, attemptBudget]) {
    assert.equal(execution.run.calls.flatMap((call) => call.rows).some((row) => row.method === "eth_sendRawTransaction"), false);
    assert.equal(execution.fixture.source.submissions.length, 0);
  }
});

test("LI.FI source protocol evidence failures persist the consumed production trace once and project only redacted telemetry", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const prepared = await productionBaseObservation(temporary.root, "success", undefined, "bridge"), result = await prepared.execute();
  assert.equal(result.reliable, false); assert.equal(result.operation.failure?.reason, "source_protocol_evidence_unavailable");
  assert.deepEqual(result.operation.failure?.observationRpc, { schemaVersion: "apn.bridge-observation-rpc-failure.v1",
    stage: "source_protocol_evidence", effectRole: "bridge", code: "APN_RPC_PROTOCOL", reason: "source_proof" });
  assert.equal(result.operation.observationTelemetry?.length, 1);
  assert.deepEqual(result.operation.observationTelemetry?.[0], { schemaVersion: "apn.bridge-observation-telemetry.v1",
    stage: "source_observation", effectRole: "bridge", outcome: "failure", ...TRACE_TELEMETRY });
  const projectedOperation = transitionBridge(prepared.template, { observationTelemetry: result.operation.observationTelemetry,
    failure: { reason: "source_protocol_evidence_unavailable", residualAllowance: null } },
    new Date(Date.parse(prepared.template.updatedAt) + 1).toISOString());
  const projected = (bridgeReceipt(projectedOperation) as any).observation_rpc_telemetry;
  assert.equal(projected.length, 1); assert.equal(projected[0].physical_requests, 4); assert.equal(projected[0].effect_role, "bridge");
  const serialized = JSON.stringify(projected);
  for (const forbidden of ["base.drpc.org", "publicnode.com", "mainnet.base.org", "authorization", "api_key"])
    assert.equal(serialized.includes(forbidden), false, forbidden);
});

test("LI.FI production observation persists bounded approval_event_identity diagnostics", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const prepared = await productionBaseObservation(temporary.root, "approvalEvent"), result = await prepared.execute();
  assert.equal(result.reliable, false);
  assert.equal(result.operation.failure?.observationRpc?.reason, "approval_event_identity");
  assert.equal(result.operation.failure?.observationRpc?.stage, "source_receipt");
  assert.equal(result.operation.observationTelemetry?.length, 1);
  assert.equal(prepared.run.calls.flatMap((call) => call.rows).some((row) => row.method === "eth_sendRawTransaction"), false);
});

test("LI.FI Base approval observation keeps missing, reverted, first-429 and transient retry outcomes bounded", async () => {
  const missing = await baseApprovalObservation("missing"); assert.equal(await missing.observe(), null);
  assert.equal(missing.session.telemetry().httpRequests, 3); assert.equal(missing.session.telemetry().httpAttempts, 3);
  const reverted = await baseApprovalObservation("reverted"), revertedProof = await reverted.observe();
  assert.equal(revertedProof?.transaction.status, "reverted"); assert.equal(reverted.session.telemetry().httpRequests, 4);
  const retried = await baseApprovalObservation("retry503"), recovered = await retried.observe(); assert.ok(recovered);
  assert.equal(retried.session.telemetry().httpRequests, 4); assert.equal(retried.session.telemetry().httpAttempts, 5);
  const retryCalls = retried.calls.filter(call => call.rows.some(row => row.method === "eth_getBlockByNumber" && row.params[0] === retried.s.block.number));
  assert.deepEqual(retryCalls[0], retryCalls[1]); // The one retry preserves the exact request and its id.
  const limitedRuns = [];
  for (const mode of ["first429", "terminal429"] as const) {
    const limited = await baseApprovalObservation(mode);
    await assert.rejects(limited.observe(), (error: unknown) => error instanceof Error &&
      (error as { code?: string; details?: { retryAfterMs?: string } }).code === "APN_RPC_RATE_LIMITED" &&
      (error as { details?: { retryAfterMs?: string } }).details?.retryAfterMs === "1000");
    assert.equal(limited.session.telemetry().httpRequests, 1); assert.equal(limited.session.telemetry().httpAttempts, 1);
    assert.equal(limited.session.telemetry().retryAfterMs, 1_000);
    limitedRuns.push(limited);
  }
  for (const run of [missing, reverted, retried, ...limitedRuns]) {
    assert.equal(run.calls.flatMap((call) => call.rows).some((row) => row.method === "eth_sendRawTransaction"), false);
    assert.ok(run.traces.every((call) => call.endpointRole !== "archive"));
  }
});

test("LI.FI Base actual fee comes from the receipt: explicit L1 fee, operator fee from its fields, DA footprint not a charge", () => {
  const receipt = { gasUsed: "0x108bd", effectiveGasPrice: "0x5f5e100", type: "0x2", l1Fee: "0x2c50fa21", daFootprintGasScalar: "0x94" };
  const execution = 0x108bdn * 0x5f5e100n, actual = bridgeActualFees(8453, receipt);
  assert.equal(actual.actualTotalFeeWei, (execution + 0x2c50fa21n).toString()); assert.equal(actual.operatorFeeWei, "0");
  assert.equal(actual.blobFeeWei, "0"); assert.equal(actual.feeEvidence.baseOracle, null); assert.equal(actual.feeEvidence.ruleHash, BRIDGE_RECEIPT_FEE_RULE_HASH);
  const operated = bridgeActualFees(8453, { ...receipt, operatorFeeScalar: "0x2", operatorFeeConstant: "0x3" });
  assert.equal(operated.operatorFeeWei, (0x108bdn * 2n * 100n + 3n).toString());
  // The Jovian DA footprint scalar is not a charge; an RPC that omits it still yields the same fee (BRDG-24, LIFI-02).
  const { daFootprintGasScalar: _footprint, ...withoutFootprint } = receipt;
  assert.equal(bridgeActualFees(8453, withoutFootprint).actualTotalFeeWei, actual.actualTotalFeeWei);
  for (const broken of [{ l1Fee: undefined }, { daFootprintGasScalar: "0x094" }, { operatorFeeScalar: "0x1" }, { operatorFeeScalar: "0x100000000", operatorFeeConstant: "0x0" },
    { type: "0x3" }]) {
    assert.throws(() => bridgeActualFees(8453, Object.fromEntries(Object.entries({ ...receipt, ...broken }).filter(([, value]) => value !== undefined))),
      { code: "APN_RPC_PROTOCOL" });
  }
});

test("legacy migration fee proof still proves operator zero at the receipt block through the pinned oracle", async () => {
  const s = await baseFeeFixture(); assert.equal(s.receipt.operatorFeeScalar, undefined);
  const actual = await legacyBridgeActualFees(8453, s.receipt, s.block, s.call);
  const execution = BigInt(s.receipt.gasUsed) * BigInt(s.receipt.effectiveGasPrice);
  assert.equal(actual.actualTotalFeeWei, (execution + BigInt(s.receipt.l1Fee)).toString());
  assert.equal(actual.blobFeeWei, "0"); assert.equal(actual.operatorFeeWei, "0"); assert.equal(actual.feeEvidence.baseOracle!.blockHash, s.block.hash);
  assert.equal(s.observed.length, 11); assert.ok(s.observed.filter((r) => r.request.method === "eth_getCode").every((r) => r.result.length > 1000));
  const mutations: Array<(s: Awaited<ReturnType<typeof baseFeeFixture>>) => void> = [
    (s) => { s.entries.find((r) => r.label === "gpo.implementationCode")!.result = "0x6000"; },
    (s) => { s.entries.find((r) => r.label === "gpo.proxyImplementationSlot")!.result = word(1n); },
    (s) => { s.entries.find((r) => r.label === "gpo.version")!.result = "0x"; },
    (s) => { s.entries.find((r) => r.label === "gpo.isJovian")!.result = word(0n); },
    (s) => { s.entries.find((r) => r.label === "gpo.getOperatorFee.gasUsed67773")!.result = word(1n); },
    (s) => { s.entries.find((r) => r.label === "l1Block.operatorFeeScalar")!.result = word(1n << 32n); },
  ];
  for (const mutate of mutations) { const s = await baseFeeFixture(); mutate(s); await assert.rejects(legacyBridgeActualFees(8453, s.receipt, s.block, s.call), { code: "APN_RPC_PROTOCOL" }); }
});

test("LI.FI actual fee arithmetic counts Arbitrum poster gas once and Ethereum type-3 blob gas separately", () => {
  const receipt = { gasUsed: "0x64", effectiveGasPrice: "0xa", type: "0x2", gasUsedForL1: "0x14" };
  const arb = bridgeActualFees(42161, receipt); assert.equal(arb.actualTotalFeeWei, "1000"); assert.equal(arb.l1DataFeeWei, "0"); assert.equal(arb.feeEvidence.arbitrumPosterGasAtomic, "20");
  assert.throws(() => bridgeActualFees(42161, { ...receipt, gasUsedForL1: "0x65" }), { code: "APN_RPC_PROTOCOL" });
  const eth = bridgeActualFees(1, { ...receipt, type: "0x3", blobGasUsed: "0x2", blobGasPrice: "0x3" });
  assert.equal(eth.actualTotalFeeWei, "1006"); assert.equal(eth.blobFeeWei, "6");
  assert.throws(() => bridgeActualFees(1, { ...receipt, type: "0x3" }), { code: "APN_RPC_PROTOCOL" });
});

test("LI.FI Base fee quote budgets 16 KiB signed bytes while existing direct-transfer quote retains 512 bytes", async () => {
  const inputs: Hex[] = [], call: EvmRpcCall = async (method, params) => {
    if (method === "eth_chainId") return "0x2105";
    if (method === "eth_getBlockByNumber") return { number: "0x1", hash: word(1n), timestamp: "0x1" };
    assert.equal(method, "eth_call"); inputs.push((params[0] as { data: Hex }).data); return word(0n);
  };
  const economics = { nonceAtomic: "0", gasLimitAtomic: "400000", maxFeePerGasAtomic: "2", maxPriorityFeePerGasAtomic: "0", maximumGasCostAtomic: "800000" };
  await new EvmRpc(call, "https://base.example").feeQuote(8453, economics); const direct = inputs[0]!;
  inputs.length = 0; await new BridgeRpc(8453, "https://base.example", call).feeQuote({ economics });
  assert.equal(BigInt(`0x${direct.slice(-64)}`), 512n); assert.equal(BigInt(`0x${inputs[0]!.slice(-64)}`), 16384n); assert.equal(direct.slice(0, 10), inputs[0]!.slice(0, 10));
});

async function sessionHeaderObservation(mutation: "none" | "chain" | "inclusion" | "safe" = "none", scalarReorg = false) {
  const s = await rpcObservation(), posts: Array<{ host: string; batch: boolean; methods: string[] }> = [];
  let numericInclusionReads = 0;
  const transport = { request: async (endpoint: string, _verb: string, body: string | null) => {
    const parsed = JSON.parse(body!) as { id: string; method: string; params: unknown[] } | Array<{ id: string; method: string; params: unknown[] }>;
    const requests = Array.isArray(parsed) ? parsed : [parsed];
    posts.push({ host: new URL(endpoint).host, batch: Array.isArray(parsed), methods: requests.map(row => row.method) });
    const responses = requests.map(request => {
      let result: unknown;
      if (request.method === "eth_chainId") result = mutation === "chain" ? "0x2105" : "0x1";
      else if (request.method === "eth_getTransactionByHash") result = s.tx;
      else if (request.method === "eth_getTransactionReceipt") result = s.receipt;
      else if (request.method === "eth_getBlockByNumber") {
        const safe = request.params[0] === "safe" || request.params[0] === "0x7d1";
        result = safe ? { ...s.block, number: "0x7d1", hash: word(99n) } : s.block;
        if (request.params[0] === s.block.number) numericInclusionReads += 1;
        const recheck = Array.isArray(parsed) || scalarReorg && (safe ? request.params[0] === "0x7d1" : numericInclusionReads > 1);
        if (recheck && (mutation === "inclusion" && !safe || mutation === "safe" && safe))
          result = { ...(result as Json), hash: word(100n) };
      } else throw new Error(`unexpected method: ${request.method}`);
      return { jsonrpc: "2.0", id: request.id, result };
    });
    return { status: 200, body: JSON.stringify(Array.isArray(parsed) ? responses : responses[0]) };
  } };
  const environment = { APN_ETHEREUM_RPC_URL: "https://primary.example" };
  const options = { transport, wait: async () => {} };
  const factory = bridgeRpcFactory(environment, options);
  return { ...s, posts, scalar: factory(1), session: factory(1, new RpcReadSession({ wait: async () => {} })) };
}

test("an ad-hoc adapter and a command session prove the same canonical inclusion on the primary alone", async () => {
  const s = await sessionHeaderObservation();
  const scalar = await s.scalar.observe(s.hash), session = await s.session.observe(s.hash);
  assert.ok(scalar); assert.deepEqual(session, scalar);
  assert.ok(s.posts.every(row => row.host === "primary.example"));
  assert.ok(s.posts.every(row => row.methods.every(method => !method.includes("send"))));
});

test("LI.FI primary session proof rejects a chain mismatch", async () => {
  const s = await sessionHeaderObservation("chain");
  await assert.rejects(s.session.observe(s.hash), { code: "APN_CHAIN_MISMATCH" });
  assert.ok(s.posts.every(row => row.host === "primary.example"));
});

for (const capacity of [3, 4]) test(`Base canonical observation enforces ${capacity} physical request ceiling`, async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const prepared = await productionBaseObservation(temporary.root, "success", { maxHttpRequests: capacity, maxHttpAttempts: 6 });
  const result = await prepared.execute();
  assert.equal(result.reliable, capacity === 4);
  assert.equal(prepared.run.calls.length, capacity);
  if (capacity === 3) {
    // An exhausted read budget defers to the next resume: no unknown-finality diagnostic, no state change.
    assert.equal(result.operation.failure, null); assert.equal(result.operation.state, "unknown_finality");
    assert.equal(prepared.run.session.telemetry().budgetRejectedBeforeTransport, 1);
  }
  assert.equal(prepared.run.calls.flatMap(call => call.rows).some(row => row.method === "eth_sendRawTransaction"), false);
  assert.equal(prepared.fixture.source.submissions.length, 0);
});
