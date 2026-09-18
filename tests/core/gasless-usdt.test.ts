import assert from "node:assert/strict";
import test from "node:test";
import { decodeFunctionData, encodeAbiParameters, getAddress, pad, parseAbi, toEventSelector, type Hex } from "viem";
import { usdtApprovalScreen } from "../../src/gasless-usdt/approval.js";
import { UsdtGaslessAllowlistGate } from "../../src/gasless-usdt/allowlist.js";
import {
  approveAndSendUsdtGasless, assertUsdtFunding, observeUsdtGasless, quoteUsdtGasless, sponsorUsdtOperation,
  type UsdtAccountState, type UsdtChainPort, type UsdtSponsorPort,
} from "../../src/gasless-usdt/engine.js";
import { USDT_GASLESS, type UsdtTransferPlan } from "../../src/gasless-usdt/model.js";
import { decodeUsdtPaymasterData, validateUsdtPaymasterData } from "../../src/gasless-usdt/paymaster-data.js";
import { planUsdtTransfer, validateUsdtGasPrice, validateUsdtTokenQuote } from "../../src/gasless-usdt/quote.js";
import { verifyUsdtReceipt, type UsdtChainReceipt } from "../../src/gasless-usdt/receipt.js";
import { usdtBatchCallData, usdtUserOperation, usdtUserOperationHash } from "../../src/gasless-usdt/userop.js";
import { activateDirectPolicy } from "./direct-allowlist-helpers.js";
import { temporaryState } from "./helpers.js";

// Captured from https://public.pimlico.io/v2/1/rpc without an API key on 2026-09-18 (see docs/gasless-usdt.md).
const QUOTE_V08 = { quotes: [{ paymaster: "0x888888888888Ec68A58AB8094Cc1AD20Ba3D2402", token: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
  postOpGas: "0x4c2c", exchangeRate: "0xa38ca6e3", exchangeRateNativeToUsd: "0x948f68af", balanceSlot: "0x2", allowanceSlot: "0x5" }] };
const PRICE = { slow: { maxFeePerGas: "0x10ef719d", maxPriorityFeePerGas: "0xbb0de7a" },
  standard: { maxFeePerGas: "0x11c8374b", maxPriorityFeePerGas: "0xc468333" },
  fast: { maxFeePerGas: "0x12a0fcf9", maxPriorityFeePerGas: "0xcdc27ec" } };
const SIGNED = { paymaster: "0x888888888888Ec68A58AB8094Cc1AD20Ba3D2402", paymasterData:
  "0x020000006aacecdb000000000000dac17f958d2ee523a2206206994597c13d831ec700000000000000000000000000004c2c00000000000000000000000000000000000000000000000000000000a380509a000000000000000000000000000138804337ff05c84b9a80ea0a78dbe7b8e102f66d4c08972391719016554aea7ecb13e50f38e455f67da2908c40238d37d162d3f3dc686067c76c198b6239400746330724b6191afa40a35538022086b0288210f55e1c1c" };
const SIGNED_UNTIL = 0x6aacecdbn;
const OWNER = getAddress("0x823A3a5BaB1186141b32fC65F8E25Ca24c679Ce7");
const RECIPIENT = getAddress("0x000000000000000000000000000000000000dEaD");
const request = (max = 500_000n, min = 500_000n) => ({ sender: OWNER, recipient: RECIPIENT, grossAtomic: 1_000_000n, maxFeeAtomic: max, minReceivedAtomic: min });
const plan = (): UsdtTransferPlan => planUsdtTransfer(request(), validateUsdtTokenQuote(QUOTE_V08), validateUsdtGasPrice(PRICE).fast);
const funded: UsdtAccountState = { usdtBalanceAtomic: 1_000_000n, entryPointNonce: 0n, eoaNonce: 31n, delegation: "empty" };

