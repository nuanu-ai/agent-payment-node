import assert from "node:assert/strict";
import test from "node:test";
import { encodeFunctionData, toFunctionSelector } from "viem";
import { FEE_FORWARDER, FEE_RECIPIENT, STARGATE_SELECTOR, feeForwarderAbi, stargateBridgeAbi } from "../../src/lifi/abi.js";
import { bridgeAssetRow, bridgeAssetTool } from "../../src/lifi/asset-registry.js";
import { decodeBridgeCall } from "../../src/lifi/decode.js";
import type { BridgeMaterialization } from "../../src/lifi/model.js";
import { validateRouteEconomics } from "../../src/lifi/routes.js";
import { BRIDGE_DIAMOND, BRIDGE_ZERO_ADDRESS } from "../../src/lifi/validation.js";

const OWNER = "0x1111111111111111111111111111111111111111";
const SOURCE = 200000000000000n;
const FIXED_FEE = 500000000000n;
const LZ_FEE = 191951159457037n;
const BRIDGED = SOURCE - FIXED_FEE;
const VALUE = SOURCE + LZ_FEE;

// Derived from the captured 2026-09-24 unsigned Ethereum -> Base LI.FI step. Identity fields are synthetic;
// the selector, ABI layout, asset ID, amounts, fee split, and 1508-byte encoding match the captured shape.
function fixture(options: { assetId?: number; nativeFee?: bigint; forwardedFee?: bigint; value?: bigint;
  cap?: bigint; feeRow?: bigint; destination?: 8453 | 42161 } = {}): BridgeMaterialization {
  const forwarded = options.forwardedFee ?? FIXED_FEE;
  const feeCall = encodeFunctionData({ abi: feeForwarderAbi, functionName: "forwardNativeFees",
    args: [[{ recipient: FEE_RECIPIENT, amount: forwarded }]] });
  const data = encodeFunctionData({ abi: stargateBridgeAbi, functionName: "swapAndStartBridgeTokensViaStargate",
    args: [{ transactionId: `0x${"ab".repeat(32)}`, bridge: "stargateV2", integrator: "lifi-api",
      referrer: BRIDGE_ZERO_ADDRESS, sendingAssetId: BRIDGE_ZERO_ADDRESS, receiver: OWNER,
      minAmount: BRIDGED, destinationChainId: BigInt(options.destination ?? 8453), hasSourceSwaps: true, hasDestinationCall: false },
    [{ callTo: FEE_FORWARDER, approveTo: FEE_FORWARDER, sendingAssetId: BRIDGE_ZERO_ADDRESS,
      receivingAssetId: BRIDGE_ZERO_ADDRESS, fromAmount: SOURCE, callData: feeCall, requiresDeposit: true }],
    { assetId: options.assetId ?? 13, sendParams: { dstEid: 30184,
      to: `0x${"0".repeat(24)}${OWNER.slice(2)}`, amountLD: BRIDGED, minAmountLD: 197010000000000n,
      extraOptions: "0x", composeMsg: "0x", oftCmd: "0x" },
      fee: { nativeFee: options.nativeFee ?? LZ_FEE, lzTokenFee: 0n }, refundAddress: OWNER }] as never });
  return {
    routeId: "synthetic-route", stepId: "synthetic-step", tool: "stargateV2", sender: OWNER,
    request: { fromChainId: 1, toChainId: options.destination ?? 8453, fromToken: BRIDGE_ZERO_ADDRESS,
      toToken: BRIDGE_ZERO_ADDRESS, recipient: OWNER, amountAtomic: SOURCE.toString(),
      minOutputAtomic: "100000000000000", maxNativeDebitWei: (options.cap ?? 600000000000000n).toString(),
      maxRouteFeeAtomic: "100000000000000", slippageBps: 50 },
    approvalAddress: BRIDGE_DIAMOND, quotedOutputAtomic: "198000000000000", minimumOutputAtomic: "197010000000000",
    feeCosts: [
      { name: "LIFI Fixed Fee", chainId: 1, asset: "native", amountAtomic: FIXED_FEE.toString(), included: true },
      { name: "LayerZero native fee", chainId: 1, asset: "native", amountAtomic: (options.feeRow ?? LZ_FEE).toString(), included: false },
    ], includedStepIdentities: [],
    transaction: { chainId: 1, from: OWNER, to: BRIDGE_DIAMOND, data,
      valueAtomic: (options.value ?? VALUE).toString(), gasLimitAtomic: "1030900" },
    requestHash: "", responseHash: "", routeHash: "", stepHash: "", materializedStepHash: "", transactionDigest: "",
  } as BridgeMaterialization;
}

test("captured native Stargate ABI shape decodes principal and separate LayerZero fee offline", () => {
  const m = fixture();
  assert.equal(toFunctionSelector(stargateBridgeAbi[0]!), STARGATE_SELECTOR);
  assert.equal((m.transaction.data.length - 2) / 2, 1508);
  const decoded = decodeBridgeCall(m);
  assert.equal(decoded.selector, STARGATE_SELECTOR);
  assert.equal(decoded.bridgeAmountAtomic, BRIDGED.toString());
  assert.equal(decoded.feeAmountAtomic, FIXED_FEE.toString());
  assert.equal(decoded.sourceValueAtomic, VALUE.toString());
  assert.equal(decoded.protocol.kind, "stargateV2");
  if (decoded.protocol.kind !== "stargateV2") throw new Error("unreachable");
  assert.equal(decoded.protocol.assetId, 13);
  assert.equal(decoded.protocol.nativeFee, LZ_FEE.toString());
  assert.equal(validateRouteEconomics(m), "1500000000000");
  assert.throws(() => bridgeAssetTool(bridgeAssetRow(1, BRIDGE_ZERO_ADDRESS), "stargateV2"),
    { code: "APN_PROVIDER_CAPABILITY_UNAVAILABLE" });
});

test("native Stargate fails closed on debit cap, asset ID and both fee bindings", () => {
  for (const bad of [
    fixture({ cap: SOURCE }), fixture({ value: SOURCE }), fixture({ value: VALUE + 1n }),
    fixture({ assetId: 1 }), fixture({ nativeFee: LZ_FEE + 1n }),
    fixture({ forwardedFee: FIXED_FEE + 1n }), fixture({ feeRow: LZ_FEE + 1n }),
    fixture({ destination: 42161 }),
  ]) assert.throws(() => decodeBridgeCall(bad), { code: "APN_PROVIDER_PROTOCOL" });
  assert.throws(() => validateRouteEconomics(fixture({ feeRow: LZ_FEE + 1n })), { code: "APN_PROVIDER_PROTOCOL" });
});
