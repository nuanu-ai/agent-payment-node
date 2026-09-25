import { encodeFunctionData } from "viem";
import { MAX_NONCE_SCAN_BLOCKS } from "./constants.js";
import { ApnError } from "./errors.js";
import { evmDecimals, evmToken, evmUint, MAX_DIRECT_TRANSACTION_BYTES, resolveEvmAsset, type EvmAssetSelection } from "./evm-asset.js";
import { directEvmChain, directEvmListRows, directEvmNetwork, directEvmQuoteFeeModel, directEvmRequiresSafeHead, type DirectEvmChainId } from "./evm-direct-networks.js";
import type { Address, Economics, Hex, OperationRecord } from "./model.js";
import type { FeeEstimate, RpcReceipt } from "./ports.js";
import type { EvmBalanceSnapshot, EvmFeeQuote, EvmNativePrepareReads, EvmRpcBatchCall, EvmRpcCall, EvmRpcPort, EvmTransactionInput, EvmTransferEvidence } from "./evm-ports.js";
import { evmRpcAddress, evmRpcBlock, evmRpcHex, evmRpcQuantity, evmRpcRecord, evmRpcWord, evmTokenBalance, recheckEvmBlock } from "./evm-rpc-codec.js";
import { observeEvmTransfer } from "./evm-transfer-evidence.js";

