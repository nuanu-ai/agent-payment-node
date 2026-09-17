import type { Hex } from "viem";
import { ApnError } from "../../../errors.js";
import type { EvmRpcCall } from "../../../evm-ports.js";
import { evmRpcAddress, evmRpcBlock, evmRpcHex, evmRpcQuantity, evmRpcRecord, evmTokenBalance, recheckEvmBlock } from "../../../evm-rpc-codec.js";
import { validateSwapOperation, type SwapOperationRecord, type SwapReceiptProof } from "../../model.js";
import { validateUniswapReceipt, type UniswapReceiptEvidence } from "../../uniswap-receipt.js";
import { UNISWAP_ROUTER, UNISWAP_USDC } from "../../uniswap-pin.js";
import { validateUniswapExecutionBinding } from "./binding.js";
import type { UniswapExecutionBinding, UniswapReceiptObserverPort } from "./types.js";

export class UniswapEthereumReceiptObserver implements UniswapReceiptObserverPort {
  constructor(private readonly call: EvmRpcCall, private readonly now: () => Date = () => new Date()) {}

  async observe(operationValue: SwapOperationRecord, bindingValue: UniswapExecutionBinding,
    transactionHash: Hex): Promise<SwapReceiptProof | null> {
    const operation = validateSwapOperation(operationValue), binding = validateUniswapExecutionBinding(bindingValue, operation);
    if (operation.submissionMarker === null || operation.submissionMarker.markerHash !== binding.submissionMarkerHash) {
      blocked("Uniswap observation is forbidden before the durable submission marker.", "uniswap_observation_before_marker");
    }
    await this.assertChain();
    const [rawTx, rawReceipt] = await Promise.all([
      this.call("eth_getTransactionByHash", [transactionHash]), this.call("eth_getTransactionReceipt", [transactionHash]),
    ]);
    if (rawTx === null && rawReceipt === null) return null;
    if (rawTx === null || rawReceipt === null) {
      if (rawTx !== null) return null;
      blocked("Uniswap RPC returned a receipt without its transaction.", "uniswap_receipt_conflict");
    }
    const tx = evmRpcRecord(rawTx), receipt = evmRpcRecord(rawReceipt);
    const txHash = evmRpcHex(tx.hash, 32), receiptHash = evmRpcHex(receipt.transactionHash, 32);
    if (txHash !== transactionHash || receiptHash !== transactionHash) blocked("Uniswap transaction hash evidence conflicts.", "uniswap_transaction_conflict");
    this.assertTransactionEnvelope(tx, binding);
    const txBlock = evmRpcQuantity(tx.blockNumber), receiptBlock = evmRpcQuantity(receipt.blockNumber),
      txBlockHash = evmRpcHex(tx.blockHash, 32), receiptBlockHash = evmRpcHex(receipt.blockHash, 32);
    if (txBlock !== receiptBlock || txBlockHash !== receiptBlockHash) blocked("Uniswap transaction and receipt block identities conflict.", "uniswap_reorg_conflict");
    if (evmRpcAddress(receipt.from) !== operation.quote.account || evmRpcAddress(receipt.to) !== UNISWAP_ROUTER) {
      blocked("Uniswap receipt sender or router conflicts with the bound transaction.", "uniswap_receipt_conflict");
    }
    const block = await evmRpcBlock(this.call, `0x${txBlock.toString(16)}`);
    if (block.hash !== txBlockHash) blocked("Uniswap receipt block is no longer canonical.", "uniswap_reorg_conflict");
    const [safeHead, finalizedHead] = await Promise.all([evmRpcBlock(this.call, "safe"), evmRpcBlock(this.call, "finalized")]);
    if (BigInt(safeHead.number) < txBlock || BigInt(finalizedHead.number) < txBlock) return null;
    if (txBlock === 0n) blocked("Uniswap receipt has no pre-state block.", "uniswap_balance_proof");
    const beforeTag = `0x${(txBlock - 1n).toString(16)}` as Hex, afterTag = block.tag;
    const [beforeNative, afterNative, beforeOutput, afterOutput] = await Promise.all([
      this.balance(operation.quote.account, beforeTag), this.balance(operation.quote.account, afterTag),
      evmTokenBalance(this.call, UNISWAP_USDC, operation.quote.recipient as `0x${string}`, beforeTag),
      evmTokenBalance(this.call, UNISWAP_USDC, operation.quote.recipient as `0x${string}`, afterTag),
    ]);
    await recheckEvmBlock(this.call, block); await recheckEvmBlock(this.call, safeHead); await recheckEvmBlock(this.call, finalizedHead);
    await this.assertChain();
    const logsRaw = receipt.logs;
    if (!Array.isArray(logsRaw) || logsRaw.length > 4096) blocked("Uniswap receipt logs are malformed.", "uniswap_receipt_conflict");
    const logs = logsRaw.map((item): UniswapReceiptEvidence["receipt"]["logs"][number] => {
      const log = evmRpcRecord(item); if (!Array.isArray(log.topics) || log.topics.length > 4) blocked("Uniswap receipt log is malformed.", "uniswap_receipt_conflict");
      if (evmRpcHex(log.transactionHash, 32) !== transactionHash || evmRpcHex(log.blockHash, 32) !== receiptBlockHash ||
          evmRpcQuantity(log.blockNumber) !== receiptBlock || log.removed !== false) {
        blocked("Uniswap receipt log identity conflicts with its transaction or block.", "uniswap_receipt_conflict");
      }
      return { address: evmRpcAddress(log.address), topics: log.topics.map((topic) => evmRpcHex(topic, 32)), data: evmRpcHex(log.data) };
    });
    const status = evmRpcQuantity(receipt.status);
    if (status !== 1n) blocked("Uniswap swap receipt is reverted or invalid.", "uniswap_receipt_revert");
    const observedAt = instant(this.now());
    return validateUniswapReceipt({ transactionHash, transaction: { hash: txHash, from: evmRpcAddress(tx.from),
      to: evmRpcAddress(tx.to), input: evmRpcHex(tx.input), value: evmRpcQuantity(tx.value).toString(),
      blockNumber: txBlock.toString(), blockHash: txBlockHash }, receipt: { transactionHash: receiptHash, status: "0x1",
      blockNumber: receiptBlock.toString(), blockHash: receiptBlockHash, logs }, beforeNative: beforeNative.toString(),
      afterNative: afterNative.toString(), beforeOutput: beforeOutput.toString(), afterOutput: afterOutput.toString(),
      finalizedHead: { number: finalizedHead.number, hash: finalizedHead.hash }, observedAt }, binding.envelope,
    { transactionHash, account: operation.quote.account, recipient: operation.quote.recipient,
      inputAmountAtomic: operation.quote.inputAmountAtomic, minimumOutputAtomic: operation.quote.minimumOutputAtomic });
  }

