import { decodeAbiParameters, encodeAbiParameters, encodeFunctionData, getAddress, pad, size, zeroAddress } from "viem";
import { canonicalJson, hashObject } from "../canonical.js";
import { ApnError } from "../errors.js";
import { evmRpcBlock, evmRpcHex, evmRpcQuantity, recheckEvmBlock } from "../evm-rpc-codec.js";
import type { EvmRpcCall } from "../evm-ports.js";
import type { Address, Hex } from "../model.js";
import { STARGATE_QUOTE_ABI, STARGATE_QUOTE_OFT_OUTPUT, STARGATE_QUOTE_SEND_OUTPUT } from "./abi.js";
import { stargateV2Route } from "./registry.js";

export interface StargateV2QuoteRequest {
  readonly sourceChainId: number;
  readonly destinationChainId: number;
  readonly sourceToken: Address | "native";
  readonly destinationToken: Address | "native";
  readonly recipient: Address;
  readonly amountAtomic: string;
  /** Canonical LayerZero Type-3 options. Empty for ordinary transfers. */
  readonly extraOptions?: Hex;
}
export interface StargateV2QuoteEvidence {
  readonly schemaVersion: "apn.stargate-v2-direct-quote.v1";
  readonly executionAdmitted: false;
  readonly route: { readonly sourceChainId: number; readonly sourceEid: number; readonly sourceToken: Address;
    readonly sourcePool: Address; readonly destinationChainId: number; readonly destinationEid: number;
    readonly destinationToken: Address; readonly destinationPool: Address; readonly asset: string };
  readonly quote: { readonly requestedAmountAtomic: string; readonly minimumTransferAtomic: string; readonly maximumTransferAtomic: string;
    readonly amountSentAtomic: string; readonly minimumOutputAtomic: string; readonly protocolFees: readonly {
      readonly amountAtomic: string; readonly description: string }[]; readonly nativeMessageFeeAtomic: string; readonly lzTokenFeeAtomic: "0" };
  readonly recipient: Address;
  readonly block: { readonly numberAtomic: string; readonly hash: Hex };
  readonly requestHash: string;
  readonly quoteHash: string;
}

const uint = (value: unknown): bigint => {
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]{0,77})$/u.test(value)) throw new ApnError("APN_INVALID_INPUT", "Stargate amount must be a canonical uint256 string.");
  const result = BigInt(value); if (result <= 0n || result >= 1n << 256n) throw new ApnError("APN_INVALID_INPUT", "Stargate amount is outside uint256."); return result;
};
const protocol = (reason: string): never => { throw new ApnError("APN_RPC_PROTOCOL", `Direct Stargate V2 quote failed closed: ${reason}.`); };
const boundedResult = (value: unknown): Hex => {
  const result = evmRpcHex(value); if (size(result) > 64 * 1024) return protocol("returndata exceeds the bound"); return result;
};
const decodeExact = <T>(raw: Hex, parameters: Parameters<typeof decodeAbiParameters>[0]): T => {
  try {
    const decoded = decodeAbiParameters(parameters, raw);
    if (encodeAbiParameters(parameters, decoded) !== raw) return protocol("returndata is not canonical ABI");
    return decoded as T;
  } catch (error) { if (error instanceof ApnError) throw error; return protocol("returndata is malformed"); }
};