const GAS_ORACLE = "0x420000000000000000000000000000000000000F";
const GAS_ORACLE_ABI = [
  { type: "function", name: "getL1FeeUpperBound", stateMutability: "view", inputs: [{ name: "size", type: "uint256" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "getOperatorFee", stateMutability: "view", inputs: [{ name: "gas", type: "uint256" }], outputs: [{ type: "uint256" }] },
] as const;

export class EvmRpc implements EvmRpcPort {
  constructor(private readonly call: EvmRpcCall, private readonly rpcOrigin: string,
    private readonly maximumSignedBytes = MAX_DIRECT_TRANSACTION_BYTES,
    private readonly batchCall?: EvmRpcBatchCall) {
    if (!Number.isSafeInteger(maximumSignedBytes) || maximumSignedBytes < MAX_DIRECT_TRANSACTION_BYTES || maximumSignedBytes > 16 * 1024) {
      throw new ApnError("APN_RPC_CONFIG", "Signed transaction size bound is invalid.");
    }
  }

  prepareLineaNative(): EvmNativePrepareReads { return this.prepareNativeBatched(59144); }
  prepareUnichainNative(): EvmNativePrepareReads { return this.prepareNativeBatched(130); }
  prepareUnichainUsdc(): EvmNativePrepareReads { return this.prepareNativeBatched(130, "usdc"); }
  preparePolygonUsdc(): EvmNativePrepareReads { return this.prepareNativeBatched(137, "usdc"); }
  prepareBnbNative(): EvmNativePrepareReads { return this.prepareNativeBatched(56); }
  prepareEthereumNative(): EvmNativePrepareReads { return this.prepareNativeBatched(1); }

  /** One prepare owns this bounded read session. No retry or scalar fallback follows a batch rejection. */
  private prepareNativeBatched(chainId: 1 | 59144 | 130 | 137 | 56, asset: "native" | "usdc" = "native"): EvmNativePrepareReads {
    if (this.batchCall === undefined) throw new ApnError("APN_RPC_CONFIG", "Selected RPC does not support batched prepare reads.");
    let attempts = 0;
    const attempt = async (method: string, params: readonly unknown[]): Promise<unknown> => {
      if (++attempts > 10) throw new ApnError("APN_RPC_PROTOCOL", "Batched prepare RPC attempt ceiling exceeded.");
      return await this.call(method, params);
    };
    const batch = async (calls: readonly { readonly method: string; readonly params: readonly unknown[] }[]): Promise<readonly unknown[]> => {
      if (++attempts > 10) throw new ApnError("APN_RPC_PROTOCOL", "Batched prepare RPC attempt ceiling exceeded.");
      return await this.batchCall!(calls);
    };
    const chain = { method: "eth_chainId", params: [] } as const;
    const check = (value: unknown): void => {
      if (evmRpcQuantity(value) !== BigInt(chainId)) throw new ApnError("APN_CHAIN_MISMATCH", "RPC chain does not match the explicitly selected EVM network.");
    };
    const blockFrom = async (value: unknown, tag: string) => await evmRpcBlock(async () => value, tag);
    const recheck = async (value: unknown, block: { readonly tag: Hex; readonly hash: Hex }) => {
      await recheckEvmBlock(async () => value, block);
    };
    const onlySelectedChain = (selected: DirectEvmChainId): void => {
      if (selected !== chainId) throw new ApnError("APN_INVALID_INPUT", "Batched prepare reads require the selected chain.");
    };
    return {
      balance: async (address, selection) => {
        onlySelectedChain(selection.chainId);
        if (asset === "native" ? selection.token !== "native" :
          selection.token === "native" || !directEvmListRows(chainId).some((row) => row.kind === "token" && row.symbol === "USDC" &&
            row.identifier === selection.token && row.decimals === 6)) {
          throw new ApnError("APN_INVALID_INPUT", "Batched prepare reads require the selected asset.");
        }
        if (selection.decimals !== undefined) evmDecimals(selection.decimals);
        const [preChain, rawHead] = await batch([chain, { method: "eth_getBlockByNumber", params: ["latest", false] }]);
        check(preChain);
        const head = await blockFrom(rawHead, "latest");
        let nativeAtomic: string, assetAtomic: string, observedDecimals: number | undefined;
        if (asset === "native") {
          nativeAtomic = evmRpcQuantity(await attempt("eth_getBalance", [address, head.tag])).toString();
          assetAtomic = nativeAtomic;
        } else {
          const token = selection.token as Address;
          const data = `0x70a08231${address.slice(2).toLowerCase().padStart(64, "0")}`;
          const [rawNative, rawCode, rawToken, rawDecimals] = await batch([
            { method: "eth_getBalance", params: [address, head.tag] },
            { method: "eth_getCode", params: [token, head.tag] },
            { method: "eth_call", params: [{ to: token, data }, head.tag] },
            { method: "eth_call", params: [{ to: token, data: "0x313ce567" }, head.tag] },
          ]);
          nativeAtomic = evmRpcQuantity(rawNative).toString();
          if (evmRpcHex(rawCode) === "0x") throw new ApnError("APN_ASSET_MISMATCH", "The selected token address has no contract on this chain.");
          assetAtomic = evmRpcWord(rawToken).toString();
          if (rawDecimals !== "0x") observedDecimals = evmDecimals(Number(evmRpcWord(rawDecimals)));
        }
        const [rawRecheck, postChain] = await batch([{ method: "eth_getBlockByNumber", params: [head.tag, false] }, chain]);
        await recheck(rawRecheck, head); check(postChain);
        return { address, asset: resolveEvmAsset(selection, observedDecimals), assetAtomic, nativeAtomic,
          blockNumberAtomic: head.number, blockHash: head.hash, rpcOrigin: this.rpcOrigin, observedAt: new Date().toISOString() };
      },
      nonceEstimate: async (address, transaction) => {
        onlySelectedChain(transaction.chainId);
        const [nonceChain, estimateChain] = await batch([chain, chain]);
        check(nonceChain); check(estimateChain);
        const [rawNonce, rawGas, rawPriority, rawHead] = await batch([
          { method: "eth_getTransactionCount", params: [address, "pending"] },
          { method: "eth_estimateGas", params: [{ from: transaction.from, to: transaction.to, data: transaction.data,
            value: `0x${evmUint(transaction.valueAtomic).toString(16)}` }] },
          { method: "eth_maxPriorityFeePerGas", params: [] },
          { method: "eth_getBlockByNumber", params: ["latest", false] },
        ]);
        const nonce = evmRpcQuantity(rawNonce).toString(), gas = evmRpcQuantity(rawGas), priority = evmRpcQuantity(rawPriority);
        const head = await blockFrom(rawHead, "latest");
        const maximum = 2n * evmRpcQuantity(head.raw.baseFeePerGas) + priority;
        if (maximum === 0n) throw new ApnError("APN_RPC_PROTOCOL", "The selected RPC quoted a zero gas price.");
        evmUint(maximum.toString(), true);
        const [noncePostChain, estimatePostChain] = await batch([chain, chain]);
        check(noncePostChain); check(estimatePostChain);
        return { nonce, estimated: { gasLimitAtomic: gas.toString(), maxFeePerGasAtomic: maximum.toString(),
          maxPriorityFeePerGasAtomic: priority.toString() } };
      },
      feeQuote: async (economics) => {
        const [preChain, rawHead] = await batch([chain, { method: "eth_getBlockByNumber", params: ["latest", false] }]);
        check(preChain);
        const head = await blockFrom(rawHead, "latest");
        const execution = evmUint(economics.maximumGasCostAtomic, true);
        let l1Fee = 0n, operatorFee = 0n;
        if (chainId === 130) {
          const data = encodeFunctionData({ abi: GAS_ORACLE_ABI, functionName: "getL1FeeUpperBound", args: [BigInt(this.maximumSignedBytes)] });
          const operatorData = encodeFunctionData({ abi: GAS_ORACLE_ABI, functionName: "getOperatorFee", args: [evmUint(economics.gasLimitAtomic, true)] });
          const [rawL1Fee, rawOperatorFee] = await batch([
            { method: "eth_call", params: [{ to: GAS_ORACLE, data }, head.tag] },
            { method: "eth_call", params: [{ to: GAS_ORACLE, data: operatorData }, head.tag] },
          ]);
          l1Fee = evmRpcWord(rawL1Fee); operatorFee = evmRpcWord(rawOperatorFee);
        }
        const total = evmUint((execution + l1Fee + operatorFee).toString(), true);
        const [rawRecheck, postChain] = await batch([{ method: "eth_getBlockByNumber", params: [head.tag, false] }, chain]);
        await recheck(rawRecheck, head); check(postChain);
        return { chainId, l1DataFeeUpperWei: l1Fee.toString(), operatorFeeUpperWei: operatorFee.toString(), maximumExecutionFeeWei: execution.toString(),
          totalQuoteWei: total.toString(), totalFeeEnforcedOnchain: false, blockNumberAtomic: head.number,
          blockHash: head.hash, rpcOrigin: this.rpcOrigin, observedAt: new Date().toISOString() };
      },
    };
  }

  async assertChain(chainId: DirectEvmChainId): Promise<void> {
    directEvmChain(chainId);
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

  async nonce(chainId: DirectEvmChainId, address: Address, tag: "pending" | "latest"): Promise<string> {
    await this.assertChain(chainId);
    const nonce = evmRpcQuantity(await this.call("eth_getTransactionCount", [address, tag])).toString();
    await this.assertChain(chainId);
    return nonce;
  }

  async estimate(input: EvmTransactionInput): Promise<FeeEstimate> {
    await this.assertChain(input.chainId);
    const gas = evmRpcQuantity(await this.call("eth_estimateGas", [{ from: input.from, to: input.to, data: input.data, value: `0x${evmUint(input.valueAtomic).toString(16)}` }]));
    const model = directEvmNetwork(input.chainId).feeModel;
    const priority = model === "arbitrum-inclusive" ? 0n : evmRpcQuantity(await this.call("eth_maxPriorityFeePerGas", []));
    const block = await evmRpcBlock(this.call, "latest");
    // A zero base fee (BNB Smart Chain) leaves the priority fee as the whole price; a zero total price is never signed.
    const maximum = 2n * evmRpcQuantity(block.raw.baseFeePerGas) + priority;
    if (maximum === 0n) throw new ApnError("APN_RPC_PROTOCOL", "The selected RPC quoted a zero gas price.");
    evmUint(maximum.toString(), true);
    await this.assertChain(input.chainId);
    return { gasLimitAtomic: gas.toString(), maxFeePerGasAtomic: maximum.toString(), maxPriorityFeePerGasAtomic: priority.toString() };
  }

  async feeQuote(chainId: DirectEvmChainId, economics: Economics): Promise<EvmFeeQuote> {
    await this.assertChain(chainId);
    const block = await evmRpcBlock(this.call, "latest");
    const data = encodeFunctionData({ abi: GAS_ORACLE_ABI, functionName: "getL1FeeUpperBound", args: [BigInt(this.maximumSignedBytes)] });
    const operatorData = encodeFunctionData({ abi: GAS_ORACLE_ABI, functionName: "getOperatorFee", args: [evmUint(economics.gasLimitAtomic, true)] });
    // OP-stack chains add the L1 data fee and operator fee on top of execution; the owner's budget caps the sum.
    const feeModel = directEvmQuoteFeeModel(chainId);
    const [l1Fee, operatorFee] = directEvmNetwork(chainId).feeModel !== "op-stack" ? [0n, 0n] : await Promise.all([
      this.call("eth_call", [{ to: GAS_ORACLE, data }, block.tag]).then(evmRpcWord),
      this.call("eth_call", [{ to: GAS_ORACLE, data: operatorData }, block.tag]).then(evmRpcWord),
    ]);
    const execution = evmUint(economics.maximumGasCostAtomic, true);
    const total = evmUint((execution + l1Fee + operatorFee).toString(), true);
    await recheckEvmBlock(this.call, block);
    await this.assertChain(chainId);
    return {
      chainId, ...(feeModel === undefined ? {} : { feeModel }), l1DataFeeUpperWei: l1Fee.toString(), operatorFeeUpperWei: operatorFee.toString(),
      maximumExecutionFeeWei: execution.toString(), totalQuoteWei: total.toString(), totalFeeEnforcedOnchain: false,
      blockNumberAtomic: block.number, blockHash: block.hash, rpcOrigin: this.rpcOrigin, observedAt: new Date().toISOString(),
    };
  }

  async receipt(chainId: DirectEvmChainId, transactionHash: Hex): Promise<RpcReceipt | null> {
    let raw: unknown;
    if (chainId === 56 && this.batchCall !== undefined) {
      const [identity, receipt] = await this.batchCall([
        { method: "eth_chainId", params: [] }, { method: "eth_getTransactionReceipt", params: [transactionHash] },
      ]);
      if (evmRpcQuantity(identity) !== 56n) throw new ApnError("APN_CHAIN_MISMATCH", "RPC chain does not match the explicitly selected EVM network.");
      raw = receipt;
    } else {
      await this.assertChain(chainId);
      raw = await this.call("eth_getTransactionReceipt", [transactionHash]);
    }
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

  async confirmedAtNonce(chainId: DirectEvmChainId, address: Address, nonce: string, startBlock: string): Promise<Hex | null> {
    await this.assertChain(chainId);
    const latest = await evmRpcBlock(this.call, directEvmRequiresSafeHead(chainId) ? "safe" : "latest");
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
