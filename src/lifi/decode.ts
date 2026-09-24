import { decodeFunctionData, encodeFunctionData, getAddress } from "viem";
import { sha256 } from "../canonical.js";
import type { Address, Hex } from "../model.js";
import { ACROSS_SELECTOR, acrossBridgeAbi, FEE_FORWARDER, FEE_FORWARDER_NATIVE_SELECTOR, FEE_FORWARDER_SELECTOR, FEE_RECIPIENT, feeForwarderAbi, STARGATE_SELECTOR, stargateBridgeAbi } from "./abi.js";
import type { BridgeMaterialization, DecodedBridgeCall } from "./model.js";
import { BRIDGE_ASSET_REGISTRY, BRIDGE_QUOTE_DESTINATIONS, bridgeAssetRow, bridgeFeeAsset, bridgeNativeDenominationConversion, bridgeNativePrincipal, bridgeQuoteDestination, validateBridgeRequest } from "./asset-registry.js";
import { BRIDGE_DIAMOND, BRIDGE_MAX_CALLDATA_BYTES, BRIDGE_MAX_GAS, BRIDGE_ZERO_ADDRESS, BRIDGE_ZERO_WORD, bridgeAddress, bridgeFailure, bridgeHex, bridgeUint } from "./validation.js";
import { BNB_COMPOSITE, decodeBnbCompositeMessage } from "./bnb-composite.js";

type BridgeData = Readonly<{
  transactionId: Hex; bridge: string; integrator: string; referrer: Address; sendingAssetId: Address;
  receiver: Address; minAmount: bigint; destinationChainId: bigint; hasSourceSwaps: boolean; hasDestinationCall: boolean;
}>;
type SwapData = Readonly<{
  callTo: Address; approveTo: Address; sendingAssetId: Address; receivingAssetId: Address;
  fromAmount: bigint; callData: Hex; requiresDeposit: boolean;
}>;
type AcrossData = Readonly<{
  receiverAddress: Hex; refundAddress: Hex; sendingAssetId: Hex; receivingAssetId: Hex;
  outputAmount: bigint; outputAmountMultiplier: bigint; exclusiveRelayer: Hex; quoteTimestamp: number;
  fillDeadline: number; exclusivityParameter: number; message: Hex;
}>;
type StargateData = Readonly<{
  assetId: number;
  sendParams: Readonly<{ dstEid: number; to: Hex; amountLD: bigint; minAmountLD: bigint; extraOptions: Hex; composeMsg: Hex; oftCmd: Hex }>;
  fee: Readonly<{ nativeFee: bigint; lzTokenFee: bigint }>;
  refundAddress: Address;
}>;

export function decodeBridgeCall(materialization: BridgeMaterialization): DecodedBridgeCall {
  const request = validateBridgeRequest(materialization.request);
  const tx = materialization.transaction;
  const data = bridgeHex(tx.data, BRIDGE_MAX_CALLDATA_BYTES);
  const sourceAmount = bridgeUint(request.amountAtomic, true);
  const quotedOutput = bridgeUint(materialization.quotedOutputAtomic, true);
  const minimumOutput = bridgeUint(materialization.minimumOutputAtomic, true);
  const value = bridgeUint(tx.valueAtomic, false);
  const gas = bridgeUint(tx.gasLimitAtomic, true);
  // Stargate carries the native principal and the separate LayerZero fee in one transaction value.
  // Across carries only the principal. The fee cap excludes principal; aggregate gas and value are checked later.
  if (gas > BRIDGE_MAX_GAS || tx.chainId !== request.fromChainId || tx.from !== materialization.sender ||
    bridgeAddress(tx.from) !== tx.from || tx.to !== BRIDGE_DIAMOND || materialization.approvalAddress !== BRIDGE_DIAMOND ||
    materialization.sender !== bridgeAddress(materialization.sender) || materialization.sender === BRIDGE_ZERO_ADDRESS ||
    (bridgeNativePrincipal(request) ?
      (materialization.tool === "stargateV2" ? value <= sourceAmount || value - sourceAmount > BigInt(request.maxNativeDebitWei) : value !== sourceAmount) :
      value > BigInt(request.maxNativeDebitWei))) fail("transaction_envelope");
  const nativeConversion = bridgeNativeDenominationConversion(request);
  if (quotedOutput < minimumOutput || minimumOutput < BigInt(request.minOutputAtomic) ||
    (!nativeConversion && (sourceAmount < quotedOutput || sourceAmount - minimumOutput > BigInt(request.maxRouteFeeAtomic))) ||
    (quotedOutput - minimumOutput) * 10_000n > quotedOutput * BigInt(request.slippageBps) + 9_999n) fail("output_economics");

  const selector = data.slice(0, 10) as Hex;
  if (mQuotedDestination(request.toChainId) && !bridgeQuoteDestination(request.toChainId).tools.includes(materialization.tool as never)) fail("destination_tool_quote_unavailable");
  try {
    if (materialization.tool === "across" && selector === ACROSS_SELECTOR) {
      const decoded = decodeFunctionData({ abi: acrossBridgeAbi, data });
      if (decoded.functionName !== "swapAndStartBridgeTokensViaAcrossV4" || canonicalData(acrossBridgeAbi, decoded.functionName, decoded.args) !== data) fail("noncanonical_calldata");
      const [bridgeData, swaps, across] = decoded.args as unknown as readonly [BridgeData, readonly SwapData[], AcrossData];
      return decodeAcross(materialization, bridgeData, swaps, across, data, sourceAmount, minimumOutput, value);
    }
    if (materialization.tool === "stargateV2" && selector === STARGATE_SELECTOR) {
      const decoded = decodeFunctionData({ abi: stargateBridgeAbi, data });
      if (decoded.functionName !== "swapAndStartBridgeTokensViaStargate" || canonicalData(stargateBridgeAbi, decoded.functionName, decoded.args) !== data) fail("noncanonical_calldata");
      const [bridgeData, swaps, stargate] = decoded.args as unknown as readonly [BridgeData, readonly SwapData[], StargateData];
      return decodeStargate(materialization, bridgeData, swaps, stargate, data, sourceAmount, minimumOutput, value);
    }
  } catch (error) {
    if (error instanceof Error && error.name === "ApnError") throw error;
    fail("ABI_decode");
  }
  return fail("tool_selector");
}

