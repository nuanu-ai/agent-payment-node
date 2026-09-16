import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { resolve } from "node:path";
import { decodeFunctionData, encodeFunctionData, encodeFunctionResult, parseAbi, keccak256 } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { canonicalJson, sha256 } from "../../src/canonical.js";
import { preflightNearBaseTronSourceReadOnly, type NearTronReadOnlyRpc } from "../../src/lifi/near-tron-preflight.js";

const abi = parseAbi(["function swapAndStartBridgeTokensViaNEARIntents((bytes32 transactionId,string bridge,string integrator,address referrer,address sendingAssetId,address receiver,uint256 minAmount,uint256 destinationChainId,bool hasSourceSwaps,bool hasDestinationCall),(address callTo,address approveTo,address sendingAssetId,address receivingAssetId,uint256 fromAmount,bytes callData,bool requiresDeposit)[],(bytes32 nonEVMReceiver,address depositAddress,bytes32 quoteId,uint256 deadline,uint256 minAmountOut,address refundRecipient,bytes signature)) payable"]);
const saved = JSON.parse(readFileSync(resolve("tests/core/lifi-fixtures/base-tron-near-synthetic-20260916.json"), "utf8"));
const binding = { sender: "0x1111111111111111111111111111111111111111" as const,
  tronRecipient: "TBXSw8fM4jpQkGc6zZjsVABFpVN7UvXPdV", sourceAmountAtomic: "100000000", maxFeeAtomic: "250000", minOutputAtomic: "97000000" };
const account = privateKeyToAccount(`0x${"1".repeat(64)}`);
const diamond = "0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE" as const;
async function signedQuote(): Promise<any> {
  const q = structuredClone(saved);
  const decoded = decodeFunctionData({ abi, data: q.transactionRequest.data });
  const args = structuredClone(decoded.args) as unknown as any[];
  const [bridge, , near] = args;
  near.signature = await account.signTypedData({
    domain: { name: "LI.FI NEAR Intents Facet", version: "1", chainId: 8453, verifyingContract: diamond },
    types: { NEARIntentsPayload: [
      { name: "transactionId", type: "bytes32" }, { name: "minAmount", type: "uint256" },
      { name: "receiver", type: "bytes32" }, { name: "depositAddress", type: "address" },
      { name: "destinationChainId", type: "uint256" }, { name: "sendingAssetId", type: "address" },
      { name: "deadline", type: "uint256" }, { name: "quoteId", type: "bytes32" }, { name: "minAmountOut", type: "uint256" },
    ] }, primaryType: "NEARIntentsPayload",
    message: { transactionId: bridge.transactionId, minAmount: bridge.minAmount, receiver: near.nonEVMReceiver,
      depositAddress: near.depositAddress, destinationChainId: bridge.destinationChainId, sendingAssetId: bridge.sendingAssetId,
      deadline: near.deadline, quoteId: near.quoteId, minAmountOut: near.minAmountOut },
  });
  q.transactionRequest.data = encodeFunctionData({ abi, functionName: "swapAndStartBridgeTokensViaNEARIntents", args: args as never });
  return q;
}

const facet = "0x2222222222222222222222222222222222222222" as const;
const code = "0x60016000" as const;
const loupeAbi = parseAbi(["function facetAddress(bytes4 selector) view returns (address)"]);
const consumedAbi = parseAbi(["function isQuoteConsumed(bytes32 quoteId) view returns (bool)"]);
function mockRpc(overrides: { code?: string; consumed?: boolean; revert?: boolean } = {}): NearTronReadOnlyRpc {
  return { async request(method, params) {
    if (method === "eth_chainId") return "0x2105";
    if (method === "eth_getBlockByNumber") return { number: "0x7b", hash: `0x${"ab".repeat(32)}`, timestamp: "0x3e8" };
    if (method === "eth_getCode") return overrides.code ?? code;
    if (method === "eth_call") {
      const tx = params[0] as { data: string; from?: string; value?: string };
      assert.equal(params[1], "0x7b");
      if (tx.data.startsWith("0xcdffacc6")) return encodeFunctionResult({ abi: loupeAbi, functionName: "facetAddress", result: facet });
      if (tx.data.startsWith("0x")) {
        if (tx.data.startsWith(encodeFunctionData({ abi: consumedAbi, functionName: "isQuoteConsumed", args: [`0x${"00".repeat(32)}`] }).slice(0, 10)))
          return encodeFunctionResult({ abi: consumedAbi, functionName: "isQuoteConsumed", result: overrides.consumed ?? false });
        assert.equal(tx.from, binding.sender);
        assert.equal(tx.value, "0x0");
        if (overrides.revert) throw new Error("execution reverted");
        return "0x";
      }
    }
    throw new Error(`unexpected ${method}`);
  } };
}
async function setup() {
  const quote = await signedQuote();
  const pins = { facetCodeHash: keccak256(code), backendSigner: account.address,
    quoteSha256: sha256(canonicalJson(quote)), nowUnixSeconds: "1001", maxSafeBlockAgeSeconds: 10 };
  return { quote, pins };
}
test("read-only source preflight succeeds at one safe block", async () => {
  const { quote, pins } = await setup();
  const proof = await preflightNearBaseTronSourceReadOnly(quote, binding, pins, mockRpc());
  assert.equal(proof.blockNumber, "0x7b");
  assert.equal(proof.executionAdmitted, false);
  assert.equal(proof.bridgeCompletion, false);
});
test("facet upgrade, signer mismatch, consumed quote, expiry and simulation revert fail closed", async () => {
  const { quote, pins } = await setup();
  for (const [changedPins, rpc] of [
    [pins, mockRpc({ code: "0x60026000" })],
    [{ ...pins, backendSigner: facet }, mockRpc()],
    [pins, mockRpc({ consumed: true })],
    [{ ...pins, nowUnixSeconds: "9999999999" }, mockRpc()],
    [pins, mockRpc({ revert: true })],
  ] as const) await assert.rejects(preflightNearBaseTronSourceReadOnly(quote, binding, changedPins, rpc));
});