test("the keyless quote is validated exactly and priced into F and N", () => {
  const p = plan();
  assert.equal(p.feeCapAtomic, 500_000n); assert.equal(p.netAtomic, 500_000n);
  // (75k + 130k + 100k + 75k + 100k + 19.5k gas) * 312540409 wei * 2744952547 / 1e18, rounded up.
  assert.equal(p.quotedFeeAtomic, 428_362n);
  assert.throws(() => planUsdtTransfer(request(400_000n), p.quote, p.price), /gasless_usdt_quote_above_max_fee|exceeds the fee budget/u);
  assert.throws(() => planUsdtTransfer(request(500_000n, 1_000_000n), p.quote, p.price), /positive fee budget/u);
  const v07 = { quotes: [{ ...QUOTE_V08.quotes[0], paymaster: "0x777777777777AeC03fd955926DbF81597e66834C" }] };
  assert.throws(() => validateUsdtTokenQuote(v07), /gasless_usdt_quote_paymaster/u);
  assert.throws(() => validateUsdtTokenQuote({ quotes: [{ ...QUOTE_V08.quotes[0], balanceSlot: "0x3" }] }), /storage_layout/u);
  assert.throws(() => validateUsdtTokenQuote({ quotes: [{ ...QUOTE_V08.quotes[0], extra: "0x1" }] }), /quote_shape/u);
  assert.throws(() => validateUsdtGasPrice({ ...PRICE, fast: PRICE.slow, slow: PRICE.fast }), /price_tiers/u);
});

test("the sponsor's signed payload is decoded exactly and re-priced against the fee budget", () => {
  const decoded = decodeUsdtPaymasterData(SIGNED.paymasterData);
  assert.equal(decoded.allowAllBundlers, false); assert.equal(decoded.treasury, USDT_GASLESS.treasury);
  assert.equal(decoded.paymasterValidationGasLimit, 80_000n); assert.equal(decoded.exchangeRate, 0xa380509an);
  validateUsdtPaymasterData(SIGNED, plan(), SIGNED_UNTIL - 300n);
  assert.throws(() => validateUsdtPaymasterData(SIGNED, plan(), SIGNED_UNTIL - 30n), /paymaster_validity/u);
  const flagged = { ...SIGNED, paymasterData: `0x0201${SIGNED.paymasterData.slice(6)}` };
  assert.throws(() => validateUsdtPaymasterData(flagged, plan(), SIGNED_UNTIL - 300n), /paymaster_flags/u);
  const otherTreasury = SIGNED.paymasterData.replace("4337ff05c84b9a80ea0a78dbe7b8e102f66d4c08", "1".repeat(40));
  assert.throws(() => validateUsdtPaymasterData({ ...SIGNED, paymasterData: otherTreasury }, plan(), SIGNED_UNTIL - 300n), /treasury/u);
  const dearer = SIGNED.paymasterData.replace("a380509a", "c380509a");
  assert.throws(() => validateUsdtPaymasterData({ ...SIGNED, paymasterData: dearer }, plan(), SIGNED_UNTIL - 300n), /signed_rate_above_max_fee|above the fee budget/u);
  assert.throws(() => decodeUsdtPaymasterData(`${SIGNED.paymasterData}00`), /paymaster_data_shape/u);
});

test("the batch resets and grants exactly F to the pinned paymaster, then sends exactly N", () => {
  const p = plan();
  const outer = decodeFunctionData({ abi: parseAbi(["function executeBatch((address target, uint256 value, bytes data)[] calls)"]), data: usdtBatchCallData(p) });
  const calls = outer.args[0], erc20 = parseAbi(["function approve(address,uint256)", "function transfer(address,uint256)"]);
  assert.equal(calls.length, 3);
  assert.ok(calls.every((call) => call.target === USDT_GASLESS.token && call.value === 0n));
  assert.deepEqual(calls.map((call) => decodeFunctionData({ abi: erc20, data: call.data }).args),
    [[USDT_GASLESS.paymaster, 0n], [USDT_GASLESS.paymaster, 500_000n], [RECIPIENT, 500_000n]]);
  const op = usdtUserOperation(p, { entryPointNonce: 0n, paymasterData: SIGNED.paymasterData as Hex, signature: "0x", authorization: null });
  assert.notEqual(usdtUserOperationHash(op), usdtUserOperationHash({ ...op, paymasterData: "0x" }));
});

