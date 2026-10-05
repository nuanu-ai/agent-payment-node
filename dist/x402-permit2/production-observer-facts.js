import { encodeFunctionData, keccak256, parseAbi } from "viem";
import { ApnError } from "../errors.js";
import { evmRpcBlockResult, evmRpcHex, evmRpcQuantity, evmRpcRecord, evmRpcWord } from "../evm-rpc-codec.js";
import { reconstructPermit2ProductionMaterial } from "./production-material.js";
import { PERMIT2_ADDRESS, PERMIT2_CODE_HASH, X402_EXACT_PERMIT2_PROXY } from "./registry.js";
const TOKEN = parseAbi(["function DOMAIN_SEPARATOR() view returns (bytes32)", "function nonces(address owner) view returns (uint256)"]);
const PERMIT2 = parseAbi(["function nonceBitmap(address owner,uint256 wordPos) view returns (uint256)"]);
export function observerBlock(value, tag) {
    const block = evmRpcBlockResult(value, tag), timestamp = evmRpcQuantity(block.raw.timestamp);
    return Object.freeze({ tag: block.tag, number: block.number, hash: block.hash, timestamp });
}
export function assertObserverChain(value) { if (evmRpcQuantity(value) !== 43114n)
    mismatch(); }
export function observerIdentityCalls(material, block) {
    const p = reconstructPermit2ProductionMaterial(material), pinned = { blockHash: block.hash, requireCanonical: true };
    return [{ method: "eth_getCode", params: [X402_EXACT_PERMIT2_PROXY, pinned] },
        { method: "eth_getCode", params: [PERMIT2_ADDRESS, pinned] },
        { method: "eth_call", params: [{ to: p.token, data: encodeFunctionData({ abi: TOKEN, functionName: "DOMAIN_SEPARATOR" }) }, pinned] }];
}
export function assertObserverIdentity(material, values) {
    const p = reconstructPermit2ProductionMaterial(material);
    if (values.length !== 3 || keccak256(evmRpcHex(values[0])) !== p.plan.selection.listAsset.proxyCodeHash ||
        keccak256(evmRpcHex(values[1])) !== PERMIT2_CODE_HASH ||
        evmRpcHex(values[2], 32) !== p.plan.selection.listAsset.tokenDomainSeparator)
        mismatch();
}
export function observerNonceCalls(material, block) {
    const p = reconstructPermit2ProductionMaterial(material), pinned = { blockHash: block.hash, requireCanonical: true };
    return [{ method: "eth_call", params: [{ to: PERMIT2_ADDRESS, data: encodeFunctionData({ abi: PERMIT2,
                        functionName: "nonceBitmap", args: [p.payer, BigInt(material.nonce) >> 8n] }) }, pinned] },
        ...(p.plan.eip2612 === null ? [] : [{ method: "eth_call", params: [{ to: p.token,
                        data: encodeFunctionData({ abi: TOKEN, functionName: "nonces", args: [p.payer] }) }, pinned] }])];
}
export function assertExpiredUnused(material, block, values) {
    const p = reconstructPermit2ProductionMaterial(material), permit = p.plan.eip2612;
    if (block.timestamp <= BigInt(p.plan.authorization.deadline) || permit !== null && block.timestamp <= BigInt(permit.info.deadline) ||
        values.length !== (permit === null ? 1 : 2) || ((evmRpcWord(values[0]) >> (BigInt(material.nonce) & 255n)) & 1n) !== 0n ||
        permit !== null && evmRpcWord(values[1]) !== BigInt(permit.info.nonce))
        mismatch();
}
/** Select the complete required raw RPC projection, preserving identity and indices before pure attribution. */
export function observerTransaction(value, locator) {
    const tx = evmRpcRecord(value);
    if (tx.hash !== locator || !/^0x[0-9a-fA-F]{40}$/u.test(String(tx.from)) || /^0x0{40}$/u.test(String(tx.from)))
        mismatch();
    evmRpcQuantity(tx.transactionIndex);
    return { chainId: tx.chainId, to: tx.to, value: tx.value,
        input: tx.input, hash: tx.hash,
        blockHash: tx.blockHash, blockNumber: tx.blockNumber };
}
export function observerReceipt(value, transaction) {
    const receipt = evmRpcRecord(value), tx = evmRpcRecord(transaction);
    if (!Array.isArray(receipt.logs) || receipt.logs.length > 4096 || receipt.transactionIndex !== tx.transactionIndex)
        mismatch();
    return { transactionHash: receipt.transactionHash,
        blockHash: receipt.blockHash, blockNumber: receipt.blockNumber,
        status: receipt.status, logs: receipt.logs.map(value => {
            const log = evmRpcRecord(value);
            if (log.transactionIndex !== tx.transactionIndex)
                mismatch();
            return { address: log.address, topics: log.topics,
                data: log.data, logIndex: log.logIndex,
                transactionHash: log.transactionHash, blockHash: log.blockHash,
                blockNumber: log.blockNumber, removed: log.removed };
        }) };
}
function mismatch() { throw new ApnError("APN_X402_SETTLEMENT_INVALID", "Permit2 canonical observation is unavailable or inconsistent."); }
//# sourceMappingURL=production-observer-facts.js.map