  private async balance(address: string, tag: Hex): Promise<bigint> { return evmRpcQuantity(await this.call("eth_getBalance", [address, tag])); }
  private async assertChain(): Promise<void> { if (evmRpcQuantity(await this.call("eth_chainId", [])) !== 1n) throw new ApnError("APN_CHAIN_MISMATCH", "Uniswap observer requires exact Ethereum chain 1 RPC."); }
  private assertTransactionEnvelope(tx: Record<string, unknown>, binding: UniswapExecutionBinding): void {
    const envelope = binding.envelope, legacy = envelope.gasPrice !== undefined;
    if (evmRpcQuantity(tx.chainId) !== 1n || evmRpcQuantity(tx.nonce).toString() !== binding.nonce ||
        evmRpcQuantity(tx.gas).toString() !== envelope.gasLimit || evmRpcQuantity(tx.type) !== (legacy ? 0n : 2n)) {
      blocked("Uniswap mined transaction chain, nonce, gas, or type conflicts with the signed binding.", "uniswap_transaction_conflict");
    }
    if (legacy) {
      if (evmRpcQuantity(tx.gasPrice).toString() !== envelope.gasPrice) blocked("Uniswap mined legacy fee conflicts with the signed binding.", "uniswap_transaction_conflict");
    } else if (evmRpcQuantity(tx.maxFeePerGas).toString() !== envelope.maxFeePerGas ||
        evmRpcQuantity(tx.maxPriorityFeePerGas).toString() !== envelope.maxPriorityFeePerGas) {
      blocked("Uniswap mined EIP-1559 fees conflict with the signed binding.", "uniswap_transaction_conflict");
    }
  }
}

function instant(value: Date): string { if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new ApnError("APN_RPC_PROTOCOL", "Uniswap observation time is invalid."); return value.toISOString(); }
function blocked(message: string, reason: string): never { throw new ApnError("APN_OPERATION_BLOCKED", message, { reason }); }
