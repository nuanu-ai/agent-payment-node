import { evmRpcAddress, evmRpcBlockResult, evmRpcHex, evmRpcQuantity, evmRpcRecord } from "../evm-rpc-codec.js";
import { ApnError } from "../errors.js";
import { HttpsBaseRpc } from "../rpc.js";
const same = (a, b) => a.toLowerCase() === b.toLowerCase();
function block(value, tag) {
    if (value === null)
        return null;
    const parsed = evmRpcBlockResult(value, tag);
    return { number: BigInt(parsed.number), hash: parsed.hash };
}
function optionalAddress(value) {
    return value === null ? null : evmRpcAddress(value);
}
function status(value) {
    const code = evmRpcQuantity(value);
    if (code !== 0n && code !== 1n)
        throw new ApnError("APN_RPC_PROTOCOL", "Relay receipt status is invalid.");
    return code === 1n ? "success" : "reverted";
}
export class RelayEthereumFinalityRpc {
    rpc;
    lastStart = 0;
    pending = Promise.resolve();
    constructor(url, rpc) { this.rpc = rpc ?? new HttpsBaseRpc(url); }
    async read(calls) {
        const task = this.pending.then(async () => {
            const wait = Math.max(0, this.lastStart + 500 - Date.now());
            if (wait > 0)
                await new Promise(resolve => setTimeout(resolve, wait));
            this.lastStart = Date.now();
            // One batch is one physical POST. HTTP 429 fails without a retry.
            return this.rpc.batchCall(calls);
        });
        this.pending = task.catch(() => undefined);
        return task;
    }
    async finalizedDeposit(hash) {
        const [chain, rawTx, rawReceipt] = await this.read([
            { method: "eth_chainId", params: [] },
            { method: "eth_getTransactionByHash", params: [hash] },
            { method: "eth_getTransactionReceipt", params: [hash] },
        ]);
        if (evmRpcQuantity(chain) !== 1n)
            throw new ApnError("APN_CHAIN_MISMATCH", "Relay source RPC is not Ethereum.");
        if (rawTx === null || rawReceipt === null)
            return null;
        const tx = evmRpcRecord(rawTx), receipt = evmRpcRecord(rawReceipt);
        const number = evmRpcQuantity(receipt.blockNumber);
        const inclusion = `0x${number.toString(16)}`;
        const [rawBlock, rawFinalized] = await this.read([
            { method: "eth_getBlockByNumber", params: [inclusion, false] },
            { method: "eth_getBlockByNumber", params: ["finalized", false] },
        ]);
        if (rawBlock === null || rawFinalized === null)
            return null;
        const included = evmRpcBlockResult(rawBlock, inclusion), finalized = evmRpcBlockResult(rawFinalized, "finalized");
        if (BigInt(finalized.number) < number)
            return null;
        const [rawIncludedAgain, rawFinalizedAgain] = await this.read([
            { method: "eth_getBlockByNumber", params: [included.tag, false] },
            { method: "eth_getBlockByNumber", params: [finalized.tag, false] },
        ]);
        if (rawIncludedAgain === null || rawFinalizedAgain === null ||
            !same(evmRpcBlockResult(rawIncludedAgain, included.tag).hash, included.hash) ||
            !same(evmRpcBlockResult(rawFinalizedAgain, finalized.tag).hash, finalized.hash))
            return null;
        if (!same(evmRpcHex(tx.blockHash, 32), included.hash) ||
            !same(evmRpcHex(receipt.blockHash, 32), included.hash) ||
            evmRpcQuantity(tx.blockNumber) !== number || evmRpcQuantity(tx.chainId) !== 1n)
            return null;
        return { transaction: { hash: evmRpcHex(tx.hash, 32), from: evmRpcAddress(tx.from),
                to: optionalAddress(tx.to), input: evmRpcHex(tx.input), value: evmRpcQuantity(tx.value), chainId: 1 },
            receipt: { transactionHash: evmRpcHex(receipt.transactionHash, 32), status: status(receipt.status),
                blockNumber: number, blockHash: evmRpcHex(receipt.blockHash, 32) }, canonicalBlockHash: included.hash };
    }
}
export class RelayBnbReadOnlyRpc {
    rpc;
    posts = 0;
    lastStart = 0;
    pending = Promise.resolve();
    constructor(url, rpc) { this.rpc = rpc ?? new HttpsBaseRpc(url); }
    get physicalPosts() { return this.posts; }
    async read(method, params) {
        const task = this.pending.then(async () => this.readSerial(method, params));
        this.pending = task.catch(() => undefined);
        return task;
    }
    async readSerial(method, params) {
        if (this.posts >= 8)
            throw new ApnError("APN_RPC_BUDGET_EXCEEDED", "Relay observe exhausted eight BNB RPC POSTs.");
        const wait = Math.max(0, this.lastStart + 500 - Date.now());
        if (wait > 0)
            await new Promise(resolve => setTimeout(resolve, wait));
        this.lastStart = Date.now();
        this.posts++;
        // HttpsBaseRpc issues one POST with no retry. HTTP 429 fails this invocation.
        const [value] = await this.rpc.batchCall([{ method, params }]);
        return value;
    }
    async chainId() { return Number(evmRpcQuantity(await this.read("eth_chainId", []))); }
    async transaction(hash) {
        const value = await this.read("eth_getTransactionByHash", [hash]);
        if (value === null)
            return null;
        const tx = evmRpcRecord(value);
        return { hash: evmRpcHex(tx.hash, 32), chainId: Number(evmRpcQuantity(tx.chainId)),
            to: optionalAddress(tx.to), valueWei: evmRpcQuantity(tx.value),
            blockNumber: tx.blockNumber === null ? null : evmRpcQuantity(tx.blockNumber),
            blockHash: tx.blockHash === null ? null : evmRpcHex(tx.blockHash, 32) };
    }
    async receipt(hash) {
        const value = await this.read("eth_getTransactionReceipt", [hash]);
        if (value === null)
            return null;
        const receipt = evmRpcRecord(value);
        return { transactionHash: evmRpcHex(receipt.transactionHash, 32), status: status(receipt.status),
            blockNumber: evmRpcQuantity(receipt.blockNumber), blockHash: evmRpcHex(receipt.blockHash, 32) };
    }
    async block(number) {
        const tag = `0x${number.toString(16)}`;
        return block(await this.read("eth_getBlockByNumber", [tag, false]), tag);
    }
    async finalityCheckpoint() {
        return block(await this.read("eth_getBlockByNumber", ["safe", false]), "safe");
    }
    async nativeTrace() { return null; }
}
//# sourceMappingURL=observe-rpc.js.map