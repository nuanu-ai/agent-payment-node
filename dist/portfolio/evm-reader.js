import { decodeFunctionResult, encodeFunctionData, getAddress, keccak256 } from "viem";
import { MULTICALL3_ADDRESS, PORTFOLIO_NETWORK_RPC } from "./registry.js";
import { CountingPortfolioHttp, jsonRpcBatchBody, jsonRpcBatchResults, PortfolioReadFailure, unavailableAttempt } from "./rpc-batch.js";
export const MULTICALL3_ABI = [
    { type: "function", name: "aggregate3", stateMutability: "payable",
        inputs: [{ name: "calls", type: "tuple[]", components: [{ name: "target", type: "address" },
                    { name: "allowFailure", type: "bool" }, { name: "callData", type: "bytes" }] }],
        outputs: [{ name: "returnData", type: "tuple[]", components: [{ name: "success", type: "bool" }, { name: "returnData", type: "bytes" }] }] },
    { type: "function", name: "getChainId", stateMutability: "view", inputs: [], outputs: [{ name: "chainid", type: "uint256" }] },
    { type: "function", name: "getBlockNumber", stateMutability: "view", inputs: [], outputs: [{ name: "blockNumber", type: "uint256" }] },
    { type: "function", name: "getEthBalance", stateMutability: "view", inputs: [{ name: "addr", type: "address" }],
        outputs: [{ name: "balance", type: "uint256" }] },
];
const ERC20_BALANCE_OF = [{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }],
        outputs: [{ name: "balance", type: "uint256" }] }];
const HEX_DATA = /^0x(?:[0-9a-fA-F]{2})*$/u;
const WORD = /^0x[0-9a-fA-F]{64}$/u;
const QUANTITY = /^0x(?:0|[1-9a-fA-F][0-9a-fA-F]{0,63})$/u;
/**
 * One HTTP request per EVM network, except Arbitrum which pins and rechecks an RPC L2 header.
 * With a pinned Multicall3 it carries `eth_getCode` (runtime-code hash check)
 * and one `aggregate3` `eth_call` that also returns chainId and block number; otherwise one plain JSON-RPC batch array.
 */
