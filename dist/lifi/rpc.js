import { encodeFunctionData, keccak256 } from "viem";
import { canonicalJson, hashObject } from "../canonical.js";
import { ApnError } from "../errors.js";
import { EvmRpc } from "../evm-rpc.js";
import { evmRpcAddress, evmRpcBlock, evmRpcHex, evmRpcQuantity, evmRpcRecord, evmRpcWord } from "../evm-rpc-codec.js";
import { parsePublicHttpsUrl } from "../network-policy.js";
import { bridgeDeployment } from "./deployments.js";
import { BridgeHttps } from "./https.js";
import { bridgeArchiveEndpoint, bridgeReceiptEndpoint, isArchiveRead, isHistoricalStateRead } from "./rpc-archive.js";
import { BASE_FEE_CONTRACT, bridgeActualFees } from "./rpc-fees.js";
import { verifyRpcTransaction } from "./rpc-transaction.js";
import { bridgeAssetRow, bridgeChain } from "./asset-registry.js";
import { BRIDGE_ZERO_ADDRESS, BRIDGE_ZERO_WORD, bridgeFailure, bridgeHex, bridgeJson, bridgeSame, bridgeUint } from "./validation.js";
import { BNB_COMPOSITE, bnbPoolReadData, verifyBnbCompositeTrace, verifyBnbPoolConfiguration } from "./bnb-composite.js";
import { approvedTransportReason, MAX_READ_ATTEMPTS, parseRetryAfter, RpcHttpFailure, RpcReadSession, RPC_RETRY_DELAY_MS } from "./rpc-session.js";
import { bridgeFeeQuote, rpcBlockValue, rpcExpectedChainValue, rpcFeeBlockValue, rpcHexValue, rpcQuantityValue, rpcRecordValue, rpcTransactionInput, rpcWordValue } from "./rpc-batch-codec.js";
import { exactNativeTransfer, parseReceiptLogs } from "./rpc-proof-codec.js";
export { RpcReadSession } from "./rpc-session.js";
const ERC20_READ = [{ type: "function", name: "allowance", stateMutability: "view", inputs: [{ type: "address" }, { type: "address" }], outputs: [{ type: "uint256" }] },
    { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] }];
const GAS_ORACLE = "0x420000000000000000000000000000000000000F";
const L1_BLOCK = "0x4200000000000000000000000000000000000015";
const GAS_ORACLE_ABI = [{ type: "function", name: "getL1FeeUpperBound", stateMutability: "view", inputs: [{ name: "size", type: "uint256" }], outputs: [{ type: "uint256" }] },
    { type: "function", name: "getOperatorFee", stateMutability: "view", inputs: [{ name: "gas", type: "uint256" }], outputs: [{ type: "uint256" }] }];
