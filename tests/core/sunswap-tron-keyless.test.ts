import assert from "node:assert/strict";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import {
  SUNSWAP_USDT, SUNSWAP_V2_CODE_HASHES, SUNSWAP_V2_ROUTER, SUNSWAP_WTRX, SunSwapKeylessQuoteBuilder,
  SunSwapPreparedMaterialStore, buildSunSwapUnsignedTransaction, encodeSunSwapCalldata, observeSunSwapFinality,
  parseSunSwapV2SwapCall, priceSunSwapV2Market, readSunSwapV2Market, validateSunSwapPreparedMaterial, validateSunSwapV2Market,
  type SunSwapKeylessQuoteRequest, type SunSwapObservationRpcPort,
} from "../../src/core.js";
import { TronRpc, type TronMethod } from "../../src/tron/rpc.js";
import { tronHex } from "../../src/tron/codec.js";
import { FakeSunSwapRpc, RESERVE_IN, RESERVE_OUT, blockId, v2Output, v2Receipt } from "./sunswap-tron-fixtures.js";
import { temporaryState } from "./helpers.js";

const OWNER = "TCikdGHFWNFWBc9ZqtTh2dmma1mnC4CanS";
const NOW = new Date("2026-09-18T05:00:00.000Z");
const DEADLINE = Math.floor(NOW.getTime() / 1000) + 300;

function request(overrides: Partial<SunSwapKeylessQuoteRequest> = {}): SunSwapKeylessQuoteRequest & { readonly now: Date } {
  return { command: "swap.sunswap.quote", profile: "sunswap", account: OWNER, recipient: OWNER, amountAtomic: "5000000",
    slippageBps: 50, ownerSlippageCapBps: 50, feeLimitSun: "30000000", deadline: DEADLINE, now: NOW, ...overrides };
}
function funded(rpc: FakeSunSwapRpc, balance = "100000000"): FakeSunSwapRpc {
  rpc.account = { address: tronHex(OWNER), balance: BigInt(balance) }; return rpc;
}

test("TRON RPC allowlist admits the full-node transaction and contract-info reads the observer and quote use", async () => {
  const paths: string[] = [];
  const fetcher: typeof fetch = async (input) => { paths.push(new URL(String(input)).pathname); return Response.json({ ok: true }); };
  const rpc = new TronRpc("https://rpc.example", fetcher);
  for (const method of ["wallet/gettransactionbyid", "wallet/gettransactioninfobyid", "wallet/getcontractinfo",
    "walletsolidity/gettransactionbyid", "walletsolidity/gettransactioninfobyid"] as const) {
    assert.deepEqual(await rpc.call(method, { value: "a".repeat(64) }), { ok: true });
  }
  assert.deepEqual(paths, ["/wallet/gettransactionbyid", "/wallet/gettransactioninfobyid", "/wallet/getcontractinfo",
    "/walletsolidity/gettransactionbyid", "/walletsolidity/gettransactioninfobyid"]);
  for (const method of ["wallet/createtransaction", "wallet/triggersmartcontract", "wallet/getcontract", "v1/accounts"]) {
    await assert.rejects(rpc.call(method as TronMethod, {}), { code: "APN_RPC_CONFIG" });
  }
  await assert.rejects(new TronRpc("https://rpc.example/?apikey=test-only", fetcher).call("wallet/gettransactionbyid", {}), { code: "APN_RPC_CONFIG" });
  assert.equal(paths.length, 5);
});

test("the production TRON RPC now serves the observer's full-node and solidified receipt reads end to end", async () => {
  const intent = { owner: OWNER, recipient: OWNER, inputAmountAtomic: "5000000", minimumOutputAtomic: "1663220", deadlineSeconds: String(DEADLINE) };
  const tx = buildSunSwapUnsignedTransaction({ ...intent, calldata: encodeSunSwapCalldata(intent), callValueAtomic: "5000000",
    referenceBlockId: blockId(86344586n), timestampMs: String(NOW.getTime()), expirationMs: String(DEADLINE * 1000), feeLimitSun: "30000000",
    maximumEnergy: "300000", energyPriceSun: "100", maximumFeeLimitSun: "30000000" });
  const receipt = v2Receipt(tx, OWNER, 5_000_000n, 1_671_577n);
  const paths: string[] = [];
  const fetcher: typeof fetch = async (input) => {
    const path = new URL(String(input)).pathname; paths.push(path);
    if (path.endsWith("/gettransactionbyid")) return Response.json(receipt.transaction);
    if (path.endsWith("/gettransactioninfobyid")) return Response.json({ ...receipt.info, blockNumber: 123, fee: 12345 });
    return Response.json({ blockID: blockId(124n), block_header: { raw_data: { number: 124, timestamp: 1 } } });
  };
  const port: SunSwapObservationRpcPort = new TronRpc("https://rpc.example", fetcher);
  const proof = await observeSunSwapFinality(port, { transactionHash: tx.txID, recipient: OWNER, inputAmountAtomic: "5000000",
    minimumOutputAtomic: "1663220", unsignedRawDataHex: tx.raw_data_hex, maximumFeeSun: "30000000" });
  assert.equal(proof.outputAmountAtomic, "1671577"); assert.equal(proof.trxDebitSun, "5012345"); assert.equal(proof.solidifiedHeadNumber, "124");
  assert.deepEqual(paths.sort(), ["/wallet/gettransactionbyid", "/wallet/gettransactioninfobyid", "/walletsolidity/getnowblock",
    "/walletsolidity/gettransactionbyid", "/walletsolidity/gettransactioninfobyid"]);
});

