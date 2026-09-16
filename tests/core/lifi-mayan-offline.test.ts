import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { decodeMayanBaseSolanaQuoteOffline } from "../../src/lifi/mayan-offline.js";

const fixture = JSON.parse(await readFile(resolve("tests/core/lifi-fixtures/base-solana-mayan-mctp-quote-synthetic-20260916.json"), "utf8")) as Record<string, any>;
const binding = {
  sender: "0x000000000000000000000000000000000000dEaD" as const,
  solanaRecipient: "95eqQDmQG7y8gad3yReqXqzyFoiQ4LYD9iAY1PMtuyRj",
  sourceAmountAtomic: "100000000",
  maxFeeAtomic: "250000",
};
const clone = (): Record<string, any> => structuredClone(fixture) as Record<string, any>;
const reject = (quote: Record<string, any>, expected?: string): void => {
  assert.throws(() => decodeMayanBaseSolanaQuoteOffline(quote, binding), expected ? new RegExp(expected) : /Bridge validation failed/u);
};
function replaceWord(quote: Record<string, any>, before: string, after: string): void {
  const data = quote.transactionRequest.data as string;
  assert.ok(data.toLowerCase().includes(before.toLowerCase()), `fixture contains ${before}`);
  quote.transactionRequest.data = data.replace(new RegExp(before, "i"), after);
}

test("synthetic Mayan fixture decodes for offline inspection only", () => {
  const decoded = decodeMayanBaseSolanaQuoteOffline(fixture, binding);
  assert.equal(decoded.kind, "offline_mayan_mctp_source_inspection");
  assert.equal(decoded.bridgeCompletion, false);
  assert.equal(decoded.approvalSpender, decoded.transactionTarget);
  assert.equal(decoded.sourceAmountAtomic, "100000000");
  assert.equal(decoded.feeAmountAtomic, "250000");
  assert.equal(decoded.bridgeAmountAtomic, "99750000");
  assert.equal(decoded.offchainToAmountMinAtomic, "97619723");
  assert.equal(decoded.solanaRecipient, binding.solanaRecipient);
  assert.equal(decoded.refundRecipient, binding.sender);
});

test("synthetic Mayan quote rejects envelope, binding and destination mutations", () => {
  const cases: readonly ((quote: Record<string, any>) => void)[] = [
    q => { q.tool = "mayanFastMCTP"; },
    q => { q.action.toChainId = 1; },
    q => { q.action.fromAmount = "100000001"; },
    q => { q.action.toAddress = "11111111111111111111111111111111"; },
    q => { q.estimate.approvalAddress = "0x0000000000000000000000000000000000000001"; },
    q => { q.transactionRequest.to = "0x0000000000000000000000000000000000000001"; },
    q => { q.transactionRequest.value = "0x1"; },
    q => { q.estimate.toAmountMin = "999999999"; },
  ];
  for (const mutate of cases) { const q = clone(); mutate(q); reject(q); }
});

test("synthetic Mayan source calldata rejects selectors, token, receiver, fee and principal mutations", () => {
  const selector = clone(); selector.transactionRequest.data = `0x00000000${(selector.transactionRequest.data as string).slice(10)}`; reject(selector, "source_selector");
  const token = clone(); replaceWord(token, "000000000000000000000000833589fcd6edb6e08f4c7c32d4f71b54bda02913", "000000000000000000000000833589fcd6edb6e08f4c7c32d4f71b54bda02914"); reject(token);
  const receiver = clone(); replaceWord(receiver, "780e9926403ab41b34744b51cfa59df95f51b46405a34cdb4358d99ae2ea56ca", "780e9926403ab41b34744b51cfa59df95f51b46405a34cdb4358d99ae2ea56cb"); reject(receiver);
  const fee = clone(); fee.estimate.feeCosts[0].amount = "250001"; reject(fee, "fee_rows");
  const capped = clone(); assert.throws(() => decodeMayanBaseSolanaQuoteOffline(capped, { ...binding, maxFeeAtomic: "249999" }), /fee_cap/u);
  const principal = clone(); replaceWord(principal, "0000000000000000000000000000000000000000000000000000000005f5e100", "0000000000000000000000000000000000000000000000000000000005f5e101"); reject(principal);
  const opaqueProtocolArg = clone(); replaceWord(opaqueProtocolArg, "00000000000000000000000000000000000000000000000000000000001924fd", "00000000000000000000000000000000000000000000000000000000001924fe"); reject(opaqueProtocolArg);
});

test("synthetic Mayan quote rejects detached top-level and included-step claims", () => {
  const cases: readonly ((quote: Record<string, any>) => void)[] = [
    q => { q.transactionId = `0x${"1".repeat(64)}`; },
    q => { q.integrator = "other-integrator"; },
    q => { q.estimate.fromAmount = "99999999"; },
    q => { q.action.fromToken.chainId = 1; },
    q => { q.action.fromToken.decimals = 18; },
    q => { q.action.toToken.chainId = 1; },
    q => { q.action.toToken.decimals = 9; },
    q => { q.includedSteps = q.includedSteps.slice(0, 1); },
    q => { q.includedSteps[0].tool = "unknownFee"; },
    q => { q.includedSteps[0].action.fromAmount = "99999999"; },
    q => { q.includedSteps[0].action.toToken.address = "0x0000000000000000000000000000000000000001"; },
    q => { q.includedSteps[0].estimate.toAmount = "99749999"; },
    q => { q.includedSteps[0].estimate.feeCosts[0].amount = "250001"; },
    q => { q.includedSteps[1].tool = "mayanFastMCTP"; },
    q => { q.includedSteps[1].action.toAddress = "11111111111111111111111111111111"; },
    q => { q.includedSteps[1].action.toToken.decimals = 9; },
    q => { q.includedSteps[1].estimate.toAmountMin = "97619722"; },
    q => { q.includedSteps[1].estimate.feeCosts = [{ amount: "1" }]; },
  ];
  for (const mutate of cases) { const q = clone(); mutate(q); reject(q); }
});
