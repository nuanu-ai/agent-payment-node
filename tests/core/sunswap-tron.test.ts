import assert from "node:assert/strict";
import test from "node:test";
import { encodeFunctionData, parseAbi, type Address } from "viem";
import {
  SUNSWAP_PIN_CATALOG, SUNSWAP_PIN_CATALOG_SHA256, SUNSWAP_USDT, SUNSWAP_V2_ROUTER, SUNSWAP_V2_WTRX_USDT_PAIR, SUNSWAP_WTRX,
  buildSunSwapUnsignedTransaction, createSunSwapQuoteSnapshot, decodeSunSwapCalldata, encodeSunSwapCalldata, loadSunSwapPinCatalog,
  observeSunSwapReceipt, parseSunSwapV2SwapCall, simulateSunSwapTransaction, validateSunSwapReceipt, validateSunSwapUnsignedTransaction,
  type SunSwapCalldataIntent, type SunSwapUnsignedIntent,
} from "../../src/core.js";
import { tronHex } from "../../src/tron/codec.js";
import { FakeSunSwapRpc, blockId, syntheticMarket, v2Output, v2Receipt, word } from "./sunswap-tron-fixtures.js";

const OWNER = "TVjuTE3V5bMVdpfNhid8kD2v35T2k1u1Br";
const HASH = blockId(86344586n);
const intent: SunSwapCalldataIntent = { owner: OWNER, recipient: OWNER, inputAmountAtomic: "1000000", minimumOutputAtomic: "300000", deadlineSeconds: "1789613100" };
const unsignedIntent = (): SunSwapUnsignedIntent => ({ ...intent, calldata: encodeSunSwapCalldata(intent), callValueAtomic: "1000000",
  referenceBlockId: HASH, timestampMs: "1789612800000", expirationMs: "1789613100000", feeLimitSun: "30000000",
  maximumEnergy: "300000", energyPriceSun: "100", maximumFeeLimitSun: "30000000" });
const ABI = parseAbi(["function swapExactETHForTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline) payable returns (uint256[] amounts)",
  "function swapExactETHForTokensSupportingFeeOnTransferTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline) payable"]);
const abi = (address: string) => `0x${tronHex(address).slice(2)}` as Address;

test("frozen V2 catalog binds on-chain verified router, factory, pair, tokens, code hashes and digest", () => {
  const catalog = loadSunSwapPinCatalog();
  assert.equal(catalog.router.address, SUNSWAP_V2_ROUTER); assert.equal(catalog.router.wrappedNative, SUNSWAP_WTRX);
  assert.equal(catalog.pair.address, SUNSWAP_V2_WTRX_USDT_PAIR); assert.equal(catalog.pair.token0, SUNSWAP_WTRX);
  assert.equal(catalog.pair.token1, SUNSWAP_USDT); assert.equal(catalog.swapSelector, "7ff36ab5");
  assert.equal(JSON.stringify(catalog).includes("open.sun.io"), false); assert.match(SUNSWAP_PIN_CATALOG_SHA256, /^[a-f0-9]{64}$/u);
  for (const mutate of [
    (v: any) => { v.router.address = SUNSWAP_USDT; }, (v: any) => { v.chainId = 1; }, (v: any) => { v.pair.codeHash = "0".repeat(64); },
    (v: any) => { v.path.reverse(); }, (v: any) => { v.quoteUrl = "https://example.com"; }, (v: any) => { v.pair.lpFeeNumerator = 998; },
  ]) { const value: any = structuredClone(SUNSWAP_PIN_CATALOG); mutate(value); assert.throws(() => loadSunSwapPinCatalog(value), { code: "APN_STATE_CORRUPT" }); }
});

