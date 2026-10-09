import { decodeEventLog, decodeFunctionResult, encodeFunctionData, erc20Abi, getAddress, hashDomain, keccak256, type Hex } from "viem";
import { canonicalJson, hashObject, isPlainRecord } from "../canonical.js";
import { EvmDirectRpcGuard } from "../evm-direct-rpc-guard.js";
import { BridgeHttps } from "../lifi/https.js";
import { parseRpcBatchResultEnvelope } from "../rpc.js";
import type { StateStore } from "../state.js";
import { MERCHANT_AMOUNT, MERCHANT_IMPLEMENTATION, MERCHANT_IMPLEMENTATION_HASH, MERCHANT_OWNER, MERCHANT_PAYEE, MERCHANT_PROXY_HASH, MERCHANT_RPC, MERCHANT_TOKEN } from "./pins.js";
import { refuse } from "./protocol.js";
import type { MerchantEnvelope, MerchantOperation, MerchantReceipt } from "./model.js";
export interface MerchantRpcPort {
    call(method: string, params: readonly unknown[], beforeSend?: () => Promise<void> | void, beforeWire?: () => void): Promise<unknown>;
    batch(calls: readonly {
        method: string;
        params: readonly unknown[];
    }[]): Promise<readonly unknown[]>;
}
const METHODS = new Set(["eth_chainId", "eth_getBlockByNumber", "eth_getBalance", "eth_getCode", "eth_getStorageAt", "eth_getTransactionCount", "eth_call", "eth_estimateGas", "eth_maxPriorityFeePerGas", "eth_getTransactionReceipt", "eth_getTransactionByHash", "eth_sendRawTransaction"]);
export class MerchantRpc implements MerchantRpcPort {
    private sequence = 0;
    private readonly guard: EvmDirectRpcGuard;
    constructor(state: StateStore, private readonly transport = new BridgeHttps()) { this.guard = new EvmDirectRpcGuard(state); }
    async batch(calls: readonly {
        method: string;
        params: readonly unknown[];
    }[]) {
        if (calls.length < 1 || calls.length > 16 || calls.some(c => !METHODS.has(c.method) || c.method === "eth_sendRawTransaction"))
            refuse("merchant_rpc_batch");
        const ids = calls.map(() => ++this.sequence);
        const response = await this.guard.post(MERCHANT_RPC, () => this.transport.request(MERCHANT_RPC, "POST", canonicalJson(calls.map((c, i) => ({ jsonrpc: "2.0", id: ids[i], ...c }))), 2 * 1024 * 1024, "APN_RPC_CONFIG"));
        if (response.status !== 200)
            refuse("merchant_rpc_http");
        return parseRpcBatchResultEnvelope(response.body, ids);
    }
    async call(method: string, params: readonly unknown[], beforeSend?: () => Promise<void> | void, beforeWire?: () => void) {
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
const DOMAIN_ABI = [{ type: "function", name: "DOMAIN_SEPARATOR", stateMutability: "view", inputs: [], outputs: [{ type: "bytes32" }] }] as const;
export function quantity(v: unknown): bigint { if (typeof v !== "string" || !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/u.test(v))
    refuse("merchant_rpc_quantity"); return BigInt(v); }
export function object(v: unknown): Record<string, unknown> { if (!isPlainRecord(v))
    refuse("merchant_rpc_object"); return v; }
export function bytes(v: unknown): Hex { if (typeof v !== "string" || !/^0x(?:[a-fA-F0-9]{2})*$/u.test(v))
    refuse("merchant_rpc_bytes"); return v.toLowerCase() as Hex; }
export function hexHash(v: unknown): Hex { const h = bytes(v); if (h.length !== 66)
    refuse("merchant_rpc_hash"); return h; }
export function rpcTransaction() { return { from: MERCHANT_OWNER, to: MERCHANT_TOKEN, data: MERCHANT_DATA, value: "0x0" }; }
/** Fresh runtime, proxy implementation, real domain, balances and pending nonce at one rechecked anchor. */
export async function merchantCurrent(rpc: MerchantRpcPort): Promise<{
    nonce: string;
    gas: string;
    maxFeePerGas: string;
    maxPriorityFeePerGas: string;
    native: string;
    token: string;
}> {
    const head = object(await rpc.call("eth_getBlockByNumber", ["latest", false])), tag = head.number, blockHash = hexHash(head.hash);
    const call = (functionName: "name" | "symbol" | "decimals" | "balanceOf", args?: readonly [
        typeof MERCHANT_OWNER
    ]) => ({ method: "eth_call", params: [{ to: MERCHANT_TOKEN, data: encodeFunctionData({ abi: erc20Abi, functionName, args } as never) }, tag] });
    const v = await rpc.batch([{ method: "eth_chainId", params: [] }, { method: "eth_getCode", params: [MERCHANT_TOKEN, tag] },
        { method: "eth_getStorageAt", params: [MERCHANT_TOKEN, IMPLEMENTATION_SLOT, tag] }, { method: "eth_getCode", params: [MERCHANT_IMPLEMENTATION, tag] },
        call("name"), call("symbol"), call("decimals"), { method: "eth_call", params: [{ to: MERCHANT_TOKEN, data: encodeFunctionData({ abi: DOMAIN_ABI, functionName: "DOMAIN_SEPARATOR" }) }, tag] },
        call("balanceOf", [MERCHANT_OWNER]), { method: "eth_getBalance", params: [MERCHANT_OWNER, "pending"] }, { method: "eth_getTransactionCount", params: [MERCHANT_OWNER, "pending"] },
        { method: "eth_getCode", params: [MERCHANT_OWNER, tag] }, { method: "eth_estimateGas", params: [rpcTransaction()] }, { method: "eth_maxPriorityFeePerGas", params: [] },
        { method: "eth_getBlockByNumber", params: [tag, false] }]);
    if (quantity(v[0]) !== 4326n || keccak256(bytes(v[1])) !== MERCHANT_PROXY_HASH || bytes(v[2]) !== `0x${MERCHANT_IMPLEMENTATION.slice(2).toLowerCase().padStart(64, "0")}` || keccak256(bytes(v[3])) !== MERCHANT_IMPLEMENTATION_HASH ||
        bytes(v[11]) !== "0x" || hexHash(object(v[14]).hash) !== blockHash)
        refuse("merchant_runtime_identity");
    const decode = (name: "name" | "symbol" | "decimals" | "balanceOf", raw: unknown) => decodeFunctionResult({ abi: erc20Abi, functionName: name, data: bytes(raw) });
    if (decode("name", v[4]) !== "MegaUSD" || decode("symbol", v[5]) !== "USDm" || decode("decimals", v[6]) !== 18 ||
        bytes(v[7]) !== hashDomain({ types: { EIP712Domain: [{name:"name",type:"string"},{name:"version",type:"string"},{name:"chainId",type:"uint256"},{name:"verifyingContract",type:"address"}] }, domain: { name: "MegaUSD", version: "1", chainId: 4326n, verifyingContract: MERCHANT_TOKEN } }))
        refuse("merchant_token_domain");
    const gas = quantity(v[12]) * 12n / 10n + 1n, priority = quantity(v[13]), fee = quantity(head.baseFeePerGas) * 2n + priority;
    return { nonce: quantity(v[10]).toString(), gas: gas.toString(), maxFeePerGas: fee.toString(), maxPriorityFeePerGas: priority.toString(), native: quantity(v[9]).toString(), token: String(decode("balanceOf", v[8])) };
}
export function checkMerchantEnvelope(current: Awaited<ReturnType<typeof merchantCurrent>>, envelope: MerchantEnvelope): void {
    if (current.nonce !== envelope.nonce || BigInt(current.gas) > BigInt(envelope.gas) || BigInt(current.maxFeePerGas) > BigInt(envelope.maxFeePerGas) || BigInt(current.maxPriorityFeePerGas) > BigInt(envelope.maxPriorityFeePerGas) ||
        BigInt(current.native) < BigInt(envelope.maximumNativeFee) || BigInt(current.token) < BigInt(MERCHANT_AMOUNT))
        refuse("merchant_nonce_fee_balance_changed");
}
/** Independent canonical finalized receipt + full transaction + exact token Transfer. No HTTP settlement inference. */
export async function merchantReceipt(rpc: MerchantRpcPort, o: MerchantOperation): Promise<MerchantReceipt | null> {
    if (o.submissionAttempts !== 1 || o.txHash === null)
        refuse("merchant_observe_without_attempt");
    const first = await rpc.batch([{ method: "eth_chainId", params: [] }, { method: "eth_getTransactionReceipt", params: [o.txHash] }, { method: "eth_getTransactionByHash", params: [o.txHash] }, { method: "eth_getBlockByNumber", params: ["finalized", false] }]);
    if (quantity(first[0]) !== 4326n)
        refuse("merchant_receipt_chain");
    if (first[1] === null || first[2] === null)
        return null;
    const r = object(first[1]), tx = object(first[2]), head = object(first[3]);
    if (quantity(r.blockNumber) > quantity(head.number))
        return null;
    const [block, code, impl, storage] = await rpc.batch([{ method: "eth_getBlockByNumber", params: [r.blockNumber, false] }, { method: "eth_getCode", params: [MERCHANT_TOKEN, r.blockNumber] },
        { method: "eth_getCode", params: [MERCHANT_IMPLEMENTATION, r.blockNumber] }, { method: "eth_getStorageAt", params: [MERCHANT_TOKEN, IMPLEMENTATION_SLOT, r.blockNumber] }]);
    if (hexHash(object(block).hash) !== hexHash(r.blockHash) || hexHash(r.transactionHash) !== o.txHash || hexHash(tx.hash) !== o.txHash || hexHash(tx.blockHash) !== hexHash(r.blockHash) || quantity(tx.blockNumber) !== quantity(r.blockNumber) ||
        getAddress(String(tx.from)) !== MERCHANT_OWNER || getAddress(String(tx.to)) !== MERCHANT_TOKEN || bytes(tx.input) !== MERCHANT_DATA || quantity(tx.value) !== 0n || quantity(tx.nonce) !== BigInt(o.envelope.nonce) || quantity(tx.chainId) !== 4326n ||
        quantity(tx.gas) !== BigInt(o.envelope.gas) || quantity(tx.maxFeePerGas) !== BigInt(o.envelope.maxFeePerGas) || quantity(tx.maxPriorityFeePerGas) !== BigInt(o.envelope.maxPriorityFeePerGas) ||
        keccak256(bytes(code)) !== MERCHANT_PROXY_HASH || keccak256(bytes(impl)) !== MERCHANT_IMPLEMENTATION_HASH || bytes(storage) !== `0x${MERCHANT_IMPLEMENTATION.slice(2).toLowerCase().padStart(64, "0")}`)
        refuse("merchant_receipt_binding");
    const gasUsed = quantity(r.gasUsed), effectiveGasPrice = quantity(r.effectiveGasPrice);
    if (gasUsed > BigInt(o.envelope.gas) || effectiveGasPrice > BigInt(o.envelope.maxFeePerGas) || gasUsed * effectiveGasPrice > BigInt(o.envelope.maximumNativeFee)) refuse("merchant_receipt_fee_ceiling");
    const status = quantity(r.status);
    if (status !== 0n && status !== 1n)
        refuse("merchant_receipt_status");
    if (!Array.isArray(r.logs))
        refuse("merchant_receipt_logs");
    if (status === 1n) {
        const transfers = r.logs.filter(v => {
            const log = object(v);
            if (getAddress(String(log.address)) !== MERCHANT_TOKEN)
                return false;
            try {
                const e = decodeEventLog({ abi: erc20Abi, eventName: "Transfer", topics: log.topics as [
                        Hex,
                        ...Hex[]
                    ], data: bytes(log.data) });
                return getAddress(e.args.from) === MERCHANT_OWNER && getAddress(e.args.to) === MERCHANT_PAYEE && e.args.value === BigInt(MERCHANT_AMOUNT) && log.removed !== true &&
                    hexHash(log.transactionHash) === o.txHash && hexHash(log.blockHash) === hexHash(r.blockHash);
            }
            catch {
                return false;
            }
        });
        if (transfers.length !== 1)
            refuse("merchant_exact_transfer_missing");
    }
    const recheck = object(await rpc.call("eth_getBlockByNumber", [r.blockNumber, false]));
    if (hexHash(recheck.hash) !== hexHash(r.blockHash))
        refuse("merchant_receipt_reorg");
    return { transactionHash: o.txHash, blockNumber: quantity(r.blockNumber).toString(), blockHash: hexHash(r.blockHash), finality: "finalized", status: status === 1n ? "success" : "reverted", networkFeeWei: (gasUsed * effectiveGasPrice).toString(), evidenceHash: hashObject({ receipt: r, transaction: tx, block, finalizedHead: head, code, impl, storage }) };
}
