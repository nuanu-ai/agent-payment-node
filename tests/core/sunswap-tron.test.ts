import assert from "node:assert/strict";
import test from "node:test";
import { decodeAbiParameters, decodeFunctionData, encodeFunctionData, parseAbi, type Hex } from "viem";
import {
  SUNSWAP_PIN_CATALOG, SUNSWAP_PIN_CATALOG_SHA256, SUNSWAP_USDT, SUNSWAP_V4_UNIVERSAL_ROUTER,
  SunSwapQuoteAdapter, assertSunSwapDirectRoute, buildSunSwapUnsignedTransaction, decodeSunSwapCalldata, decodeSunSwapQuote,
  createSunSwapQuoteSnapshot, encodeSunSwapCalldata, loadSunSwapPinCatalog, observeSunSwapReceipt, simulateSunSwapTransaction,
  sunSwapQuoteUrl, validateSunSwapQuoteRoute, validateSunSwapReceipt, validateSunSwapUnsignedTransaction,
  type SunSwapCalldataIntent, type SunSwapUnsignedIntent,
} from "../../src/core.js";
import { tronHex } from "../../src/tron/codec.js";
import type { TronMethod, TronRpcPort } from "../../src/tron/rpc.js";

const OWNER = "TVjuTE3V5bMVdpfNhid8kD2v35T2k1u1Br";
const RECIPIENT = "TTJxU3P8rHycAyFY4kVtGNfmnMH4ezcuM9";
const HASH = "000000000000007b" + "1".repeat(48);
const intent: SunSwapCalldataIntent = { owner: OWNER, recipient: RECIPIENT, inputAmountAtomic: "1000000", minimumOutputAtomic: "300000", deadlineSeconds: "1789613100" };
const unsignedIntent = (): SunSwapUnsignedIntent => ({ ...intent, calldata: encodeSunSwapCalldata(intent), callValueAtomic: "1000000",
  referenceBlockId: HASH, timestampMs: "1789612800000", expirationMs: "1789613100000", feeLimitSun: "100000000",
  maximumEnergy: "100000", energyPriceSun: "100", maximumFeeLimitSun: "100000000" });

function quoteResponse() {
  return { code: 0, message: "SUCCESS", data: [{ roadForAddr: ["T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb", SUNSWAP_USDT],
    roadForName: ["TRX", "USDT"], pool: ["v2"], amount: "0.345678", inUsd: "1.0", outUsd: "0.345678",
    impact: "-0.001", fee: "0.003" }] };
}

test("frozen SunSwap catalog binds exact official identities, sources and digest", () => {
  assert.equal(loadSunSwapPinCatalog().router, SUNSWAP_V4_UNIVERSAL_ROUTER);
  assert.match(SUNSWAP_PIN_CATALOG_SHA256, /^[a-f0-9]{64}$/u);
  for (const mutate of [
    (v: any) => { v.router = RECIPIENT; }, (v: any) => { v.chainId = 1; },
    (v: any) => { v.quoteUrl = "https://example.com"; }, (v: any) => { v.sources[0].sha256 = "0".repeat(64); },
  ]) { const value: any = structuredClone(SUNSWAP_PIN_CATALOG); mutate(value); assert.throws(() => loadSunSwapPinCatalog(value), { code: "APN_STATE_CORRUPT" }); }
});

test("quote codec binds the native TRX to USDT route and bounded GET", async () => {
  const url = sunSwapQuoteUrl({ inputAmountAtomic: "1000000" });
  assert.equal(url.origin + url.pathname, "https://open.sun.io/apiv2/quote/swap/routingInV2");
  assert.equal(url.searchParams.get("fromTokenAddr"), "T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb");
  const routes = decodeSunSwapQuote(quoteResponse()); assert.equal(routes[0]!.amountOutAtomic, "345678"); assert.match(routes[0]!.routeHash, /^[a-f0-9]{64}$/u);
  assert.deepEqual(validateSunSwapQuoteRoute(structuredClone(routes[0]!)), routes[0]); assert.deepEqual(assertSunSwapDirectRoute(routes[0], "300000"), routes[0]);
  const routeTamper: any = structuredClone(routes[0]!); routeTamper.roadForName[0] = "WTRX";
  assert.throws(() => validateSunSwapQuoteRoute(routeTamper), { code: "APN_PROVIDER_PROTOCOL" });
  assert.throws(() => assertSunSwapDirectRoute(routes[0], "345679"), { code: "APN_OPERATION_BLOCKED" });
  const snapshot = createSunSwapQuoteSnapshot({ profile: "sunswap", account: OWNER, recipient: RECIPIENT, inputAmountAtomic: "1000000",
    minimumOutputAtomic: "300000", slippageBps: 2000, effectiveAt: "2026-09-17T00:00:00.000Z", expiresAt: "2026-09-17T00:05:00.000Z",
    providerResponseHash: "a".repeat(64), unsignedTransactionPayloadHash: "b".repeat(64), route: routes[0]!,
    simulation: { requestHash: "c".repeat(64), resultHash: "d".repeat(64), success: true } });
  assert.equal(snapshot.sourceAsset.kind, "native"); assert.equal(snapshot.destinationAsset.identifier, SUNSWAP_USDT); assert.equal(snapshot.routeHash, routes[0]!.routeHash);
  let called = false;
  const adapter = new SunSwapQuoteAdapter(async (request, init) => { called = true; assert.equal(init?.method, "GET");
    assert.equal(new URL(String(request)).host, "open.sun.io"); return Response.json(quoteResponse()); });
  assert.equal((await adapter.quote({ inputAmountAtomic: "1000000" }))[0]!.amountOutAtomic, "345678"); assert.equal(called, true);
  for (const mutate of [
    (v: any) => { v.data[0].roadForAddr[0] = SUNSWAP_USDT; }, (v: any) => { v.data[0].amount = "0.1234567"; },
    (v: any) => { v.data[0].pool = []; }, (v: any) => { v.data[0].extra = true; }, (v: any) => { v.code = 1; },
  ]) { const value: any = quoteResponse(); mutate(value); assert.throws(() => decodeSunSwapQuote(value), { code: "APN_PROVIDER_PROTOCOL" }); }
  assert.throws(() => sunSwapQuoteUrl({ inputAmountAtomic: "01" }), { code: "APN_INVALID_INPUT" });
});