export class EvmPortfolioPort {
    http;
    registry;
    family = "evm";
    constructor(http, registry = PORTFOLIO_NETWORK_RPC) {
        this.http = http;
        this.registry = registry;
    }
    async read(request) {
        const network = this.registry.find((row) => row.chain === request.chain && row.family === "evm");
        const mode = network?.multicall3CodeHash === null ? "evm_json_rpc_batch" : "evm_multicall3_aggregate3";
        const counter = new CountingPortfolioHttp(this.http);
        try {
            if (network === undefined || network.evmChainId === null)
                throw new PortfolioReadFailure("protocol");
            const account = getAddress(request.account);
            const read = network.multicall3CodeHash === null
                ? await plainBatch(counter, request, account, network.evmChainId)
                : await multicallBatch(counter, request, account, network.evmChainId, network.multicall3CodeHash);
            return { status: "available", mode, calls: counter.calls, methods: counter.methods, block: read.block, slot: null, balances: read.balances };
        }
        catch (error) {
            return unavailableAttempt(error, mode, counter);
        }
    }
}
async function multicallBatch(counter, request, account, chainId, codeHash) {
    const calls = [
        { target: MULTICALL3_ADDRESS, allowFailure: false, callData: encodeFunctionData({ abi: MULTICALL3_ABI, functionName: "getChainId" }) },
        { target: MULTICALL3_ADDRESS, allowFailure: false, callData: encodeFunctionData({ abi: MULTICALL3_ABI, functionName: "getBlockNumber" }) },
        ...request.assets.map((asset) => asset.kind === "native"
            ? { target: MULTICALL3_ADDRESS, allowFailure: true, callData: encodeFunctionData({ abi: MULTICALL3_ABI, functionName: "getEthBalance", args: [account] }) }
            : { target: getAddress(asset.identifier), allowFailure: true, callData: encodeFunctionData({ abi: ERC20_BALANCE_OF, functionName: "balanceOf", args: [account] }) }),
    ];
    const data = encodeFunctionData({ abi: MULTICALL3_ABI, functionName: "aggregate3", args: [calls] });
    // Arbitrum's Solidity block.number is an L1 counter, not an RPC L2 block tag.
    const anchor = chainId === 42161 ? await arbitrumAnchor(counter, request, chainId, codeHash) : null;
    const tag = anchor?.number ?? "latest";
    const raw = await counter.postJson(new URL(request.endpoint), jsonRpcBatchBody([
        ...(anchor === null ? [] : [
            { method: "eth_chainId", params: [] },
            { method: "eth_getBlockByNumber", params: [tag, false] },
        ]),
        { method: "eth_getCode", params: [MULTICALL3_ADDRESS, tag] },
        { method: "eth_call", params: [{ to: MULTICALL3_ADDRESS, data }, tag] },
    ]), anchor === null ? 2 : 4);
    const items = jsonRpcBatchResults(raw, anchor === null ? 2 : 4, false);
    if (anchor !== null) {
        checkChain(items[0], chainId);
        const rechecked = rpcHeader(items[1]);
        if (rechecked.number !== anchor.number || rechecked.hash !== anchor.hash)
            throw new PortfolioReadFailure("protocol");
    }
    const [code, call] = items.slice(anchor === null ? 0 : 2);
    if (!code.ok || !call.ok)
        throw new PortfolioReadFailure("rpc_error");
    if (typeof code.value !== "string" || !HEX_DATA.test(code.value) || keccak256(code.value) !== codeHash) {
        throw new PortfolioReadFailure("multicall_code_mismatch");
    }
    if (typeof call.value !== "string" || !HEX_DATA.test(call.value))
        throw new PortfolioReadFailure("protocol");
    let results;
    try {
        results = decodeFunctionResult({ abi: MULTICALL3_ABI, functionName: "aggregate3", data: call.value });
    }
    catch {
        throw new PortfolioReadFailure("protocol");
    }
    if (results.length !== calls.length)
        throw new PortfolioReadFailure("protocol");
    const observedChain = word(results[0]), block = word(results[1]);
    if (observedChain === null || block === null)
        throw new PortfolioReadFailure("protocol");
    if (observedChain !== BigInt(chainId))
        throw new PortfolioReadFailure("chain_mismatch");
    if (anchor !== null) {
        // A batch may execute its header and eth_call in either order. Recheck after the call completes.
        const after = await counter.postJson(new URL(request.endpoint), jsonRpcBatchBody([
            { method: "eth_getBlockByNumber", params: [tag, false] },
        ]), 1);
        const rechecked = rpcHeader(jsonRpcBatchResults(after, 1, false)[0]);
        if (rechecked.number !== anchor.number || rechecked.hash !== anchor.hash)
            throw new PortfolioReadFailure("protocol");
    }
    return { block: anchor === null ? block.toString() : BigInt(anchor.number).toString(), balances: request.assets.map((asset, index) => {
            const result = results[index + 2];
            if (!result.success)
                return { ...asset, unavailable: "partial_batch" };
            const amount = word(result);
            return amount === null ? { ...asset, unavailable: "protocol" } : { ...asset, amountAtomic: amount.toString() };
        }) };
}
/** Select an RPC L2 header before reading balances; the follow-up rechecks its identity. */
async function arbitrumAnchor(counter, request, chainId, codeHash) {
    const raw = await counter.postJson(new URL(request.endpoint), jsonRpcBatchBody([
        { method: "eth_chainId", params: [] },
        { method: "eth_getBlockByNumber", params: ["latest", false] },
        { method: "eth_getCode", params: [MULTICALL3_ADDRESS, "latest"] },
    ]), 3);
    const items = jsonRpcBatchResults(raw, 3, false);
    checkChain(items[0], chainId);
    const anchor = rpcHeader(items[1]);
    const code = items[2];
    if (!code.ok)
        throw new PortfolioReadFailure("rpc_error");
    if (typeof code.value !== "string" || !HEX_DATA.test(code.value) || keccak256(code.value) !== codeHash) {
        throw new PortfolioReadFailure("multicall_code_mismatch");
    }
    return anchor;
}
function checkChain(item, chainId) {
    if (!item.ok)
        throw new PortfolioReadFailure("rpc_error");
    const chain = quantity(item);
    if (chain === null)
        throw new PortfolioReadFailure("protocol");
    if (chain !== BigInt(chainId))
        throw new PortfolioReadFailure("chain_mismatch");
}
function rpcHeader(item) {
    if (!item.ok)
        throw new PortfolioReadFailure("rpc_error");
    const header = item.value;
    if (header === null || typeof header !== "object" || Array.isArray(header) ||
        !("number" in header) || typeof header.number !== "string" || !QUANTITY.test(header.number) ||
        !("hash" in header) || typeof header.hash !== "string" || !WORD.test(header.hash)) {
        throw new PortfolioReadFailure("protocol");
    }
    return { number: header.number, hash: header.hash.toLowerCase() };
}
async function plainBatch(counter, request, account, chainId) {
    const raw = await counter.postJson(new URL(request.endpoint), jsonRpcBatchBody([
        { method: "eth_chainId", params: [] },
        { method: "eth_blockNumber", params: [] },
        ...request.assets.map((asset) => asset.kind === "native"
            ? { method: "eth_getBalance", params: [account, "latest"] }
            : { method: "eth_call", params: [{ to: getAddress(asset.identifier),
                        data: encodeFunctionData({ abi: ERC20_BALANCE_OF, functionName: "balanceOf", args: [account] }) }, "latest"] }),
    ]), 2 + request.assets.length);
    const items = jsonRpcBatchResults(raw, 2 + request.assets.length, false);
    const observedChain = quantity(items[0]), block = quantity(items[1]);
    if (!items[0].ok || !items[1].ok)
        throw new PortfolioReadFailure("rpc_error");
    if (observedChain === null || block === null)
        throw new PortfolioReadFailure("protocol");
    if (observedChain !== BigInt(chainId))
        throw new PortfolioReadFailure("chain_mismatch");
    return { block: block.toString(), balances: request.assets.map((asset, index) => {
            const item = items[index + 2];
            if (!item.ok)
                return { ...asset, unavailable: "partial_batch" };
            const amount = asset.kind === "native" ? quantity(item)
                : typeof item.value === "string" && WORD.test(item.value) ? BigInt(item.value) : null;
            return amount === null ? { ...asset, unavailable: "protocol" } : { ...asset, amountAtomic: amount.toString() };
        }) };
}
/** Exactly one ABI word; empty return data (for example a contract without code) is never read as zero. */
function word(result) {
    return result.success && WORD.test(result.returnData) ? BigInt(result.returnData) : null;
}
function quantity(item) {
    return item.ok && typeof item.value === "string" && QUANTITY.test(item.value) ? BigInt(item.value) : null;
}
//# sourceMappingURL=evm-reader.js.map