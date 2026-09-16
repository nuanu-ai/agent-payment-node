import { encodeFunctionData, keccak256 } from "viem";
import { canonicalJson, hashObject } from "../canonical.js";
import { EvmRpc } from "../evm-rpc.js";
import { evmRpcAddress, evmRpcBlock, evmRpcHex, evmRpcQuantity, evmRpcRecord, evmRpcWord } from "../evm-rpc-codec.js";
import { parsePublicHttpsUrl } from "../network-policy.js";
import { bridgeDeployment } from "./deployments.js";
import { BridgeHttps } from "./https.js";
import { BASE_FEE_CONTRACT, bridgeActualFees } from "./rpc-fees.js";
import { verifyRpcTransaction } from "./rpc-transaction.js";
import { bridgeChain, bridgeTokenRow } from "./asset-registry.js";
import { BRIDGE_ZERO_WORD, bridgeFailure, bridgeHex, bridgeJson, bridgeSame, bridgeUint } from "./validation.js";
const ERC20_READ = [{ type: "function", name: "allowance", stateMutability: "view", inputs: [{ type: "address" }, { type: "address" }], outputs: [{ type: "uint256" }] },
    { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] }];
const READ_METHODS = new Set(["eth_chainId", "eth_getBlockByNumber", "eth_getBalance", "eth_getCode", "eth_getStorageAt", "eth_getTransactionCount", "eth_call", "eth_estimateGas", "eth_maxPriorityFeePerGas", "eth_getTransactionByHash", "eth_getTransactionReceipt", "eth_getLogs", "eth_sendRawTransaction"]);
export const BRIDGE_RPC_ENV = { 1: "APN_ETHEREUM_RPC_URL", 8453: "APN_BASE_RPC_URL", 42161: "APN_ARBITRUM_RPC_URL" };
export function bridgeRpcFactory(environment) {
    const cache = new Map(), transport = new BridgeHttps();
    return (chainId) => {
        bridgeChain(chainId, "APN_RPC_CONFIG");
        const existing = cache.get(chainId);
        if (existing !== undefined)
            return existing;
        const value = environment[BRIDGE_RPC_ENV[chainId]];
        if (value === undefined || value.length === 0)
            bridgeFailure("APN_RPC_CONFIG", `missing_${BRIDGE_RPC_ENV[chainId]}`);
        const endpoint = parsePublicHttpsUrl(value, "APN_RPC_CONFIG", "Bridge RPC endpoint", 2048);
        if (endpoint.search !== "")
            bridgeFailure("APN_RPC_CONFIG", "bridge_RPC_query_forbidden");
        let sequence = 0n;
        const call = async (method, params) => {
            if (!READ_METHODS.has(method))
                bridgeFailure("APN_RPC_PROTOCOL", "bridge_RPC_method");
            const id = (++sequence).toString(), body = canonicalJson({ jsonrpc: "2.0", id, method, params });
            const response = await transport.request(endpoint.toString(), "POST", body, 1024 * 1024, "APN_RPC_CONFIG");
            if (response.status !== 200)
                bridgeFailure("APN_RPC_PROTOCOL", "bridge_RPC_HTTP_status");
            const r = evmRpcRecord(bridgeJson(response.body, 1024 * 1024));
            if (r.jsonrpc !== "2.0" || r.id !== id || !Object.hasOwn(r, "result") || Object.hasOwn(r, "error"))
                bridgeFailure("APN_RPC_PROTOCOL", "bridge_RPC_response");
            return r.result;
        };
        const rpc = new BridgeRpc(chainId, endpoint.origin, call);
        cache.set(chainId, rpc);
        return rpc;
    };
}
export class BridgeRpc {
    chainId;
    origin;
    call;
    evm;
    constructor(chainId, origin, call) {
        this.chainId = chainId;
        this.origin = origin;
        this.call = call;
        bridgeChain(chainId);
        this.evm = new EvmRpc(call, origin, 16 * 1024);
    }
    async assertChain() { await this.evm.assertChain(this.chainId); }
    async block(tag) {
        await this.assertChain();
        const rpcTag = tag === "latest" || tag === "safe" ? tag : quantity(bridgeUint(tag));
        const b = await evmRpcBlock(this.call, rpcTag);
        await this.assertChain();
        return { numberAtomic: b.number, hash: b.hash, timestampAtomic: evmRpcQuantity(b.raw.timestamp).toString() };
    }
    async deployment(tool, peerChainId, token, block) {
        await this.assertChain();
        const at = block ?? await this.block("safe"), contract = bridgeDeployment(this.chainId, peerChainId, tool, token), tag = quantity(BigInt(at.numberAtomic));
        const code = [], configuration = [];
        const feeContract = this.chainId === 8453 ? BASE_FEE_CONTRACT : { code: [], reads: [] };
        for (const row of [...contract.code, ...feeContract.code]) {
            const bytes = bridgeHex(await this.call("eth_getCode", [row.address, tag]), 128 * 1024, undefined, "APN_RPC_PROTOCOL");
            if (bytes === "0x" || keccak256(bytes) !== row.codeHash)
                bridgeFailure("APN_PROVIDER_PROTOCOL", "bridge_deployment_code_changed");
            code.push({ address: row.address, codeHash: keccak256(bytes) });
        }
        for (const row of [...contract.reads, ...feeContract.reads]) {
            const result = row.kind === "storage" ? await this.call("eth_getStorageAt", [row.address, row.data, tag])
                : await this.call("eth_call", [{ to: row.address, data: row.data }, tag]);
            const observed = bridgeHex(result, 64 * 1024, undefined, "APN_RPC_PROTOCOL");
            if (observed !== row.expected)
                bridgeFailure("APN_PROVIDER_PROTOCOL", "bridge_deployment_configuration_changed");
            configuration.push({ ...row, expected: observed });
        }
        await this.recheck(at);
        await this.assertChain();
        return { chainId: this.chainId, peerChainId, tool, block: at, rpcOrigin: this.origin,
            contractHash: hashObject({ protocol: contract, feeContract }), codeHash: hashObject(code), configurationHash: hashObject(configuration) };
    }
    async account(owner, spender, token) {
        await this.assertChain();
        const at = await this.block("latest"), tag = quantity(BigInt(at.numberAtomic));
        bridgeTokenRow(this.chainId, token, "APN_RPC_CONFIG");
        const data = encodeFunctionData({ abi: ERC20_READ, functionName: "balanceOf", args: [owner] });
        const allowanceData = encodeFunctionData({ abi: ERC20_READ, functionName: "allowance", args: [owner, spender] });
        const [balance, native, allowance, latest, pending] = await Promise.all([
            this.call("eth_call", [{ to: token, data }, tag]).then(evmRpcWord), this.call("eth_getBalance", [owner, tag]).then(evmRpcQuantity),
            this.call("eth_call", [{ to: token, data: allowanceData }, tag]).then(evmRpcWord),
            this.call("eth_getTransactionCount", [owner, "latest"]).then(evmRpcQuantity), this.call("eth_getTransactionCount", [owner, "pending"]).then(evmRpcQuantity),
        ]);
        await this.recheck(at);
        await this.assertChain();
        return { chainId: this.chainId, rpcOrigin: this.origin, block: at, owner, token, spender, balanceAtomic: balance.toString(),
            nativeBalanceWei: native.toString(), allowanceAtomic: allowance.toString(), latestNonceAtomic: latest.toString(), pendingNonceAtomic: pending.toString() };
    }
    async prices() {
        await this.assertChain();
        const b = await evmRpcBlock(this.call, "latest"), priority = this.chainId === 42161 ? 0n : evmRpcQuantity(await this.call("eth_maxPriorityFeePerGas", []));
        const maximum = 2n * evmRpcQuantity(b.raw.baseFeePerGas) + priority;
        bridgeUint(maximum.toString(), true, "APN_RPC_PROTOCOL");
        await this.assertChain();
        return { maxFeePerGasAtomic: maximum.toString(), maxPriorityFeePerGasAtomic: priority.toString() };
    }
    async estimate(transaction) {
        if (transaction.chainId !== this.chainId)
            bridgeFailure("APN_CHAIN_MISMATCH", "bridge_estimate_chain");
        return await this.evm.estimate(transaction);
    }
    async feeQuote(envelope) { return await this.evm.feeQuote(this.chainId, envelope.economics); }
    async send(raw) {
        bridgeHex(raw, 16 * 1024, undefined, "APN_PROVIDER_EFFECT_UNAVAILABLE");
        const hash = evmRpcHex(await this.call("eth_sendRawTransaction", [raw]), 32);
        if (hash !== keccak256(raw))
            bridgeFailure("APN_RPC_AMBIGUOUS", "submitted_transaction_hash_mismatch");
        return hash;
    }
    async observe(hash, expected) {
        await this.assertChain();
        bridgeHex(hash, 32, 32, "APN_RPC_PROTOCOL");
        const [rawTx, rawReceipt] = await Promise.all([this.call("eth_getTransactionByHash", [hash]), this.call("eth_getTransactionReceipt", [hash])]);
        if (rawTx === null || rawReceipt === null)
            return null;
        const tx = evmRpcRecord(rawTx), r = evmRpcRecord(rawReceipt), number = evmRpcQuantity(r.blockNumber), blockHash = evmRpcHex(r.blockHash, 32);
        if (evmRpcHex(r.transactionHash, 32) !== hash || evmRpcHex(tx.blockHash, 32) !== blockHash ||
            evmRpcQuantity(tx.blockNumber) !== number || evmRpcQuantity(tx.type) !== evmRpcQuantity(r.type) || evmRpcQuantity(tx.transactionIndex) !== evmRpcQuantity(r.transactionIndex))
            bridgeFailure("APN_RPC_PROTOCOL", "receipt_transaction_membership");
        const included = await evmRpcBlock(this.call, quantity(number));
        const index = evmRpcQuantity(r.transactionIndex);
        if (included.hash !== blockHash || !Array.isArray(included.raw.transactions) || included.raw.transactions.length > 20_000 ||
            index >= BigInt(included.raw.transactions.length) || included.raw.transactions[Number(index)] !== hash)
            bridgeFailure("APN_RPC_PROTOCOL", "canonical_transaction_membership");
        const block = { numberAtomic: number.toString(), hash: blockHash, timestampAtomic: evmRpcQuantity(included.raw.timestamp).toString() };
        const safe = await this.block("safe"), safeBlock = BigInt(safe.numberAtomic) >= number ? safe : null;
        const status = evmRpcQuantity(r.status);
        if (status !== 0n && status !== 1n)
            bridgeFailure("APN_RPC_PROTOCOL", "receipt_status");
        const identity = await verifyRpcTransaction(tx, this.chainId, hash, expected);
        if (evmRpcAddress(r.from) !== identity.from || evmRpcAddress(r.to) !== identity.to)
            bridgeFailure("APN_RPC_PROTOCOL", "receipt_sender_target");
        const logs = parseReceiptLogs(r.logs, hash, block, index), fees = await bridgeActualFees(this.chainId, r, block, this.call);
        if (BigInt(fees.gasUsedAtomic) > BigInt(identity.gasLimitAtomic) || BigInt(fees.effectiveGasPriceAtomic) > BigInt(identity.maxFeePerGasAtomic))
            bridgeFailure("APN_RPC_PROTOCOL", "receipt_execution_fee_bounds");
        await this.recheck(block);
        if (safeBlock !== null)
            await this.recheck(safeBlock);
        await this.assertChain();
        return { transaction: { chainId: this.chainId, transactionHash: hash, block, safeBlock, rpcOrigin: this.origin, ...identity,
                ...fees, status: status === 1n ? "success" : "reverted", logsHash: hashObject(logs) },
            receipt: { chainId: this.chainId, transactionHash: hash, blockNumberAtomic: number.toString(), blockHash, logs } };
    }
    async logs(input) {
        await this.assertChain();
        const from = bridgeUint(input.fromBlockAtomic), to = bridgeUint(input.toBlockAtomic);
        if (from > to || to - from >= 1024n || input.topics.length < 2 || input.topics.length > 4)
            bridgeFailure("APN_RPC_PROTOCOL", "destination_log_range");
        const value = await this.call("eth_getLogs", [{ address: input.address, fromBlock: quantity(from), toBlock: quantity(to), topics: input.topics }]);
        if (!Array.isArray(value) || value.length > 128)
            bridgeFailure("APN_RPC_PROTOCOL", "destination_log_count");
        const result = value.map((value) => {
            const r = evmRpcRecord(value), number = evmRpcQuantity(r.blockNumber), blockHash = evmRpcHex(r.blockHash, 32), transactionHash = evmRpcHex(r.transactionHash, 32);
            if (evmRpcAddress(r.address) !== input.address || r.removed !== false || number < from || number > to ||
                !Array.isArray(r.topics) || r.topics.length > 4 || r.topics.length < input.topics.length ||
                input.topics.some((v, i) => v !== null && evmRpcHex(r.topics[i], 32) !== v))
                bridgeFailure("APN_RPC_PROTOCOL", "destination_log_identity");
            bridgeHex(r.data, 64 * 1024, undefined, "APN_RPC_PROTOCOL");
            if (transactionHash === BRIDGE_ZERO_WORD || blockHash === BRIDGE_ZERO_WORD)
                bridgeFailure("APN_RPC_PROTOCOL", "destination_log_hash");
            return { transactionHash, blockNumberAtomic: number.toString(), blockHash };
        });
        await this.assertChain();
        return result;
    }
    async recheck(block) {
        if (!bridgeSame(await this.block(block.numberAtomic), block))
            bridgeFailure("APN_RPC_PROTOCOL", "bridge_block_reorg");
    }
}
function quantity(n) { return `0x${n.toString(16)}`; }
function parseReceiptLogs(value, hash, block, transactionIndex) {
    if (!Array.isArray(value) || value.length > 256)
        bridgeFailure("APN_RPC_PROTOCOL", "receipt_log_count");
    const indices = new Set();
    return value.map((value) => {
        const l = evmRpcRecord(value), index = evmRpcQuantity(l.logIndex).toString();
        if (indices.has(index) || evmRpcHex(l.transactionHash, 32) !== hash || evmRpcHex(l.blockHash, 32) !== block.hash ||
            evmRpcQuantity(l.blockNumber).toString() !== block.numberAtomic || evmRpcQuantity(l.transactionIndex) !== transactionIndex || l.removed !== false || !Array.isArray(l.topics) || l.topics.length > 4)
            bridgeFailure("APN_RPC_PROTOCOL", "receipt_log_membership");
        indices.add(index);
        return { address: evmRpcAddress(l.address), topics: l.topics.map((v) => evmRpcHex(v, 32)), data: bridgeHex(l.data, 64 * 1024, undefined, "APN_RPC_PROTOCOL") };
    });
}
//# sourceMappingURL=rpc.js.map