test("router decoder proves calldata value recipient deadline path and rejects all other commands", () => {
  const calldata = encodeSunSwapCalldata(intent); const decoded = decodeSunSwapCalldata(calldata, "1000000", intent);
  assert.equal(decoded.command, "0x08"); assert.equal(decoded.sourceAsset, "T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb"); assert.equal(decoded.destinationAsset, SUNSWAP_USDT);
  assert.throws(() => decodeSunSwapCalldata(calldata, "999999", intent), { code: "APN_OPERATION_BLOCKED" });
  assert.throws(() => decodeSunSwapCalldata(calldata, "1000000", { ...intent, recipient: OWNER }), { code: "APN_OPERATION_BLOCKED" });
  assert.throws(() => decodeSunSwapCalldata(calldata, "1000000", { ...intent, deadlineSeconds: "1789613101" }), { code: "APN_OPERATION_BLOCKED" });
  assert.throws(() => decodeSunSwapCalldata(calldata, "1000000", { ...intent, minimumOutputAtomic: "300001" }), { code: "APN_OPERATION_BLOCKED" });
  const abi = parseAbi(["function execute(bytes commands, bytes[] inputs, uint256 deadline) payable"]);
  const parsed = decodeFunctionData({ abi, data: calldata }); const [, inputs, deadline] = parsed.args;
  for (const command of ["0x02", "0x03", "0x0a", "0x12", "0x21"]) {
    const altered = encodeFunctionData({ abi, functionName: "execute", args: [command as Hex, inputs, deadline] });
    assert.throws(() => decodeSunSwapCalldata(altered, "1000000", intent), { code: "APN_OPERATION_BLOCKED" });
  }
  const inputTypes = [{ type: "address" }, { type: "uint256" }, { type: "uint256" }, { type: "address[]" }, { type: "bool" }] as const;
  const [recipient, amount, minimum, path] = decodeAbiParameters(inputTypes, inputs[0]!);
  assert.equal(recipient.toLowerCase(), `0x${tronHex(RECIPIENT).slice(2)}`); assert.equal(amount, 1000000n); assert.equal(minimum, 300000n); assert.equal(path.length, 2);
});

test("unsigned TriggerSmartContract is exact and energy fee bounds fail closed", () => {
  const frozen = unsignedIntent(); const tx = buildSunSwapUnsignedTransaction(frozen);
  assert.equal(tx.raw_data.contract[0].parameter.value.call_value, 1000000); assert.equal(tx.raw_data.contract[0].parameter.value.contract_address, tronHex(SUNSWAP_V4_UNIVERSAL_ROUTER));
  assert.deepEqual(validateSunSwapUnsignedTransaction(structuredClone(tx), frozen), tx);
  const tampered: any = structuredClone(tx); tampered.raw_data.contract[0].parameter.value.call_value++;
  assert.throws(() => validateSunSwapUnsignedTransaction(tampered, frozen), { code: "APN_WALLET_MISMATCH" });
  assert.throws(() => buildSunSwapUnsignedTransaction({ ...frozen, feeLimitSun: "9999999" }), { code: "APN_FEE_BUDGET_EXCEEDED" });
  assert.throws(() => buildSunSwapUnsignedTransaction({ ...frozen, feeLimitSun: "100000001" }), { code: "APN_FEE_BUDGET_EXCEEDED" });
  assert.throws(() => buildSunSwapUnsignedTransaction({ ...frozen, expirationMs: "1789614000000" }), { code: "APN_INVALID_INPUT" });
});