test("swapExactETHForTokens encoder and strict decoder round-trip only the owner-bound WTRX to USDT call", () => {
  const calldata = encodeSunSwapCalldata(intent);
  assert.equal(calldata.slice(2, 10), "7ff36ab5"); assert.equal(calldata.length, 458);
  assert.equal(calldata, encodeFunctionData({ abi: ABI, functionName: "swapExactETHForTokens",
    args: [300000n, [abi(SUNSWAP_WTRX), abi(SUNSWAP_USDT)], abi(OWNER), 1789613100n] }));
  assert.deepEqual(parseSunSwapV2SwapCall(calldata), { amountOutMinAtomic: "300000", path: [SUNSWAP_WTRX, SUNSWAP_USDT], to: OWNER,
    deadlineSeconds: "1789613100" });
  const decoded = decodeSunSwapCalldata(calldata, "1000000", intent);
  assert.equal(decoded.router, SUNSWAP_V2_ROUTER); assert.equal(decoded.selector, "7ff36ab5"); assert.deepEqual(decoded.path, [SUNSWAP_WTRX, SUNSWAP_USDT]);
  assert.equal(decoded.callValueAtomic, "1000000"); assert.equal(encodeSunSwapCalldata(intent), calldata);
  for (const [value, expected] of [["999999", intent], ["1000000", { ...intent, deadlineSeconds: "1789613101" }],
    ["1000000", { ...intent, minimumOutputAtomic: "300001" }]] as const) {
    assert.throws(() => decodeSunSwapCalldata(calldata, value, expected), { code: "APN_OPERATION_BLOCKED" });
  }
  const other = "TTJxU3P8rHycAyFY4kVtGNfmnMH4ezcuM9";
  for (const altered of [
    encodeFunctionData({ abi: ABI, functionName: "swapExactETHForTokens", args: [300000n, [abi(SUNSWAP_WTRX), abi(SUNSWAP_USDT)], abi(other), 1789613100n] }),
    encodeFunctionData({ abi: ABI, functionName: "swapExactETHForTokens", args: [300000n, [abi(SUNSWAP_USDT), abi(SUNSWAP_WTRX)], abi(OWNER), 1789613100n] }),
    encodeFunctionData({ abi: ABI, functionName: "swapExactETHForTokens", args: [300000n, [abi(SUNSWAP_WTRX), abi(other), abi(SUNSWAP_USDT)], abi(OWNER), 1789613100n] }),
    encodeFunctionData({ abi: ABI, functionName: "swapExactETHForTokensSupportingFeeOnTransferTokens",
      args: [300000n, [abi(SUNSWAP_WTRX), abi(SUNSWAP_USDT)], abi(OWNER), 1789613100n] }),
    `${calldata}00`, calldata.toUpperCase().replace("0X", "0x"), `${calldata.slice(0, 34)}f${calldata.slice(35)}`,
  ]) assert.throws(() => decodeSunSwapCalldata(altered, "1000000", intent), { code: "APN_OPERATION_BLOCKED" });
  assert.throws(() => encodeSunSwapCalldata({ ...intent, recipient: other }), { code: "APN_INVALID_INPUT" });
  assert.throws(() => encodeSunSwapCalldata({ ...intent, extra: true } as any), { code: "APN_INVALID_INPUT" });
  assert.throws(() => encodeSunSwapCalldata({ ...intent, inputAmountAtomic: (1n << 256n).toString() }), { code: "APN_INVALID_INPUT" });
  assert.throws(() => encodeSunSwapCalldata({ ...intent, owner: `${OWNER.slice(0, -1)}a`, recipient: `${OWNER.slice(0, -1)}a` }), { code: "APN_INVALID_INPUT" });
});

