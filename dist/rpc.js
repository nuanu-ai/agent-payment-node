import { request as httpsRequest } from "node:https";
import { decodeAbiParameters } from "viem";
import { sha256 } from "./canonical.js";
import { BASE_USDC, CHAIN_ID, MAX_NONCE_SCAN_BLOCKS, MAX_RPC_RESPONSE_BYTES } from "./constants.js";
import { ApnError } from "./errors.js";
import { parseAtomic } from "./money.js";
import { isPublicIp, parsePublicHttpsUrl, resolvePublicAddresses } from "./network-policy.js";
const AUTHORIZATION_STATE_SELECTOR = "0xe94a0102";
const AUTHORIZATION_USED_TOPIC = "0x98de503528ee59b575ef0c0a2576a82497bfc029a5685b209e9ec333479b10a5";
const MAX_X402_LOGS = 256;
const MAX_X402_TOPICS = 4;
const MAX_X402_LOG_DATA_BYTES = 4096;
export class HttpsBaseRpc {
    endpoint;
    rpcOrigin;
    sequence = 0n;
    pinnedAddresses;
    constructor(endpoint) {
        const parsed = parsePublicHttpsUrl(endpoint, "APN_RPC_CONFIG", "RPC endpoint");
        this.endpoint = parsed;
        this.rpcOrigin = parsed.origin;
    }
    async assertBaseChain() {
        const chainId = rpcQuantity(await this.call("eth_chainId", []));
        if (chainId !== BigInt(CHAIN_ID))
            throw new ApnError("APN_CHAIN_MISMATCH", "RPC endpoint is not Base chain ID 8453.");
        return { chainId: CHAIN_ID, rpcOrigin: this.rpcOrigin };
    }
    async getBalances(address) {
        await this.assertBaseChain();
        const block = record(await this.call("eth_getBlockByNumber", ["latest", false]), "latest block");
        const blockNumber = rpcQuantity(block.number).toString();
        const blockHash = rpcHex(block.hash, 32);
        const tag = block.number;
        const eth = rpcQuantity(await this.call("eth_getBalance", [address, tag])).toString();
        const data = `0x70a08231${address.slice(2).toLowerCase().padStart(64, "0")}`;
        const usdc = rpcQuantity(await this.call("eth_call", [{ to: BASE_USDC, data }, tag])).toString();
        return { address, ethAtomic: eth, usdcAtomic: usdc, blockNumberAtomic: blockNumber, blockHash, observedAt: new Date().toISOString(), rpcOrigin: this.rpcOrigin };
    }
    async getX402PrepareEvidence(address) {
        const block = record(await this.call("eth_getBlockByNumber", ["safe", false]), "safe block");
        const tag = block.number;
        const number = rpcQuantity(tag).toString();
        const hash = rpcHex(block.hash, 32);
        const timestamp = rpcQuantity(block.timestamp).toString();
        const balanceData = `0x70a08231${address.slice(2).toLowerCase().padStart(64, "0")}`;
        const [balance, name, version, domainSeparator] = await Promise.all([
            this.call("eth_call", [{ to: BASE_USDC, data: balanceData }, tag]),
            this.call("eth_call", [{ to: BASE_USDC, data: "0x06fdde03" }, tag]),
            this.call("eth_call", [{ to: BASE_USDC, data: "0x54fd4d50" }, tag]),
            this.call("eth_call", [{ to: BASE_USDC, data: "0x3644e515" }, tag]),
        ]);
        const recheckedBlock = record(await this.call("eth_getBlockByNumber", ["safe", false]), "rechecked safe block");
        const recheckedNumber = rpcQuantity(recheckedBlock.number).toString();
        const recheckedHash = rpcHex(recheckedBlock.hash, 32);
        const recheckedTimestamp = rpcQuantity(recheckedBlock.timestamp).toString();
        if (recheckedNumber !== number || recheckedHash !== hash || recheckedTimestamp !== timestamp) {
            throw new ApnError("APN_RPC_PROTOCOL", "RPC safe block identity changed around the pinned x402 reads.");
        }
        return {
            address,
            usdcAtomic: rpcUint256Data(balance, "USDC balance"),
            tokenName: rpcString(name, "token name"),
            tokenVersion: rpcString(version, "token version"),
            domainSeparator: rpcHex(domainSeparator, 32),
            rpcOriginHash: sha256(this.rpcOrigin),
            observedAt: new Date().toISOString(),
            queriedTag: "safe",
            block: { number, hash, timestamp },
        };
    }
    async getX402Head(tag) {
        const block = record(await this.call("eth_getBlockByNumber", [tag, false]), `${tag} block`);
        const observedAt = new Date().toISOString();
        const timestamp = rpcQuantity(block.timestamp).toString();
        if (BigInt(timestamp) > BigInt(Math.floor(Date.parse(observedAt) / 1000))) {
            throw new ApnError("APN_RPC_PROTOCOL", `RPC ${tag} block is future-dated.`);
        }
        return {
            queriedTag: tag,
            number: rpcQuantity(block.number).toString(),
            hash: nonzeroBytes32(block.hash, `${tag} block hash`),
            timestamp,
            observedAt,
            rpcOrigin: this.rpcOrigin,
        };
    }
    async getX402Block(number) {
        const quantity = parseAtomic(number);
        const block = record(await this.call("eth_getBlockByNumber", [`0x${quantity.toString(16)}`, false]), "numbered block");
        if (rpcQuantity(block.number) !== quantity)
            throw new ApnError("APN_RPC_PROTOCOL", "RPC numbered block identity is inconsistent.");
        const observedAt = new Date().toISOString();
        const timestamp = rpcQuantity(block.timestamp).toString();
        if (BigInt(timestamp) > BigInt(Math.floor(Date.parse(observedAt) / 1000))) {
            throw new ApnError("APN_RPC_PROTOCOL", "RPC numbered block is future-dated.");
        }
        return {
            queriedTag: "number",
            number,
            hash: nonzeroBytes32(block.hash, "numbered block hash"),
            timestamp,
            observedAt,
            rpcOrigin: this.rpcOrigin,
        };
    }
    async getX402Receipt(transactionHash) {
        const raw = await this.call("eth_getTransactionReceipt", [transactionHash]);
        if (raw === null)
            return null;
        const receipt = record(raw, "x402 transaction receipt");
        const status = rpcQuantity(receipt.status);
        if (status !== 0n && status !== 1n)
            throw new ApnError("APN_RPC_PROTOCOL", "RPC receipt status is invalid.");
        const receiptTransactionHash = nonzeroBytes32(receipt.transactionHash, "receipt transaction hash");
        const blockNumber = rpcQuantity(receipt.blockNumber).toString();
        const blockHash = nonzeroBytes32(receipt.blockHash, "receipt block hash");
        if (!Array.isArray(receipt.logs) || receipt.logs.length > MAX_X402_LOGS) {
            throw new ApnError("APN_RPC_PROTOCOL", "RPC receipt logs exceed the fixed bound.");
        }
        const logs = receipt.logs.map((entry) => x402RpcLog(entry));
        if (logs.some((log) => log.transactionHash !== receiptTransactionHash || log.blockNumber !== blockNumber || log.blockHash !== blockHash))
            throw new ApnError("APN_RPC_PROTOCOL", "RPC receipt log identity is inconsistent.");
        return {
            transactionHash: receiptTransactionHash,
            status: status === 1n ? "success" : "reverted",
            blockNumber,
            blockHash,
            logs,
            observedAt: new Date().toISOString(),
            rpcOrigin: this.rpcOrigin,
        };
    }
    async getX402AuthorizationState(authorizer, nonce, block) {
        const identity = "tag" in block ? await this.getX402Head(block.tag) : await this.getX402Block(block.number);
        const tag = `0x${BigInt(identity.number).toString(16)}`;
        const data = `${AUTHORIZATION_STATE_SELECTOR}${authorizer.slice(2).toLowerCase().padStart(64, "0")}${rpcHex(nonce, 32).slice(2)}`;
        const encoded = rpcHex(await this.call("eth_call", [{ to: BASE_USDC, data }, tag]), 32);
        const value = BigInt(encoded);
        if (value !== 0n && value !== 1n)
            throw new ApnError("APN_RPC_PROTOCOL", "RPC authorization state is not a canonical boolean.");
        return {
            value: value === 1n,
            blockNumber: identity.number,
            blockHash: identity.hash,
            blockTag: "tag" in block ? block.tag : "number",
            observedAt: new Date().toISOString(),
            rpcOrigin: this.rpcOrigin,
        };
    }
    async getX402AuthorizationUsedLogs(input) {
        const from = parseAtomic(input.fromBlock);
        const to = parseAtomic(input.toBlock);
        if (from > to || to - from + 1n > 2048n)
            throw new ApnError("APN_RPC_PROTOCOL", "RPC AuthorizationUsed range exceeds the fixed bound.");
        const result = await this.callX402Logs([{
                address: BASE_USDC,
                fromBlock: `0x${from.toString(16)}`,
                toBlock: `0x${to.toString(16)}`,
                topics: [
                    AUTHORIZATION_USED_TOPIC,
                    `0x${input.authorizer.slice(2).toLowerCase().padStart(64, "0")}`,
                    rpcHex(input.nonce, 32),
                ],
            }]);
        if (result.kind !== "complete")
            return result;
        if (!Array.isArray(result.value) || result.value.length > MAX_X402_LOGS) {
            throw new ApnError("APN_RPC_PROTOCOL", "RPC AuthorizationUsed logs exceed the fixed bound.");
        }
        const logs = result.value.map((entry) => x402RpcLog(entry));
        for (const log of logs) {
            if (log.address.toLowerCase() !== BASE_USDC.toLowerCase() || log.topics.length !== 3 ||
                log.topics[0] !== AUTHORIZATION_USED_TOPIC ||
                log.topics[1] !== `0x${input.authorizer.slice(2).toLowerCase().padStart(64, "0")}` ||
                log.topics[2] !== input.nonce.toLowerCase() || log.data !== "0x" ||
                BigInt(log.blockNumber) < from || BigInt(log.blockNumber) > to)
                throw new ApnError("APN_RPC_PROTOCOL", "RPC AuthorizationUsed log violates the exact filter.");
        }
        return { kind: "complete", logs };
    }
    async getPendingNonce(address) {
        await this.assertBaseChain();
        return rpcQuantity(await this.call("eth_getTransactionCount", [address, "pending"])).toString();
    }
    async estimateDirectTransfer(input) {
        await this.assertBaseChain();
        if (input.to !== BASE_USDC)
            throw new ApnError("APN_INVALID_INPUT", "Only exact Base USDC is supported.");
        const gas = rpcQuantity(await this.call("eth_estimateGas", [{ from: input.from, to: input.to, data: input.data, value: "0x0" }]));
        const priority = rpcQuantity(await this.call("eth_maxPriorityFeePerGas", []));
        const block = record(await this.call("eth_getBlockByNumber", ["latest", false]), "latest block");
        const baseFee = rpcQuantity(block.baseFeePerGas);
        return { gasLimitAtomic: gas.toString(), maxFeePerGasAtomic: (baseFee * 2n + priority).toString(), maxPriorityFeePerGasAtomic: priority.toString() };
    }
    async submitRawTransaction(rawTransaction) {
        try {
            return rpcHex(await this.call("eth_sendRawTransaction", [rawTransaction]), 32);
        }
        catch {
            throw new ApnError("APN_RPC_AMBIGUOUS", "Transaction submission outcome is ambiguous.");
        }
    }
    async getReceipt(transactionHash) {
        await this.assertBaseChain();
        const raw = await this.call("eth_getTransactionReceipt", [transactionHash]);
        if (raw === null)
            return null;
        const receipt = record(raw, "transaction receipt");
        const status = rpcQuantity(receipt.status);
        if (status !== 0n && status !== 1n)
            throw new ApnError("APN_RPC_PROTOCOL", "RPC receipt status is invalid.");
        if (!Array.isArray(receipt.logs))
            throw new ApnError("APN_RPC_PROTOCOL", "RPC receipt logs are invalid.");
        const logs = receipt.logs.map((entry) => {
            const log = record(entry, "receipt log");
            if (!Array.isArray(log.topics))
                throw new ApnError("APN_RPC_PROTOCOL", "RPC log topics are invalid.");
            return { address: rpcAddress(log.address), topics: log.topics.map((topic) => rpcHex(topic, 32)), data: rpcHex(log.data) };
        });
        return { transactionHash: rpcHex(receipt.transactionHash, 32), status: status === 1n ? "success" : "reverted", blockNumberAtomic: rpcQuantity(receipt.blockNumber).toString(), logs, observedAt: new Date().toISOString(), rpcOrigin: this.rpcOrigin };
    }
    async getLatestConfirmedNonce(address) {
        await this.assertBaseChain();
        return rpcQuantity(await this.call("eth_getTransactionCount", [address, "latest"])).toString();
    }
    async getConfirmedTransactionAtNonce(address, nonceAtomic, startBlockNumberAtomic) {
        await this.assertBaseChain();
        const latestBlock = record(await this.call("eth_getBlockByNumber", ["latest", false]), "latest block");
        const latest = rpcQuantity(latestBlock.number);
        const requestedStart = parseAtomic(startBlockNumberAtomic);
        const boundedStart = latest >= MAX_NONCE_SCAN_BLOCKS - 1n ? latest - (MAX_NONCE_SCAN_BLOCKS - 1n) : 0n;
        const start = requestedStart > boundedStart ? requestedStart : boundedStart;
        for (let blockNumber = latest; blockNumber >= start; blockNumber -= 1n) {
            const tag = `0x${blockNumber.toString(16)}`;
            const block = record(await this.call("eth_getBlockByNumber", [tag, true]), "confirmed block");
            if (!Array.isArray(block.transactions))
                throw new ApnError("APN_RPC_PROTOCOL", "RPC block transactions are invalid.");
            for (const item of block.transactions) {
                const transaction = record(item, "block transaction");
                if (typeof transaction.from === "string" && transaction.from.toLowerCase() === address.toLowerCase() && rpcQuantity(transaction.nonce).toString() === nonceAtomic) {
                    return rpcHex(transaction.hash, 32);
                }
            }
            if (blockNumber === 0n)
                break;
        }
        return null;
    }
    async call(method, params) {
        const id = (++this.sequence).toString();
        const body = JSON.stringify({ jsonrpc: "2.0", id, method, params });
        const addresses = await (this.pinnedAddresses ??= this.resolvePublicAddresses());
        const raw = await postJson(this.endpoint, body, addresses);
        let value;
        try {
            value = JSON.parse(raw);
        }
        catch {
            throw new ApnError("APN_RPC_PROTOCOL", "RPC response is not valid JSON.");
        }
        const message = record(value, "JSON-RPC response");
        if (message.jsonrpc !== "2.0" || message.id !== id || !("result" in message) || "error" in message) {
            throw new ApnError("APN_RPC_PROTOCOL", "RPC response violates JSON-RPC identity or result requirements.");
        }
        return message.result;
    }
    async callX402Logs(params) {
        const id = (++this.sequence).toString();
        const body = JSON.stringify({ jsonrpc: "2.0", id, method: "eth_getLogs", params });
        const addresses = await (this.pinnedAddresses ??= this.resolvePublicAddresses());
        const raw = await postJson(this.endpoint, body, addresses);
        let value;
        try {
            value = JSON.parse(raw);
        }
        catch {
            throw new ApnError("APN_RPC_PROTOCOL", "RPC response is not valid JSON.");
        }
        const message = record(value, "JSON-RPC response");
        if (message.jsonrpc !== "2.0" || message.id !== id) {
            throw new ApnError("APN_RPC_PROTOCOL", "RPC response violates JSON-RPC identity requirements.");
        }
        if ("result" in message && !("error" in message))
            return { kind: "complete", value: message.result };
        if (!("error" in message) || "result" in message)
            throw new ApnError("APN_RPC_PROTOCOL", "RPC log response has no exclusive result or error.");
        const error = record(message.error, "JSON-RPC error");
        const availability = classifyX402LogAvailabilityMessage(typeof error.message === "string" ? error.message : "");
        if (availability !== null)
            return { kind: availability };
        throw new ApnError("APN_RPC_PROTOCOL", "RPC log query failed without a recognized availability class.");
    }
    async resolvePublicAddresses() {
        return await resolvePublicAddresses(this.endpoint, "APN_RPC_CONFIG", "RPC endpoint");
    }
}
export function classifyX402LogAvailabilityMessage(message) {
    const text = message.toLowerCase();
    if (/\b(?:rate[ -]limit(?:ed|ing)?|request limit|too many requests)\b/u.test(text))
        return null;
    if (/\b(?:pruned|missing trie|historical state|history unavailable)\b/u.test(text))
        return "pruned";
    const rangeSubject = /\b(?:block(?:s)?|range|logs?|results?|query|window)\b/u.test(text);
    const boundedFailure = /\b(?:too (?:wide|large)|too many results?|exceed(?:s|ed|ing)?|maximum|max|limit(?:ed)?|more than|returned more|at most)\b/u.test(text);
    return rangeSubject && boundedFailure ? "range_unavailable" : null;
}
async function postJson(endpoint, body, addresses) {
    return await new Promise((resolve, reject) => {
        const selected = addresses[0];
        if (selected === undefined) {
            reject(new ApnError("APN_RPC_CONFIG", "RPC host has no validated address."));
            return;
        }
        const request = httpsRequest(endpoint, {
            method: "POST",
            family: selected.family,
            headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body).toString() },
            lookup: (_hostname, _options, callback) => callback(null, selected.address, selected.family),
        }, (response) => {
            if ((response.statusCode ?? 0) >= 300 && (response.statusCode ?? 0) < 400) {
                response.resume();
                reject(new ApnError("APN_RPC_PROTOCOL", "RPC redirects are forbidden."));
                return;
            }
            if (response.statusCode !== 200) {
                response.resume();
                reject(new ApnError("APN_RPC_PROTOCOL", "RPC returned an unsuccessful HTTP status."));
                return;
            }
            const declared = Number(response.headers["content-length"] ?? "0");
            if (Number.isFinite(declared) && declared > MAX_RPC_RESPONSE_BYTES) {
                response.destroy();
                reject(new ApnError("APN_RPC_PROTOCOL", "RPC response exceeds the size limit."));
                return;
            }
            const chunks = [];
            let total = 0;
            response.on("data", (chunk) => {
                total += chunk.length;
                if (total > MAX_RPC_RESPONSE_BYTES) {
                    response.destroy();
                    reject(new ApnError("APN_RPC_PROTOCOL", "RPC response exceeds the size limit."));
                    return;
                }
                chunks.push(chunk);
            });
            response.on("end", () => resolve(Buffer.concat(chunks, total).toString("utf8")));
            response.on("error", () => reject(new ApnError("APN_RPC_AMBIGUOUS", "RPC response failed safely.")));
        });
        request.setTimeout(20_000, () => request.destroy(new ApnError("APN_RPC_AMBIGUOUS", "RPC request timed out.")));
        request.on("error", (error) => reject(error instanceof ApnError ? error : new ApnError("APN_RPC_AMBIGUOUS", "RPC transport failed safely.")));
        request.end(body);
    });
}
export { isPublicIp } from "./network-policy.js";
function record(value, label) {
    if (value === null || typeof value !== "object" || Array.isArray(value))
        throw new ApnError("APN_RPC_PROTOCOL", `RPC ${label} is invalid.`);
    return value;
}
function rpcQuantity(value) {
    if (typeof value !== "string" || !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(value))
        throw new ApnError("APN_RPC_PROTOCOL", "RPC quantity is not canonical hexadecimal.");
    return BigInt(value);
}
function rpcHex(value, byteLength) {
    if (typeof value !== "string" || !/^0x(?:[0-9a-fA-F]{2})*$/.test(value))
        throw new ApnError("APN_RPC_PROTOCOL", "RPC hex data is invalid.");
    if (byteLength !== undefined && value.length !== 2 + byteLength * 2)
        throw new ApnError("APN_RPC_PROTOCOL", "RPC hex data has the wrong length.");
    return value.toLowerCase();
}
function rpcAddress(value) {
    if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value))
        throw new ApnError("APN_RPC_PROTOCOL", "RPC address is invalid.");
    return value;
}
function nonzeroBytes32(value, label) {
    const parsed = rpcHex(value, 32);
    if (/^0x0{64}$/u.test(parsed))
        throw new ApnError("APN_RPC_PROTOCOL", `RPC ${label} is zero.`);
    return parsed;
}
function x402RpcLog(value) {
    const log = record(value, "x402 log");
    if (!Array.isArray(log.topics) || log.topics.length > MAX_X402_TOPICS) {
        throw new ApnError("APN_RPC_PROTOCOL", "RPC log topics exceed the fixed bound.");
    }
    const data = rpcHex(log.data);
    if ((data.length - 2) / 2 > MAX_X402_LOG_DATA_BYTES) {
        throw new ApnError("APN_RPC_PROTOCOL", "RPC log data exceeds the fixed bound.");
    }
    return {
        address: rpcAddress(log.address).toLowerCase(),
        topics: log.topics.map((topic) => rpcHex(topic, 32)),
        data,
        blockNumber: rpcQuantity(log.blockNumber).toString(),
        blockHash: nonzeroBytes32(log.blockHash, "log block hash"),
        transactionHash: nonzeroBytes32(log.transactionHash, "log transaction hash"),
        logIndex: rpcQuantity(log.logIndex).toString(),
    };
}
function rpcString(value, label) {
    const encoded = rpcHex(value);
    try {
        const [decoded] = decodeAbiParameters([{ type: "string" }], encoded);
        if (decoded.length === 0 || Buffer.byteLength(decoded, "utf8") > 128)
            throw new Error("bounded string");
        return decoded;
    }
    catch {
        throw new ApnError("APN_RPC_PROTOCOL", `RPC ${label} is invalid.`);
    }
}
function rpcUint256Data(value, label) {
    try {
        return BigInt(rpcHex(value, 32)).toString();
    }
    catch {
        throw new ApnError("APN_RPC_PROTOCOL", `RPC ${label} is invalid.`);
    }
}
//# sourceMappingURL=rpc.js.map