const USER_OP_EVENT = toEventSelector("UserOperationEvent(bytes32 indexed userOpHash, address indexed sender, address indexed paymaster, uint256 nonce, bool success, uint256 actualGasCost, uint256 actualGasUsed)");
const TRANSFER = toEventSelector("Transfer(address indexed from, address indexed to, uint256 value)");
const HASH = `0x${"ab".repeat(32)}` as Hex;
const word = (address: string) => pad(address as Hex, { size: 32 }).toLowerCase();
const transfer = (to: string, value: bigint) => ({ address: USDT_GASLESS.token, topics: [TRANSFER, word(OWNER), word(to)], data: pad(`0x${value.toString(16)}`, { size: 32 }) });
const receipt = (logs: UsdtChainReceipt["logs"], success = true): UsdtChainReceipt => ({ transactionHash: `0x${"cd".repeat(32)}`, blockNumber: 26_002_999n, status: "success", logs: [
  { address: USDT_GASLESS.entryPoint, topics: [USER_OP_EVENT, HASH, word(OWNER), word(USDT_GASLESS.paymaster)],
    data: encodeAbiParameters([{ type: "uint256" }, { type: "bool" }, { type: "uint256" }, { type: "uint256" }], [0n, success, 10n ** 14n, 300_000n]) },
  ...logs] });

test("a receipt proves the USDT debit and the recipient credit, or it proves nothing", () => {
  const p = plan();
  const settled = verifyUsdtReceipt(p, HASH, receipt([transfer(RECIPIENT, 500_000n), transfer(USDT_GASLESS.treasury, 301_234n)]));
  assert.deepEqual([settled.senderDebitAtomic, settled.feeAtomic, settled.recipientCreditAtomic, settled.residualAllowanceAtomic],
    ["801234", "301234", "500000", "198766"]);
  assert.throws(() => verifyUsdtReceipt(p, HASH, receipt([transfer(RECIPIENT, 499_999n), transfer(USDT_GASLESS.treasury, 1n)])), /delivery_amount/u);
  assert.throws(() => verifyUsdtReceipt(p, HASH, receipt([transfer(RECIPIENT, 500_000n), transfer(USDT_GASLESS.treasury, 500_001n)])), /fee_amount/u);
  assert.throws(() => verifyUsdtReceipt(p, HASH, receipt([transfer(RECIPIENT, 500_000n)])), /receipt_transfers/u);
  assert.throws(() => verifyUsdtReceipt(p, HASH, receipt([transfer(RECIPIENT, 500_000n), transfer(USDT_GASLESS.treasury, 1n),
    transfer(RECIPIENT, 500_000n)])), /receipt_transfers/u);
  assert.throws(() => verifyUsdtReceipt(p, HASH, receipt([transfer(RECIPIENT, 500_000n), transfer(USDT_GASLESS.treasury, 1n)], false)), /operation_failed/u);
  assert.throws(() => verifyUsdtReceipt(p, `0x${"ef".repeat(32)}`, receipt([])), /receipt_user_operation/u);
});

function ports(log: string[], options: { readonly marker?: "fails"; readonly send?: "throws" } = {}) {
  const sponsor: UsdtSponsorPort = {
    tokenQuote: async () => { log.push("quote"); return QUOTE_V08; },
    gasPrice: async () => { log.push("price"); return PRICE; },
    paymasterData: async (op) => { log.push(`sponsor:${op.signature.length}:${op.eip7702Auth?.nonce ?? "none"}`); return SIGNED; },
    send: async (op) => { log.push("send"); if (options.send === "throws") throw new Error("lost"); return usdtUserOperationHash(op); },
  };
  const chain: UsdtChainPort = { verifyPins: async () => { log.push("pins"); }, account: async () => { log.push("account"); return funded; },
    receiptFor: async () => { log.push("receipt"); return null; } };
  const signer = { authorize: async (nonce: bigint) => { log.push("sign:authorization"); return { chainId: "0x1" as Hex, address: USDT_GASLESS.delegate,
    nonce: `0x${nonce.toString(16)}` as Hex, yParity: "0x1" as Hex, r: `0x${"33".repeat(32)}` as Hex, s: `0x${"44".repeat(32)}` as Hex }; },
  signUserOperation: async () => { log.push("sign:userop"); return `0x${"55".repeat(65)}` as Hex; } };
  const journal = { markSending: async () => { log.push("marker"); if (options.marker === "fails") throw new Error("disk"); },
    markSent: async (_: Hex, result: string) => { log.push(`sent:${result}`); } };
  return { sponsor, chain, signer, journal };
}

