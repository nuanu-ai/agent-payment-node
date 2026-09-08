import { encodeFunctionData } from "viem";
import { MAX_NONCE_SCAN_BLOCKS } from "./constants.js";
import { ApnError } from "./errors.js";
import { evmChain, evmDecimals, evmToken, evmUint, MAX_DIRECT_TRANSACTION_BYTES, resolveEvmAsset, type EvmAssetSelection, type EvmChainId } from "./evm-asset.js";
import type { Address, Economics, Hex, OperationRecord } from "./model.js";
import type { FeeEstimate, RpcReceipt } from "./ports.js";
import type { EvmBalanceSnapshot, EvmFeeQuote, EvmRpcCall, EvmRpcPort, EvmTransactionInput, EvmTransferEvidence } from "./evm-ports.js";
import { evmRpcAddress, evmRpcBlock, evmRpcHex, evmRpcQuantity, evmRpcRecord, evmRpcWord, evmTokenBalance, recheckEvmBlock } from "./evm-rpc-codec.js";
import { observeEvmTransfer } from "./evm-transfer-evidence.js";

const GAS_ORACLE = "0x420000000000000000000000000000000000000F";
const GAS_ORACLE_ABI = [
  { type: "function", name: "getL1FeeUpperBound", stateMutability: "view", inputs: [{ name: "size", type: "uint256" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "getOperatorFee", stateMutability: "view", inputs: [{ name: "gas", type: "uint256" }], outputs: [{ type: "uint256" }] },
] as const;

export class EvmRpc implements EvmRpcPort {
  constructor(private readonly call: EvmRpcCall, private readonly rpcOrigin: string) {}

  async assertChain(chainId: EvmChainId): Promise<void> {
    evmChain(chainId);
    if (evmRpcQuantity(await this.call("eth_chainId", [])) !== BigInt(chainId)) {
      throw new ApnError("APN_CHAIN_MISMATCH", "RPC chain does not match the explicitly selected EVM network.");
    }
  }

  async balance(address: Address, selection: EvmAssetSelection): Promise<EvmBalanceSnapshot> {
    await this.assertChain(selection.chainId);
    const token = evmToken(selection.token);
    if (selection.decimals !== undefined) evmDecimals(selection.decimals);
    const block = await evmRpcBlock(this.call, "latest");
    const nativeAtomic = evmRpcQuantity(await this.call("eth_getBalance", [address, block.tag])).toString();
    let observedDecimals: number | undefined;
    let assetAtomic = nativeAtomic;
    if (token !== "native") {
      if (evmRpcHex(await this.call("eth_getCode", [token, block.tag])) === "0x") {
        throw new ApnError("APN_ASSET_MISMATCH", "The selected token address has no contract on this chain.");
      }
      assetAtomic = (await evmTokenBalance(this.call, token, address, block.tag)).toString();
      let encodedDecimals: unknown;
      try { encodedDecimals = await this.call("eth_call", [{ to: token, data: "0x313ce567" }, block.tag]); } catch { encodedDecimals = undefined; }
      if (encodedDecimals !== undefined && encodedDecimals !== "0x") observedDecimals = evmDecimals(Number(evmRpcWord(encodedDecimals)));
    }
    const asset = resolveEvmAsset(selection, observedDecimals);
    await recheckEvmBlock(this.call, block);
    await this.assertChain(selection.chainId);
    return { address, asset, assetAtomic, nativeAtomic, blockNumberAtomic: block.number, blockHash: block.hash, rpcOrigin: this.rpcOrigin, observedAt: new Date().toISOString() };
  }

  async nonce(chainId: EvmChainId, address: Address, tag: "pending" | "latest"): Promise<string> {
    await this.assertChain(chainId);
    const nonce = evmRpcQuantity(await this.call("eth_getTransactionCount", [address, tag])).toString();
    await this.assertChain(chainId);
    return nonce;
  }

  async estimate(input: EvmTransactionInput): Promise<FeeEstimate> {
    await this.assertChain(input.chainId);
    const gas = evmRpcQuantity(await this.call("eth_estimateGas", [{ from: input.from, to: input.to, data: input.data, value: `0x${evmUint(input.valueAtomic).toString(16)}` }]));
    const priority = input.chainId === 42161 ? 0n : evmRpcQuantity(await this.call("eth_maxPriorityFeePerGas", []));
    const block = await evmRpcBlock(this.call, "latest");
    const maximum = 2n * evmRpcQuantity(block.raw.baseFeePerGas) + priority;
    evmUint(maximum.toString(), true);
    await this.assertChain(input.chainId);
    return { gasLimitAtomic: gas.toString(), maxFeePerGasAtomic: maximum.toString(), maxPriorityFeePerGasAtomic: priority.toString() };
  }

  async feeQuote(chainId: EvmChainId, economics: Economics): Promise<EvmFeeQuote> {
    await this.assertChain(chainId);
    const block = await evmRpcBlock(this.call, "latest");
    const data = encodeFunctionData({ abi: GAS_ORACLE_ABI, functionName: "getL1FeeUpperBound", args: [BigInt(MAX_DIRECT_TRANSACTION_BYTES)] });
    const operatorData = encodeFunctionData({ abi: GAS_ORACLE_ABI, functionName: "getOperatorFee", args: [evmUint(economics.gasLimitAtomic, true)] });
    const [l1Fee, operatorFee] = chainId !== 8453 ? [0n, 0n] : await Promise.all([
      this.call("eth_call", [{ to: GAS_ORACLE, data }, block.tag]).then(evmRpcWord),
      this.call("eth_call", [{ to: GAS_ORACLE, data: operatorData }, block.tag]).then(evmRpcWord),
    ]);
    const execution = evmUint(economics.maximumGasCostAtomic, true);
    const total = evmUint((execution + l1Fee + operatorFee).toString(), true);
    await recheckEvmBlock(this.call, block);
    await this.assertChain(chainId);
    return {
      chainId, ...(chainId === 42161 ? { feeModel: "arbitrum-inclusive" as const } : {}), l1DataFeeUpperWei: l1Fee.toString(), operatorFeeUpperWei: operatorFee.toString(),
      maximumExecutionFeeWei: execution.toString(), totalQuoteWei: total.toString(), totalFeeEnforcedOnchain: false,
      blockNumberAtomic: block.number, blockHash: block.hash, rpcOrigin: this.rpcOrigin, observedAt: new Date().toISOString(),
    };
  }

  async receipt(chainId: EvmChainId, transactionHash: Hex): Promise<RpcReceipt | null> {
    await this.assertChain(chainId);
    const raw = await this.call("eth_getTransactionReceipt", [transactionHash]);
    if (raw === null) return null;
    const receipt = evmRpcRecord(raw);
    const receiptHash = evmRpcHex(receipt.transactionHash, 32), blockHash = evmRpcHex(receipt.blockHash, 32);
    const blockNumber = evmRpcQuantity(receipt.blockNumber);
    if (receiptHash !== transactionHash.toLowerCase() || blockHash === `0x${"0".repeat(64)}`) throw new ApnError("APN_RPC_PROTOCOL", "EVM receipt identity is inconsistent.");
    const status = evmRpcQuantity(receipt.status);
    if (status !== 0n && status !== 1n) throw new ApnError("APN_RPC_PROTOCOL", "EVM receipt status is invalid.");
    if (!Array.isArray(receipt.logs) || receipt.logs.length > 256) throw new ApnError("APN_RPC_PROTOCOL", "EVM receipt log count exceeds its bound.");
    const logs = receipt.logs.map((value) => {
      const log = evmRpcRecord(value);
      if (!Array.isArray(log.topics) || log.topics.length > 4) throw new ApnError("APN_RPC_PROTOCOL", "EVM receipt topics are invalid.");
      if (evmRpcHex(log.transactionHash, 32) !== receiptHash || evmRpcHex(log.blockHash, 32) !== blockHash ||
          evmRpcQuantity(log.blockNumber) !== blockNumber || log.removed !== false || typeof log.data !== "string" || log.data.length > 131074) {
        throw new ApnError("APN_RPC_PROTOCOL", "EVM log does not belong to its canonical receipt.");
      }
      return { address: evmRpcAddress(log.address), topics: log.topics.map((topic) => evmRpcHex(topic, 32)), data: evmRpcHex(log.data) };
    });
    await this.assertChain(chainId);
    return {
      transactionHash: receiptHash, status: status === 1n ? "success" : "reverted",
      blockNumberAtomic: blockNumber.toString(), blockHash,
      logs, observedAt: new Date().toISOString(), rpcOrigin: this.rpcOrigin,
    };
  }

  async evidence(operation: OperationRecord, receipt: RpcReceipt): Promise<EvmTransferEvidence> {
    await this.assertChain(operation.chainId);
    const evidence = await observeEvmTransfer(this.call, operation, receipt);
    await this.assertChain(operation.chainId);
    return evidence;
  }

  async confirmedAtNonce(chainId: EvmChainId, address: Address, nonce: string, startBlock: string): Promise<Hex | null> {
    await this.assertChain(chainId);
    const latest = await evmRpcBlock(this.call, chainId === 42161 ? "safe" : "latest");
    const last = BigInt(latest.number);
    const lower = last >= MAX_NONCE_SCAN_BLOCKS - 1n ? last - MAX_NONCE_SCAN_BLOCKS + 1n : 0n;
    const first = evmUint(startBlock) > lower ? evmUint(startBlock) : lower;
    for (let number = last; number >= first; number -= 1n) {
      const block = evmRpcRecord(await this.call("eth_getBlockByNumber", [`0x${number.toString(16)}`, true]));
      if (evmRpcQuantity(block.number) !== number || !Array.isArray(block.transactions)) throw new ApnError("APN_RPC_PROTOCOL", "EVM nonce-scan block is invalid.");
      for (const value of block.transactions) {
        const transaction = evmRpcRecord(value);
        if (evmRpcAddress(transaction.from) === address && evmRpcQuantity(transaction.nonce) === evmUint(nonce)) {
          const hash = evmRpcHex(transaction.hash, 32), blockHash = evmRpcHex(block.hash, 32);
          if (evmRpcQuantity(transaction.chainId) !== BigInt(chainId) || evmRpcQuantity(transaction.blockNumber) !== number ||
              evmRpcHex(transaction.blockHash, 32) !== blockHash) throw new ApnError("APN_RPC_PROTOCOL", "Nonce evidence has a different chain or block identity.");
          await recheckEvmBlock(this.call, { tag: `0x${number.toString(16)}`, hash: blockHash });
          await this.assertChain(chainId);
          return hash;
        }
      }
      if (number === 0n) break;
    }
    return null;
  }
}