test("unsigned TriggerSmartContract targets the V2 router with call_value = input and an explicit fee_limit", () => {
  const frozen = unsignedIntent(); const tx = buildSunSwapUnsignedTransaction(frozen);
  const value = tx.raw_data.contract[0].parameter.value;
  assert.equal(value.call_value, 1000000); assert.equal(value.contract_address, tronHex(SUNSWAP_V2_ROUTER)); assert.equal(value.owner_address, tronHex(OWNER));
  assert.equal(tx.raw_data.fee_limit, 30_000_000); assert.equal(tx.raw_data.ref_block_bytes, HASH.slice(12, 16));
  assert.deepEqual(validateSunSwapUnsignedTransaction(structuredClone(tx), frozen), tx);
  for (const mutate of [(v: any) => { v.raw_data.contract[0].parameter.value.call_value++; }, (v: any) => { v.extra = undefined; },
    (v: any) => { v.raw_data.contract[0].parameter.value.contract_address = tronHex(SUNSWAP_USDT); }, (v: any) => { v.raw_data.fee_limit++; }]) {
    const tampered: any = structuredClone(tx); mutate(tampered);
    assert.throws(() => validateSunSwapUnsignedTransaction(tampered, frozen), { code: "APN_WALLET_MISMATCH" });
  }
  assert.throws(() => buildSunSwapUnsignedTransaction({ ...frozen, feeLimitSun: "29999999" }), { code: "APN_FEE_BUDGET_EXCEEDED" });
  assert.throws(() => buildSunSwapUnsignedTransaction({ ...frozen, feeLimitSun: "30000001" }), { code: "APN_FEE_BUDGET_EXCEEDED" });
  assert.throws(() => buildSunSwapUnsignedTransaction({ ...frozen, expirationMs: "1789613400001" }), { code: "APN_INVALID_INPUT" });
  assert.throws(() => buildSunSwapUnsignedTransaction({ ...frozen, callValueAtomic: "999999" }), { code: "APN_OPERATION_BLOCKED" });
  assert.throws(() => buildSunSwapUnsignedTransaction({ ...frozen, extra: true } as any), { code: "APN_INVALID_INPUT" });
});

test("simulation runs the exact unsigned call from the owner, bound to the recorded block within the drift bound", async () => {
  const frozen = unsignedIntent(); const tx = buildSunSwapUnsignedTransaction(frozen);
  const rpc = new FakeSunSwapRpc(); rpc.heads = [86344589n];
  const proof = await simulateSunSwapTransaction(rpc, tx, frozen);
  assert.equal(proof.energyRequired, "157354"); assert.equal(proof.gasEstimate, "157354"); assert.equal(proof.blockHash, `0x${HASH}`);
  assert.equal(proof.blockNumber, "86344586"); assert.equal(proof.headBlockNumber, "86344589"); assert.equal(proof.maxHeadDrift, 10);
  assert.deepEqual(rpc.calls.map((row) => row.method), ["wallet/triggerconstantcontract", "wallet/getnowblock"]);
  assert.deepEqual(rpc.calls[0]!.body, { owner_address: tronHex(OWNER), contract_address: tronHex(SUNSWAP_V2_ROUTER),
    data: tx.raw_data.contract[0].parameter.value.data, call_value: 1_000_000, visible: false });
  const drift = new FakeSunSwapRpc(); drift.heads = [86344597n];
  await assert.rejects(simulateSunSwapTransaction(drift, tx, frozen), { code: "APN_OPERATION_BLOCKED", details: { reason: "sunswap_head_drift" } });
  const costly = new FakeSunSwapRpc(); costly.heads = [86344586n]; costly.energyUsed = 300_001n;
  await assert.rejects(simulateSunSwapTransaction(costly, tx, frozen), { code: "APN_FEE_BUDGET_EXCEEDED" });
  const unactivated = new FakeSunSwapRpc(); unactivated.simulation = "not_activated";
  await assert.rejects(simulateSunSwapTransaction(unactivated, tx, frozen), { code: "APN_INSUFFICIENT_ASSET", details: { reason: "sunswap_owner_not_activated" } });
  const echo = new FakeSunSwapRpc(); echo.echoData = "00";
  await assert.rejects(simulateSunSwapTransaction(echo, tx, frozen), { code: "APN_RPC_PROTOCOL" });
  const high = { ...frozen, minimumOutputAtomic: (v2Output(1_000_000n) + 1n).toString() };
  high.calldata = encodeSunSwapCalldata({ owner: OWNER, recipient: OWNER, inputAmountAtomic: "1000000",
    minimumOutputAtomic: high.minimumOutputAtomic, deadlineSeconds: frozen.deadlineSeconds });
  await assert.rejects(simulateSunSwapTransaction(new FakeSunSwapRpc(), buildSunSwapUnsignedTransaction(high), high),
    { code: "APN_OPERATION_BLOCKED", details: { reason: "sunswap_output_below_minimum" } });
  const drifted: any = structuredClone(tx); drifted.raw_data.fee_limit--;
  await assert.rejects(simulateSunSwapTransaction(new FakeSunSwapRpc(), drifted, frozen), { code: "APN_WALLET_MISMATCH" });
});