test("keyless market read proves pinned code, binds the recorded block and prices exactly from reserves", async () => {
  const rpc = new FakeSunSwapRpc();
  const market = await readSunSwapV2Market(rpc, { caller: OWNER, amountInAtomic: "5000000" });
  const expected = v2Output(5_000_000n);
  assert.equal(market.amountOutAtomic, expected.toString()); assert.equal(market.amountOutAtomic, "1671577");
  assert.equal(market.reserveInAtomic, RESERVE_IN.toString()); assert.equal(market.reserveOutAtomic, RESERVE_OUT.toString());
  assert.deepEqual(market.codeHashes, { ...SUNSWAP_V2_CODE_HASHES }); assert.deepEqual(market.path, [SUNSWAP_WTRX, SUNSWAP_USDT]);
  assert.equal(market.referenceBlock.number, "86344586"); assert.equal(market.headBlockNumber, "86344588");
  assert.deepEqual(rpc.calls.map((row) => row.method), ["wallet/getnowblock", ...Array(5).fill("wallet/getcontractinfo"),
    "wallet/triggerconstantcontract", "wallet/triggerconstantcontract", "wallet/getnowblock"]);
  assert.ok(rpc.calls.every((row) => row.body.call_value === undefined));
  assert.deepEqual(validateSunSwapV2Market(structuredClone(market), "stored"), market);
  const pricing = priceSunSwapV2Market(market, 50, 50);
  assert.deepEqual(pricing, { expectedOutputAtomic: "1671577", minimumOutputAtomic: "1663220", slippageBps: 50, ownerSlippageCapBps: 50,
    spotOutputAtomic: "1676606", spotPriceUsdtPerTrx: "0.335321392192", executionPriceUsdtPerTrx: "0.334315400000",
    priceImpactBps: "31", lpFeeBps: "30" });
  assert.equal(BigInt(pricing.minimumOutputAtomic), (expected * 9_950n + 9_999n) / 10_000n);
  assert.throws(() => priceSunSwapV2Market(market, 51, 50), { code: "APN_INVALID_INPUT" });
  assert.equal(priceSunSwapV2Market(market, 0, 0).minimumOutputAtomic, "1671577");
  for (const mutate of [
    (v: any) => { v.amountOutAtomic = "1671578"; }, (v: any) => { v.codeHashes.router = "0".repeat(64); },
    (v: any) => { v.headBlockNumber = "86344597"; }, (v: any) => { v.reserveInAtomic = "1"; }, (v: any) => { v.extra = true; },
    (v: any) => { v.routeHash = "0".repeat(64); }, (v: any) => { v.referenceBlock.number = "86344587"; },
  ]) { const value: any = structuredClone(market); mutate(value); assert.throws(() => validateSunSwapV2Market(value, "stored"), { code: "APN_STATE_CORRUPT" }); }
});

