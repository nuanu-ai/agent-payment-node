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
function mockRpc(overrides: { code?: string; consumed?: boolean; revert?: boolean; remapFacet?: boolean; staleBlock?: boolean; reorg?: boolean } = {}): NearTronReadOnlyRpc {
  let blockReads = 0;
  return { async request(method, params) {
    if (method === "eth_chainId") return "0x2105";
    if (method === "eth_getBlockByNumber") {
      blockReads++;
      return { number: "0x7b", hash: `0x${(overrides.reorg && blockReads > 1 ? "cd" : "ab").repeat(32)}`,
        timestamp: overrides.staleBlock ? "0x3d0" : "0x3e8" };
    }
    if (method === "eth_getCode") {
      assert.equal(params[1], "0x7b");
      return overrides.code ?? (overrides.remapFacet && params[0] === diamond ? "0x60026000" : code);
    }
    if (method === "eth_call") {
      const tx = params[0] as { data: string; from?: string; value?: string };
      assert.equal(params[1], "0x7b");
      if (tx.data.startsWith("0xcdffacc6")) return encodeFunctionResult({ abi: loupeAbi, functionName: "facetAddress", result: overrides.remapFacet ? diamond : facet });
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

import { freezeNonEvmBridgeOperation } from "../../src/lifi/non-evm-operation.js";
import { prepareNearTronBaseSourceReadOnly } from "../../src/lifi/near-tron-source-preparation.js";
import { inspectNearBaseTronQuoteOffline } from "../../src/lifi/near-tron-offline.js";
const erc20 = parseAbi(["function balanceOf(address owner) view returns (uint256)", "function allowance(address owner,address spender) view returns (uint256)"]);
async function preparation(overrides: { insufficient?: boolean; allowance?: boolean; pending?: boolean; gas?: boolean; native?: boolean; reorg?: boolean; consumed?: boolean } = {}) {
  const { quote, pins } = await setup();
  const inspected = inspectNearBaseTronQuoteOffline(quote, binding);
  const draft = freezeNonEvmBridgeOperation({ schemaVersion: "apn.non-evm-bridge-operation.v2", kind: "non_evm_bridge_intent",
    executionAdmitted: false, state: "unchecked_draft", sourceCallValidation: "unchecked",
    profileHash: "a".repeat(64), operationId: "b".repeat(64), requestHash: "c".repeat(64),
    createdAt: "1970-01-01T00:00:00.000Z", expiresAt: "2099-01-01T00:00:00.000Z",
    source: { chainId: 8453, token: inspected.sourceToken, owner: binding.sender, amountAtomic: binding.sourceAmountAtomic },
    sourceCall: { chainId: 8453, from: binding.sender, to: diamond, valueAtomic: "0", data: quote.transactionRequest.data,
      dataSha256: inspected.calldataSha256 }, maxSourceNativeDebitWei: "10000000000000000", maxProviderFeeAtomic: binding.maxFeeAtomic,
    route: "base_usdc_to_tron_usdt_lifi_near_intents",
    destination: { chainId: 728126428, token: inspected.quotedDestinationToken, recipient: binding.tronRecipient,
      minimumReceivedAtomic: binding.minOutputAtomic },
    provider: { kind: "lifi_near_intents", quoteHash: pins.quoteSha256, routeId: quote.id,
      stepId: quote.includedSteps[1].id, transactionId: quote.transactionId,
      quoteId: inspected.quoteId, depositAddress: inspected.depositAddress } } as any);
  const original = mockRpc(overrides.consumed ? { consumed: true } : {});
  const calls: string[] = [];
  let headReads = 0;
  const rpc: NearTronReadOnlyRpc = { async request(method, params) {
    calls.push(method);
    if (method === "eth_getTransactionCount") return params[1] === "pending" && overrides.pending ? "0x2" : "0x1";
    if (method === "eth_call") {
      const tx = params[0] as { data: string };
      if (tx.data.startsWith("0x70a08231")) return encodeFunctionResult({ abi: erc20, functionName: "balanceOf", result: overrides.insufficient ? 1n : 100000000n });
      if (tx.data.startsWith("0xdd62ed3e")) return encodeFunctionResult({ abi: erc20, functionName: "allowance", result: overrides.allowance ? 0n : 100000000n });
    }
    if (method === "eth_estimateGas") return overrides.gas ? "0x1000000" : "0x100000";
    if (method === "eth_maxPriorityFeePerGas") return "0x1";
    if (method === "eth_getBalance") return overrides.native ? "0x0" : "0x100000000000000";
    if (method === "eth_getBlockByNumber" && params[0] === "latest") {
      headReads++;
      return { number: "0x7b", timestamp: "0x3e8", hash: `0x${(overrides.reorg && headReads > 1 ? "cd" : "ab").repeat(32)}`, baseFeePerGas: "0x1" };
    }
    return original.request(method, params);
  } };
  return { draft, quote, pins, rpc, calls };
}
test("read-only preparation freezes the exact unchecked draft and quote with no side effects", async () => {
  const input = await preparation();
  const result = await prepareNearTronBaseSourceReadOnly(input);
  assert.equal(result.executionAdmitted, false);
  assert.equal(result.sourceCall.nonceAtomic, "1");
  assert.equal(result.sourceCall.data, input.draft.sourceCall.data);
  assert.equal(result.sourceCall.maxFeePerGasAtomic, "3");
  assert.ok(Object.isFrozen(result) && Object.isFrozen(result.sourceCall));
  assert.ok(input.calls.every((method) => method.startsWith("eth_") && !/send|sign|approve/i.test(method)));
});
test("mutations, exhausted state, pending nonce, reorg and consumed quote fail closed", async () => {
  for (const variant of ["insufficient", "allowance", "pending", "gas", "native", "reorg", "consumed"] as const) {
    const input = await preparation({ [variant]: true });
    await assert.rejects(prepareNearTronBaseSourceReadOnly(input), variant);
  }
  const input = await preparation();
  await assert.rejects(prepareNearTronBaseSourceReadOnly({ ...input, quote: { ...input.quote, id: "mutated" } }));
  await assert.rejects(prepareNearTronBaseSourceReadOnly({ ...input, draft: { ...input.draft, maxProviderFeeAtomic: "1" } }));
  const { integrityHash: _, ...body } = input.draft;
  await assert.rejects(prepareNearTronBaseSourceReadOnly({ ...input, draft: freezeNonEvmBridgeOperation({ ...body,
    provider: { ...input.draft.provider, quoteId: `0x${"11".repeat(32)}` } } as any) }));
});