function decodeAcross(m: BridgeMaterialization, bridge: BridgeData, swaps: readonly SwapData[], across: AcrossData, data: Hex, sourceAmount: bigint, minimum: bigint, value: bigint): DecodedBridgeCall {
  const bnb = m.request.fromChainId === 1 && m.request.toChainId === 56;
  const common = decodeCommon(m, bridge, swaps, sourceAmount, bnb);
  const receiverWord = addressWord(m.request.recipient), senderWord = addressWord(m.sender);
  // Across carries a native leg as the chain's pinned wrapped-native token: the facet deposits it, the fill unwraps it.
  const native = bridgeNativePrincipal(m.request), denominationConversion = bridgeNativeDenominationConversion(m.request);
  const inputWord = addressWord(native ? BRIDGE_ASSET_REGISTRY[m.request.fromChainId].nativeCoin.wrapped.address : m.request.fromToken);
  const outputWord = addressWord(bnb ? BNB_COMPOSITE.weth : native ? BRIDGE_ASSET_REGISTRY[m.request.toChainId].nativeCoin.wrapped.address : m.request.toToken);
  const composite = bnb ? decodeBnbCompositeMessage(across.message, bridge.transactionId, m.request.recipient) : undefined;
  const expectedReceiver = bnb ? addressWord(BNB_COMPOSITE.receiver) : receiverWord;
  if (value !== (native ? sourceAmount : 0n) || across.receiverAddress.toLowerCase() !== expectedReceiver || across.refundAddress.toLowerCase() !== senderWord ||
    across.sendingAssetId.toLowerCase() !== inputWord || across.receivingAssetId.toLowerCase() !== outputWord ||
    across.exclusiveRelayer.toLowerCase() !== BRIDGE_ZERO_WORD || across.exclusivityParameter !== 0 || (!bnb && across.message !== "0x") ||
    across.outputAmountMultiplier <= 0n || (!denominationConversion && across.outputAmountMultiplier > 1_000_000_000_000_000_000n) ||
    across.outputAmount !== bridge.minAmount * across.outputAmountMultiplier / 1_000_000_000_000_000_000n ||
    (!bnb && across.outputAmount !== minimum) || (bnb && (composite!.minimumOutputAtomic !== minimum.toString() ||
      composite!.expectedOutputAtomic !== m.quotedOutputAtomic || BigInt(composite!.inputAmountAtomic) > across.outputAmount)) ||
    across.quoteTimestamp >= across.fillDeadline) fail("across_semantics");
  validateFeeRows(m, common.fee, value, "across");
  return result(m, data, ACROSS_SELECTOR, bridge, common.fee, {
    kind: "across", receiverAddress: bridgeHex(across.receiverAddress, 32, 32), refundAddress: bridgeHex(across.refundAddress, 32, 32),
    sendingAssetId: bridgeHex(across.sendingAssetId, 32, 32), receivingAssetId: bridgeHex(across.receivingAssetId, 32, 32),
    outputAmountAtomic: across.outputAmount.toString(), outputAmountMultiplier: across.outputAmountMultiplier.toString(),
    exclusiveRelayer: bridgeHex(across.exclusiveRelayer, 32, 32), quoteTimestamp: String(across.quoteTimestamp),
    fillDeadline: String(across.fillDeadline), exclusivityParameter: String(across.exclusivityParameter), message: bridgeHex(across.message, 4096),
  }, common.bridgeAmount, value.toString(), composite);
}

