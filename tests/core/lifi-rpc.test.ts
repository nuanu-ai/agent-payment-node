import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { keccak256, parseTransaction, type TransactionSerializable } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { canonicalJson, sha256 } from "../../src/canonical.js";
import { EvmRpc } from "../../src/evm-rpc.js";
import type { EvmRpcCall } from "../../src/evm-ports.js";
import type { Hex } from "../../src/model.js";
import { BridgeRpc } from "../../src/lifi/rpc.js";
import { bridgeActualFees } from "../../src/lifi/rpc-fees.js";
import { evmTransactionSignatureScalar, verifyRpcTransaction } from "../../src/lifi/rpc-transaction.js";
import { verifyBridgeSigned } from "../../src/lifi/transaction.js";
import { BRIDGE_DIAMOND } from "../../src/lifi/validation.js";
import type { BridgeEnvelope } from "../../src/lifi/model.js";
import { LIFI_RECIPIENT, LIFI_SYNTHETIC_KEY, LIFI_SYNTHETIC_SENDER } from "./lifi-helpers.js";

type Json = Record<string, any>;
const word = (n: bigint): Hex => `0x${n.toString(16).padStart(64, "0")}`, quantity = (n: bigint | number) => `0x${n.toString(16)}`;
const TYPES = ["legacy", "eip2930", "eip1559", "eip4844", "eip7702"] as const;
async function signedRpcTransaction(index = 2, nonce = 7) {
  const type = TYPES[index]!, account = privateKeyToAccount(LIFI_SYNTHETIC_KEY);
  const common = { chainId: 1, to: BRIDGE_DIAMOND, nonce, gas: 400000n, value: 0n, data: "0x12345678" as Hex };
  const fees = { maxFeePerGas: 2000000000n, maxPriorityFeePerGas: 0n };
  let transaction: TransactionSerializable;
  if (type === "legacy") transaction = { ...common, type, gasPrice: 2000000000n };
  else if (type === "eip2930") transaction = { ...common, type, gasPrice: 2000000000n, accessList: [{ address: LIFI_RECIPIENT, storageKeys: [word(5n) as Hex] }] };
  else if (type === "eip1559") transaction = { ...common, ...fees, type, accessList: [] };
  else if (type === "eip4844") transaction = { ...common, ...fees, type, maxFeePerBlobGas: 100n, blobVersionedHashes: [`0x01${"67".repeat(31)}`], accessList: [] };
  else transaction = { ...common, ...fees, type, accessList: [], authorizationList: [await account.signAuthorization({ chainId: 1, contractAddress: LIFI_RECIPIENT, nonce: 0 })] };
  const raw = await account.signTransaction(transaction), parsed = parseTransaction(raw) as Json, hash = keccak256(raw);
  const rpc: Json = { hash, chainId: "0x1", type: quantity(index), nonce: quantity(nonce), from: account.address, to: common.to,
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

async function rpcObservation() {
  const s = await signedRpcTransaction(), blockHash = `0x${"ab".repeat(32)}` as Hex;
  const block: Json = { number: "0x7d0", hash: blockHash, timestamp: "0x6aa004bb", baseFeePerGas: "0x1", transactions: [s.hash] };
  const tx: Json = { ...s.rpc, blockNumber: block.number, blockHash, transactionIndex: "0x0" };
  const receipt: Json = { transactionHash: s.hash, blockNumber: block.number, blockHash, transactionIndex: "0x0", from: tx.from, to: tx.to,
    type: "0x2", status: "0x1", gasUsed: "0x5208", effectiveGasPrice: "0x3b9aca00", logs: [{ address: LIFI_RECIPIENT,
      blockHash, blockNumber: block.number, transactionHash: s.hash, transactionIndex: "0x0", logIndex: "0x0", removed: false, topics: [word(2n)], data: "0x" }] };
  const methods: string[] = [];
  const call: EvmRpcCall = async (method) => {
    methods.push(method);
    if (method === "eth_chainId") return "0x1";
    if (method === "eth_getBlockByNumber") return block;
    if (method === "eth_getTransactionByHash") return tx;
    if (method === "eth_getTransactionReceipt") return receipt;
    throw new Error(`unexpected method: ${method}`);
  };
  return { ...s, tx, receipt, block, methods, rpcAdapter: new BridgeRpc(1, "https://ethereum.example", call) };
}
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
  ];
  for (const mutate of mutations) { const s = await rpcObservation(); mutate(s); await assert.rejects(s.rpcAdapter.observe(s.hash), { code: "APN_RPC_PROTOCOL" }); }
});

test("LI.FI destination log scan enforces exact correlation, 1024-block and 128-log bounds", async () => {
  const topic = word(5n) as Hex, hash = word(7n) as Hex, blockHash = word(8n) as Hex;
  let rows: Json[] = [], calls = 0;
  const rpc = new BridgeRpc(1, "https://ethereum.example", async (method) => {
    if (method === "eth_chainId") return "0x1"; assert.equal(method, "eth_getLogs"); calls++; return rows;
  });
  const input = { address: LIFI_RECIPIENT, fromBlockAtomic: "1", toBlockAtomic: "1024", topics: [topic, word(6n) as Hex] };
  await assert.rejects(rpc.logs({ ...input, toBlockAtomic: "1025" }), { code: "APN_RPC_PROTOCOL" }); assert.equal(calls, 0);
  const valid = { address: LIFI_RECIPIENT, blockNumber: "0x2", blockHash, transactionHash: hash, topics: input.topics, removed: false, data: "0x" };
  rows = [valid]; assert.deepEqual(await rpc.logs(input), [{ transactionHash: hash, blockNumberAtomic: "2", blockHash }]);
  for (const change of [{ address: BRIDGE_DIAMOND }, { topics: [word(9n), word(6n)] }, { removed: true }, { blockNumber: "0x0" }, { blockHash: word(0n) }]) {
    rows = [{ ...valid, ...change }]; await assert.rejects(rpc.logs(input), { code: "APN_RPC_PROTOCOL" });
  }
  rows = Array.from({ length: 129 }, () => valid); await assert.rejects(rpc.logs(input), { code: "APN_RPC_PROTOCOL" });
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
