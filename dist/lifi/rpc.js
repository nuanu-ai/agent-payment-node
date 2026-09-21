import { encodeFunctionData, keccak256 } from "viem";
import { canonicalJson, hashObject } from "../canonical.js";
import { ApnError } from "../errors.js";
import { EvmRpc } from "../evm-rpc.js";
import { evmRpcAddress, evmRpcBlock, evmRpcHex, evmRpcQuantity, evmRpcRecord, evmRpcWord } from "../evm-rpc-codec.js";
import { parsePublicHttpsUrl } from "../network-policy.js";
import { bridgeDeployment } from "./deployments.js";
import { BridgeHttps } from "./https.js";
import { bridgeArchiveEndpoint, isHistoricalStateRead } from "./rpc-archive.js";
import { BASE_FEE_CONTRACT, bridgeActualFees } from "./rpc-fees.js";
import { verifyRpcTransaction } from "./rpc-transaction.js";
import { bridgeAssetRow, bridgeChain } from "./asset-registry.js";
import { BRIDGE_ZERO_ADDRESS, BRIDGE_ZERO_WORD, bridgeFailure, bridgeHex, bridgeJson, bridgeSame, bridgeUint } from "./validation.js";
import { BNB_COMPOSITE, bnbPoolReadData, verifyBnbCompositeTrace, verifyBnbPoolConfiguration } from "./bnb-composite.js";
import { approvedTransportReason, MAX_READ_ATTEMPTS, parseRetryAfter, RpcHttpFailure, RpcReadSession, RPC_RETRY_DELAY_MS } from "./rpc-session.js";
export { RpcReadSession } from "./rpc-session.js";
const ERC20_READ = [{ type: "function", name: "allowance", stateMutability: "view", inputs: [{ type: "address" }, { type: "address" }], outputs: [{ type: "uint256" }] },
    { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] }];
const GAS_ORACLE = "0x420000000000000000000000000000000000000F";
const GAS_ORACLE_ABI = [{ type: "function", name: "getL1FeeUpperBound", stateMutability: "view", inputs: [{ name: "size", type: "uint256" }], outputs: [{ type: "uint256" }] },
    { type: "function", name: "getOperatorFee", stateMutability: "view", inputs: [{ name: "gas", type: "uint256" }], outputs: [{ type: "uint256" }] }];
