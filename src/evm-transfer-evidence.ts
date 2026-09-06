import { ApnError } from "./errors.js";
import type { EvmRpcCall, EvmTransferEvidence } from "./evm-ports.js";
import type { OperationRecord } from "./model.js";
import type { RpcReceipt } from "./ports.js";
import { evmRpcAddress, evmRpcBlock, evmRpcHex, evmRpcQuantity, evmRpcRecord, evmTokenBalance, recheckEvmBlock } from "./evm-rpc-codec.js";

export async function observeEvmTransfer(call: EvmRpcCall, operation: OperationRecord, receipt: RpcReceipt): Promise<EvmTransferEvidence> {
  const binding = operation.evm;
  if (binding === undefined || operation.transactionHash === undefined || operation.economics === undefined || receipt.blockHash === undefined) {
    throw new ApnError("APN_RPC_PROTOCOL", "Generic transfer evidence requires its frozen transaction and receipt block.");
  }
  const block = await evmRpcBlock(call, `0x${BigInt(receipt.blockNumberAtomic).toString(16)}`);
  if (block.hash !== receipt.blockHash) throw new ApnError("APN_RPC_PROTOCOL", "Transfer receipt is not on the observed canonical block.");
  const transaction = evmRpcRecord(await call("eth_getTransactionByHash", [operation.transactionHash]));
  const transactionVerified = evmRpcHex(transaction.hash, 32) === operation.transactionHash.toLowerCase() &&
    evmRpcHex(transaction.blockHash, 32) === block.hash && evmRpcQuantity(transaction.blockNumber).toString() === block.number &&
    evmRpcQuantity(transaction.chainId) === BigInt(operation.chainId) && evmRpcAddress(transaction.from) === operation.walletAddress &&
    evmRpcAddress(transaction.to) === binding.transactionTo && evmRpcQuantity(transaction.value).toString() === binding.valueAtomic &&
    evmRpcHex(transaction.input) === operation.transactionData?.toLowerCase() &&
    evmRpcQuantity(transaction.type) === 2n && evmRpcQuantity(transaction.gas).toString() === operation.economics.gasLimitAtomic &&
    evmRpcQuantity(transaction.maxFeePerGas).toString() === operation.economics.maxFeePerGasAtomic &&
    evmRpcQuantity(transaction.maxPriorityFeePerGas).toString() === operation.economics.maxPriorityFeePerGasAtomic &&
    Array.isArray(transaction.accessList) && transaction.accessList.length === 0 &&
    evmRpcQuantity(transaction.nonce).toString() === operation.economics.nonceAtomic;
  if (!transactionVerified || binding.asset.kind === "native" || receipt.status === "reverted") {
    await recheckEvmBlock(call, block);
    return { blockHash: block.hash, transactionVerified, tokenBalanceDeltasVerified: false };
  }
  if (BigInt(block.number) === 0n || operation.recipient === operation.walletAddress) {
    return { blockHash: block.hash, transactionVerified, tokenBalanceDeltasVerified: false };
  }
  const previous = await evmRpcBlock(call, `0x${(BigInt(block.number) - 1n).toString(16)}`);
  if (evmRpcHex(block.raw.parentHash, 32) !== previous.hash) throw new ApnError("APN_RPC_PROTOCOL", "Receipt balance blocks are not contiguous.");
  const [senderBefore, senderAfter, recipientBefore, recipientAfter] = await Promise.all([
    evmTokenBalance(call, binding.asset.address, operation.walletAddress, previous.tag),
    evmTokenBalance(call, binding.asset.address, operation.walletAddress, block.tag),
    evmTokenBalance(call, binding.asset.address, operation.recipient, previous.tag),
    evmTokenBalance(call, binding.asset.address, operation.recipient, block.tag),
  ]);
  await recheckEvmBlock(call, previous);
  await recheckEvmBlock(call, block);
  const senderDeltaAtomic = (senderBefore - senderAfter).toString();
  const recipientDeltaAtomic = (recipientAfter - recipientBefore).toString();
  return {
    blockHash: block.hash, transactionVerified,
    tokenBalanceDeltasVerified: senderDeltaAtomic === operation.amountAtomic && recipientDeltaAtomic === operation.amountAtomic,
    senderDeltaAtomic, recipientDeltaAtomic,
  };
}
