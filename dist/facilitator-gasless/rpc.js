import { canonicalJson, exactKeys, sha256 } from "../canonical.js";
import { GaslessHttps } from "../gasless/https.js";
import { addressWord, parseReceiptLogs, quantity, rpcBlock, rpcHex, rpcJson, rpcQuantity, rpcRecord, rpcWord, receiptHash, recheckBlock } from "../gasless/rpc-codec.js";
import { parsePublicHttpsUrl } from "../network-policy.js";
import { facilitatorFail } from "./failure.js";
import { AVALANCHE_FACILITATOR as R } from "./registry.js";
const METHODS = new Set(["eth_chainId", "eth_getBlockByNumber", "eth_call", "eth_getTransactionReceipt", "eth_getLogs"]);
const MAX_RESPONSE = 4 * 1024 * 1024;
const LOG_WINDOW = 2048n;
export function avalancheFacilitatorRpc(environment, transport) {
    const rpcUrl = environment[R.rpcEnv];
    if (rpcUrl === undefined || rpcUrl.length === 0)
        facilitatorFail("facilitator_gasless_rpc_binding");
    return new AvalancheFacilitatorRpc(rpcUrl, transport);
}
export class AvalancheFacilitatorRpc {
    transport;
    rpcOrigin;
    rpcEndpointHash;
    endpoint;
    sequence = 0n;
    call = async (method, params) => await this.request(method, params);
    constructor(rpcUrl, transport = new GaslessHttps()) {
        this.transport = transport;
        const endpoint = rpcEndpoint(rpcUrl);
        this.endpoint = endpoint.toString();
        this.rpcOrigin = endpoint.origin;
        this.rpcEndpointHash = sha256(this.endpoint);
    }
    async assertChain() {
        if (rpcQuantity(await this.call("eth_chainId", [])) !== BigInt(R.chainId))
            facilitatorFail("facilitator_gasless_rpc_binding");
    }
    async finalized() { return (await rpcBlock(this.call, R.finalityTag)).block; }
    async usdcBalance(owner, block) {
        const data = `0x70a08231${addressWord(owner).slice(2)}`;
        return rpcWord(await this.call("eth_call", [{ to: R.token, data }, quantity(BigInt(block.numberAtomic))]));
    }
    async authorizationUsed(owner, nonce, block) {
        const data = `${R.authorizationStateSelector}${addressWord(owner).slice(2)}${nonce.slice(2)}`;
        return rpcWord(await this.call("eth_call", [{ to: R.token, data }, quantity(BigInt(block.numberAtomic))])) !== 0n;
    }
    async findAuthorizationLog(owner, nonce, from, to, validBefore) {
        const hashes = new Set(), last = BigInt(to.numberAtomic);
        for (let start = BigInt(from.numberAtomic); start <= last; start += LOG_WINDOW) {
            const end = start + LOG_WINDOW - 1n < last ? start + LOG_WINDOW - 1n : last;
            const logs = await this.call("eth_getLogs", [{ address: R.token, fromBlock: quantity(start), toBlock: quantity(end),
                    topics: [R.authorizationUsedTopic, addressWord(owner), nonce] }]);
            if (!Array.isArray(logs))
                facilitatorFail("facilitator_gasless_evidence");
            for (const item of logs) {
                const log = rpcRecord(item);
                if (log.removed !== false)
                    facilitatorFail("facilitator_gasless_evidence");
                hashes.add(rpcHex(log.transactionHash, 32, 32));
            }
            // EIP-3009 refuses an authorization at or after validBefore, so no later block can use it.
            if (end < last && BigInt((await rpcBlock(this.call, quantity(end))).block.timestampAtomic) >= validBefore)
                break;
        }
        return hashes.size === 0 ? null : hashes.size === 1 ? [...hashes][0] : "ambiguous";
    }
    async settledTransfer(query) {
        const found = await this.call("eth_getTransactionReceipt", [query.transactionHash]);
        if (found === null)
            return null;
        const receipt = rpcRecord(found), status = rpcQuantity(receipt.status);
        if (rpcHex(receipt.transactionHash, 32, 32) !== query.transactionHash)
            facilitatorFail("facilitator_gasless_evidence");
        if (status !== 1n)
            return null;
        const included = await rpcBlock(this.call, quantity(rpcQuantity(receipt.blockNumber)));
        if (included.block.hash !== rpcHex(receipt.blockHash, 32, 32))
            facilitatorFail("facilitator_gasless_evidence");
        const finalized = await this.finalized();
        if (BigInt(included.block.numberAtomic) > BigInt(finalized.numberAtomic))
            return null;
        const logs = parseReceiptLogs(receipt.logs, query.transactionHash, included.block, rpcQuantity(receipt.transactionIndex));
        const fromToken = logs.filter(log => log.address.toLowerCase() === R.token);
        const used = fromToken.filter(log => log.topics[0] === R.authorizationUsedTopic && log.topics[1] === addressWord(query.owner) &&
            log.topics[2] === query.nonce);
        const transfers = fromToken.filter(log => log.topics[0] === R.transferTopic && log.topics[1] === addressWord(query.owner));
        if (used.length !== 1 || transfers.length !== 1 || transfers[0].topics[2] !== addressWord(query.recipient) ||
            rpcWord(transfers[0].data) !== BigInt(query.amountAtomic))
            facilitatorFail("facilitator_gasless_evidence");
        // The used-nonce mapping is permanent, so the finalized block proves it without historical state.
        if (!await this.authorizationUsed(query.owner, query.nonce, finalized))
            facilitatorFail("facilitator_gasless_evidence");
        await recheckBlock(this.call, included.block);
        return { transactionHash: query.transactionHash, block: included.block, finalized,
            receiptHash: receiptHash(R.chainId, query.transactionHash, included.block, status, logs), deliveredAtomic: query.amountAtomic };
    }
    async request(method, params) {
        if (!METHODS.has(method))
            facilitatorFail("facilitator_gasless_evidence");
        const id = (++this.sequence).toString(), body = canonicalJson({ jsonrpc: "2.0", id, method, params });
        let response;
        try {
            response = await this.transport.request(this.endpoint, "POST", body, MAX_RESPONSE, "APN_RPC_CONFIG");
        }
        catch {
            return facilitatorFail("facilitator_gasless_rpc_unavailable");
        }
        if (response.status !== 200)
            facilitatorFail("facilitator_gasless_rpc_unavailable");
        const record = rpcRecord(rpcJson(response.body, MAX_RESPONSE));
        const result = Object.hasOwn(record, "result"), error = Object.hasOwn(record, "error");
        if (record.jsonrpc !== "2.0" || record.id !== id || result === error || !exactKeys(record, result ? ["jsonrpc", "id", "result"] : ["jsonrpc", "id", "error"])) {
            facilitatorFail("facilitator_gasless_evidence");
        }
        if (error)
            facilitatorFail("facilitator_gasless_rpc_unavailable");
        return record.result;
    }
}
function rpcEndpoint(value) {
    try {
        return parsePublicHttpsUrl(value, "APN_RPC_CONFIG", "Avalanche RPC endpoint", 2048);
    }
    catch {
        return facilitatorFail("facilitator_gasless_rpc_binding");
    }
}
//# sourceMappingURL=rpc.js.map