const READ_METHODS = new Set(["eth_chainId", "eth_getBlockByNumber", "eth_getBalance", "eth_getCode", "eth_getStorageAt", "eth_getTransactionCount", "eth_call", "eth_estimateGas", "eth_maxPriorityFeePerGas", "eth_getTransactionByHash", "eth_getTransactionReceipt", "eth_getLogs", "debug_traceTransaction", "eth_sendRawTransaction"]);
const LINEA_TRACE_PROBE_TRANSACTION = "0x4352433956109d31ab50db9547f16bcb90f3545f793ed40f75716ccd9a360efd";
const MONAD_TRACE_PROBE_TRANSACTION = "0x9ff1560ef67d7253df2663b897452abe6644f6d6cb746743253822c264d13440";
export const BRIDGE_RPC_ENV = { 1: "APN_ETHEREUM_RPC_URL", 56: "APN_BNB_RPC_URL", 8453: "APN_BASE_RPC_URL", 143: "APN_MONAD_RPC_URL", 42161: "APN_ARBITRUM_RPC_URL", 59144: "APN_LINEA_RPC_URL" };
export function bridgeRpcCall(chainId, environment, options = {}) {
    bridgeChain(chainId, "APN_RPC_CONFIG");
    const transport = options.transport ?? new BridgeHttps();
    const wait = options.wait ?? (async (milliseconds) => await new Promise((resolve) => setTimeout(resolve, milliseconds)));
    const value = environment[BRIDGE_RPC_ENV[chainId]];
    if (value === undefined || value.length === 0)
        bridgeFailure("APN_RPC_CONFIG", `missing_${BRIDGE_RPC_ENV[chainId]}`);
    const endpoint = parsePublicHttpsUrl(value, "APN_RPC_CONFIG", "Bridge RPC endpoint", 2048);
    if (endpoint.search !== "")
        bridgeFailure("APN_RPC_CONFIG", "bridge_RPC_query_forbidden");
    const archive = bridgeArchiveEndpoint(chainId, environment);
    let sequence = 0n, archiveChain;
    const call = async (method, params) => {
        if (!READ_METHODS.has(method))
            bridgeFailure("APN_RPC_PROTOCOL", "bridge_RPC_method");
        if (method === "eth_sendRawTransaction")
            return await submitDirect(method, params, (m, p) => oneAttempt(endpoint, m, p));
        if (archive === null || !isHistoricalStateRead(method, params))
            return await retryDirect(method, params, () => oneAttempt(endpoint, method, params), wait);
        if (archiveChain === undefined)
            archiveChain = (async () => {
                if (evmRpcQuantity(await retryDirect("eth_chainId", [], () => oneAttempt(archive, "eth_chainId", []), wait)) !== BigInt(chainId)) {
                    bridgeFailure("APN_RPC_CONFIG", "bridge_archive_RPC_chain");
                }
            })();
        await archiveChain;
        return await retryDirect(method, params, () => oneAttempt(archive, method, params), wait);
    };
    const oneAttempt = async (target, method, params, now = Date.now()) => {
        if (!READ_METHODS.has(method))
            bridgeFailure("APN_RPC_PROTOCOL", "bridge_RPC_method");
        const id = (++sequence).toString(), body = canonicalJson({ jsonrpc: "2.0", id, method, params });
        let response;
        try {
            response = await transport.request(target.toString(), "POST", body, 1024 * 1024, "APN_RPC_CONFIG");
        }
        catch (error) {
            if (error instanceof ApnError && error.code === "APN_RPC_AMBIGUOUS")
                throw error;
            throw error;
        }
        if (response.status !== 200)
            throw new RpcHttpFailure(method, response.status, parseRetryAfter(response.headers, now));
        const r = evmRpcRecord(bridgeJson(response.body, 1024 * 1024));
        if (r.jsonrpc !== "2.0" || r.id !== id || !Object.hasOwn(r, "result") || Object.hasOwn(r, "error"))
            bridgeFailure("APN_RPC_PROTOCOL", "bridge_RPC_response");
        return r.result;
    };
    const batchAttempt = async (target, items, now = Date.now()) => {
        if (items.length < 1 || items.length > 32 || items.some((item) => !READ_METHODS.has(item.method) || item.method === "eth_sendRawTransaction")) {
            bridgeFailure("APN_RPC_PROTOCOL", "bridge_RPC_batch_items");
        }
        const requests = items.map((item) => ({ jsonrpc: "2.0", id: (++sequence).toString(), method: item.method, params: item.params }));
        let response;
        try {
            response = await transport.request(target.toString(), "POST", canonicalJson(requests), 1024 * 1024, "APN_RPC_CONFIG");
        }
        catch (error) {
            throw error;
        }
        if (response.status !== 200)
            throw new RpcHttpFailure("batch", response.status, parseRetryAfter(response.headers, now));
        const parsed = bridgeJson(response.body, 1024 * 1024);
        if (!Array.isArray(parsed))
            throw new ApnError("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "Bridge RPC endpoint does not support JSON-RPC batching.");
        if (parsed.length !== requests.length)
            bridgeFailure("APN_RPC_PROTOCOL", "bridge_RPC_batch_response_count");
        const expected = new Map(requests.map((request, index) => [request.id, index]));
        const results = new Array(requests.length), seen = new Set();
        for (const value of parsed) {
            const item = evmRpcRecord(value), id = item.id;
            if (item.jsonrpc !== "2.0" || typeof id !== "string" || !expected.has(id) || seen.has(id))
                bridgeFailure("APN_RPC_PROTOCOL", "bridge_RPC_batch_response_id");
            seen.add(id);
            if (Object.hasOwn(item, "error")) {
                const error = evmRpcRecord(item.error), code = typeof error.code === "number" ? error.code : null;
                if (code === -32600 || code === -32601)
                    throw new ApnError("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "Bridge RPC endpoint does not support JSON-RPC batching.");
                bridgeFailure("APN_RPC_PROTOCOL", "bridge_RPC_batch_suberror");
            }
            if (!Object.hasOwn(item, "result") || Object.keys(item).some((key) => !["jsonrpc", "id", "result"].includes(key))) {
                bridgeFailure("APN_RPC_PROTOCOL", "bridge_RPC_batch_response_item");
            }
            results[expected.get(id)] = item.result;
        }
        if (seen.size !== requests.length)
            bridgeFailure("APN_RPC_PROTOCOL", "bridge_RPC_batch_response_id");
        return results;
    };
    const sessionCall = (session) => async (method, params) => {
        if (!READ_METHODS.has(method))
            bridgeFailure("APN_RPC_PROTOCOL", "bridge_RPC_method");
        const primaryAttempt = (m, p) => oneAttempt(endpoint, m, p, session.currentTime());
        if (method === "eth_sendRawTransaction")
            return await submitDirect(method, params, primaryAttempt);
        if (archive === null || !isHistoricalStateRead(method, params)) {
            return await session.read(endpoint.toString(), chainId, method, params, primaryAttempt);
        }
        const archiveAttempt = (m, p) => oneAttempt(archive, m, p, session.currentTime());
        const archiveChain = await session.read(archive.toString(), chainId, "eth_chainId", [], archiveAttempt);
        if (evmRpcQuantity(archiveChain) !== BigInt(chainId))
            bridgeFailure("APN_RPC_CONFIG", "bridge_archive_RPC_chain");
        return await session.read(archive.toString(), chainId, method, params, archiveAttempt);
    };
    const sessionBatchCall = (session) => async (items) => {
        const attempt = async (requests) => await batchAttempt(endpoint, requests, session.currentTime());
        return await session.readBatch(endpoint.toString(), chainId, items.map((item) => ({ ...item, batchAttempt: attempt })));
    };
    return { origin: endpoint.origin, call, attempt: (method, params) => oneAttempt(endpoint, method, params), sessionCall, sessionBatchCall };
}
export function bridgeRpcFactory(environment, options = {}) {
    const cache = new Map(), transport = options.transport ?? new BridgeHttps();
    return (chainId, session) => {
        bridgeChain(chainId, "APN_RPC_CONFIG");
        const existing = cache.get(chainId);
        if (existing !== undefined) {
            if (session === undefined)
                return existing.base;
            return new BridgeRpc(chainId, existing.origin, existing.call, session, existing.attempt, existing.sessionCall, existing.sessionBatchCall);
        }
        const { origin, call, attempt, sessionCall, sessionBatchCall } = bridgeRpcCall(chainId, environment, { ...options, transport });
        const base = new BridgeRpc(chainId, origin, call);
        cache.set(chainId, { origin, call, attempt, sessionCall, sessionBatchCall, base });
        return session === undefined ? base : new BridgeRpc(chainId, origin, call, session, attempt, sessionCall, sessionBatchCall);
    };
}
export class BridgeRpc {
    chainId;
    origin;
    evm;
    call;
    batchCall;
    commandLatestBlock;
    constructor(chainId, origin, call, session, oneAttempt, sessionCall, sessionBatchCall) {
        this.chainId = chainId;
        this.origin = origin;
        bridgeChain(chainId);
        this.call = session === undefined ? call : sessionCall?.(session) ?? session.wrap(origin, chainId, call, oneAttempt ?? call);
        this.batchCall = session === undefined ? undefined : sessionBatchCall?.(session);
        this.evm = new EvmRpc(this.call, origin, 16 * 1024);
    }
    async assertChain() { await this.evm.assertChain(this.chainId); }
    async block(tag) {
        if (this.batchCall !== undefined) {
            const rpcTag = tag === "latest" || tag === "safe" ? tag : quantity(bridgeUint(tag));
            const [chain, raw] = await this.batchCall([
                { method: "eth_chainId", params: [], cachePolicy: "immutable" },
                { method: "eth_getBlockByNumber", params: [rpcTag, false], cachePolicy: tag === "latest" ? "snapshot" : "immutable" },
            ]);
            if (evmRpcQuantity(chain) !== BigInt(this.chainId))
                throw new ApnError("APN_CHAIN_MISMATCH", "RPC chain does not match the explicitly selected EVM network.");
            const b = evmRpcRecord(raw), number = evmRpcQuantity(b.number).toString(), hash = evmRpcHex(b.hash, 32);
            if (tag !== "latest" && tag !== "safe" && number !== bridgeUint(tag).toString())
                bridgeFailure("APN_RPC_PROTOCOL", "bridge_block_number");
            const block = { numberAtomic: number, hash, timestampAtomic: evmRpcQuantity(b.timestamp).toString() };
            if (tag === "latest")
                this.commandLatestBlock = block;
            return block;
        }
        await this.assertChain();
        const rpcTag = tag === "latest" || tag === "safe" ? tag : quantity(bridgeUint(tag));
        const b = await evmRpcBlock(this.call, rpcTag);
        await this.assertChain();
        return { numberAtomic: b.number, hash: b.hash, timestampAtomic: evmRpcQuantity(b.raw.timestamp).toString() };
    }
    async deployment(tool, peerChainId, token, block) {
        if (this.batchCall === undefined)
            await this.assertChain();
        const at = block ?? await this.block("safe"), contract = bridgeDeployment(this.chainId, peerChainId, tool, token), tag = quantity(BigInt(at.numberAtomic));
        const code = [], configuration = [];
        const feeContract = this.chainId === 8453 ? BASE_FEE_CONTRACT : { code: [], reads: [] };
        const codeRows = [...contract.code, ...feeContract.code], readRows = [...contract.reads, ...feeContract.reads];
        const extraItems = [];
        if (this.chainId === 56 && peerChainId === 1 && tool === "across" && token === BRIDGE_ZERO_ADDRESS) {
            extraItems.push({ method: "eth_call", params: [{ to: BNB_COMPOSITE.vault, data: bnbPoolReadData.registration }, tag], cachePolicy: "immutable" }, { method: "eth_call", params: [{ to: BNB_COMPOSITE.vault, data: bnbPoolReadData.tokens }, tag], cachePolicy: "immutable" });
        }
        let traceProbe;
        if ((this.chainId === 143 || this.chainId === 59144) && peerChainId === 1 && tool === "across" && token === BRIDGE_ZERO_ADDRESS) {
            traceProbe = this.chainId === 143 ? { transaction: MONAD_TRACE_PROBE_TRANSACTION, from: "0x6f49a8f621353f12378d0046e7d7e4b9b249dc9e", to: "0x0000000000000000000000000000000000001000", value: 18000000000000000000n }
                : { transaction: LINEA_TRACE_PROBE_TRANSACTION, from: "0x9629fe86f04e735923e8542ddd9f265f576e7421", to: "0xbcc016e2a79d509d2b776827ed986568d9b56d59", value: 243939205000000000n };
            extraItems.push({ method: "debug_traceTransaction", params: [traceProbe.transaction, { tracer: "callTracer", tracerConfig: { onlyTopCall: true, withLog: false } }], cachePolicy: "immutable" });
        }
        const items = [
            ...codeRows.map((row) => ({ method: "eth_getCode", params: [row.address, tag], cachePolicy: "immutable" })),
            ...readRows.map((row) => ({ method: row.kind === "storage" ? "eth_getStorageAt" : "eth_call",
                params: row.kind === "storage" ? [row.address, row.data, tag] : [{ to: row.address, data: row.data }, tag], cachePolicy: "immutable" })),
            ...extraItems,
            { method: "eth_getBlockByNumber", params: [tag, false], cachePolicy: "immutable" },
        ];
        const values = this.batchCall === undefined ? await Promise.all(items.map((item) => this.call(item.method, item.params))) : await this.batchCall(items);
        let offset = 0;
        for (const row of codeRows) {
            const bytes = bridgeHex(values[offset++], 128 * 1024, undefined, "APN_RPC_PROTOCOL");
            if (bytes === "0x" || keccak256(bytes) !== row.codeHash)
                bridgeFailure("APN_PROVIDER_PROTOCOL", "bridge_deployment_code_changed");
            code.push({ address: row.address, codeHash: keccak256(bytes) });
        }
        for (const row of readRows) {
            const observed = bridgeHex(values[offset++], 64 * 1024, undefined, "APN_RPC_PROTOCOL");
            if (observed !== row.expected)
                bridgeFailure("APN_PROVIDER_PROTOCOL", "bridge_deployment_configuration_changed");
            configuration.push({ ...row, expected: observed });
        }
        if (this.chainId === 56 && peerChainId === 1 && tool === "across" && token === BRIDGE_ZERO_ADDRESS) {
            const registrationRaw = values[offset++], tokensRaw = values[offset++];
            const pool = verifyBnbPoolConfiguration(bridgeHex(registrationRaw, 256, undefined, "APN_RPC_PROTOCOL"), bridgeHex(tokensRaw, 2048, undefined, "APN_RPC_PROTOCOL"));
            configuration.push({ kind: "pool", address: BNB_COMPOSITE.vault, data: bnbPoolReadData.tokens,
                expected: `0x${Buffer.from(canonicalJson(pool)).toString("hex")}` });
        }
        if (traceProbe !== undefined) {
            const trace = evmRpcRecord(values[offset++]);
            if (trace.type !== "CALL" || evmRpcAddress(trace.from).toLowerCase() !== traceProbe.from ||
                evmRpcAddress(trace.to).toLowerCase() !== traceProbe.to || evmRpcQuantity(trace.value) !== traceProbe.value) {
                bridgeFailure("APN_PROVIDER_PROTOCOL", "native_destination_trace_capability_changed");
            }
        }
        const recheck = evmRpcRecord(values[offset]);
        if (evmRpcQuantity(recheck.number).toString() !== at.numberAtomic || evmRpcHex(recheck.hash, 32) !== at.hash)
            bridgeFailure("APN_RPC_PROTOCOL", "bridge_block_reorg");
        if (this.batchCall === undefined)
            await this.assertChain();
        return { chainId: this.chainId, peerChainId, tool, block: at, rpcOrigin: this.origin,
            contractHash: hashObject({ protocol: contract, feeContract }), codeHash: hashObject(code), configurationHash: hashObject(configuration) };
    }
    /** A native principal's balance is the native balance itself and its allowance is the constant zero: nothing is approved. */
    async account(owner, spender, token) {
        if (this.batchCall !== undefined) {
            const asset = bridgeAssetRow(this.chainId, token, "APN_RPC_CONFIG");
            const data = encodeFunctionData({ abi: ERC20_READ, functionName: "balanceOf", args: [owner] });
            const allowanceData = encodeFunctionData({ abi: ERC20_READ, functionName: "allowance", args: [owner, spender] });
            const items = [
                { method: "eth_chainId", params: [], cachePolicy: "immutable" },
                { method: "eth_getBlockByNumber", params: ["latest", false], cachePolicy: "snapshot" },
                { method: "eth_getBalance", params: [owner, "latest"], cachePolicy: "none" },
                ...(asset.kind === "native" ? [] : [
                    { method: "eth_call", params: [{ to: token, data }, "latest"], cachePolicy: "none" },
                    { method: "eth_call", params: [{ to: token, data: allowanceData }, "latest"], cachePolicy: "none" },
                ]),
                { method: "eth_getTransactionCount", params: [owner, "latest"], cachePolicy: "none" },
                { method: "eth_getTransactionCount", params: [owner, "pending"], cachePolicy: "none" },
            ];
            const values = await this.batchCall(items);
            let offset = 0;
            if (evmRpcQuantity(values[offset++]) !== BigInt(this.chainId))
                throw new ApnError("APN_CHAIN_MISMATCH", "RPC chain does not match the explicitly selected EVM network.");
            const raw = evmRpcRecord(values[offset++]), at = { numberAtomic: evmRpcQuantity(raw.number).toString(), hash: evmRpcHex(raw.hash, 32),
                timestampAtomic: evmRpcQuantity(raw.timestamp).toString() };
            this.commandLatestBlock = at;
            const native = evmRpcQuantity(values[offset++]);
            const balance = asset.kind === "native" ? native : evmRpcWord(values[offset++]);
            const allowance = asset.kind === "native" ? 0n : evmRpcWord(values[offset++]);
            const latest = evmRpcQuantity(values[offset++]), pending = evmRpcQuantity(values[offset]);
            return { chainId: this.chainId, rpcOrigin: this.origin, block: at, owner, token, spender, balanceAtomic: balance.toString(),
                nativeBalanceWei: native.toString(), allowanceAtomic: allowance.toString(), latestNonceAtomic: latest.toString(), pendingNonceAtomic: pending.toString() };
        }
        await this.assertChain();
        const at = await this.block("latest"), tag = quantity(BigInt(at.numberAtomic));
        const asset = bridgeAssetRow(this.chainId, token, "APN_RPC_CONFIG");
        const data = encodeFunctionData({ abi: ERC20_READ, functionName: "balanceOf", args: [owner] });
        const allowanceData = encodeFunctionData({ abi: ERC20_READ, functionName: "allowance", args: [owner, spender] });
        const nativeBalance = this.call("eth_getBalance", [owner, tag]).then(evmRpcQuantity);
        const [balance, native, allowance, latest, pending] = await Promise.all([
            asset.kind === "native" ? nativeBalance : this.call("eth_call", [{ to: token, data }, tag]).then(evmRpcWord), nativeBalance,
            asset.kind === "native" ? Promise.resolve(0n) : this.call("eth_call", [{ to: token, data: allowanceData }, tag]).then(evmRpcWord),
            this.call("eth_getTransactionCount", [owner, "latest"]).then(evmRpcQuantity), this.call("eth_getTransactionCount", [owner, "pending"]).then(evmRpcQuantity),
        ]);
        await this.recheck(at);
        await this.assertChain();
        return { chainId: this.chainId, rpcOrigin: this.origin, block: at, owner, token, spender, balanceAtomic: balance.toString(),
            nativeBalanceWei: native.toString(), allowanceAtomic: allowance.toString(), latestNonceAtomic: latest.toString(), pendingNonceAtomic: pending.toString() };
    }
    async prices() {
        if (this.batchCall !== undefined) {
            const items = [
                { method: "eth_chainId", params: [], cachePolicy: "immutable" },
                { method: "eth_getBlockByNumber", params: ["latest", false], cachePolicy: "snapshot" },
                ...(this.chainId === 42161 ? [] : [{ method: "eth_maxPriorityFeePerGas", params: [], cachePolicy: "snapshot" }]),
            ];
            const values = await this.batchCall(items);
            if (evmRpcQuantity(values[0]) !== BigInt(this.chainId))
                throw new ApnError("APN_CHAIN_MISMATCH", "RPC chain does not match the explicitly selected EVM network.");
            const block = evmRpcRecord(values[1]), priority = this.chainId === 42161 ? 0n : evmRpcQuantity(values[2]);
            this.commandLatestBlock = { numberAtomic: evmRpcQuantity(block.number).toString(), hash: evmRpcHex(block.hash, 32), timestampAtomic: evmRpcQuantity(block.timestamp).toString() };
            const maximum = 2n * evmRpcQuantity(block.baseFeePerGas) + priority;
            bridgeUint(maximum.toString(), true, "APN_RPC_PROTOCOL");
            return { maxFeePerGasAtomic: maximum.toString(), maxPriorityFeePerGasAtomic: priority.toString() };
        }
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
        if (this.batchCall !== undefined) {
            const items = [
                { method: "eth_chainId", params: [], cachePolicy: "immutable" },
                { method: "eth_estimateGas", params: [{ from: transaction.from, to: transaction.to, data: transaction.data,
                            value: quantity(bridgeUint(transaction.valueAtomic)) }], cachePolicy: "none" },
                { method: "eth_getBlockByNumber", params: ["latest", false], cachePolicy: "snapshot" },
                ...(this.chainId === 42161 ? [] : [{ method: "eth_maxPriorityFeePerGas", params: [], cachePolicy: "snapshot" }]),
            ];
            const values = await this.batchCall(items);
            if (evmRpcQuantity(values[0]) !== BigInt(this.chainId))
                throw new ApnError("APN_CHAIN_MISMATCH", "RPC chain does not match the explicitly selected EVM network.");
            const gas = evmRpcQuantity(values[1]), block = evmRpcRecord(values[2]), priority = this.chainId === 42161 ? 0n : evmRpcQuantity(values[3]);
            this.commandLatestBlock = { numberAtomic: evmRpcQuantity(block.number).toString(), hash: evmRpcHex(block.hash, 32), timestampAtomic: evmRpcQuantity(block.timestamp).toString() };
            const maximum = 2n * evmRpcQuantity(block.baseFeePerGas) + priority;
            if (maximum === 0n)
                bridgeFailure("APN_RPC_PROTOCOL", "bridge_zero_gas_price");
            return { gasLimitAtomic: gas.toString(), maxFeePerGasAtomic: maximum.toString(), maxPriorityFeePerGasAtomic: priority.toString() };
        }
        return await this.evm.estimate(transaction);
    }
    async feeQuote(envelope) { return (await this.feeQuotes([envelope]))[0]; }
    async feeQuotes(envelopes) {
        if (this.batchCall === undefined)
            return await Promise.all(envelopes.map(async (envelope) => await this.evm.feeQuote(this.chainId, envelope.economics)));
        const block = this.commandLatestBlock ?? await this.block("latest"), tag = quantity(BigInt(block.numberAtomic));
        const items = [
            { method: "eth_chainId", params: [], cachePolicy: "immutable" },
            ...(this.chainId === 8453 ? envelopes.flatMap((envelope) => {
                const l1 = encodeFunctionData({ abi: GAS_ORACLE_ABI, functionName: "getL1FeeUpperBound", args: [16384n] });
                const operator = encodeFunctionData({ abi: GAS_ORACLE_ABI, functionName: "getOperatorFee", args: [bridgeUint(envelope.economics.gasLimitAtomic, true)] });
                return [
                    { method: "eth_call", params: [{ to: GAS_ORACLE, data: l1 }, tag], cachePolicy: "none" },
                    { method: "eth_call", params: [{ to: GAS_ORACLE, data: operator }, tag], cachePolicy: "none" },
                ];
            }) : []),
            { method: "eth_getBlockByNumber", params: [tag, false], cachePolicy: "immutable" },
        ];
        const values = await this.batchCall(items);
        if (evmRpcQuantity(values[0]) !== BigInt(this.chainId))
            throw new ApnError("APN_CHAIN_MISMATCH", "RPC chain does not match the explicitly selected EVM network.");
        let offset = 1;
        const quotes = envelopes.map((envelope) => {
            const execution = bridgeUint(envelope.economics.maximumGasCostAtomic, true);
            const l1 = this.chainId === 8453 ? evmRpcWord(values[offset++]) : 0n;
            const operator = this.chainId === 8453 ? evmRpcWord(values[offset++]) : 0n;
            const total = execution + l1 + operator;
            return { chainId: this.chainId, ...(this.chainId === 42161 ? { feeModel: "arbitrum-inclusive" } : this.chainId === 143 ? { feeModel: "monad-gas-limit" } : {}),
                l1DataFeeUpperWei: l1.toString(), operatorFeeUpperWei: operator.toString(), maximumExecutionFeeWei: execution.toString(),
                totalQuoteWei: total.toString(), totalFeeEnforcedOnchain: false, blockNumberAtomic: block.numberAtomic, blockHash: block.hash,
                rpcOrigin: this.origin, observedAt: new Date().toISOString() };
        });
        const recheck = evmRpcRecord(values[offset]);
        if (evmRpcQuantity(recheck.number).toString() !== block.numberAtomic || evmRpcHex(recheck.hash, 32) !== block.hash)
            bridgeFailure("APN_RPC_PROTOCOL", "bridge_block_reorg");
        return quotes;
    }
    async send(raw) {
        bridgeHex(raw, 16 * 1024, undefined, "APN_PROVIDER_EFFECT_UNAVAILABLE");
        const hash = evmRpcHex(await this.call("eth_sendRawTransaction", [raw]), 32);
        if (hash !== keccak256(raw))
            bridgeFailure("APN_RPC_AMBIGUOUS", "submitted_transaction_hash_mismatch");
        return hash;
    }
    async observe(hash, expected, nativeDelivery) {
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
        let nativeBalance = null;
        let nativeTransfer = null;
        let compositeTrace = null;
        if (nativeDelivery !== undefined) {
            if (number === 0n)
                bridgeFailure("APN_RPC_PROTOCOL", "native_balance_genesis");
            const beforeRaw = await evmRpcBlock(this.call, quantity(number - 1n));
            const before = { numberAtomic: (number - 1n).toString(), hash: beforeRaw.hash, timestampAtomic: evmRpcQuantity(beforeRaw.raw.timestamp).toString() };
            const [beforeBalance, afterBalance, trace] = await Promise.all([
                this.call("eth_getBalance", [nativeDelivery.recipient, { blockHash: before.hash, requireCanonical: true }]).then(evmRpcQuantity),
                this.call("eth_getBalance", [nativeDelivery.recipient, { blockHash: block.hash, requireCanonical: true }]).then(evmRpcQuantity),
                this.call("debug_traceTransaction", [hash, { tracer: "callTracer", tracerConfig: { onlyTopCall: false, withLog: false } }]),
            ]);
            if (afterBalance < beforeBalance)
                bridgeFailure("APN_RPC_PROTOCOL", "native_balance_delta_negative");
            nativeBalance = { recipient: nativeDelivery.recipient, beforeBlock: before, afterBlock: block,
                beforeBalanceAtomic: beforeBalance.toString(), afterBalanceAtomic: afterBalance.toString(), deltaAtomic: (afterBalance - beforeBalance).toString() };
            if (nativeDelivery.composite === undefined)
                nativeTransfer = exactNativeTransfer(trace, hash, nativeDelivery);
            else
                compositeTrace = verifyBnbCompositeTrace(trace, hash, nativeDelivery.composite.message, nativeDelivery.composite.call, { sender: identity.from, calldata: bridgeHex(tx.input, 24_576, undefined, "APN_RPC_PROTOCOL") });
            await this.recheck(before);
        }
        await this.recheck(block);
        if (safeBlock !== null)
            await this.recheck(safeBlock);
        await this.assertChain();
        return { transaction: { chainId: this.chainId, transactionHash: hash, block, safeBlock, rpcOrigin: this.origin, ...identity,
                ...fees, status: status === 1n ? "success" : "reverted", logsHash: hashObject(logs) },
            receipt: { chainId: this.chainId, transactionHash: hash, blockNumberAtomic: number.toString(), blockHash, logs, nativeBalance, nativeTransfer, compositeTrace } };
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
async function retryDirect(method, _params, oneAttempt, wait = async (milliseconds) => {
    await new Promise((resolve) => setTimeout(resolve, milliseconds));
}) {
    for (let attempt = 0;; attempt += 1) {
        try {
            return await oneAttempt();
        }
        catch (error) {
            const http = error instanceof RpcHttpFailure ? error : undefined, transport = approvedTransportReason(error);
            const retryable = http !== undefined ? http.status === 408 || http.status >= 500 && http.status <= 599 : transport !== undefined;
            if (!retryable || attempt + 1 >= MAX_READ_ATTEMPTS) {
                if (http !== undefined) {
                    if (http.status === 429)
                        throw new ApnError("APN_RPC_RATE_LIMITED", "Bridge RPC provider requested a cooldown.", {
                            rpcMethod: method, ...(http.retryAfterMs === undefined ? {} : { retryAfterMs: http.retryAfterMs.toString() }), attempts: (attempt + 1).toString(),
                        });
                    throw rpcHttpFailure("bridge_RPC_HTTP_status", method, http.status, attempt + 1);
                }
                if (transport !== undefined)
                    throw new ApnError("APN_RPC_AMBIGUOUS", "Bridge RPC transport is unavailable.", {
                        rpcMethod: method, attempts: (attempt + 1).toString(), transportReason: transport,
                    });
                if (error instanceof ApnError && error.code === "APN_RPC_AMBIGUOUS") {
                    throw new ApnError("APN_RPC_AMBIGUOUS", "Bridge RPC transport is unavailable.", { rpcMethod: method });
                }
                throw error;
            }
            const delay = Math.max(RPC_RETRY_DELAY_MS, http?.retryAfterMs ?? 0);
            await wait(delay);
        }
    }
}
async function submitDirect(method, params, oneAttempt) {
    try {
        return await oneAttempt(method, params);
    }
    catch (error) {
        if (error instanceof RpcHttpFailure) {
            if (error.status === 429)
                throw new ApnError("APN_RPC_RATE_LIMITED", "Bridge RPC provider requested a cooldown.", {
                    rpcMethod: method, ...(error.retryAfterMs === undefined ? {} : { retryAfterMs: error.retryAfterMs.toString() }), attempts: "1",
                });
            throw rpcHttpFailure("bridge_RPC_HTTP_status", method, error.status, 1);
        }
        const transport = approvedTransportReason(error);
        if (transport !== undefined)
            throw new ApnError("APN_RPC_AMBIGUOUS", "Bridge RPC transport is unavailable.", {
                rpcMethod: method, attempts: "1", transportReason: transport,
            });
        if (error instanceof ApnError && error.code === "APN_RPC_AMBIGUOUS") {
            throw new ApnError("APN_RPC_AMBIGUOUS", "Bridge RPC transport is unavailable.", { rpcMethod: method });
        }
        throw error;
    }
}
function rpcHttpFailure(reason, method, status, attempts) {
    return new ApnError("APN_RPC_PROTOCOL", `Bridge validation failed: ${reason}.`, {
        rpcMethod: method, httpStatus: status.toString(), attempts: attempts.toString(),
    });
}
function exactNativeTransfer(value, transactionHash, expected) {
    if ((expected.amountAtomic === undefined) === (expected.minimumAmountAtomic === undefined))
        bridgeFailure("APN_INTERNAL", "native_transfer_bound");
    const rows = [];
    const visit = (raw, path, depth) => {
        if (depth > 32 || rows.length > 1024)
            bridgeFailure("APN_RPC_PROTOCOL", "native_trace_bound");
        const call = evmRpcRecord(raw), from = evmRpcAddress(call.from), to = evmRpcAddress(call.to), valueAtomic = evmRpcQuantity(call.value ?? "0x0").toString();
        const bounded = expected.amountAtomic === undefined ? BigInt(valueAtomic) >= BigInt(expected.minimumAmountAtomic) : valueAtomic === expected.amountAtomic;
        if (call.type === "CALL" && call.error === undefined && from === expected.from && to === expected.recipient && bounded) {
            rows.push({ type: "CALL", from, to, valueAtomic, path });
        }
        if (call.calls !== undefined) {
            if (!Array.isArray(call.calls) || call.calls.length > 256)
                bridgeFailure("APN_RPC_PROTOCOL", "native_trace_calls");
            call.calls.forEach((child, index) => visit(child, `${path}.${index}`, depth + 1));
        }
    };
    visit(value, "0", 0);
    if (rows.length !== 1)
        bridgeFailure("APN_RPC_PROTOCOL", "native_destination_transfer");
    return { transactionHash, from: expected.from, to: expected.recipient, valueAtomic: rows[0].valueAtomic,
        traceHash: hashObject({ transactionHash, delivery: rows[0] }) };
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