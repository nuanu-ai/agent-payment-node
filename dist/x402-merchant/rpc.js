import { decodeEventLog, decodeFunctionResult, encodeFunctionData, erc20Abi, getAddress, hashDomain, keccak256 } from "viem";
import { canonicalJson, hashObject, isPlainRecord } from "../canonical.js";
import { EvmDirectRpcGuard } from "../evm-direct-rpc-guard.js";
import { BridgeHttps } from "../lifi/https.js";
import { parseRpcBatchResultEnvelope } from "../rpc.js";
import { MERCHANT_AMOUNT, MERCHANT_IMPLEMENTATION, MERCHANT_IMPLEMENTATION_HASH, MERCHANT_OWNER, MERCHANT_PAYEE, MERCHANT_PROXY_HASH, MERCHANT_RPC, MERCHANT_TOKEN } from "./pins.js";
import { refuse } from "./protocol.js";
const METHODS = new Set(["eth_chainId", "eth_getBlockByNumber", "eth_getBalance", "eth_getCode", "eth_getStorageAt", "eth_getTransactionCount", "eth_call", "eth_estimateGas", "eth_maxPriorityFeePerGas", "eth_getTransactionReceipt", "eth_getTransactionByHash", "eth_sendRawTransaction"]);
export class MerchantRpc {
    transport;
    sequence = 0;
    guard;
    constructor(state, transport = new BridgeHttps()) {
        this.transport = transport;
        this.guard = new EvmDirectRpcGuard(state);
    }
    async batch(calls) {
        if (calls.length < 1 || calls.length > 16 || calls.some(c => !METHODS.has(c.method) || c.method === "eth_sendRawTransaction"))
            refuse("merchant_rpc_batch");
        const ids = calls.map(() => ++this.sequence);
        const response = await this.guard.post(MERCHANT_RPC, () => this.transport.request(MERCHANT_RPC, "POST", canonicalJson(calls.map((c, i) => ({ jsonrpc: "2.0", id: ids[i], ...c }))), 2 * 1024 * 1024, "APN_RPC_CONFIG"));
        if (response.status !== 200)
            refuse("merchant_rpc_http");
        return parseRpcBatchResultEnvelope(response.body, ids);
    }
    async call(method, params, beforeSend, beforeWire) {
        if (!METHODS.has(method))
            refuse("merchant_rpc_method");
        const id = ++this.sequence;
        const response = await this.guard.post(MERCHANT_RPC, async () => { await beforeSend?.(); return this.transport.request(MERCHANT_RPC, "POST", canonicalJson({ jsonrpc: "2.0", id, method, params }), 2 * 1024 * 1024, "APN_RPC_CONFIG", beforeWire); });
        if (response.status !== 200)
            refuse("merchant_rpc_http");
        return parseRpcBatchResultEnvelope(`[${response.body}]`, [id])[0];
    }
}
export const MERCHANT_DATA = encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [MERCHANT_PAYEE, BigInt(MERCHANT_AMOUNT)] });
const IMPLEMENTATION_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
const DOMAIN_ABI = [{ type: "function", name: "DOMAIN_SEPARATOR", stateMutability: "view", inputs: [], outputs: [{ type: "bytes32" }] }];
export function quantity(v) {
    if (typeof v !== "string" || !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/u.test(v))
        refuse("merchant_rpc_quantity");
    return BigInt(v);
}
export function object(v) {
    if (!isPlainRecord(v))
        refuse("merchant_rpc_object");
    return v;
}
export function bytes(v) {
    if (typeof v !== "string" || !/^0x(?:[a-fA-F0-9]{2})*$/u.test(v))
        refuse("merchant_rpc_bytes");
    return v.toLowerCase();
}
export function hexHash(v) {
    const h = bytes(v);
    if (h.length !== 66)
        refuse("merchant_rpc_hash");
    return h;
}
export function rpcTransaction() { return { from: MERCHANT_OWNER, to: MERCHANT_TOKEN, data: MERCHANT_DATA, value: "0x0" }; }
/** Fresh runtime, proxy implementation, real domain, balances and pending nonce at one rechecked anchor. */
export async function merchantCurrent(rpc) {
    const head = object(await rpc.call("eth_getBlockByNumber", ["latest", false])), tag = head.number, blockHash = hexHash(head.hash);
    const call = (functionName, args) => ({ method: "eth_call", params: [{ to: MERCHANT_TOKEN, data: encodeFunctionData({ abi: erc20Abi, functionName, args }) }, tag] });
    const v = await rpc.batch([{ method: "eth_chainId", params: [] }, { method: "eth_getCode", params: [MERCHANT_TOKEN, tag] },
        { method: "eth_getStorageAt", params: [MERCHANT_TOKEN, IMPLEMENTATION_SLOT, tag] }, { method: "eth_getCode", params: [MERCHANT_IMPLEMENTATION, tag] },
        call("name"), call("symbol"), call("decimals"), { method: "eth_call", params: [{ to: MERCHANT_TOKEN, data: encodeFunctionData({ abi: DOMAIN_ABI, functionName: "DOMAIN_SEPARATOR" }) }, tag] },
        call("balanceOf", [MERCHANT_OWNER]), { method: "eth_getBalance", params: [MERCHANT_OWNER, "pending"] }, { method: "eth_getTransactionCount", params: [MERCHANT_OWNER, "pending"] },
        { method: "eth_getCode", params: [MERCHANT_OWNER, tag] }, { method: "eth_estimateGas", params: [rpcTransaction()] }, { method: "eth_maxPriorityFeePerGas", params: [] },
        { method: "eth_getBlockByNumber", params: [tag, false] }]);
    if (quantity(v[0]) !== 4326n || keccak256(bytes(v[1])) !== MERCHANT_PROXY_HASH || bytes(v[2]) !== `0x${MERCHANT_IMPLEMENTATION.slice(2).toLowerCase().padStart(64, "0")}` || keccak256(bytes(v[3])) !== MERCHANT_IMPLEMENTATION_HASH ||
        bytes(v[11]) !== "0x" || hexHash(object(v[14]).hash) !== blockHash)
        refuse("merchant_runtime_identity");
    const decode = (name, raw) => decodeFunctionResult({ abi: erc20Abi, functionName: name, data: bytes(raw) });
    if (decode("name", v[4]) !== "MegaUSD" || decode("symbol", v[5]) !== "USDm" || decode("decimals", v[6]) !== 18 ||
        bytes(v[7]) !== hashDomain({ types: { EIP712Domain: [{ name: "name", type: "string" }, { name: "version", type: "string" }, { name: "chainId", type: "uint256" }, { name: "verifyingContract", type: "address" }] }, domain: { name: "MegaUSD", version: "1", chainId: 4326n, verifyingContract: MERCHANT_TOKEN } }))
        refuse("merchant_token_domain");
    const gas = quantity(v[12]) * 12n / 10n + 1n, priority = quantity(v[13]), fee = quantity(head.baseFeePerGas) * 2n + priority;
    return { nonce: quantity(v[10]).toString(), gas: gas.toString(), maxFeePerGas: fee.toString(), maxPriorityFeePerGas: priority.toString(), native: quantity(v[9]).toString(), token: String(decode("balanceOf", v[8])) };
}
export function checkMerchantEnvelope(current, envelope) {
    if (current.nonce !== envelope.nonce || BigInt(current.gas) > BigInt(envelope.gas) || BigInt(current.maxFeePerGas) > BigInt(envelope.maxFeePerGas) || BigInt(current.maxPriorityFeePerGas) > BigInt(envelope.maxPriorityFeePerGas) ||
        BigInt(current.native) < BigInt(envelope.gas) * BigInt(envelope.maxFeePerGas) || BigInt(current.token) < BigInt(MERCHANT_AMOUNT))
        refuse("merchant_nonce_fee_balance_changed");
}
export function merchantHeader(value) {
    const b = object(value), result = {};
    for (const key of ["hash", "parentHash", "stateRoot", "transactionsRoot", "receiptsRoot", "sha3Uncles"])
        result[key] = hexHash(b[key]);
    for (const key of ["number", "timestamp", "gasLimit", "gasUsed", "baseFeePerGas", "difficulty"])
        result[key] = quantity(b[key]).toString();
    for (const [key, length] of [["logsBloom", 514], ["nonce", 18]]) {
        const v = bytes(b[key]);
        if (v.length !== length)
            refuse("merchant_header_bytes");
        result[key] = v;
    }
    result.miner = getAddress(String(b.miner));
    result.extraData = bytes(b.extraData);
    if (String(result.extraData).length > 514 || BigInt(String(result.gasUsed)) > BigInt(String(result.gasLimit)))
        refuse("merchant_header_bounds");
    return result;
}
function transactionBinding(value) {
    const tx = object(value), result = {};
    for (const key of ["hash", "blockHash"])
        result[key] = hexHash(tx[key]);
    for (const key of ["blockNumber", "transactionIndex", "type", "value", "nonce", "chainId", "gas", "maxFeePerGas", "maxPriorityFeePerGas"])
        result[key] = quantity(tx[key]).toString();
    result.from = getAddress(String(tx.from));
    result.to = getAddress(String(tx.to));
    result.input = bytes(tx.input);
    if (!Array.isArray(tx.accessList) || tx.accessList.length !== 0 || result.type !== "2")
        refuse("merchant_receipt_transaction_type");
    return result;
}
/** Independent canonical finalized receipt + full transaction + exact token Transfer. No HTTP settlement inference. */
export async function merchantReceipt(rpc, o) {
    if (o.submissionAttempts !== 1 || o.txHash === null)
        refuse("merchant_observe_without_attempt");
    const first = await rpc.batch([{ method: "eth_chainId", params: [] }, { method: "eth_getTransactionReceipt", params: [o.txHash] }, { method: "eth_getTransactionByHash", params: [o.txHash] }, { method: "eth_getBlockByNumber", params: ["finalized", false] }]);
    if (quantity(first[0]) !== 4326n)
        refuse("merchant_receipt_chain");
    if (first[1] === null || first[2] === null)
        return null;
    const r = object(first[1]), tx = object(first[2]), head = object(first[3]), headIdentity = merchantHeader(head);
    if (quantity(r.blockNumber) > quantity(head.number))
        return null;
    const [block, code, impl, storage, headAnchor] = await rpc.batch([{ method: "eth_getBlockByNumber", params: [r.blockNumber, true] }, { method: "eth_getCode", params: [MERCHANT_TOKEN, r.blockNumber] },
        { method: "eth_getCode", params: [MERCHANT_IMPLEMENTATION, r.blockNumber] }, { method: "eth_getStorageAt", params: [MERCHANT_TOKEN, IMPLEMENTATION_SLOT, r.blockNumber] }, { method: "eth_getBlockByNumber", params: [head.number, false] }]);
    const blockIdentity = merchantHeader(block), fullBlock = object(block), index = quantity(r.transactionIndex), boundTransaction = transactionBinding(tx);
    if (!Array.isArray(fullBlock.transactions) || fullBlock.transactions.length > 65536 || index >= BigInt(fullBlock.transactions.length) ||
        canonicalJson(transactionBinding(fullBlock.transactions[Number(index)])) !== canonicalJson(boundTransaction) ||
        quantity(tx.transactionIndex) !== index || fullBlock.transactions.filter(v => hexHash(object(v).hash) === o.txHash).length !== 1 ||
        canonicalJson(merchantHeader(headAnchor)) !== canonicalJson(headIdentity) || quantity(fullBlock.number) !== quantity(r.blockNumber) ||
        quantity(fullBlock.timestamp) > quantity(head.timestamp))
        refuse("merchant_receipt_membership_anchor");
    if (hexHash(object(block).hash) !== hexHash(r.blockHash) || hexHash(r.transactionHash) !== o.txHash || hexHash(tx.hash) !== o.txHash || hexHash(tx.blockHash) !== hexHash(r.blockHash) || quantity(tx.blockNumber) !== quantity(r.blockNumber) ||
        getAddress(String(tx.from)) !== MERCHANT_OWNER || getAddress(String(tx.to)) !== MERCHANT_TOKEN || bytes(tx.input) !== MERCHANT_DATA || quantity(tx.value) !== 0n || quantity(tx.nonce) !== BigInt(o.envelope.nonce) || quantity(tx.chainId) !== 4326n ||
        quantity(tx.gas) !== BigInt(o.envelope.gas) || quantity(tx.maxFeePerGas) !== BigInt(o.envelope.maxFeePerGas) || quantity(tx.maxPriorityFeePerGas) !== BigInt(o.envelope.maxPriorityFeePerGas) ||
        keccak256(bytes(code)) !== MERCHANT_PROXY_HASH || keccak256(bytes(impl)) !== MERCHANT_IMPLEMENTATION_HASH || bytes(storage) !== `0x${MERCHANT_IMPLEMENTATION.slice(2).toLowerCase().padStart(64, "0")}`)
        refuse("merchant_receipt_binding");
    const gasUsed = quantity(r.gasUsed), effectiveGasPrice = quantity(r.effectiveGasPrice), baseFee = quantity(fullBlock.baseFeePerGas);
    const signedPrice = BigInt(o.envelope.maxFeePerGas), offeredPrice = baseFee + BigInt(o.envelope.maxPriorityFeePerGas);
    if (effectiveGasPrice !== (signedPrice < offeredPrice ? signedPrice : offeredPrice))
        refuse("merchant_receipt_effective_fee");
    if (gasUsed === 0n || quantity(r.type) !== 2n || effectiveGasPrice < baseFee || effectiveGasPrice > baseFee + BigInt(o.envelope.maxPriorityFeePerGas) ||
        r.l1Fee !== undefined && quantity(r.l1Fee) !== 0n || r.blobGasUsed !== undefined && quantity(r.blobGasUsed) !== 0n)
        refuse("merchant_receipt_fee_type");
    if (gasUsed > BigInt(o.envelope.gas) || effectiveGasPrice > BigInt(o.envelope.maxFeePerGas) || gasUsed * effectiveGasPrice > BigInt(o.envelope.maximumNativeFee))
        refuse("merchant_receipt_fee_ceiling");
    const status = quantity(r.status);
    if (status !== 0n && status !== 1n)
        refuse("merchant_receipt_status");
    if (!Array.isArray(r.logs))
        refuse("merchant_receipt_logs");
    if (status === 0n && r.logs.length !== 0)
        refuse("merchant_receipt_reverted_logs");
    if (status === 1n) {
        const transfers = r.logs.filter(v => {
            const log = object(v);
            if (getAddress(String(log.address)) !== MERCHANT_TOKEN)
                return false;
            try {
                const e = decodeEventLog({ abi: erc20Abi, eventName: "Transfer", topics: log.topics, data: bytes(log.data) });
                return getAddress(e.args.from) === MERCHANT_OWNER && getAddress(e.args.to) === MERCHANT_PAYEE && e.args.value === BigInt(MERCHANT_AMOUNT) && log.removed === false && Array.isArray(log.topics) && log.topics.length === 3 && bytes(log.data).length === 66 &&
                    hexHash(log.transactionHash) === o.txHash && hexHash(log.blockHash) === hexHash(r.blockHash) &&
                    quantity(log.blockNumber) === quantity(r.blockNumber) && quantity(log.transactionIndex) === index && quantity(log.logIndex) >= 0n;
            }
            catch {
                return false;
            }
        });
        if (transfers.length !== 1)
            refuse("merchant_exact_transfer_missing");
    }
    const [recheck, finalHead, finalAnchor] = await rpc.batch([
        { method: "eth_getBlockByNumber", params: [r.blockNumber, true] },
        { method: "eth_getBlockByNumber", params: ["finalized", false] },
        { method: "eth_getBlockByNumber", params: [head.number, false] },
    ]);
    if (canonicalJson(merchantHeader(recheck)) !== canonicalJson(blockIdentity) || canonicalJson(object(recheck).transactions) !== canonicalJson(fullBlock.transactions) ||
        canonicalJson(merchantHeader(finalAnchor)) !== canonicalJson(headIdentity))
        refuse("merchant_receipt_reorg");
    const currentHead = object(finalHead), currentIdentity = merchantHeader(currentHead);
    if (quantity(currentHead.number) < quantity(head.number) || quantity(currentHead.timestamp) < quantity(head.timestamp))
        refuse("merchant_receipt_finalized_regressed");
    if (quantity(currentHead.number) === quantity(head.number)) {
        if (canonicalJson(currentIdentity) !== canonicalJson(headIdentity))
            refuse("merchant_receipt_finalized_changed");
    }
    else {
        if (quantity(currentHead.number) === quantity(head.number) + 1n && hexHash(currentHead.parentHash) !== hexHash(head.hash))
            refuse("merchant_receipt_finalized_parent");
        const currentAnchor = await rpc.call("eth_getBlockByNumber", [currentHead.number, false]);
        if (canonicalJson(merchantHeader(currentAnchor)) !== canonicalJson(currentIdentity))
            refuse("merchant_receipt_finalized_changed");
    }
    return { transactionHash: o.txHash, blockNumber: quantity(r.blockNumber).toString(), blockHash: hexHash(r.blockHash), finality: "finalized", status: status === 1n ? "success" : "reverted", networkFeeWei: (gasUsed * effectiveGasPrice).toString(),
        canonical: { transactionIndex: index.toString(), blockHeaderHash: hashObject(blockIdentity), finalizedNumber: quantity(currentHead.number).toString(), finalizedHash: hexHash(currentHead.hash), finalizedHeaderHash: hashObject(currentIdentity) },
        evidenceHash: hashObject({ receipt: r, transaction: tx, block, finalizedHead: head, currentFinalizedHead: currentHead, code, impl, storage }) };
}
//# sourceMappingURL=rpc.js.map