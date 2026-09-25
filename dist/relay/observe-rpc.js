import { evmRpcAddress, evmRpcBlockResult, evmRpcHex, evmRpcQuantity, evmRpcRecord } from "../evm-rpc-codec.js";
import { ApnError } from "../errors.js";
import { EvmDirectRpcGuard } from "../evm-direct-rpc-guard.js";
import { HttpsBaseRpc } from "../rpc.js";
const same = (a, b) => a.toLowerCase() === b.toLowerCase();
/** The shared provider lock stays held until 750 ms after a POST settles.
 * This covers the delay between the scheduler's persisted reservation and the
 * transport's actual POST start, including DNS and filesystem latency. */
async function holdProviderAfterPost(post) {
    try {
        return await post();
    }
    finally {
        await new Promise(resolve => setTimeout(resolve, 750));
    }
}
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
    url;
    guardFactory;
    expectedChainId;
    rpc;
    constructor(url, state, rpc, guardFactory = () => new EvmDirectRpcGuard(state, 3), expectedChainId = 1) {
        this.url = url;
        this.guardFactory = guardFactory;
        this.expectedChainId = expectedChainId;
        this.rpc = rpc ?? new HttpsBaseRpc(url);
    }
    async read(guard, calls) {
        // One batch is one POST. The shared provider-family scheduler persists starts
        // across CLI processes and refuses cooldowns/lock contention before transport.
        return guard.post(this.url, () => holdProviderAfterPost(() => this.rpc.batchCall(calls)));
    }
    async finalizedDeposit(hash) {
        const guard = this.guardFactory();
        const [chain, rawTx, rawReceipt] = await this.read(guard, [
            { method: "eth_chainId", params: [] },
            { method: "eth_getTransactionByHash", params: [hash] },
            { method: "eth_getTransactionReceipt", params: [hash] },
        ]);
        if (evmRpcQuantity(chain) !== BigInt(this.expectedChainId))
            throw new ApnError("APN_CHAIN_MISMATCH", "Relay source RPC chain is wrong.");
        if (rawTx === null || rawReceipt === null)
            return null;
        const tx = evmRpcRecord(rawTx), receipt = evmRpcRecord(rawReceipt);
        const number = evmRpcQuantity(receipt.blockNumber);
        const inclusion = `0x${number.toString(16)}`;
        const [rawBlock, rawFinalized] = await this.read(guard, [
            { method: "eth_getBlockByNumber", params: [inclusion, false] },
            { method: "eth_getBlockByNumber", params: [this.expectedChainId === 1 ? "finalized" : "latest", false] },
        ]);
        if (rawBlock === null || rawFinalized === null)
            return null;
        const included = evmRpcBlockResult(rawBlock, inclusion), finalized = evmRpcBlockResult(rawFinalized, this.expectedChainId === 1 ? "finalized" : "latest");
        if (BigInt(finalized.number) < number + (this.expectedChainId === 56 ? 15n : 0n))
            return null;
        const [rawIncludedAgain, rawFinalizedAgain] = await this.read(guard, [
            { method: "eth_getBlockByNumber", params: [included.tag, false] },
            { method: "eth_getBlockByNumber", params: [finalized.tag, false] },
        ]);
        if (rawIncludedAgain === null || rawFinalizedAgain === null ||
            !same(evmRpcBlockResult(rawIncludedAgain, included.tag).hash, included.hash) ||
            !same(evmRpcBlockResult(rawFinalizedAgain, finalized.tag).hash, finalized.hash))
            return null;
        if (!same(evmRpcHex(tx.blockHash, 32), included.hash) ||
            !same(evmRpcHex(receipt.blockHash, 32), included.hash) ||
            evmRpcQuantity(tx.blockNumber) !== number || evmRpcQuantity(tx.chainId) !== BigInt(this.expectedChainId))
            return null;
        return { transaction: { hash: evmRpcHex(tx.hash, 32), from: evmRpcAddress(tx.from),
                to: optionalAddress(tx.to), input: evmRpcHex(tx.input), value: evmRpcQuantity(tx.value), chainId: this.expectedChainId },
            receipt: { transactionHash: evmRpcHex(receipt.transactionHash, 32), status: status(receipt.status),
                blockNumber: number, blockHash: evmRpcHex(receipt.blockHash, 32) }, canonicalBlockHash: included.hash };
    }
}
export class RelayBnbReadOnlyRpc {
    url;
    expectedChainId;
    rpc;
    guard;
    constructor(url, state, rpc, guard = new EvmDirectRpcGuard(state, 8), expectedChainId = 56) {
        this.url = url;
        this.expectedChainId = expectedChainId;
        this.rpc = rpc ?? new HttpsBaseRpc(url);
        this.guard = guard;
    }
    get physicalPosts() { return this.guard.physicalRequests; }
    async read(method, params) {
        const [value] = await this.guard.post(this.url, () => holdProviderAfterPost(() => this.rpc.batchCall([{ method, params }])));
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
        if (this.expectedChainId === 56)
            return block(await this.read("eth_getBlockByNumber", ["safe", false]), "safe");
        // A 15-block canonical checkpoint is used on native Relay destination lanes.
        const latest = block(await this.read("eth_getBlockByNumber", ["latest", false]), "latest");
        if (latest === null || latest.number < 15n)
            return null;
        return this.block(latest.number - 15n);
    }
    async nativeTrace() { return null; }
}
//# sourceMappingURL=observe-rpc.js.map