const READ_METHODS = new Set(["eth_chainId", "eth_getBlockByNumber", "eth_getBalance", "eth_getCode", "eth_getStorageAt", "eth_getTransactionCount", "eth_call", "eth_estimateGas", "eth_maxPriorityFeePerGas", "eth_getTransactionByHash", "eth_getTransactionReceipt", "debug_traceTransaction", "eth_sendRawTransaction"]);
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
    const archive = bridgeArchiveEndpoint(chainId, environment), receipt = bridgeReceiptEndpoint(chainId, environment);
    const distinctArchive = archive !== null && archive.origin !== endpoint.origin ? archive : null;
    const distinctReceipt = receipt !== null && receipt.url.origin !== endpoint.origin ? receipt : null;
    const receiptFallback = distinctReceipt === null
        ? distinctArchive === null ? null : { url: distinctArchive, maxItemsPerRequest: 3, role: "archive" }
        : { ...distinctReceipt, role: "receipt" };
    let sequence = 0n, archiveChain;
    const call = async (method, params) => {
        if (!READ_METHODS.has(method))
            bridgeFailure("APN_RPC_PROTOCOL", "bridge_RPC_method");
        if (method === "eth_sendRawTransaction")
            return await submitDirect(method, params, (m, p) => oneAttempt(endpoint, m, p));
        if (method === "eth_getTransactionReceipt" && isArchiveRead(method, params)) {
            let primary;
            try {
                primary = await retryDirect(method, params, () => oneAttempt(endpoint, method, params), wait);
            }
            catch (error) {
                if (receiptFallback === null || !isReceiptFallbackError(error))
                    throw error;
                return await fallbackReceipt(method, params, receiptFallback);
            }
            if (primary !== null || receiptFallback === null)
                return primary;
            return await fallbackReceipt(method, params, receiptFallback);
        }
        if (isHistoricalStateRead(method, params)) {
            if (distinctArchive === null)
                return missingHistoricalArchive();
            return await archiveRead(method, params, distinctArchive);
        }
        return await retryDirect(method, params, () => oneAttempt(endpoint, method, params), wait);
    };
    const assertArchiveChain = async (target) => {
        if (archiveChain === undefined)
            archiveChain = (async () => {
                if (evmRpcQuantity(await retryDirect("eth_chainId", [], () => oneAttempt(target, "eth_chainId", []), wait)) !== BigInt(chainId)) {
                    bridgeFailure("APN_RPC_CONFIG", "bridge_archive_RPC_chain");
                }
            })();
        await archiveChain;
    };
    const archiveRead = async (method, params, target) => {
        await assertArchiveChain(target);
        return await retryDirect(method, params, () => oneAttempt(target, method, params), wait);
    };
    const fallbackReceipt = async (method, params, target) => {
        const requests = [
            { jsonrpc: "2.0", id: (++sequence).toString(), method: "eth_chainId", params: [] },
            { jsonrpc: "2.0", id: (++sequence).toString(), method, params },
        ];
        return await retryDirect(method, params, async () => {
            let values;
            if (target.maxItemsPerRequest === 1) {
                const chain = await oneAttempt(target.url, requests[0].method, requests[0].params);
                await wait(750);
                const result = await oneAttempt(target.url, requests[1].method, requests[1].params);
                values = [chain, result];
            }
            else {
                values = decodeAtomicBatchResponse(await batchAttempt(target.url, canonicalJson(requests)), requests);
            }
            rpcFallbackChainValue(chainId, target.role)(values[0]);
            return rpcReceiptFallbackValue(params[0])(values[1]);
        }, wait);
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
        if (response.status !== 200) {
            if (response.status === 403 && knownPublicNodeReceiptCapability(chainId, target, method, response.body)) {
                throw new ApnError("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "Bridge RPC historical receipt read is unavailable.", { rpcMethod: method, reason: "historical_receipt_unavailable" });
            }
            throw new RpcHttpFailure(method, response.status, parseRetryAfter(response.headers, now));
        }
        const r = evmRpcRecord(bridgeJson(response.body, 1024 * 1024));
        if (r.jsonrpc !== "2.0" || r.id !== id)
            bridgeFailure("APN_RPC_PROTOCOL", "bridge_RPC_response", { rpcMethod: method });
        if (Object.hasOwn(r, "error")) {
            if (method === "eth_getTransactionReceipt" && historicalReceiptUnavailable(r.error, chainId, target, method)) {
                throw new ApnError("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "Bridge RPC historical receipt read is unavailable.", { rpcMethod: method, reason: "historical_receipt_unavailable" });
            }
            bridgeFailure("APN_RPC_PROTOCOL", "bridge_RPC_response", { rpcMethod: method });
        }
        if (!Object.hasOwn(r, "result"))
            bridgeFailure("APN_RPC_PROTOCOL", "bridge_RPC_response", { rpcMethod: method });
        return r.result;
    };
    const batchAttempt = async (target, body, now = Date.now()) => {
        const rpcMethod = rpcBodyMethod(body);
        let response;
        try {
            response = await transport.request(target.toString(), "POST", body, 1024 * 1024, "APN_RPC_CONFIG");
        }
        catch (error) {
            throw error;
        }
        if (response.status !== 200)
            throw new RpcHttpFailure(rpcMethod, response.status, parseRetryAfter(response.headers, now));
        return bridgeJson(response.body, 1024 * 1024);
    };
    const sessionBatchCall = (session) => async (items, route = "primary") => {
        if (route === "receipt" && !isReceiptBatchShape(items)) {
            bridgeFailure("APN_RPC_CONFIG", "bridge_receipt_RPC_method");
        }
        if (route !== "primary" && route !== "receipt" && items.some((item) => !isArchiveBatchItem(item.method, item.params))) {
            bridgeFailure("APN_RPC_CONFIG", "bridge_archive_RPC_method");
        }
        const fallback = route === "receipt" ? receiptFallback : null;
        if (route === "receipt" && fallback === null)
            missingHistoricalArchive();
        const target = route === "receipt" ? fallback.url : route !== "primary" ? distinctArchive ?? missingHistoricalArchive() : endpoint;
        const attempt = async (body) => await batchAttempt(target, body, session.currentTime());
        const bound = items.map((item) => ({ ...item, batchAttempt: attempt }));
        return route === "receipt"
            ? await session.readReceiptBatch(target.toString(), chainId, bound, fallback.maxItemsPerRequest)
            : route === "archive_deployment"
                ? await session.readArchiveDeploymentBatch(target.toString(), chainId, bound)
                : await session.readBatch(target.toString(), chainId, bound);
    };
    const sessionArchiveReceipt = async (session, method, params) => {
        const values = await sessionBatchCall(session)([
            { method: "eth_chainId", params: [], cachePolicy: "immutable", decoder: rpcFallbackChainValue(chainId, receiptFallback?.role ?? "archive") },
            { method, params, cachePolicy: "auto", decoder: rpcReceiptFallbackValue(params[0]) },
        ], "receipt");
        return values[1];
    };
    const sessionCall = (session) => async (method, params) => {
        if (!READ_METHODS.has(method))
            bridgeFailure("APN_RPC_PROTOCOL", "bridge_RPC_method");
        const primaryAttempt = (m, p) => oneAttempt(endpoint, m, p, session.currentTime());
        if (method === "eth_sendRawTransaction")
            return await submitDirect(method, params, primaryAttempt);
        if (method === "eth_getTransactionReceipt" && isArchiveRead(method, params)) {
            let primary;
            try {
                primary = await session.read(endpoint.toString(), chainId, method, params, primaryAttempt);
            }
            catch (error) {
                if (receiptFallback === null || !isReceiptFallbackError(error))
                    throw error;
                return await sessionArchiveReceipt(session, method, params);
            }
            if (primary !== null || receiptFallback === null)
                return primary;
            return await sessionArchiveReceipt(session, method, params);
        }
        if (isHistoricalStateRead(method, params)) {
            if (distinctArchive === null)
                return missingHistoricalArchive();
            const archiveAttempt = (m, p) => oneAttempt(distinctArchive, m, p, session.currentTime());
            const chain = await session.read(distinctArchive.toString(), chainId, "eth_chainId", [], archiveAttempt);
            if (evmRpcQuantity(chain) !== BigInt(chainId))
                bridgeFailure("APN_RPC_CONFIG", "bridge_archive_RPC_chain");
            return await session.read(distinctArchive.toString(), chainId, method, params, archiveAttempt);
        }
        return await session.read(endpoint.toString(), chainId, method, params, primaryAttempt);
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
    commandPrices;
    commandFeeInputs;
    preparedEstimates = new Map();
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
                { method: "eth_chainId", params: [], cachePolicy: "immutable", decoder: rpcExpectedChainValue(this.chainId) },
                { method: "eth_getBlockByNumber", params: [rpcTag, false], cachePolicy: tag === "latest" ? "snapshot" : "immutable", decoder: rpcBlockValue },
            ]);
            if (chain !== BigInt(this.chainId))
                throw new ApnError("APN_CHAIN_MISMATCH", "RPC chain does not match the explicitly selected EVM network.");
            const b = raw, number = evmRpcQuantity(b.number).toString(), hash = evmRpcHex(b.hash, 32);
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
            extraItems.push({ method: "eth_call", params: [{ to: BNB_COMPOSITE.vault, data: bnbPoolReadData.registration }, tag], cachePolicy: "immutable", decoder: rpcHexValue(256) }, { method: "eth_call", params: [{ to: BNB_COMPOSITE.vault, data: bnbPoolReadData.tokens }, tag], cachePolicy: "immutable", decoder: rpcHexValue(2048) });
        }
        let traceProbe;
        if ((this.chainId === 143 || this.chainId === 59144) && peerChainId === 1 && tool === "across" && token === BRIDGE_ZERO_ADDRESS) {
            traceProbe = this.chainId === 143 ? { transaction: MONAD_TRACE_PROBE_TRANSACTION, from: "0x6f49a8f621353f12378d0046e7d7e4b9b249dc9e", to: "0x0000000000000000000000000000000000001000", value: 18000000000000000000n }
                : { transaction: LINEA_TRACE_PROBE_TRANSACTION, from: "0x9629fe86f04e735923e8542ddd9f265f576e7421", to: "0xbcc016e2a79d509d2b776827ed986568d9b56d59", value: 243939205000000000n };
            extraItems.push({ method: "debug_traceTransaction", params: [traceProbe.transaction, { tracer: "callTracer", tracerConfig: { onlyTopCall: true, withLog: false } }], cachePolicy: "immutable", decoder: rpcRecordValue });
        }
        const items = [
            { method: "eth_chainId", params: [], cachePolicy: "immutable", decoder: rpcExpectedChainValue(this.chainId) },
            ...codeRows.map((row) => ({ method: "eth_getCode", params: [row.address, tag], cachePolicy: "immutable", decoder: rpcHexValue(128 * 1024) })),
            ...readRows.map((row) => ({ method: row.kind === "storage" ? "eth_getStorageAt" : "eth_call",
                params: row.kind === "storage" ? [row.address, row.data, tag] : [{ to: row.address, data: row.data }, tag], cachePolicy: "immutable",
                decoder: rpcHexValue(64 * 1024) })),
            ...extraItems,
            { method: "eth_getBlockByNumber", params: [tag, false], cachePolicy: "immutable", decoder: rpcBlockValue },
        ];
        const values = this.batchCall === undefined ? await Promise.all(items.map(async (item) => item.decoder(await this.call(item.method, item.params))))
            : await this.batchCall(items, block === undefined ? "archive" : "archive_deployment");
        let offset = 0;
        if (values[offset++] !== BigInt(this.chainId))
            throw new ApnError("APN_CHAIN_MISMATCH", "RPC chain does not match the explicitly selected EVM network.");
        for (const row of codeRows) {
            const bytes = values[offset++];
            if (bytes === "0x" || keccak256(bytes) !== row.codeHash)
                bridgeFailure("APN_PROVIDER_PROTOCOL", "bridge_deployment_code_changed");
            code.push({ address: row.address, codeHash: keccak256(bytes) });
        }
        for (const row of readRows) {
            const observed = values[offset++];
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
            const trace = values[offset++];
            if (trace.type !== "CALL" || evmRpcAddress(trace.from).toLowerCase() !== traceProbe.from ||
                evmRpcAddress(trace.to).toLowerCase() !== traceProbe.to || evmRpcQuantity(trace.value) !== traceProbe.value) {
                bridgeFailure("APN_PROVIDER_PROTOCOL", "native_destination_trace_capability_changed");
            }
        }
        const recheck = values[offset];
        if (evmRpcQuantity(recheck.number).toString() !== at.numberAtomic || evmRpcHex(recheck.hash, 32) !== at.hash)
            bridgeFailure("APN_RPC_PROTOCOL", "bridge_block_reorg");
        if (this.batchCall === undefined)
            await this.assertChain();
        return { chainId: this.chainId, peerChainId, tool, block: at, rpcOrigin: this.origin,
            contractHash: hashObject({ protocol: contract, feeContract }), codeHash: hashObject(code), configurationHash: hashObject(configuration) };
    }
    /** A native principal's balance is the native balance itself and its allowance is the constant zero: nothing is approved. */
    async account(owner, spender, token, planned = []) {
        if (this.batchCall !== undefined) {
            const asset = bridgeAssetRow(this.chainId, token, "APN_RPC_CONFIG");
            const data = encodeFunctionData({ abi: ERC20_READ, functionName: "balanceOf", args: [owner] });
            const allowanceData = encodeFunctionData({ abi: ERC20_READ, functionName: "allowance", args: [owner, spender] });
            const l1Data = encodeFunctionData({ abi: GAS_ORACLE_ABI, functionName: "getL1FeeUpperBound", args: [16384n] });
            const phaseOne = [
                { method: "eth_chainId", params: [], cachePolicy: "immutable", decoder: rpcExpectedChainValue(this.chainId) },
                { method: "eth_getBlockByNumber", params: ["latest", false], cachePolicy: "snapshot", decoder: rpcFeeBlockValue },
                ...(this.chainId === 42161 ? [] : [{ method: "eth_maxPriorityFeePerGas", params: [], cachePolicy: "snapshot", decoder: rpcQuantityValue }]),
            ];
            const head = await this.batchCall(phaseOne);
            let headOffset = 0;
            if (head[headOffset++] !== BigInt(this.chainId))
                throw new ApnError("APN_CHAIN_MISMATCH", "RPC chain does not match the explicitly selected EVM network.");
            const raw = head[headOffset++], at = { numberAtomic: evmRpcQuantity(raw.number).toString(), hash: evmRpcHex(raw.hash, 32),
                timestampAtomic: evmRpcQuantity(raw.timestamp).toString() };
            const priority = this.chainId === 42161 ? 0n : head[headOffset++], maximum = 2n * evmRpcQuantity(raw.baseFeePerGas) + priority;
            bridgeUint(maximum.toString(), true, "APN_RPC_PROTOCOL");
            this.commandLatestBlock = at;
            this.commandPrices = { maxFeePerGasAtomic: maximum.toString(), maxPriorityFeePerGasAtomic: priority.toString() };
            const tag = quantity(BigInt(at.numberAtomic));
            const phaseTwo = [
                { method: "eth_chainId", params: [], cachePolicy: "immutable", decoder: rpcExpectedChainValue(this.chainId) },
                { method: "eth_getBalance", params: [owner, tag], cachePolicy: "immutable", decoder: rpcQuantityValue },
                ...(asset.kind === "native" ? [] : [
                    { method: "eth_call", params: [{ to: token, data }, tag], cachePolicy: "immutable", decoder: rpcWordValue },
                    { method: "eth_call", params: [{ to: token, data: allowanceData }, tag], cachePolicy: "immutable", decoder: rpcWordValue },
                ]),
                ...(this.chainId === 8453 ? [
                    { method: "eth_call", params: [{ to: GAS_ORACLE, data: l1Data }, tag], cachePolicy: "immutable", decoder: rpcWordValue },
                    { method: "eth_call", params: [{ to: L1_BLOCK, data: "0x4d5d9a2a" }, tag], cachePolicy: "immutable", decoder: rpcWordValue },
                    { method: "eth_call", params: [{ to: L1_BLOCK, data: "0x16d3bc7f" }, tag], cachePolicy: "immutable", decoder: rpcWordValue },
                ] : []),
                { method: "eth_getTransactionCount", params: [owner, tag], cachePolicy: "immutable", decoder: rpcQuantityValue },
                { method: "eth_getTransactionCount", params: [owner, "pending"], cachePolicy: "none", decoder: rpcQuantityValue },
                ...planned.map((transaction) => ({ method: "eth_estimateGas", params: [rpcTransactionInput(transaction), tag], cachePolicy: "none", decoder: rpcQuantityValue })),
                { method: "eth_getBlockByNumber", params: [tag, false], cachePolicy: "immutable", decoder: rpcBlockValue },
            ];
            const values = await this.batchCall(phaseTwo);
            let offset = 0;
            if (values[offset++] !== BigInt(this.chainId))
                throw new ApnError("APN_CHAIN_MISMATCH", "RPC chain does not match the explicitly selected EVM network.");
            const native = values[offset++], balance = asset.kind === "native" ? native : values[offset++];
            const allowance = asset.kind === "native" ? 0n : values[offset++];
            this.commandFeeInputs = this.chainId === 8453 ? { l1DataFeeUpperWei: values[offset++],
                operatorScalar: values[offset++], operatorConstant: values[offset++] } :
                { l1DataFeeUpperWei: 0n, operatorScalar: 0n, operatorConstant: 0n };
            const latest = values[offset++], pending = values[offset++];
            for (const transaction of planned)
                this.preparedEstimates.set(hashObject(transaction), values[offset++].toString());
            const recheck = values[offset];
            if (evmRpcQuantity(recheck.number).toString() !== at.numberAtomic || evmRpcHex(recheck.hash, 32) !== at.hash)
                bridgeFailure("APN_RPC_PROTOCOL", "bridge_block_reorg");
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
        if (this.commandPrices !== undefined)
            return this.commandPrices;
        if (this.batchCall !== undefined) {
            const items = [
                { method: "eth_chainId", params: [], cachePolicy: "immutable", decoder: rpcExpectedChainValue(this.chainId) },
                { method: "eth_getBlockByNumber", params: ["latest", false], cachePolicy: "snapshot", decoder: rpcFeeBlockValue },
                ...(this.chainId === 42161 ? [] : [{ method: "eth_maxPriorityFeePerGas", params: [], cachePolicy: "snapshot", decoder: rpcQuantityValue }]),
            ];
            const values = await this.batchCall(items);
            if (values[0] !== BigInt(this.chainId))
                throw new ApnError("APN_CHAIN_MISMATCH", "RPC chain does not match the explicitly selected EVM network.");
            const block = values[1], priority = this.chainId === 42161 ? 0n : values[2];
            this.commandLatestBlock = { numberAtomic: evmRpcQuantity(block.number).toString(), hash: evmRpcHex(block.hash, 32), timestampAtomic: evmRpcQuantity(block.timestamp).toString() };
            const maximum = 2n * evmRpcQuantity(block.baseFeePerGas) + priority;
            bridgeUint(maximum.toString(), true, "APN_RPC_PROTOCOL");
            return this.commandPrices = { maxFeePerGasAtomic: maximum.toString(), maxPriorityFeePerGasAtomic: priority.toString() };
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
        const prepared = this.preparedEstimates.get(hashObject(transaction));
        if (prepared !== undefined && this.commandPrices !== undefined)
            return { gasLimitAtomic: prepared, ...this.commandPrices };
        if (this.batchCall !== undefined) {
            const items = [
                { method: "eth_chainId", params: [], cachePolicy: "immutable", decoder: rpcExpectedChainValue(this.chainId) },
                { method: "eth_estimateGas", params: [{ from: transaction.from, to: transaction.to, data: transaction.data,
                            value: quantity(bridgeUint(transaction.valueAtomic)) }], cachePolicy: "none", decoder: rpcQuantityValue },
                { method: "eth_getBlockByNumber", params: ["latest", false], cachePolicy: "snapshot", decoder: rpcFeeBlockValue },
                ...(this.chainId === 42161 ? [] : [{ method: "eth_maxPriorityFeePerGas", params: [], cachePolicy: "snapshot", decoder: rpcQuantityValue }]),
            ];
            const values = await this.batchCall(items);
            if (values[0] !== BigInt(this.chainId))
                throw new ApnError("APN_CHAIN_MISMATCH", "RPC chain does not match the explicitly selected EVM network.");
            const gas = values[1], block = values[2], priority = this.chainId === 42161 ? 0n : values[3];
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
        if (this.commandLatestBlock !== undefined && this.commandFeeInputs !== undefined)
            return envelopes.map((envelope) => {
                const execution = bridgeUint(envelope.economics.maximumGasCostAtomic, true), input = this.commandFeeInputs;
                const operator = BigInt(envelope.economics.gasLimitAtomic) * input.operatorScalar * 100n + input.operatorConstant;
                return bridgeFeeQuote(this.chainId, this.origin, this.commandLatestBlock, execution, input.l1DataFeeUpperWei, operator);
            });
        const block = this.commandLatestBlock ?? await this.block("latest"), tag = quantity(BigInt(block.numberAtomic));
        const items = [
            { method: "eth_chainId", params: [], cachePolicy: "immutable", decoder: rpcExpectedChainValue(this.chainId) },
            ...(this.chainId === 8453 ? envelopes.flatMap((envelope) => {
                const l1 = encodeFunctionData({ abi: GAS_ORACLE_ABI, functionName: "getL1FeeUpperBound", args: [16384n] });
                const operator = encodeFunctionData({ abi: GAS_ORACLE_ABI, functionName: "getOperatorFee", args: [bridgeUint(envelope.economics.gasLimitAtomic, true)] });
                return [
                    { method: "eth_call", params: [{ to: GAS_ORACLE, data: l1 }, tag], cachePolicy: "none", decoder: rpcWordValue },
                    { method: "eth_call", params: [{ to: GAS_ORACLE, data: operator }, tag], cachePolicy: "none", decoder: rpcWordValue },
                ];
            }) : []),
            { method: "eth_getBlockByNumber", params: [tag, false], cachePolicy: "immutable", decoder: rpcBlockValue },
        ];
        const values = await this.batchCall(items);
        if (values[0] !== BigInt(this.chainId))
            throw new ApnError("APN_CHAIN_MISMATCH", "RPC chain does not match the explicitly selected EVM network.");
        let offset = 1;
        const quotes = envelopes.map((envelope) => {
            const execution = bridgeUint(envelope.economics.maximumGasCostAtomic, true);
            const l1 = this.chainId === 8453 ? values[offset++] : 0n;
            const operator = this.chainId === 8453 ? values[offset++] : 0n;
            const total = execution + l1 + operator;
            return { chainId: this.chainId, ...(this.chainId === 42161 ? { feeModel: "arbitrum-inclusive" } : this.chainId === 143 ? { feeModel: "monad-gas-limit" } : {}),
                l1DataFeeUpperWei: l1.toString(), operatorFeeUpperWei: operator.toString(), maximumExecutionFeeWei: execution.toString(),
                totalQuoteWei: total.toString(), totalFeeEnforcedOnchain: false, blockNumberAtomic: block.numberAtomic, blockHash: block.hash,
                rpcOrigin: this.origin, observedAt: new Date().toISOString() };
        });
        const recheck = values[offset];
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
        return await this.observeCanonical(hash, expected, nativeDelivery, true);
    }
    async observeDestination(hash, nativeDelivery) {
        return await this.observeCanonical(hash, undefined, nativeDelivery, false);
    }
    async observeCanonical(hash, expected, nativeDelivery, includeFees) {
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
        const safeRaw = await evmRpcBlock(this.call, "safe");
        const safe = { numberAtomic: safeRaw.number, hash: safeRaw.hash, timestampAtomic: evmRpcQuantity(safeRaw.raw.timestamp).toString() };
        const safeBlock = BigInt(safe.numberAtomic) >= number ? safe : null;
        const status = evmRpcQuantity(r.status);
        if (status !== 0n && status !== 1n)
            bridgeFailure("APN_RPC_PROTOCOL", "receipt_status");
        const identity = await verifyRpcTransaction(tx, this.chainId, hash, expected);
        if (evmRpcAddress(r.from) !== identity.from || evmRpcAddress(r.to) !== identity.to)
            bridgeFailure("APN_RPC_PROTOCOL", "receipt_sender_target");
        const logs = parseReceiptLogs(r.logs, hash, block, index);
        const fees = includeFees ? await bridgeActualFees(this.chainId, r, block, this.call) : null;
        if (fees !== null && (BigInt(fees.gasUsedAtomic) > BigInt(identity.gasLimitAtomic) ||
            BigInt(fees.effectiveGasPriceAtomic) > BigInt(identity.maxFeePerGasAtomic)))
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
        if (this.batchCall === undefined) {
            await this.recheck(block);
            if (safeBlock !== null)
                await this.recheck(safeBlock);
        }
        else {
            const values = await this.batchCall([
                { method: "eth_chainId", params: [], cachePolicy: "immutable", decoder: rpcArchiveChainValue(this.chainId) },
                { method: "eth_getBlockByNumber", params: [quantity(number), false], cachePolicy: "immutable", decoder: rpcBlockValue },
                { method: "eth_getBlockByNumber", params: [quantity(BigInt(safe.numberAtomic)), false], cachePolicy: "immutable", decoder: rpcBlockValue },
            ], "archive");
            assertMatchingHeader(values[1], block);
            assertMatchingHeader(values[2], safe);
        }
        await this.assertChain();
        return { transaction: { chainId: this.chainId, transactionHash: hash, block, safeBlock, rpcOrigin: this.origin, ...identity,
                ...(fees ?? {}), status: status === 1n ? "success" : "reverted", logsHash: hashObject(logs) },
            receipt: { chainId: this.chainId, transactionHash: hash, blockNumberAtomic: number.toString(), blockHash, logs, nativeBalance, nativeTransfer, compositeTrace } };
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
function isReceiptFallbackError(error) {
    if (!(error instanceof ApnError))
        return false;
    if (error.code === "APN_PROVIDER_CAPABILITY_UNAVAILABLE") {
        return error.details?.reason === "historical_receipt_unavailable" && error.details.rpcMethod === "eth_getTransactionReceipt";
    }
    if (["APN_RPC_AMBIGUOUS", "APN_RPC_RATE_LIMITED", "APN_PROVIDER_UNAVAILABLE"].includes(error.code))
        return true;
    if (error.code !== "APN_RPC_PROTOCOL")
        return false;
    const status = Number(error.details?.httpStatus);
    return status === 408 || status >= 500 && status <= 599;
}
const PUBLICNODE_ARCHIVE_MESSAGE = "archive requests require a personal token";
function historicalReceiptUnavailable(value, chainId, target, method) {
    let error;
    try {
        error = evmRpcRecord(value);
    }
    catch {
        return false;
    }
    if (!Number.isSafeInteger(error.code) || typeof error.message !== "string" || error.message.length > 1024)
        return false;
    const message = normalizeProviderMessage(error.message);
    if (message === PUBLICNODE_ARCHIVE_MESSAGE)
        return isPublicNodeReceiptRequest(chainId, target, method);
    if (credentialOrAuthorizationMessage(message))
        return false;
    return message.includes("missing trie node") || message.includes("pruned") ||
        message.includes("historical") && ["unavailable", "not available", "unsupported", "not supported"].some((part) => message.includes(part));
}
function knownPublicNodeReceiptCapability(chainId, target, method, body) {
    if (!isPublicNodeReceiptRequest(chainId, target, method))
        return false;
    const trimmed = body.trim();
    if (normalizeProviderMessage(trimmed) === PUBLICNODE_ARCHIVE_MESSAGE)
        return true;
    if (trimmed.length === 0 || trimmed.length > 4096)
        return false;
    try {
        const value = evmRpcRecord(JSON.parse(trimmed)), error = evmRpcRecord(value.error);
        return typeof error.message === "string" && normalizeProviderMessage(error.message) === PUBLICNODE_ARCHIVE_MESSAGE;
    }
    catch {
        return false;
    }
}
function isPublicNodeReceiptRequest(chainId, target, method) {
    if (method !== "eth_getTransactionReceipt" || target.pathname !== "/" || target.search !== "")
        return false;
    return chainId === 8453 && target.origin === "https://base-rpc.publicnode.com" ||
        chainId === 1 && target.origin === "https://ethereum-rpc.publicnode.com";
}
function normalizeProviderMessage(message) { return message.trim().toLowerCase(); }
function credentialOrAuthorizationMessage(message) {
    return ["token", "credential", "api key", "apikey", "unauthorized", "forbidden", "authorization", "authentication", "access denied"]
        .some((part) => message.includes(part));
}
function missingHistoricalArchive() {
    throw new ApnError("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "Historical bridge proof requires a distinct archive RPC endpoint.", { reason: "distinct_archive_RPC_required" });
}
function rpcBodyMethod(body) {
    try {
        const parsed = JSON.parse(body);
        if (Array.isArray(parsed))
            return "batch";
        if (typeof parsed === "object" && parsed !== null && typeof parsed.method === "string") {
            return parsed.method;
        }
    }
    catch { /* The canonical body is constructed internally and validated by the response path. */ }
    return "batch";
}
function decodeAtomicBatchResponse(response, requests) {
    if (!Array.isArray(response) || response.length !== requests.length) {
        throw new ApnError("APN_RPC_PROTOCOL", "Bridge RPC batch result count is invalid.", { rpcMethod: "eth_getTransactionReceipt" });
    }
    const byId = new Map();
    for (const candidate of response) {
        const row = evmRpcRecord(candidate);
        if (row.jsonrpc !== "2.0" || typeof row.id !== "string" || byId.has(row.id) || Object.hasOwn(row, "error") || !Object.hasOwn(row, "result")) {
            bridgeFailure("APN_RPC_PROTOCOL", "bridge_RPC_response", { rpcMethod: "eth_getTransactionReceipt" });
        }
        byId.set(row.id, row.result);
    }
    return requests.map((request) => byId.has(request.id) ? byId.get(request.id) : bridgeFailure("APN_RPC_PROTOCOL", "bridge_RPC_response", { rpcMethod: "eth_getTransactionReceipt" }));
}
function isArchiveBatchItem(method, params) {
    if (method === "eth_chainId")
        return params.length === 0;
    if (method === "eth_getBlockByNumber")
        return params.length === 2 && typeof params[0] === "string" && /^0x(?:0|[1-9a-f][0-9a-f]*)$/u.test(params[0]);
    if (method === "debug_traceTransaction")
        return params.length === 2 && typeof params[0] === "string" && /^0x[0-9a-fA-F]{64}$/u.test(params[0]);
    return isArchiveRead(method, params);
}
function isReceiptBatchShape(items) {
    if (items.length !== 2)
        return false;
    const [chain, receipt] = items;
    return chain?.method === "eth_chainId" && chain.params.length === 0 && receipt?.method === "eth_getTransactionReceipt" &&
        receipt.params.length === 1 && typeof receipt.params[0] === "string" && /^0x[0-9a-f]{64}$/u.test(receipt.params[0]);
}
function rpcArchiveChainValue(chainId) {
    return (value) => {
        const observed = evmRpcQuantity(value);
        if (observed !== BigInt(chainId))
            bridgeFailure("APN_RPC_CONFIG", "bridge_archive_RPC_chain");
        return observed;
    };
}
function rpcFallbackChainValue(chainId, role) {
    return (value) => {
        const observed = evmRpcQuantity(value);
        if (observed !== BigInt(chainId))
            bridgeFailure("APN_RPC_CONFIG", role === "receipt" ? "bridge_receipt_RPC_chain" : "bridge_archive_RPC_chain");
        return observed;
    };
}
function rpcReceiptFallbackValue(expected) {
    return (value) => {
        if (value === null)
            return null;
        const receipt = evmRpcRecord(value), hash = evmRpcHex(expected, 32);
        if (evmRpcHex(receipt.transactionHash, 32) !== hash)
            bridgeFailure("APN_RPC_PROTOCOL", "receipt_transaction_hash");
        const status = evmRpcQuantity(receipt.status);
        if (status !== 0n && status !== 1n)
            bridgeFailure("APN_RPC_PROTOCOL", "receipt_status");
        evmRpcQuantity(receipt.blockNumber);
        evmRpcHex(receipt.blockHash, 32);
        return value;
    };
}
function assertMatchingHeader(raw, expected) {
    if (evmRpcQuantity(raw.number).toString() !== expected.numberAtomic || evmRpcHex(raw.hash, 32) !== expected.hash) {
        bridgeFailure("APN_RPC_PROTOCOL", "bridge_archive_block_mismatch");
    }
}
function quantity(n) { return `0x${n.toString(16)}`; }
//# sourceMappingURL=rpc.js.map