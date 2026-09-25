import assert from "node:assert/strict";
import test from "node:test";
import { getAddress } from "viem";
import { inspectSeiGasZipQuote, revalidateSeiGasZipQuote, SEI_GASZIP_LOCAL_MAX_AGE_MS } from "../../src/lifi/sei-gaszip-quote.js";
import { BRIDGE_DIAMOND, BRIDGE_ZERO_ADDRESS } from "../../src/lifi/validation.js";

const owner = getAddress("0x823A3a5BaB1186141b32fC65F8E25Ca24c679Ce7");
const transactionId = `0x${"a".repeat(64)}`;
const source = "200000000000000", feeAmount = "500000000000", bridged = "199500000000000";
const output = "7044794492080240000", minimum = "7009570519619838800";
const eth = { address: BRIDGE_ZERO_ADDRESS, chainId: 1, symbol: "ETH", decimals: 18 };
const sei = { address: BRIDGE_ZERO_ADDRESS, chainId: 1329, symbol: "SEI", decimals: 18 };
const fee = { name: "LIFI Fixed Fee", included: true, amount: feeAmount, token: eth,
  feeSplit: { lifiFee: feeAmount, integratorFee: "0", recipients: [{ name: "lifi", type: "FIXED", fee: feeAmount }] } };
const action = (toChainId: number, fromAmount: string, fromAddress: string, toAddress: string) => ({
  fromChainId: 1, toChainId, fromToken: eth, toToken: toChainId === 1 ? eth : sei,
  fromAmount, fromAddress, toAddress,
});
function quote() {
  return structuredClone({
    type: "lifi", id: "synthetic-gaszip:0", tool: "gasZipBridge", toolDetails: { key: "gasZipBridge" },
    action: { ...action(1329, source, owner, owner), slippage: 0.005 }, integrator: "lifi-api",
    estimate: { tool: "gasZipBridge", approvalAddress: BRIDGE_DIAMOND, fromAmount: source,
      toAmount: output, toAmountMin: minimum, feeCosts: [fee], skipApproval: true },
    includedSteps: [
      { type: "protocol", tool: "feeCollection", toolDetails: { key: "feeCollection" },
        action: action(1, source, BRIDGE_DIAMOND, BRIDGE_DIAMOND),
        estimate: { tool: "feeCollection", fromAmount: source, toAmount: bridged, toAmountMin: bridged, feeCosts: [fee] } },
      { type: "cross", tool: "gasZipBridge", toolDetails: { key: "gasZipBridge" },
        action: action(1329, bridged, BRIDGE_DIAMOND, owner),
        estimate: { tool: "gasZipBridge", fromAmount: bridged, toAmount: output, toAmountMin: minimum,
          approvalAddress: BRIDGE_DIAMOND, feeCosts: [] } },
    ],
    transactionRequest: { from: owner, to: BRIDGE_DIAMOND, chainId: 1, value: "0xb5e620f48000",
      data: `0x606326ff${transactionId.slice(2)}${"0".repeat(64)}`, gasLimit: "0x83144", gasPrice: "0x95c45dd" },
    transactionId,
  });
}
function changed(mutator: (q: ReturnType<typeof quote>) => void) {
  const q = quote(); mutator(q); return q;
}
const fetched = Date.parse("2026-09-26T00:00:00.000Z");

test("Sei GasZip quote remains read-only and is tied to a local capture age, not provider expiry", () => {
  const q = quote(), inspected = inspectSeiGasZipQuote(q, fetched);
  assert.equal(inspected.signable, false);
  assert.equal(inspected.execution_blocked, true);
  assert.equal(inspected.providerExpiry, null);
  assert.equal(inspected.feeAtomic, feeAmount);
  assert.equal(inspected.bridgeAmountAtomic, bridged);
  assert.equal(inspected.quotedOutputAtomic, output);
  assert.equal(inspected.transactionValueAtomic, source);
  assert.equal(inspected.localExpiresAt, "2026-09-26T00:01:00.000Z");
  assert.deepEqual(revalidateSeiGasZipQuote(inspected, q, fetched + SEI_GASZIP_LOCAL_MAX_AGE_MS - 1), inspected);
  assert.throws(() => revalidateSeiGasZipQuote(inspected, q, fetched + SEI_GASZIP_LOCAL_MAX_AGE_MS), /local_quote_stale/u);
  assert.throws(() => revalidateSeiGasZipQuote(inspected, q, fetched - 1), /local_quote_stale/u);
});

test("Sei GasZip rejects swapped provider tool, destination, owner and recipient", () => {
  const other = getAddress("0x0B4Dd0C3dA001Fa146EEd3f80B01860BEF6B8a14");
  for (const q of [
    changed((x) => { x.tool = "across"; }),
    changed((x) => { x.toolDetails.key = "across"; }),
    changed((x) => { x.action.toChainId = 143; }),
    changed((x) => { x.action.toToken.chainId = 143; }),
    changed((x) => { x.action.fromAddress = other; }),
    changed((x) => { x.action.toAddress = other; }),
    changed((x) => { x.includedSteps[1]!.action.toAddress = other; }),
  ]) assert.throws(() => inspectSeiGasZipQuote(q, fetched), { code: "APN_PROVIDER_PROTOCOL" });
});

test("Sei GasZip rejects amount, fee, transaction envelope and malformed fields", () => {
  for (const q of [
    changed((x) => { x.action.fromAmount = "200000000000001"; }),
    changed((x) => { x.estimate.toAmountMin = "0"; }),
    changed((x) => { x.estimate.feeCosts[0]!.amount = "1"; }),
    changed((x) => { x.estimate.feeCosts[0]!.feeSplit.recipients[0]!.fee = "1"; }),
    changed((x) => { x.transactionRequest.to = owner; }),
    changed((x) => { x.transactionRequest.from = BRIDGE_DIAMOND; }),
    changed((x) => { x.transactionRequest.chainId = 1329; }),
    changed((x) => { x.transactionRequest.value = "0x1"; }),
    changed((x) => { x.transactionRequest.data = "0xdeadbeef"; }),
    changed((x) => { x.transactionRequest.gasLimit = "0x0"; }),
    changed((x) => { x.transactionRequest.value = "bogus"; }),
    changed((x) => { x.includedSteps[1]!.estimate.fromAmount = "1"; }),
  ]) assert.throws(() => inspectSeiGasZipQuote(q, fetched), { code: "APN_PROVIDER_PROTOCOL" });
});

test("Sei GasZip digest binds the complete provider quote and blocks mutation on revalidation", () => {
  const q = quote(), saved = inspectSeiGasZipQuote(q, fetched);
  const mutated = changed((x) => { x.transactionRequest.data += "00"; });
  assert.throws(() => revalidateSeiGasZipQuote(saved, mutated, fetched + 1000), /quote_mutated/u);
  const altered = changed((x) => { x.includedSteps[1]!.estimate.toAmount = output; x.id = "other-quote:0"; });
  assert.throws(() => revalidateSeiGasZipQuote(saved, altered, fetched + 1000), /quote_mutated/u);
  assert.throws(() => revalidateSeiGasZipQuote({ ...saved, signable: true } as never, q, fetched + 1000), /quote_mutated/u);
});