class FakeRpc implements TronRpcPort {
  readonly originHash = "a".repeat(64); readonly calls: TronMethod[] = [];
  constructor(readonly handler: (method: TronMethod) => unknown | Promise<unknown>) {}
  async call(method: TronMethod): Promise<unknown> { this.calls.push(method); return await this.handler(method); }
}

test("simulation requires bound triggerconstantcontract and estimateenergy proofs", async () => {
  const frozen = unsignedIntent(), tx = buildSunSwapUnsignedTransaction(frozen);
  const rpc = new FakeRpc((method) => ({ result: { result: true }, transaction: { txID: tx.txID, raw_data_hex: tx.raw_data_hex },
    ...(method === "wallet/estimateenergy" ? { energy_required: "50000" } : { energy_used: "49000" }) }));
  const proof = await simulateSunSwapTransaction(rpc, tx, frozen); assert.equal(proof.energyRequired, "50000");
  assert.deepEqual(rpc.calls, ["wallet/triggerconstantcontract", "wallet/estimateenergy"]);
  await assert.rejects(simulateSunSwapTransaction(new FakeRpc(() => { throw new Error("offline"); }), tx, frozen), { code: "APN_RPC_PROTOCOL" });
  await assert.rejects(simulateSunSwapTransaction(new FakeRpc(() => ({ result: { result: false }, transaction: { txID: tx.txID, raw_data_hex: tx.raw_data_hex } })), tx, frozen), { code: "APN_OPERATION_BLOCKED" });
  await assert.rejects(simulateSunSwapTransaction(new FakeRpc((method) => ({ result: { result: true }, transaction: { txID: "f".repeat(64), raw_data_hex: tx.raw_data_hex },
    ...(method === "wallet/estimateenergy" ? { energy_required: "50000" } : { energy_used: "50000" }) })), tx, frozen), { code: "APN_OPERATION_BLOCKED" });
  await assert.rejects(simulateSunSwapTransaction(new FakeRpc((method) => ({ result: { result: true }, transaction: { txID: tx.txID, raw_data_hex: tx.raw_data_hex },
    ...(method === "wallet/estimateenergy" ? { energy_required: "100001" } : { energy_used: "50000" }) })), tx, frozen), { code: "APN_FEE_BUDGET_EXCEEDED" });
});

function receiptFixture(txID: string, raw: string, output = "300001", solid = "124") {
  const topic = tronHex(RECIPIENT).slice(2).padStart(64, "0");
  const transaction = { txID, raw_data_hex: raw, ret: [{ contractRet: "SUCCESS" }] };
  const info = { id: txID, blockNumber: "123", fee: "12345", receipt: { result: "SUCCESS" }, log: [{ address: tronHex(SUNSWAP_USDT),
    topics: ["ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef", "0".repeat(64), topic], data: BigInt(output).toString(16).padStart(64, "0") }] };
  return { transaction, info, solid };
}

test("walletsolidity receipt proves solidification and canonical USDT minimum output", async () => {
  const tx = buildSunSwapUnsignedTransaction(unsignedIntent()); const expected = { transactionHash: tx.txID, recipient: RECIPIENT,
    minimumOutputAtomic: "300000", unsignedRawDataHex: tx.raw_data_hex, maximumFeeSun: "100000" };
  const fixture = receiptFixture(tx.txID, tx.raw_data_hex); const proof = validateSunSwapReceipt(fixture.transaction, fixture.info, fixture.solid, expected);
  assert.equal(proof.outputAmountAtomic, "300001"); assert.equal(proof.finalized, true);
  const calls = new FakeRpc((method) => method.endsWith("gettransactionbyid") ? fixture.transaction : method.endsWith("gettransactioninfobyid") ? fixture.info :
    { block_header: { raw_data: { number: fixture.solid } } });
  assert.equal((await observeSunSwapReceipt(calls, expected)).transactionHash, tx.txID);
  for (const mutate of [
    (v: any) => { v.info.log[0].data = BigInt(299999).toString(16).padStart(64, "0"); },
    (v: any) => { v.info.log[0].topics[2] = "0".repeat(64); }, (v: any) => { v.info.log[0].address = tronHex(OWNER); },
    (v: any) => { v.info.receipt.result = "FAILED"; }, (v: any) => { v.info.fee = "100001"; },
    (v: any) => { v.solid = "122"; }, (v: any) => { v.transaction.raw_data_hex = "00"; },
  ]) { const value: any = receiptFixture(tx.txID, tx.raw_data_hex); mutate(value);
    assert.throws(() => validateSunSwapReceipt(value.transaction, value.info, value.solid, expected), { code: "APN_RPC_PROTOCOL" }); }
});