export async function quoteStargateV2Direct(request: StargateV2QuoteRequest, call: EvmRpcCall): Promise<StargateV2QuoteEvidence> {
  const snapshot = canonicalJson(request), amount = uint(request.amountAtomic), recipient = canonicalAddress(request.recipient);
  const extraOptions = request.extraOptions ?? "0x";
  if (!/^0x(?:[0-9a-f]{2})*$/u.test(extraOptions) || size(extraOptions) > 1024) protocol("extra options are malformed");
  const route = stargateV2Route(
    { chainId: request.sourceChainId as never, token: request.sourceToken },
    { chainId: request.destinationChainId as never, token: request.destinationToken },
  );
  await assertChain(call, route.from.chainId);
  const block = await evmRpcBlock(call, "latest"), code = boundedResult(await call("eth_getCode", [route.from.pool, block.tag]));
  if (code === "0x") protocol("the pinned source contract has no code");
  const sendParam = { dstEid: route.to.eid, to: pad(recipient, { size: 32 }), amountLD: amount, minAmountLD: 0n,
    extraOptions, composeMsg: "0x" as Hex, oftCmd: "0x" as Hex };
  const quoteOftData = encodeFunctionData({ abi: STARGATE_QUOTE_ABI, functionName: "quoteOFT", args: [sendParam] });
  const oftRaw = boundedResult(await call("eth_call", [{ to: route.from.pool, data: quoteOftData }, block.tag]));
  type OftResult = readonly [{ readonly minAmountLD: bigint; readonly maxAmountLD: bigint },
    readonly { readonly feeAmountLD: bigint; readonly description: string }[],
    { readonly amountSentLD: bigint; readonly amountReceivedLD: bigint }];
  const [limit, details, receipt] = decodeExact<OftResult>(oftRaw, STARGATE_QUOTE_OFT_OUTPUT);
  if (details.length > 8 || details.some((entry) => Buffer.byteLength(entry.description, "utf8") > 256 || /[\u0000-\u001f\u007f]/u.test(entry.description))) {
    protocol("fee details are malformed");
  }
  const conversionRate = 10n ** BigInt(route.from.localDecimals - route.from.sharedDecimals);
  const canonicalSent = amount - amount % conversionRate;
  const feeTotal = details.reduce((total, entry) => total + entry.feeAmountLD, 0n);
  if (limit.minAmountLD !== conversionRate || limit.minAmountLD > limit.maxAmountLD || amount > limit.maxAmountLD ||
      receipt.amountSentLD !== canonicalSent || receipt.amountSentLD < limit.minAmountLD || receipt.amountReceivedLD <= 0n ||
      receipt.amountReceivedLD - receipt.amountSentLD !== feeTotal) protocol("quote amounts are inconsistent");
  const quoteSendData = encodeFunctionData({ abi: STARGATE_QUOTE_ABI, functionName: "quoteSend", args: [sendParam, false] });
  const feeRaw = boundedResult(await call("eth_call", [{ to: route.from.pool, data: quoteSendData }, block.tag]));
  type FeeResult = readonly [{ readonly nativeFee: bigint; readonly lzTokenFee: bigint }];
  const [fee] = decodeExact<FeeResult>(feeRaw, STARGATE_QUOTE_SEND_OUTPUT);
  if (fee.lzTokenFee !== 0n) protocol("native fee quote unexpectedly returned an LZ token fee");
  await recheckEvmBlock(call, block); await assertChain(call, route.from.chainId);
  if (snapshot !== canonicalJson(request)) protocol("quote request mutated during the pinned reads");
  const evidence = {
    schemaVersion: "apn.stargate-v2-direct-quote.v1" as const, executionAdmitted: false as const,
    route: { sourceChainId: route.from.chainId, sourceEid: route.from.eid, sourceToken: route.from.token, sourcePool: route.from.pool,
      destinationChainId: route.to.chainId, destinationEid: route.to.eid, destinationToken: route.to.token, destinationPool: route.to.pool, asset: route.from.asset },
    quote: { requestedAmountAtomic: amount.toString(), minimumTransferAtomic: limit.minAmountLD.toString(), maximumTransferAtomic: limit.maxAmountLD.toString(),
      amountSentAtomic: receipt.amountSentLD.toString(), minimumOutputAtomic: receipt.amountReceivedLD.toString(),
      protocolFees: details.map((entry) => ({ amountAtomic: entry.feeAmountLD.toString(), description: entry.description })),
      nativeMessageFeeAtomic: fee.nativeFee.toString(), lzTokenFeeAtomic: "0" as const },
    recipient, block: { numberAtomic: block.number, hash: block.hash }, requestHash: hashObject(JSON.parse(snapshot)),
  };
  return Object.freeze({ ...evidence, quoteHash: hashObject(evidence) });
}

function canonicalAddress(value: unknown): Address {
  try { const result = getAddress(value as string); if (result === zeroAddress) throw new Error("zero"); return result; }
  catch { throw new ApnError("APN_INVALID_INPUT", "Stargate recipient must be a nonzero EVM address."); }
}
async function assertChain(call: EvmRpcCall, expected: number): Promise<void> {
  if (evmRpcQuantity(await call("eth_chainId", [])) !== BigInt(expected)) throw new ApnError("APN_CHAIN_MISMATCH", "Stargate RPC chain identity does not match the source route.");
}