function decodeStargate(m: BridgeMaterialization, bridge: BridgeData, swaps: readonly SwapData[], stargate: StargateData, data: Hex, sourceAmount: bigint, minimum: bigint, value: bigint): DecodedBridgeCall {
  const native = bridgeNativePrincipal(m.request);
  // Only this captured native pair has a reviewed offline calldata shape. Route preparation stays gated separately.
  if (native && (m.request.fromChainId !== 1 || m.request.toChainId !== 8453 || m.request.toToken !== BRIDGE_ZERO_ADDRESS)) fail("stargate_native_pair_unreviewed");
  const common = decodeCommon(m, bridge, swaps, sourceAmount);
  const expectedEid = destinationEid(m.request.toChainId);
  const p = stargate.sendParams;
  const nativeFee = native ? value - sourceAmount : value;
  if (stargate.assetId !== (native ? 13 : 1) || p.dstEid !== expectedEid || p.to.toLowerCase() !== addressWord(m.request.recipient) ||
    p.amountLD !== bridge.minAmount || p.minAmountLD !== minimum || p.extraOptions !== "0x" || p.composeMsg !== "0x" || p.oftCmd !== "0x" ||
    stargate.fee.nativeFee !== nativeFee || nativeFee === 0n || stargate.fee.lzTokenFee !== 0n || stargate.refundAddress !== m.sender) fail("stargate_taxi_semantics");
  validateFeeRows(m, common.fee, nativeFee, "stargateV2");
  return result(m, data, STARGATE_SELECTOR, bridge, common.fee, {
    kind: "stargateV2", assetId: native ? 13 : 1, dstEid: p.dstEid, receiverAddress: bridgeHex(p.to, 32, 32),
    amountLD: p.amountLD.toString(), minAmountLD: p.minAmountLD.toString(), nativeFee: nativeFee.toString(), lzTokenFee: "0",
    refundAddress: stargate.refundAddress, extraOptions: "0x", composeMsg: "0x", oftCmd: "0x",
  }, common.bridgeAmount, value.toString());
}

function decodeCommon(m: BridgeMaterialization, bridge: BridgeData, swaps: readonly SwapData[], sourceAmount: bigint, destinationCall = false): { fee: bigint; bridgeAmount: bigint } {
  const request = m.request;
  if (bridge.transactionId.toLowerCase() === BRIDGE_ZERO_WORD || bridge.bridge !== m.tool || bridge.integrator !== "lifi-api" ||
    bridge.referrer !== BRIDGE_ZERO_ADDRESS || bridge.sendingAssetId !== request.fromToken || bridge.receiver !== request.recipient ||
    bridge.destinationChainId !== BigInt(request.toChainId) || !bridge.hasSourceSwaps || bridge.hasDestinationCall !== destinationCall || bridge.minAmount <= 0n || bridge.minAmount >= sourceAmount || swaps.length !== 1) fail("bridge_data");
  const swap = swaps[0]!;
  if (swap.callTo !== FEE_FORWARDER || swap.approveTo !== FEE_FORWARDER || swap.sendingAssetId !== request.fromToken ||
    swap.receivingAssetId !== request.fromToken || swap.fromAmount !== sourceAmount || !swap.requiresDeposit) fail("fee_swap");
  // The fee forwarder takes the principal in its own kind: `forwardNativeFees` for the native coin, else the token call.
  const native = bridgeNativePrincipal(request), callData = bridgeHex(swap.callData);
  if (callData.slice(0, 10) !== (native ? FEE_FORWARDER_NATIVE_SELECTOR : FEE_FORWARDER_SELECTOR)) fail("fee_selector");
  let inner: ReturnType<typeof decodeFunctionData>;
  try { inner = decodeFunctionData({ abi: feeForwarderAbi, data: callData }); } catch { return fail("fee_ABI"); }
  if (inner.functionName !== (native ? "forwardNativeFees" : "forwardERC20Fees") ||
    canonicalData(feeForwarderAbi, inner.functionName, inner.args) !== callData) fail("fee_noncanonical");
  const [token, distributions] = (native ? [BRIDGE_ZERO_ADDRESS, inner.args[0]] : inner.args) as unknown as readonly [Address, readonly { recipient: Address; amount: bigint }[]];
  const fee = sourceAmount - bridge.minAmount;
  if (token !== request.fromToken || distributions.length !== 1 || distributions[0]!.recipient !== FEE_RECIPIENT || distributions[0]!.amount !== fee || fee <= 0n) fail("fee_distribution");
  return { fee, bridgeAmount: bridge.minAmount };
}