test("quote snapshot binds on-chain market evidence and the simulation to the recorded block", () => {
  const market = syntheticMarket({ amountIn: 1_000_000n, referenceBlockId: HASH });
  const simulation = { requestHash: "c".repeat(64), resultHash: "d".repeat(64), success: true as const, blockNumber: "86344586",
    blockHash: `0x${HASH}`, headBlockNumber: "86344587", maxHeadDrift: 10, gasEstimate: "157354" };
  const snapshot = createSunSwapQuoteSnapshot({ profile: "sunswap", account: OWNER, recipient: OWNER, slippageBps: 2000, ownerSlippageCapBps: 2000,
    effectiveAt: "2026-09-17T00:00:00.000Z", expiresAt: "2026-09-17T00:05:00.000Z", unsignedTransactionPayloadHash: "b".repeat(64), market, simulation });
  assert.equal(snapshot.expectedOutputAtomic, v2Output(1_000_000n).toString()); assert.equal(snapshot.routeHash, market.routeHash);
  assert.equal(snapshot.minimumOutputAtomic, ((v2Output(1_000_000n) * 8_000n + 9_999n) / 10_000n).toString());
  assert.throws(() => createSunSwapQuoteSnapshot({ profile: "sunswap", account: OWNER, recipient: SUNSWAP_USDT, slippageBps: 2000, ownerSlippageCapBps: 2000,
    effectiveAt: "2026-09-17T00:00:00.000Z", expiresAt: "2026-09-17T00:05:00.000Z", unsignedTransactionPayloadHash: "b".repeat(64), market, simulation }),
  { code: "APN_INVALID_INPUT" });
  assert.throws(() => createSunSwapQuoteSnapshot({ profile: "sunswap", account: OWNER, recipient: OWNER, slippageBps: 2000, ownerSlippageCapBps: 2000,
    effectiveAt: "2026-09-17T00:00:00.000Z", expiresAt: "2026-09-17T00:05:00.000Z", unsignedTransactionPayloadHash: "b".repeat(64), market,
    simulation: { ...simulation, blockHash: `0x${blockId(86344586n, "2")}` } }), { code: "APN_OPERATION_BLOCKED" });
});

