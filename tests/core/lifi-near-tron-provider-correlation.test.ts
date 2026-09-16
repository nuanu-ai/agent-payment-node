import assert from "node:assert/strict";
import test from "node:test";
import { correlateNearTronProviderStatusOffline } from "../../src/lifi/near-tron-provider-correlation.js";
import type { NearTronSourceDepositCandidate } from "../../src/lifi/near-tron-source-receipt.js";
import type { TronDestinationCandidate } from "../../src/lifi/tron-destination-candidate.js";
import type { Hex } from "../../src/model.js";
import { TRON_USDT } from "../../src/tron/codec.js";

const sourceHash: string = `0x${"12".repeat(32)}`;
const destinationHash = "ab".repeat(32);
const transactionId: string = `0x${"34".repeat(32)}`;
const recipient = "TBXSw8fM4jpQkGc6zZjsVABFpVN7UvXPdV";
const source: NearTronSourceDepositCandidate = {
  kind: "offline_near_tron_source_deposit_candidate", executionAdmitted: false, bridgeCompletion: false,
  recipientDelivery: "unverified", status: "unverified", chainId: 8453, transactionHash: sourceHash as Hex,
  blockNumberAtomic: "100", blockHash: `0x${"45".repeat(32)}`, logsHash: "logsha", transactionId: transactionId as Hex,
  quoteId: `0x${"56".repeat(32)}`, depositAddress: "0x1111111111111111111111111111111111111111",
  sourceToken: "0x2222222222222222222222222222222222222222", bridgeAmountAtomic: "99750000",
  facetMinimumOutputAtomic: "97000000", tronRecipient: recipient,
  facetNonEvmReceiver: `0x${"00".repeat(12)}${"33".repeat(20)}`,
  quotedDestinationToken: TRON_USDT, minimumOutputAtomic: "97000000",
  refundTo: "0x4444444444444444444444444444444444444444",
};
const destination: TronDestinationCandidate = {
  proofClass: "tron_solidified_usdt_destination_candidate", transactionId: destinationHash,
  recipient, token: TRON_USDT, receivedAtomic: "98500000", minimumOutputAtomic: "97000000",
  sourceMessageCorrelation: "unverified", bridgeCompletion: false,
};
function fixture() {
  return {
    lifi: { transactionId, sending: { txHash: sourceHash, chainId: 8453, token: { address: source.sourceToken } },
      receiving: { txHash: destinationHash, chainId: 728126428, token: { address: TRON_USDT }, amount: "98500000" },
      tool: "near", status: "DONE", substatus: "COMPLETED" },
    near: { status: "SUCCESS", quoteResponse: { quoteRequest: { recipient, refundTo: source.refundTo },
      quote: { depositAddress: source.depositAddress, amountIn: "99750000", minAmountOut: "97000000" } },
      swapDetails: { originChainTxHashes: [{ hash: sourceHash }], destinationChainTxHashes: [{ hash: destinationHash }], amountIn: "99750000", amountOut: "98500000" } },
  };
}
function refused(change: (f: ReturnType<typeof fixture>) => void, candidates: readonly TronDestinationCandidate[] = [destination]) {
  const f = fixture(); change(f);
  assert.throws(() => correlateNearTronProviderStatusOffline(source, f.lifi, f.near, candidates), { code: "APN_PROVIDER_PROTOCOL" });
}
test("correlates exact provider IDs and destination candidate without admitting completion", () => {
  const f = fixture();
  const result = correlateNearTronProviderStatusOffline(source, f.lifi, f.near, [destination]);
  assert.equal(result.destinationTransactionId, destinationHash);
  assert.equal(result.providerOutcome, "correlated_success");
  assert.equal(result.executionAdmitted, false);
  assert.equal(result.bridgeCompletion, false);
});
test("refuses LI.FI partial, refund, identity, chain, token and amount conflicts", () => {
  refused(f => { f.lifi.substatus = "PARTIAL"; });
  refused(f => { f.lifi.substatus = "REFUNDED"; });
  refused(f => { f.lifi.status = "PENDING"; });
  refused(f => { f.lifi.transactionId = sourceHash; });
  refused(f => { f.lifi.sending.txHash = destinationHash; });
  refused(f => { f.lifi.receiving.chainId = 1; });
  refused(f => { f.lifi.receiving.token.address = "wrong"; });
  refused(f => { f.lifi.receiving.amount = "1"; });
});
test("refuses NEAR incomplete, refunded, mismatched quote, hashes and output", () => {
  refused(f => { f.near.status = "INCOMPLETE_DEPOSIT"; });
  refused(f => { f.near.status = "REFUNDED"; });
  refused(f => { f.near.quoteResponse.quote.depositAddress = source.refundTo; });
  refused(f => { f.near.quoteResponse.quoteRequest.recipient = "other"; });
  refused(f => { f.near.quoteResponse.quoteRequest.refundTo = source.depositAddress; });
  refused(f => { f.near.quoteResponse.quote.minAmountOut = "1"; });
  refused(f => { f.near.swapDetails.originChainTxHashes[0]!.hash = destinationHash; });
  refused(f => { f.near.swapDetails.destinationChainTxHashes[0]!.hash = sourceHash; });
  refused(f => { f.near.swapDetails.amountOut = "1"; });
  refused(f => { f.near.swapDetails.amountIn = "1"; });
  refused(f => { f.near.swapDetails.originChainTxHashes.push({ hash: sourceHash }); });
});
test("refuses missing or duplicate destination candidates and conflicting receipt", () => {
  refused(() => {}, []);
  refused(() => {}, [destination, destination]);
  refused(() => {}, [{ ...destination, recipient: "other" }]);
  refused(() => {}, [{ ...destination, receivedAtomic: "1" }]);
});
