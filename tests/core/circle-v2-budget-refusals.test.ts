/**
 * CIRCLE-BUDGET-REFUSAL-DIAGNOSTICS-001: a fresh, well-formed Circle quote or Base read that does not fit the caller's
 * limits is refused before signing as an economic refusal with its numbers and units; malformed data stays a protocol
 * refusal. Uses the real Iris quote QA retained (fee 130431) at its own expiry block, offline.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { getBase58Encoder } from "@solana/kit";
import { encodeFunctionData, parseAbi, type Hex } from "viem";
import { ApnError } from "../../src/errors.js";
import { circleV2FeeWithinBudget, circleV2GasWithinBudget, circleV2NativeWithinBudget } from "../../src/lifi/circle-v2-budget.js";
import { inspectCircleV2UpfrontOffline } from "../../src/lifi/circle-v2-upfront-offline.js";
import { prepareCircleV2BaseUsdcApprovalReadOnly, type CircleV2ApprovalState } from "../../src/lifi/circle-v2-approval-preparation.js";
import { failureEnvelope } from "../../src/output.js";
import { associatedUsdc } from "../../src/solana/accounts.js";

const ABI = parseAbi(["function depositForBurnWithHookAndFees(uint256 amount,uint32 destinationDomain,bytes32 mintRecipient,address burnToken,bytes32 destinationCaller,bytes hookData,(bytes signedQuote,address refundAddress) claim) payable"]);
const WRAPPER = "0x71f54F818671cD0D7ea140Da213e5C8b5C92a408", USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
interface Captured { readonly payer: string; readonly recipientOwner: string; readonly quoteEndpoint: string;
  readonly request: { amount: string; feeToken: string; requests: { type: string; params: { hookData: string } }[] };
  readonly response: { signedQuote: Hex; feeTotalAmount: string; expiry: { expiresAtBlock: number }; nonce: string; items: { amount: string }[] } }

async function capturedInput(maxSourceFeeAtomic: string) {
  const q = JSON.parse(await readFile("tests/fixtures/circle-v2-fee-quote-051.json", "utf8")) as Captured;
  const ata = await associatedUsdc(q.recipientOwner);
  const data = encodeFunctionData({ abi: ABI, functionName: "depositForBurnWithHookAndFees", args: [BigInt(q.request.amount), 5,
    `0x${Buffer.from(getBase58Encoder().encode(ata)).toString("hex")}`, USDC, `0x${"0".repeat(64)}`, q.request.requests[0]!.params.hookData as Hex,
    { signedQuote: q.response.signedQuote, refundAddress: q.payer as Hex }] });
  return { quoteEndpoint: q.quoteEndpoint, quoteRequest: q.request, quoteResponse: q.response,
    transaction: { to: WRAPPER, refundAddress: q.payer, chainId: 8453, valueAtomic: "0", data }, recipientWallet: q.recipientOwner,
    amountAtomic: q.request.amount, maxSourceFeeAtomic, sourceBlockNumber: String(q.response.expiry.expiresAtBlock - 1),
    recipientSetup: "existing_ata" as const };
}
function refusal(error: unknown): ApnError { assert.ok(error instanceof ApnError); return error; }

test("the captured quote at the caller's fee cap is admitted; one atom lower is a fee-budget refusal with both numbers, not a protocol fault", async () => {
  const at = await inspectCircleV2UpfrontOffline(await capturedInput("130431"));
  assert.deepEqual([at.executionAdmitted, at.quotedFeeAtomic], [false, "130431"]);
  const below = await inspectCircleV2UpfrontOffline(await capturedInput("130430")).then(() => null, refusal);
  assert.ok(below !== null);
  assert.equal(below.code, "APN_FEE_BUDGET_EXCEEDED");
  assert.match(below.message, /130431 USDC atomic units \(6 decimals\), above --max-source-fee-atomic 130430 USDC atomic units/u);
  assert.match(below.message, /Nothing was signed\./u);
  assert.deepEqual([below.details?.reason, below.details?.quotedFeeAtomic, below.details?.maxSourceFeeAtomic],
    ["circle_v2_upfront_fee_ceiling", "130431", "130430"]);
  const envelope = failureEnvelope("circle.source.submit", "request", below);
  assert.equal(envelope.next_actions.length, 1);
  assert.match(envelope.next_actions[0]!, /^If a Circle fee of 130431 USDC atomic units is acceptable, rerun apn circle source submit with --max-source-fee-atomic of at least 130431/u);
  assert.equal(envelope.next_actions.some(action => /pinned provider client/u.test(action)), false);
});

test("a malformed or rebound quote stays a protocol refusal even when it is also over the caller's cap", async () => {
  for (const change of [
    (v: Awaited<ReturnType<typeof capturedInput>>) => { v.quoteResponse.nonce = "1"; },
    (v: Awaited<ReturnType<typeof capturedInput>>) => { v.quoteResponse.items[0]!.amount = "130432"; },
    (v: Awaited<ReturnType<typeof capturedInput>>) => { v.quoteResponse.signedQuote = "0x01" as Hex; },
    (v: Awaited<ReturnType<typeof capturedInput>>) => { v.sourceBlockNumber = String(v.quoteResponse.expiry.expiresAtBlock); },
  ]) {
    const value = await capturedInput("1"); change(value);
    await assert.rejects(inspectCircleV2UpfrontOffline(value), { code: "APN_PROVIDER_PROTOCOL" });
  }
});

test("a fee that is not below the principal names the principal; gas, fee per gas, tip and native caps name their option and unit", () => {
  const caught = (work: () => void): ApnError => { try { work(); } catch (error) { return refusal(error); } assert.fail("no refusal"); };
  const principal = caught(() => circleV2FeeWithinBudget("r", 286146n, 170000n, 300000n));
  assert.equal(principal.code, "APN_FEE_BUDGET_EXCEEDED");
  assert.match(principal.message, /286146 USDC atomic units \(6 decimals\), not below the principal --amount-atomic 170000/u);
  circleV2FeeWithinBudget("r", 147766n, 170000n, 147766n);
  const limits = { maxGasLimitAtomic: "300000", maxFeePerGasWei: "11000000", maxPriorityFeePerGasWei: "1000000", maxNativeDebitWei: "15000000000000" };
  circleV2GasWithinBudget("circle_v2_source_preparation", "apn circle source submit", 300000n, 11000000n, 1000000n, limits);
  const gas = caught(() => circleV2GasWithinBudget("circle_v2_source_preparation", "apn circle source submit", 586415n, 11000000n, 1000000n, limits));
  assert.deepEqual([gas.code, gas.details?.reason, gas.details?.gasLimitAtomic, gas.details?.maxGasLimitAtomic],
    ["APN_FEE_BUDGET_EXCEEDED", "circle_v2_source_preparation_gas_or_fee_cap", "586415", "300000"]);
  assert.match(gas.message, /586415 gas units for this transaction, above --max-gas-limit-atomic 300000 gas units/u);
  assert.match(String((gas.details?.nextActions as readonly string[])[0]), /rerun apn circle source submit with --max-gas-limit-atomic of at least 586415/u);
  const fee = caught(() => circleV2GasWithinBudget("p", "apn circle approval prepare", 1n, 11000001n, 1n, limits));
  assert.match(fee.message, /11000001 wei, above --max-fee-per-gas-wei 11000000 wei/u);
  const tip = caught(() => circleV2GasWithinBudget("p", "apn circle approval prepare", 1n, 1n, 1000001n, limits));
  assert.match(tip.message, /--max-priority-fee-per-gas-wei 1000000 wei/u);
  const ceiling = caught(() => circleV2GasWithinBudget("p", "apn circle approval prepare", 5_000_001n, 1n, 1n, { ...limits, maxGasLimitAtomic: "9000000" }));
  assert.match(ceiling.message, /APN's bridge gas ceiling 5000000 gas units/u);
  circleV2NativeWithinBudget("p", "apn circle source submit", 6460715651026n, 22949154455953n, "15000000000000");
  const cap = caught(() => circleV2NativeWithinBudget("p", "apn circle source submit", 15000000000001n, 22949154455953n, "15000000000000"));
  assert.deepEqual([cap.code, cap.details?.nativeDebitWei, cap.details?.maxNativeDebitWei], ["APN_FEE_BUDGET_EXCEEDED", "15000000000001", "15000000000000"]);
  const poor = caught(() => circleV2NativeWithinBudget("p", "apn circle source submit", 6460715651026n, 6460715651025n, "15000000000000"));
  assert.deepEqual([poor.code, poor.details?.nativeBalanceWei], ["APN_INSUFFICIENT_GAS", "6460715651025"]);
  assert.match(String((poor.details?.nextActions as readonly string[])[0]), /Add at least 1 wei of Base ETH/u);
});

const PAYER = "0x3De1d3CB9e5a9B24Df663a220f11C304CFe1133b";
function approvalState(change: Partial<CircleV2ApprovalState> = {}) {
  return async () => ({ chainId: 8453 as const, payer: PAYER, token: USDC, spender: WRAPPER, blockNumber: "12345",
    blockHash: `0x${"a".repeat(64)}`, latestNonceAtomic: "7", pendingNonceAtomic: "7", usdcBalanceAtomic: "500000",
    usdcAllowanceAtomic: "0", nativeBalanceWei: "200000000000000", gasLimitAtomic: "60000", maxFeePerGasWei: "2000000000",
    maxPriorityFeePerGasWei: "100000000", totalNativeDebitWei: "120000000000000", ...change });
}
const APPROVAL_LIMITS = { maxGasLimitAtomic: "60000", maxFeePerGasWei: "2000000000", maxPriorityFeePerGasWei: "100000000",
  maxNativeDebitWei: "120000000000000", ttlMs: 60000 };
const approve = (cap: string, change: Partial<CircleV2ApprovalState> = {}, limits = APPROVAL_LIMITS) => prepareCircleV2BaseUsdcApprovalReadOnly(
  { chainId: 8453, payer: PAYER, token: USDC, spender: WRAPPER, approvalCapAtomic: cap }, approvalState(change), limits, () => 1_800_000_000_000);

test("the separate approval refuses caller gas, native and balance shortfalls economically before anything is signed", async () => {
  assert.equal((await approve("320000")).approvalCapAtomic, "320000");
  await assert.rejects(approve("320000", { gasLimitAtomic: "60001" }), { code: "APN_FEE_BUDGET_EXCEEDED" });
  await assert.rejects(approve("320000", {}, { ...APPROVAL_LIMITS, maxNativeDebitWei: "119999999999999" }), { code: "APN_FEE_BUDGET_EXCEEDED" });
  await assert.rejects(approve("320000", { nativeBalanceWei: "119999999999999" }), { code: "APN_INSUFFICIENT_GAS" });
  await assert.rejects(approve("500001"), { code: "APN_INSUFFICIENT_USDC" });
  await assert.rejects(approve("320000", { gasLimitAtomic: "0" }), { code: "APN_PROVIDER_PROTOCOL" });
  await assert.rejects(approve("320000", { usdcAllowanceAtomic: "320001" }), { code: "APN_PROVIDER_PROTOCOL" });
});
