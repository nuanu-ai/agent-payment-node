import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { resolve } from "node:path";
import { decodeFunctionData, encodeFunctionData, parseAbi } from "viem";
import { inspectNearBaseTronQuoteOffline } from "../../src/lifi/near-tron-offline.js";

const saved = JSON.parse(readFileSync(resolve("tests/core/lifi-fixtures/base-tron-near-synthetic-20260916.json"), "utf8"));
const binding = { sender: "0x1111111111111111111111111111111111111111" as const,
  tronRecipient: "TBXSw8fM4jpQkGc6zZjsVABFpVN7UvXPdV", sourceAmountAtomic: "100000000",
  maxFeeAtomic: "250000", minOutputAtomic: "97000000" };
const copy = () => structuredClone(saved);
const B = "(bytes32 transactionId,string bridge,string integrator,address referrer,address sendingAssetId,address receiver,uint256 minAmount,uint256 destinationChainId,bool hasSourceSwaps,bool hasDestinationCall)";
const S = "(address callTo,address approveTo,address sendingAssetId,address receivingAssetId,uint256 fromAmount,bytes callData,bool requiresDeposit)[]";
const N = "(bytes32 nonEVMReceiver,address depositAddress,bytes32 quoteId,uint256 deadline,uint256 minAmountOut,address refundRecipient,bytes signature)";
const abi = parseAbi([`function swapAndStartBridgeTokensViaNEARIntents(${B},${S},${N}) payable`]);
function mutateCall(mutator: (args: any[]) => void): any {
  const q = copy(), decoded = decodeFunctionData({ abi, data: q.transactionRequest.data });
  const args = structuredClone(decoded.args) as unknown as any[]; mutator(args);
  q.transactionRequest.data = encodeFunctionData({ abi, functionName: "swapAndStartBridgeTokensViaNEARIntents", args: args as never });
  return q;
}
function refused(q: any, b = binding): void {
  assert.throws(() => inspectNearBaseTronQuoteOffline(q, b), { code: "APN_PROVIDER_PROTOCOL" });
}
test("offline NEAR source binding proves byte-level TRON account payload, not execution", () => {
  const result = inspectNearBaseTronQuoteOffline(copy(), binding);
  assert.equal(result.destinationBinding, "tron_account_payload_matches");
  assert.equal(result.executionAdmitted, false);
  assert.equal(result.bridgeCompletion, false);
  assert.equal(result.sourceAmountAtomic, "100000000");
  assert.equal(result.feeAmountAtomic, "250000");
  assert.equal(result.bridgeAmountAtomic, "99750000");
  assert.equal(result.facetMinimumOutputAtomic, "97962770");
  assert.equal(result.facetNonEvmReceiver, result.expectedTronAddressWord);
  assert.equal(result.facetDestinationChainId, "1885080386571452");
});
test("quote and transaction envelope mutations are refused", () => {
  for (const mutate of [
    (q: any) => { q.action.toAddress = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t"; },
    (q: any) => { q.action.toToken.address = "other"; },
    (q: any) => { q.estimate.approvalAddress = "0x1111111111111111111111111111111111111111"; },
    (q: any) => { q.estimate.toAmountMin = "96999999"; },
    (q: any) => { q.transactionRequest.chainId = 1; },
    (q: any) => { q.transactionRequest.value = "0x1"; },
    (q: any) => { q.transactionRequest.to = "0x1111111111111111111111111111111111111111"; },
    (q: any) => { q.includedSteps[1].action.toAddress = "other"; },
    (q: any) => { q.includedSteps[0].estimate.toAmount = "99749999"; },
  ]) { const q = copy(); mutate(q); refused(q); }
});
test("canonical calldata refuses destination, fee and amount mutations", () => {
  refused(mutateCall((a) => { a[0].destinationChainId = 728126428n; }));
  refused(mutateCall((a) => { a[0].minAmount = 99750001n; }));
  refused(mutateCall((a) => { a[0].hasDestinationCall = true; }));
  refused(mutateCall((a) => { a[1][0].fromAmount = 100000001n; }));
  refused(mutateCall((a) => { a[2].nonEVMReceiver = `0x${"0".repeat(63)}1`; }));
  refused(mutateCall((a) => { a[2].minAmountOut = 1n; }));
  refused(mutateCall((a) => { a[2].refundRecipient = "0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE"; }));
});