test("keyless market read fails closed on code, reserve, head, echo and revert drift", async () => {
  const codeDrift = new FakeSunSwapRpc(); codeDrift.runtimeOverride = "6080604052";
  await assert.rejects(readSunSwapV2Market(codeDrift, { caller: OWNER, amountInAtomic: "5000000" }),
    { code: "APN_OPERATION_BLOCKED", details: { reason: "sunswap_code_hash_mismatch", contract: SUNSWAP_V2_ROUTER } });
  assert.equal(codeDrift.calls.filter((row) => row.method === "wallet/triggerconstantcontract").length, 0);
  const reserveDrift = new FakeSunSwapRpc(); reserveDrift.reserveShift = 10_000_000_000n;
  await assert.rejects(readSunSwapV2Market(reserveDrift, { caller: OWNER, amountInAtomic: "5000000" }),
    { code: "APN_OPERATION_BLOCKED", details: { reason: "sunswap_reserve_drift" } });
  const headDrift = new FakeSunSwapRpc(); headDrift.heads = [86344586n, 86344597n];
  await assert.rejects(readSunSwapV2Market(headDrift, { caller: OWNER, amountInAtomic: "5000000" }),
    { code: "APN_OPERATION_BLOCKED", details: { reason: "sunswap_head_drift" } });
  const headBehind = new FakeSunSwapRpc(); headBehind.heads = [86344586n, 86344585n];
  await assert.rejects(readSunSwapV2Market(headBehind, { caller: OWNER, amountInAtomic: "5000000" }), { code: "APN_OPERATION_BLOCKED" });
  const echo = new FakeSunSwapRpc(); echo.echoData = "0902f1ac";
  await assert.rejects(readSunSwapV2Market(echo, { caller: OWNER, amountInAtomic: "5000000" }), { code: "APN_RPC_PROTOCOL" });
  const offline = new FakeSunSwapRpc(); offline.call = async () => { throw new Error("offline"); };
  await assert.rejects(readSunSwapV2Market(offline, { caller: OWNER, amountInAtomic: "5000000" }), { code: "APN_RPC_PROTOCOL" });
  for (const amountInAtomic of ["0", "05", "9007199254740992", "1.5"]) {
    await assert.rejects(readSunSwapV2Market(new FakeSunSwapRpc(), { caller: OWNER, amountInAtomic }), { code: "APN_INVALID_INPUT" });
  }
});

test("keyless builder persists exact prepared material by quoteHash and load re-validates every binding", async (t) => {
  const temp = await temporaryState(); t.after(temp.cleanup);
  const rpc = funded(new FakeSunSwapRpc()), store = new SunSwapPreparedMaterialStore(temp.root);
  const builder = new SunSwapKeylessQuoteBuilder(rpc, store);
  const material = await builder.quote(request());
  assert.equal(material.approvalCapAtomic, "0"); assert.equal(material.quote.inputAmountAtomic, "5000000");
  assert.equal(material.quote.expectedOutputAtomic, "1671577"); assert.equal(material.quote.minimumOutputAtomic, "1663220");
  assert.equal(material.quote.recipient, OWNER); assert.equal(material.quote.destinationAsset.identifier, SUNSWAP_USDT);
  assert.equal(material.quote.simulation.blockNumber, "86344586"); assert.equal(material.quote.simulation.headBlockNumber, "86344589");
  assert.deepEqual(material.gasOrEnergy, { resource: "tron_energy", energyUsed: "157354", energyPriceSun: "100",
    estimatedEnergyFeeSun: "15735400", feeLimitSun: "30000000", maximumEnergy: "300000", callValueSun: "5000000",
    maximumTrxDebitSun: "35000000", rawDataBytes: (material.execution.transaction.raw_data_hex.length / 2).toString() });
  const value = material.execution.transaction.raw_data.contract[0].parameter.value;
  assert.equal(value.contract_address, tronHex(SUNSWAP_V2_ROUTER)); assert.equal(value.call_value, 5_000_000);
  assert.equal(material.execution.transaction.raw_data.fee_limit, 30_000_000);
  assert.deepEqual(parseSunSwapV2SwapCall(`0x${value.data}`), { amountOutMinAtomic: "1663220", path: [SUNSWAP_WTRX, SUNSWAP_USDT],
    to: OWNER, deadlineSeconds: DEADLINE.toString() });
  const simulation = rpc.calls.find((row) => row.method === "wallet/triggerconstantcontract" && row.body.call_value !== undefined)!;
  assert.deepEqual(simulation.body, { owner_address: tronHex(OWNER), contract_address: tronHex(SUNSWAP_V2_ROUTER), data: value.data,
    call_value: 5_000_000, visible: false });
  assert.equal(rpc.calls[0]!.method, "wallet/getblockbynum"); assert.equal(rpc.calls.at(-1)!.method, "wallet/getaccount");
  assert.deepEqual(await builder.load(material.quote.quoteHash), material);
  assert.deepEqual(await store.save(structuredClone(material)), material);
  assert.equal(await builder.load("f".repeat(64)), null);
  await assert.rejects(builder.load("F".repeat(64)), { code: "APN_INVALID_INPUT" });
  const path = join(temp.root, "sunswap-tron-prepared", `${material.quote.quoteHash}.json`);
  const stored = JSON.parse(await readFile(path, "utf8"));
  for (const mutate of [
    (v: any) => { v.execution.transaction.raw_data.fee_limit = 40_000_000; }, (v: any) => { v.execution.intent.minimumOutputAtomic = "1"; },
    (v: any) => { v.gasOrEnergy.feeLimitSun = "1"; }, (v: any) => { v.approvalCapAtomic = "1"; },
    (v: any) => { v.execution.market.reserveOutAtomic = "1"; }, (v: any) => { v.execution.simulation.energyRequired = "157355"; },
    (v: any) => { v.execution.pricing.priceImpactBps = "0"; },
  ]) {
    const tampered = structuredClone(stored); mutate(tampered);
    assert.throws(() => validateSunSwapPreparedMaterial(tampered, "stored"), { code: "APN_STATE_CORRUPT" });
    await writeFile(path, JSON.stringify(tampered)); await assert.rejects(builder.load(material.quote.quoteHash), { code: "APN_STATE_CORRUPT" });
  }
});

