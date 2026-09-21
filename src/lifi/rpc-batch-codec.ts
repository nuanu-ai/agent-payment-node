import { ApnError } from "../errors.js";
import { evmRpcHex, evmRpcQuantity, evmRpcRecord, evmRpcWord } from "../evm-rpc-codec.js";
import type { Address, Hex } from "../model.js";
import type { BridgeChainId } from "./chains.js";
import type { BridgeBlock, BridgeTransaction } from "./model.js";
import { bridgeHex, bridgeUint } from "./validation.js";

export function rpcQuantityValue(value: unknown): bigint { return evmRpcQuantity(value); }
export function rpcExpectedChainValue(chainId: BridgeChainId): (value: unknown) => bigint {
  return (value) => {
    const observed = evmRpcQuantity(value);
    if (observed !== BigInt(chainId)) throw new ApnError("APN_CHAIN_MISMATCH", "RPC chain does not match the explicitly selected EVM network.");
    return observed;
  };
}
export function rpcWordValue(value: unknown): bigint { return evmRpcWord(value); }
export function rpcHexValue(maximumBytes: number): (value: unknown) => Hex {
  return (value) => bridgeHex(value, maximumBytes, undefined, "APN_RPC_PROTOCOL");
}
export function rpcRecordValue(value: unknown): Record<string, unknown> { return evmRpcRecord(value); }
export function rpcBlockValue(value: unknown): Record<string, unknown> {
  const block = evmRpcRecord(value); evmRpcQuantity(block.number); evmRpcHex(block.hash, 32); evmRpcQuantity(block.timestamp); return block;
}
export function rpcFeeBlockValue(value: unknown): Record<string, unknown> {
  const block = rpcBlockValue(value); evmRpcQuantity(block.baseFeePerGas); return block;
}
export function rpcTransactionInput(transaction: BridgeTransaction): Readonly<Record<string, unknown>> {
  return { from: transaction.from, to: transaction.to, data: transaction.data, value: quantity(bridgeUint(transaction.valueAtomic)) };
}
export function bridgeFeeQuote(chainId: BridgeChainId, origin: string, block: BridgeBlock, execution: bigint, l1: bigint, operator: bigint) {
  return { chainId, ...(chainId === 42161 ? { feeModel: "arbitrum-inclusive" as const } : chainId === 143 ? { feeModel: "monad-gas-limit" as const } : {}),
    l1DataFeeUpperWei: l1.toString(), operatorFeeUpperWei: operator.toString(), maximumExecutionFeeWei: execution.toString(),
    totalQuoteWei: (execution + l1 + operator).toString(), totalFeeEnforcedOnchain: false as const,
    blockNumberAtomic: block.numberAtomic, blockHash: block.hash, rpcOrigin: origin, observedAt: new Date().toISOString() };
}
function quantity(n: bigint): Hex { return `0x${n.toString(16)}`; }