function validateFeeRows(m: BridgeMaterialization, forwardedFee: bigint, value: bigint, tool: "across" | "stargateV2"): void {
  let included = 0n, fixed = 0, native = 0;
  const sourceAsset = bridgeFeeAsset(bridgeAssetRow(m.request.fromChainId, m.request.fromToken));
  const destinationAsset = bridgeFeeAsset(bridgeAssetRow(m.request.toChainId, m.request.toToken));
  for (const fee of m.feeCosts) {
    const amount = bridgeUint(fee.amountAtomic, false);
    if (fee.included) {
      if (fee.chainId !== m.request.fromChainId && fee.chainId !== m.request.toChainId) fail("included_fee_asset");
      if (fee.asset !== (fee.chainId === m.request.fromChainId ? sourceAsset : destinationAsset)) fail("included_fee_asset");
      included += amount;
      if (fee.name === "LIFI Fixed Fee" && fee.chainId === m.request.fromChainId && fee.asset === sourceAsset && amount === forwardedFee) fixed += 1;
    } else {
      if (tool !== "stargateV2" || fee.name !== "LayerZero native fee" || fee.chainId !== m.request.fromChainId || fee.asset !== "native" || amount !== value) fail("native_fee_row");
      native += 1;
    }
  }
  if (fixed !== 1 || (!bridgeNativeDenominationConversion(m.request) &&
      included + BigInt(m.quotedOutputAtomic) > BigInt(m.request.amountAtomic)) ||
      (tool === "across" ? native !== 0 : native !== 1)) fail("fee_reconciliation");
}

function result(m: BridgeMaterialization, data: Hex, selector: Hex, bridge: BridgeData, fee: bigint, protocol: DecodedBridgeCall["protocol"], bridgeAmount: bigint, sourceValueAtomic: string, composite?: DecodedBridgeCall["composite"]): DecodedBridgeCall {
  return {
    tool: m.tool, selector, transactionId: bridgeHex(bridge.transactionId, 32, 32), bridgeName: m.tool,
    integrator: "lifi-api", referrer: BRIDGE_ZERO_ADDRESS, sender: m.sender, recipient: m.request.recipient,
    sourceChainId: m.request.fromChainId, destinationChainId: m.request.toChainId, sourceToken: m.request.fromToken,
    destinationToken: m.request.toToken, sourceAmountAtomic: m.request.amountAtomic, bridgeAmountAtomic: bridgeAmount.toString(),
    feeAmountAtomic: fee.toString(), feeRecipient: FEE_RECIPIENT, minimumOutputAtomic: m.minimumOutputAtomic,
    sourceValueAtomic, dataHash: sha256(Buffer.from(data.slice(2), "hex")), protocol, ...(composite === undefined ? {} : { composite }),
  };
}

function canonicalData(abi: typeof acrossBridgeAbi | typeof stargateBridgeAbi | typeof feeForwarderAbi, functionName: string, args: readonly unknown[]): Hex {
  return encodeFunctionData({ abi, functionName: functionName as never, args: args as never }).toLowerCase() as Hex;
}
function addressWord(address: Address): string { return `0x${"0".repeat(24)}${address.slice(2).toLowerCase()}`; }
function destinationEid(chainId: number): number {
  if (chainId === 1) return 30101; if (chainId === 8453) return 30184; if (chainId === 42161) return 30110;
  const row = bridgeQuoteDestination(chainId); if (row.endpointId !== null) return row.endpointId;
  return fail("destination_EID");
}
function mQuotedDestination(chainId: number): boolean { return chainId in BRIDGE_QUOTE_DESTINATIONS; }
function fail(reason: string): never { return bridgeFailure("APN_PROVIDER_PROTOCOL", reason); }