test("quote and sponsor data never reach the key; the marker is durable before the one send", async () => {
  const log: string[] = [];
  const p = await quoteUsdtGasless(ports(log), request());
  await sponsorUsdtOperation(ports(log).sponsor, p, funded, SIGNED_UNTIL - 300n);
  assert.deepEqual(log, ["pins", "quote", "price", "sponsor:132:0x1f"]);
  assert.throws(() => assertUsdtFunding(p, { ...funded, usdtBalanceAtomic: 0n }), /gasless_usdt_balance_below_gross|holds 0 atomic/u);
  const sent: string[] = [];
  assert.equal((await approveAndSendUsdtGasless(ports(sent), p, SIGNED_UNTIL - 300n)).state, "sent");
  assert.deepEqual(sent, ["pins", "account", "sponsor:132:0x1f", "sign:authorization", "sign:userop", "marker", "send", "sent:accepted"]);
  const failed: string[] = [];
  await assert.rejects(approveAndSendUsdtGasless(ports(failed, { marker: "fails" }), p, SIGNED_UNTIL - 300n), /disk/u);
  assert.equal(failed.includes("send"), false);
  const lost: string[] = [];
  assert.equal((await approveAndSendUsdtGasless(ports(lost, { send: "throws" }), p, SIGNED_UNTIL - 300n)).state, "send_unacknowledged");
  assert.equal(lost.filter((entry) => entry === "send").length, 1);
  const observed: string[] = [];
  assert.deepEqual(await observeUsdtGasless(ports(observed).chain, p, HASH), { state: "pending" });
  assert.deepEqual(observed, ["receipt"]);
});

test("the gate admits only the pinned gasless mechanism under the owner's caps and counts the gross in the ledger", async () => {
  const state = await temporaryState();
  try {
    const now = new Date("2026-09-18T08:00:00.000Z"), clock = { now: () => new Date(now) };
    const gate = new UsdtGaslessAllowlistGate({ state: { root: state.root }, clock });
    const subject = { profile: "default", operationId: "op-usdt-1", account: OWNER, grossAtomic: "1000000" };
    await assert.rejects(gate.admit(subject), /allowlist policy/u);
    const admission = (mechanism: { provider: string; reference: string }) => ({ chain: "eip155:1", kind: "token" as const,
      identifier: USDT_GASLESS.token, rail: "gasless" as const, maximumPerTransferAtomic: "3000000", dailyLimitAtomic: "10000000", mechanism });
    await activateDirectPolicy(state.root, "default", { accounts: { evm: OWNER }, now,
      admissions: [admission({ provider: "pimlico-erc20-paymaster", reference: "eip155:1:0x0000000000000000000000000000000000000001" })] } as never);
    await assert.rejects(gate.admit(subject), /allowlist_mechanism_mismatch|exactly this sponsor mechanism/u);
    await activateDirectPolicy(state.root, "default", { accounts: { evm: OWNER }, now, admissions: [admission({ ...USDT_GASLESS.mechanism })] } as never);
    const admitted = await gate.admit(subject);
    assert.equal(admitted.maximumPerTransferAtomic, "3000000"); assert.equal(admitted.dailyUsageAtomic, "0");
    await assert.rejects(gate.admit({ ...subject, grossAtomic: "3000001" }), /per-operation/u);
    const reservation = await gate.reserve(subject, admitted);
    assert.equal(reservation.rail, "gasless"); assert.equal(reservation.amountAtomic, "1000000");
    assert.equal((await gate.reserve(subject, admitted)).reservationId, reservation.reservationId);
    assert.equal((await gate.admit({ ...subject, operationId: "op-usdt-2" })).dailyUsageAtomic, "1000000");
    await gate.follow(subject, "finalized", "a".repeat(64));
    await assert.rejects(gate.follow(subject, "failed_before_effect", "b".repeat(64)), /different terminal state/u);
    const screen = usdtApprovalScreen(plan(), admitted, true).join("\n");
    for (const needle of ["Gross (total sender debit at most): 1 USDT", "Fee cap (allowance granted to the sponsor): 0.5 USDT",
      "Net to recipient: 0.5 USDT", "per operation 3 USDT", "daily 10 USDT", "First use"]) assert.ok(screen.includes(needle), needle);
  } finally { await state.cleanup(); }
});
