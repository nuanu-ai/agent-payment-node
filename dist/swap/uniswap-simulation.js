import { canonicalJson, domainHash } from "../canonical.js";
import { ApnError } from "../errors.js";
import { evmRpcBlock, evmRpcHex, evmRpcQuantity } from "../evm-rpc-codec.js";
import { UNISWAP_ROUTER } from "./uniswap-pin.js";
export class UniswapEvmSimulator {
    call;
    maxHeadDrift;
    constructor(call, maxHeadDrift = 64) {
        this.call = call;
        this.maxHeadDrift = maxHeadDrift;
        if (!Number.isSafeInteger(maxHeadDrift) || maxHeadDrift < 0 || maxHeadDrift > 256)
            throw new ApnError("APN_RPC_CONFIG", "Uniswap head drift bound is invalid.");
    }
    async simulate(envelope) {
        if (evmRpcQuantity(await this.call("eth_chainId", [])) !== 1n)
            throw new ApnError("APN_CHAIN_MISMATCH", "Uniswap requires exact Ethereum chain 1 RPC.");
        const block = await evmRpcBlock(this.call, "safe"), tx = { from: envelope.from, to: UNISWAP_ROUTER, data: envelope.data,
            value: `0x${BigInt(envelope.value).toString(16)}` };
        const request = { chainId: 1, blockNumber: block.number, blockHash: block.hash, transaction: tx };
        let callResult, gas;
        try {
            callResult = evmRpcHex(await this.call("eth_call", [tx, block.tag]));
            gas = evmRpcQuantity(await this.call("eth_estimateGas", [tx, block.tag]));
        }
        catch {
            throw new ApnError("APN_OPERATION_BLOCKED", "Exact Uniswap simulation reverted or was unavailable.", { reason: "uniswap_simulation" });
        }
        const rechecked = await evmRpcBlock(this.call, block.tag);
        if (rechecked.hash !== block.hash)
            throw new ApnError("APN_OPERATION_BLOCKED", "Simulation block changed during proof.", { reason: "uniswap_block_changed" });
        const head = await evmRpcBlock(this.call, "latest"), drift = BigInt(head.number) - BigInt(block.number);
        if (drift < 0n || drift > BigInt(this.maxHeadDrift))
            throw new ApnError("APN_OPERATION_BLOCKED", "Simulation reference is outside the allowed head drift.", { reason: "uniswap_head_drift" });
        if (evmRpcQuantity(await this.call("eth_chainId", [])) !== 1n)
            throw new ApnError("APN_CHAIN_MISMATCH", "Ethereum RPC chain changed during simulation.");
        const result = { callResult, gasEstimate: gas.toString(), blockNumber: block.number, blockHash: block.hash, headBlockNumber: head.number };
        return { requestHash: domainHash("apn.uniswap-simulation-request.v1", canonicalJson(request)),
            resultHash: domainHash("apn.uniswap-simulation-result.v1", canonicalJson(result)), success: true, blockNumber: block.number,
            blockHash: block.hash, headBlockNumber: head.number, maxHeadDrift: this.maxHeadDrift, gasEstimate: gas.toString() };
    }
}
//# sourceMappingURL=uniswap-simulation.js.map