test("V2 receipt proves solidified success, exact debit, WTRX deposit, pair swap and USDT output to the owner", async () => {
  const tx = buildSunSwapUnsignedTransaction(unsignedIntent());
  const expected = { transactionHash: tx.txID, recipient: OWNER, inputAmountAtomic: "1000000", minimumOutputAtomic: "300000",
    unsignedRawDataHex: tx.raw_data_hex, maximumFeeSun: "30000000", maximumBandwidthFeeSun: "512000" };
  const fixture = v2Receipt(tx, OWNER, 1_000_000n, 334_314n);
  const proof = validateSunSwapReceipt(fixture.transaction, fixture.info, fixture.solid, expected);
  assert.equal(proof.outputAmountAtomic, "334314"); assert.equal(proof.feeSun, "12345"); assert.equal(proof.trxDebitSun, "1012345");
  assert.equal(proof.inputAmountAtomic, "1000000"); assert.equal(proof.finalized, true); assert.match(proof.receiptHash, /^[a-f0-9]{64}$/u);
  const bigints: any = structuredClone(fixture); bigints.info.blockNumber = 123n; bigints.info.fee = 12345n;
  bigints.transaction.raw_data.contract[0].parameter.value.call_value = 1_000_000n;
  assert.equal(validateSunSwapReceipt(bigints.transaction, bigints.info, "124", expected).trxDebitSun, "1012345");
  const calls = new FakeSunSwapRpc(); calls.call = async (method) => method.endsWith("gettransactionbyid") ? fixture.transaction :
    method.endsWith("gettransactioninfobyid") ? fixture.info : { block_header: { raw_data: { number: 124n } } };
  assert.equal((await observeSunSwapReceipt(calls, expected)).transactionHash, tx.txID);
  for (const mutate of [
    (v: any) => { v.info.log[2].data = (299_999n).toString(16).padStart(64, "0"); }, (v: any) => { v.info.log[2].topics[2] = word(SUNSWAP_USDT); },
    (v: any) => { v.info.log[2].topics[1] = word(OWNER); }, (v: any) => { v.info.log[4].topics[2] = word(SUNSWAP_USDT); },
    (v: any) => { v.info.log[4].data = v.info.log[4].data.replace(/^.{64}/u, (2_000_000n).toString(16).padStart(64, "0")); },
    (v: any) => { v.info.log[0].data = (1n).toString(16).padStart(64, "0"); }, (v: any) => { v.info.log.splice(0, 1); },
    (v: any) => { v.info.log.push(structuredClone(v.info.log[2])); }, (v: any) => { v.info.receipt.result = "REVERT"; },
    (v: any) => { v.info.fee = "30000001"; }, (v: any) => { v.solid = "122"; }, (v: any) => { v.transaction.raw_data_hex = "00"; },
    (v: any) => { v.transaction.ret[0].contractRet = "OUT_OF_ENERGY"; }, (v: any) => { v.transaction.raw_data.contract[0].parameter.value.call_value = 1; },
    (v: any) => { v.info.id = "0".repeat(64); }, (v: any) => { v.info.log[2].address = v.info.log[2].address.toUpperCase(); },
  ]) { const value: any = v2Receipt(tx, OWNER, 1_000_000n, 334_314n); mutate(value);
    assert.throws(() => validateSunSwapReceipt(value.transaction, value.info, value.solid, expected), { code: "APN_RPC_PROTOCOL" }); }
  const noFee: any = v2Receipt(tx, OWNER, 1_000_000n, 334_314n, {}); delete noFee.info.fee;
  assert.equal(validateSunSwapReceipt(noFee.transaction, noFee.info, noFee.solid, expected).trxDebitSun, "1000000");
  // Mainnet shapes (tx 83b46330..., 1936fbed...): staked energy burns only 512000 SUN bandwidth; free bandwidth burns only energy.
  const bandwidthOnly = v2Receipt(tx, OWNER, 1_000_000n, 334_314n, { net: 512_000n });
  assert.equal(validateSunSwapReceipt(bandwidthOnly.transaction, bandwidthOnly.info, "124", expected).trxDebitSun, "1512000");
  const both = v2Receipt(tx, OWNER, 1_000_000n, 334_314n, { energy: 30_000_000n, net: 512_000n });
  assert.equal(validateSunSwapReceipt(both.transaction, both.info, "124", expected).feeSun, "30512000");
  for (const fees of [{ energy: 30_000_001n }, { net: 512_001n }, { energy: 30_000_000n, net: 512_001n }]) {
    const over = v2Receipt(tx, OWNER, 1_000_000n, 334_314n, fees);
    assert.throws(() => validateSunSwapReceipt(over.transaction, over.info, "124", expected), { code: "APN_RPC_PROTOCOL" });
  }
  const unexplained: any = v2Receipt(tx, OWNER, 1_000_000n, 334_314n); unexplained.info.fee = "12346";
  assert.throws(() => validateSunSwapReceipt(unexplained.transaction, unexplained.info, "124", expected), { code: "APN_RPC_PROTOCOL" });
  assert.throws(() => validateSunSwapReceipt(fixture.transaction, fixture.info, "124", { ...expected, maximumBandwidthFeeSun: "0" }),
    { code: "APN_RPC_PROTOCOL" });
});
