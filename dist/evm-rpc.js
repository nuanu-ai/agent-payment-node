import { encodeFunctionData } from "viem";
import { ApnError } from "./errors.js";
import { evmDecimals, evmToken, evmUint, MAX_DIRECT_TRANSACTION_BYTES, resolveEvmAsset } from "./evm-asset.js";
import { directEvmChain, directEvmNetwork, directEvmQuoteFeeModel, directEvmRequiresSafeHead } from "./evm-direct-networks.js";
import { evmDirectReads, OP_STACK_GAS_ORACLE, OP_STACK_GAS_ORACLE_ABI } from "./evm-direct-reads.js";
import { evmRpcAddress, evmRpcBlock, evmRpcHex, evmRpcQuantity, evmRpcRecord, evmRpcWord, evmTokenBalance, recheckEvmBlock } from "./evm-rpc-codec.js";
import { observeEvmTransfer } from "./evm-transfer-evidence.js";
export class EvmRpc {
    call;
    rpcOrigin;
    maximumSignedBytes;
    batchCall;
    /** The endpoint's IP is pinned for this instance, so its chain id is proven once and cannot change afterwards. */
    verifiedChain;
    constructor(call, rpcOrigin, maximumSignedBytes = MAX_DIRECT_TRANSACTION_BYTES, batchCall) {
        this.call = call;
        this.rpcOrigin = rpcOrigin;
        this.maximumSignedBytes = maximumSignedBytes;
        this.batchCall = batchCall;
        if (!Number.isSafeInteger(maximumSignedBytes) || maximumSignedBytes < MAX_DIRECT_TRANSACTION_BYTES || maximumSignedBytes > 16 * 1024) {
            throw new ApnError("APN_RPC_CONFIG", "Signed transaction size bound is invalid.");
        }
    }
    /** One batched read session for one direct transfer step; see `evmDirectReads` for its POST plan. */
    directReads(chainId) {
        if (this.batchCall === undefined)
            throw new ApnError("APN_RPC_CONFIG", "Selected RPC does not support batched direct reads.");
        return evmDirectReads(directEvmChain(chainId), calls => this.read(chainId, calls), this.rpcOrigin, this.maximumSignedBytes);
    }
    /** Independent reads in one POST when the transport batches; the chain id joins the first POST of this instance. */
    async read(chainId, calls) {
        if (this.verifiedChain !== undefined && this.verifiedChain !== chainId)
            chainMismatch();
        const identity = this.verifiedChain === undefined ? [{ method: "eth_chainId", params: [] }] : [];
        const all = [...identity, ...calls];
        let values;
        if (this.batchCall !== undefined)
            values = await this.batchCall(all);
        else {
            const sequential = [];
            for (const item of all)
                sequential.push(await this.call(item.method, item.params));
            values = sequential;
        }
        if (values.length !== all.length)
            throw new ApnError("APN_RPC_PROTOCOL", "RPC batch result count differs from its request.");
        if (identity.length === 1) {
            if (evmRpcQuantity(values[0]) !== BigInt(chainId))
                chainMismatch();
            this.verifiedChain = chainId;
        }
        return values.slice(identity.length);
    }
    async assertChain(chainId) {
        directEvmChain(chainId);
        if (this.verifiedChain === chainId)
            return;
        if (this.verifiedChain !== undefined || evmRpcQuantity(await this.call("eth_chainId", [])) !== BigInt(chainId))
            chainMismatch();
        this.verifiedChain = chainId;
    }
    async balance(address, selection) {
        await this.assertChain(selection.chainId);
        const token = evmToken(selection.token);
        if (selection.decimals !== undefined)
            evmDecimals(selection.decimals);
        const block = await evmRpcBlock(this.call, "latest");
        const nativeAtomic = evmRpcQuantity(await this.call("eth_getBalance", [address, block.tag])).toString();
        let observedDecimals;
        let assetAtomic = nativeAtomic;
        if (token !== "native") {
            if (evmRpcHex(await this.call("eth_getCode", [token, block.tag])) === "0x") {
                throw new ApnError("APN_ASSET_MISMATCH", "The selected token address has no contract on this chain.");
            }
            assetAtomic = (await evmTokenBalance(this.call, token, address, block.tag)).toString();
            let encodedDecimals;
            try {
                encodedDecimals = await this.call("eth_call", [{ to: token, data: "0x313ce567" }, block.tag]);
            }
            catch {
                encodedDecimals = undefined;
            }
            if (encodedDecimals !== undefined && encodedDecimals !== "0x")
                observedDecimals = evmDecimals(Number(evmRpcWord(encodedDecimals)));
        }
        const asset = resolveEvmAsset(selection, observedDecimals);
        return { address, asset, assetAtomic, nativeAtomic, blockNumberAtomic: block.number, blockHash: block.hash, rpcOrigin: this.rpcOrigin, observedAt: new Date().toISOString() };
    }
    async nonce(chainId, address, tag) {
        await this.assertChain(chainId);
        return evmRpcQuantity(await this.call("eth_getTransactionCount", [address, tag])).toString();
    }
    async estimate(input) {
        await this.assertChain(input.chainId);
        const gas = evmRpcQuantity(await this.call("eth_estimateGas", [{ from: input.from, to: input.to, data: input.data, value: `0x${evmUint(input.valueAtomic).toString(16)}` }]));
        const model = directEvmNetwork(input.chainId).feeModel;
        const priority = model === "arbitrum-inclusive" ? 0n : evmRpcQuantity(await this.call("eth_maxPriorityFeePerGas", []));
        const block = await evmRpcBlock(this.call, "latest");
        // A zero base fee (BNB Smart Chain) leaves the priority fee as the whole price; a zero total price is never signed.
        const maximum = 2n * evmRpcQuantity(block.raw.baseFeePerGas) + priority;
        if (maximum === 0n)
            throw new ApnError("APN_RPC_PROTOCOL", "The selected RPC quoted a zero gas price.");
        evmUint(maximum.toString(), true);
        return { gasLimitAtomic: gas.toString(), maxFeePerGasAtomic: maximum.toString(), maxPriorityFeePerGasAtomic: priority.toString() };
    }
    async feeQuote(chainId, economics) {
        await this.assertChain(chainId);
        const block = await evmRpcBlock(this.call, "latest");
        const data = encodeFunctionData({ abi: OP_STACK_GAS_ORACLE_ABI, functionName: "getL1FeeUpperBound", args: [BigInt(this.maximumSignedBytes)] });
        const operatorData = encodeFunctionData({ abi: OP_STACK_GAS_ORACLE_ABI, functionName: "getOperatorFee", args: [evmUint(economics.gasLimitAtomic, true)] });
        // OP-stack chains add the L1 data fee and operator fee on top of execution; the owner's budget caps the sum.
        const feeModel = directEvmQuoteFeeModel(chainId);
        const [l1Fee, operatorFee] = directEvmNetwork(chainId).feeModel !== "op-stack" ? [0n, 0n] : await Promise.all([
            this.call("eth_call", [{ to: OP_STACK_GAS_ORACLE, data }, block.tag]).then(evmRpcWord),
            this.call("eth_call", [{ to: OP_STACK_GAS_ORACLE, data: operatorData }, block.tag]).then(evmRpcWord),
        ]);
        const execution = evmUint(economics.maximumGasCostAtomic, true);
        const total = evmUint((execution + l1Fee + operatorFee).toString(), true);
        return {
            chainId, ...(feeModel === undefined ? {} : { feeModel }), l1DataFeeUpperWei: l1Fee.toString(), operatorFeeUpperWei: operatorFee.toString(),
            maximumExecutionFeeWei: execution.toString(), totalQuoteWei: total.toString(), totalFeeEnforcedOnchain: false,
            blockNumberAtomic: block.number, blockHash: block.hash, rpcOrigin: this.rpcOrigin, observedAt: new Date().toISOString(),
        };
    }
    async receipt(chainId, transactionHash) {
        const [raw] = await this.read(directEvmChain(chainId), [{ method: "eth_getTransactionReceipt", params: [transactionHash] }]);
        if (raw === null)
            return null;
        const receipt = evmRpcRecord(raw);
        const receiptHash = evmRpcHex(receipt.transactionHash, 32), blockHash = evmRpcHex(receipt.blockHash, 32);
        const blockNumber = evmRpcQuantity(receipt.blockNumber);
        if (receiptHash !== transactionHash.toLowerCase() || blockHash === `0x${"0".repeat(64)}`)
            throw new ApnError("APN_RPC_PROTOCOL", "EVM receipt identity is inconsistent.");
        const status = evmRpcQuantity(receipt.status);
        if (status !== 0n && status !== 1n)
            throw new ApnError("APN_RPC_PROTOCOL", "EVM receipt status is invalid.");
        if (!Array.isArray(receipt.logs) || receipt.logs.length > 256)
            throw new ApnError("APN_RPC_PROTOCOL", "EVM receipt log count exceeds its bound.");
        const logs = receipt.logs.map((value) => {
            const log = evmRpcRecord(value);
            if (!Array.isArray(log.topics) || log.topics.length > 4)
                throw new ApnError("APN_RPC_PROTOCOL", "EVM receipt topics are invalid.");
            if (evmRpcHex(log.transactionHash, 32) !== receiptHash || evmRpcHex(log.blockHash, 32) !== blockHash ||
                evmRpcQuantity(log.blockNumber) !== blockNumber || log.removed !== false || typeof log.data !== "string" || log.data.length > 131074) {
                throw new ApnError("APN_RPC_PROTOCOL", "EVM log does not belong to its canonical receipt.");
            }
            return { address: evmRpcAddress(log.address), topics: log.topics.map((topic) => evmRpcHex(topic, 32)), data: evmRpcHex(log.data) };
        });
        return {
            transactionHash: receiptHash, status: status === 1n ? "success" : "reverted",
            blockNumberAtomic: blockNumber.toString(), blockHash,
            logs, observedAt: new Date().toISOString(), rpcOrigin: this.rpcOrigin,
        };
    }
    /** Bounded read-only transport for the native fee observer. */
    async nativeFeeRead(method, params) {
        if (!["eth_getTransactionReceipt", "eth_getTransactionByHash", "eth_getBlockByNumber", "eth_call"].includes(method)) {
            throw new ApnError("APN_INVALID_INPUT", "Native fee reads cannot invoke a write RPC method.");
        }
        return await this.call(method, params);
    }
    /** One POST after the receipt: its block, the transaction and, where finality is `safe`, the safe head. */
    async evidence(operation, receipt) {
        return await observeEvmTransfer(calls => this.read(directEvmChain(operation.chainId), calls), operation, receipt);
    }
    /** A finalized nonce past the frozen one, with no receipt for this hash from the same node, proves another transaction took it. */
    async unlandedEvidence(chainId, address, transactionHash) {
        if (this.batchCall === undefined)
            throw new ApnError("APN_RPC_CONFIG", "Unlanded-transfer evidence requires one batched RPC read.");
        const [nonce, receipt, transaction] = await this.read(directEvmChain(chainId), [
            { method: "eth_getTransactionCount", params: [address, "finalized"] },
            { method: "eth_getTransactionReceipt", params: [transactionHash] }, { method: "eth_getTransactionByHash", params: [transactionHash] },
        ]);
        if (receipt !== null)
            evmRpcRecord(receipt);
        if (transaction !== null && evmRpcHex(evmRpcRecord(transaction).hash, 32) !== transactionHash.toLowerCase()) {
            throw new ApnError("APN_RPC_PROTOCOL", "EVM transaction lookup returned a different hash.");
        }
        return { finalizedNonce: evmRpcQuantity(nonce).toString(), receiptFound: receipt !== null, transactionKnown: transaction !== null };
    }
}
function chainMismatch() {
    throw new ApnError("APN_CHAIN_MISMATCH", "RPC chain does not match the explicitly selected EVM network.");
}
//# sourceMappingURL=evm-rpc.js.map