import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { resolve } from "node:path";
import { decodeFunctionData, encodeFunctionData, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { verifyNearBaseTronSignatureOffline } from "../../src/lifi/near-tron-signature-offline.js";

const abi = parseAbi(["function swapAndStartBridgeTokensViaNEARIntents((bytes32 transactionId,string bridge,string integrator,address referrer,address sendingAssetId,address receiver,uint256 minAmount,uint256 destinationChainId,bool hasSourceSwaps,bool hasDestinationCall),(address callTo,address approveTo,address sendingAssetId,address receivingAssetId,uint256 fromAmount,bytes callData,bool requiresDeposit)[],(bytes32 nonEVMReceiver,address depositAddress,bytes32 quoteId,uint256 deadline,uint256 minAmountOut,address refundRecipient,bytes signature)) payable"]);
const saved = JSON.parse(readFileSync(resolve("tests/core/lifi-fixtures/base-tron-near-synthetic-20260916.json"), "utf8"));
const binding = { sender: "0x1111111111111111111111111111111111111111" as const,
  tronRecipient: "TBXSw8fM4jpQkGc6zZjsVABFpVN7UvXPdV", sourceAmountAtomic: "100000000", maxFeeAtomic: "250000", minOutputAtomic: "97000000" };
const account = privateKeyToAccount(`0x${"1".repeat(64)}`);
const diamond = "0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE" as const;
const context = { backendSigner: account.address, diamond, chainId: 8453 as const, nowUnixSeconds: "0" };

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

test("offline proof recovers the exact typed payload signer and stays outside execution", async () => {
  const proof = await verifyNearBaseTronSignatureOffline(await signedQuote(), binding, context);
  assert.equal(proof.recoveredSigner, account.address);
  assert.match(proof.digest, /^0x[0-9a-f]{64}$/u);
  assert.equal(proof.executionAdmitted, false);
  assert.equal(proof.bridgeCompletion, false);
});

test("wrong signer, domain and elapsed deadline fail closed", async () => {
  const quote = await signedQuote();
  for (const changed of [
    { ...context, backendSigner: "0x2222222222222222222222222222222222222222" as const },
    { ...context, diamond: "0x1111111111111111111111111111111111111111" as const },
    { ...context, chainId: 1 as any },
    { ...context, nowUnixSeconds: "9999999999" },
  ]) await assert.rejects(verifyNearBaseTronSignatureOffline(quote, binding, changed), { code: "APN_PROVIDER_PROTOCOL" });
  const tampered = structuredClone(quote);
  const decoded = decodeFunctionData({ abi, data: tampered.transactionRequest.data });
  const args = structuredClone(decoded.args) as unknown as any[];
  args[2].signature = `0x${"11".repeat(65)}`;
  tampered.transactionRequest.data = encodeFunctionData({ abi, functionName: "swapAndStartBridgeTokensViaNEARIntents", args: args as never });
  await assert.rejects(verifyNearBaseTronSignatureOffline(tampered, binding, context), { code: "APN_PROVIDER_PROTOCOL" });
});