test("owner economics refuse before any material exists: unactivated, underfunded, fee_limit and revert", async (t) => {
  const temp = await temporaryState(); t.after(temp.cleanup);
  const quote = async (rpc: FakeSunSwapRpc, overrides: Partial<SunSwapKeylessQuoteRequest> = {}) =>
    await new SunSwapKeylessQuoteBuilder(rpc, new SunSwapPreparedMaterialStore(temp.root)).quote(request(overrides));
  const unactivated = new FakeSunSwapRpc(); unactivated.simulation = "not_activated";
  await assert.rejects(quote(unactivated), { code: "APN_INSUFFICIENT_ASSET", details: { reason: "sunswap_owner_not_activated" } });
  const poor = funded(new FakeSunSwapRpc()); poor.simulation = "insufficient";
  await assert.rejects(quote(poor), { code: "APN_INSUFFICIENT_ASSET", details: { reason: "sunswap_owner_trx_insufficient" } });
  await assert.rejects(quote(funded(new FakeSunSwapRpc(), "34999999")),
    { code: "APN_INSUFFICIENT_ASSET", details: { reason: "sunswap_owner_trx_insufficient" } });
  await assert.rejects(quote(new FakeSunSwapRpc()), { code: "APN_INSUFFICIENT_ASSET", details: { reason: "sunswap_owner_not_activated" } });
  await assert.rejects(quote(funded(new FakeSunSwapRpc()), { feeLimitSun: "15735399" }),
    { code: "APN_FEE_BUDGET_EXCEEDED", details: { reason: "sunswap_fee_limit_exceeded" } });
  const reverted = funded(new FakeSunSwapRpc()); reverted.simulation = "revert";
  await assert.rejects(quote(reverted), { code: "APN_OPERATION_BLOCKED",
    details: { reason: "sunswap_constant_call_reverted", revertReason: "UniswapV2Router: INSUFFICIENT_OUTPUT_AMOUNT" } });
  const capped = funded(new FakeSunSwapRpc()); capped.maxFeeLimit = 29_999_999n;
  await assert.rejects(quote(capped), { code: "APN_INVALID_INPUT" });
  const testnet = funded(new FakeSunSwapRpc()); testnet.genesis = `0000000000000000${"d".repeat(48)}`;
  await assert.rejects(quote(testnet), { code: "APN_CHAIN_MISMATCH" });
  for (const overrides of [{ feeLimitSun: "" }, { feeLimitSun: "0" }, { recipient: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t" },
    { deadline: DEADLINE + 301 }, { deadline: Math.floor(NOW.getTime() / 1000) }, { slippageBps: 51 }, { amountAtomic: "9007199254740992" }]) {
    const rpc = funded(new FakeSunSwapRpc());
    await assert.rejects(quote(rpc, overrides as Partial<SunSwapKeylessQuoteRequest>), { code: "APN_INVALID_INPUT" }); assert.equal(rpc.calls.length, 0);
  }
  const extra: any = { ...request(), feeLimit: "30000000" };
  await assert.rejects(new SunSwapKeylessQuoteBuilder(funded(new FakeSunSwapRpc()), new SunSwapPreparedMaterialStore(temp.root)).quote(extra), { code: "APN_INVALID_INPUT" });
  assert.deepEqual(await readdir(join(temp.root, "sunswap-tron-prepared")).catch(() => []), []);
});
