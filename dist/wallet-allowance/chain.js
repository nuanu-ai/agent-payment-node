import { encodeFunctionData, keccak256, parseAbi, parseTransaction, recoverTransactionAddress } from "viem";
import { ApnError } from "../errors.js";
import { checkNeverLands } from "../evm-finalized-proof.js";
import { evmRpcHex, evmRpcQuantity, evmRpcRecord } from "../evm-rpc-codec.js";
const APPROVAL_TOPIC = "0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925";
const ERC20 = parseAbi(["function approve(address spender, uint256 amount) returns (bool)"]);
const word = (value) => value.slice(2).toLowerCase().padStart(64, "0");
const hexQuantity = (value) => `0x${BigInt(value).toString(16)}`;
/** The only call this family ever signs: approve(spender, 0). */
export const revokeData = (spender) => encodeFunctionData({ abi: ERC20, functionName: "approve", args: [spender, 0n] });
const allowanceCall = (owner, token, spender, block) => ({ method: "eth_call", params: [{ to: token, data: `0xdd62ed3e${word(owner)}${word(spender)}` }, block] });
function chain(value, chainId) {
    if (evmRpcQuantity(value) !== BigInt(chainId)) {
        throw new ApnError("APN_CHAIN_MISMATCH", `The RPC does not serve eip155:${chainId}.`, { reason: "wallet_allowance_rpc_chain_mismatch", chain: `eip155:${chainId}` });
    }
}
/** The allowance at one block: the latest header first, then the read pinned to it (EIP-1898). */
export async function readAllowanceAt(rpc, input) {
    const [chainId, latest] = await rpc.batch([{ method: "eth_chainId", params: [] }, { method: "eth_getBlockByNumber", params: ["latest", false] }]);
    chain(chainId, input.chainId);
    const header = evmRpcRecord(latest), blockHash = evmRpcHex(header.hash, 32);
    const [allowance] = await rpc.batch([allowanceCall(input.owner, input.token, input.spender, { blockHash, requireCanonical: true })]);
    return { allowanceAtomic: BigInt(evmRpcHex(allowance, 32)).toString(), blockNumber: evmRpcQuantity(header.number).toString(), blockHash };
}
/**
 * The latest header first, then one batch pinned to it (EIP-1898): the owner's nonce (which must equal the pending one,
 * so no other transaction of this account is in flight), the current allowance, the native balance, the token's code and
 * an estimate of exactly this revoke.
 */
export async function readRevokePrepare(rpc, input) {
    const [chainId, latest] = await rpc.batch([{ method: "eth_chainId", params: [] }, { method: "eth_getBlockByNumber", params: ["latest", false] }]);
    chain(chainId, input.chainId);
    const header = evmRpcRecord(latest), era = { number: evmRpcQuantity(header.number).toString(), hash: evmRpcHex(header.hash, 32) };
    const pinned = { blockHash: era.hash, requireCanonical: true };
    const [nonce, pending, allowance, balance, code, estimate] = await rpc.batch([
        { method: "eth_getTransactionCount", params: [input.owner, pinned] }, { method: "eth_getTransactionCount", params: [input.owner, "pending"] },
        allowanceCall(input.owner, input.token, input.spender, pinned), { method: "eth_getBalance", params: [input.owner, pinned] },
        { method: "eth_getCode", params: [input.token, pinned] },
        { method: "eth_estimateGas", params: [{ from: input.owner, to: input.token, data: revokeData(input.spender), value: "0x0" }] },
    ]);
    if (evmRpcHex(code) === "0x")
        throw new ApnError("APN_OPERATION_BLOCKED", "The token has no contract code on this chain.", { reason: "wallet_allowance_token_code_missing" });
    if (evmRpcQuantity(nonce) !== evmRpcQuantity(pending)) {
        throw new ApnError("APN_OPERATION_BLOCKED", "Another transaction of this wallet is pending on this chain; let it settle first.", { reason: "wallet_allowance_nonce_pending" });
    }
    return { era, baseFeeWei: evmRpcQuantity(header.baseFeePerGas), nonce: evmRpcQuantity(nonce).toString(),
        allowanceAtomic: BigInt(evmRpcHex(allowance, 32)).toString(), nativeBalanceWei: evmRpcQuantity(balance), gasEstimate: evmRpcQuantity(estimate) };
}
/** The sealed bytes must be exactly the frozen approve(spender, 0), signed by the owner. */
export async function verifyRevokeRaw(terms, raw) {
    const tx = parseTransaction(raw), signer = await recoverTransactionAddress({ serializedTransaction: raw });
    if (signer !== terms.owner || tx.type !== "eip1559" || tx.chainId !== terms.chainId || tx.to?.toLowerCase() !== terms.token.toLowerCase() ||
        tx.data !== revokeData(terms.spender) || (tx.value ?? 0n) !== 0n || tx.nonce !== Number(terms.nonce) ||
        tx.gas !== BigInt(terms.gasLimit) || tx.maxFeePerGas !== BigInt(terms.maxFeePerGasWei) ||
        (tx.maxPriorityFeePerGas ?? 0n) !== BigInt(terms.maxPriorityFeePerGasWei) || (tx.accessList ?? []).length !== 0) {
        throw new ApnError("APN_STATE_CORRUPT", "The sealed revoke is not the frozen approve(spender, 0).");
    }
    return keccak256(raw);
}
/**
 * A receipt counts once its block is at or below the chain's proof tag and is that height's canonical block; success needs
 * the token's Approval(owner, spender, 0) log or the allowance read at the tag equal to zero. Without a receipt, the shared
 * never-lands rule decides (finalized nonce past, the node indexing the era block, the transaction unknown).
 */
export async function observeRevoke(rpc, record, now) {
    const t = record.terms, hash = record.signed.transactionHash;
    const [chainId, receiptValue, tagValue] = await rpc.batch([{ method: "eth_chainId", params: [] },
        { method: "eth_getTransactionReceipt", params: [hash] }, { method: "eth_getBlockByNumber", params: [t.proofTag, false] }]);
    chain(chainId, t.chainId);
    if (receiptValue === null) {
        const check = await checkNeverLands({ chainId: t.chainId, account: t.owner, nonce: BigInt(t.nonce), transactionHash: hash,
            before: { hash: t.era.hash, number: BigInt(t.era.number) } }, async (calls) => await rpc.batch(calls));
        return check.neverLands ? { kind: "never_lands", finalizedNonce: check.finalizedNonce.toString() }
            : { kind: "pending", reason: check.transactionKnown ? "transaction_pending" : "receipt_not_found" };
    }
    const receipt = evmRpcRecord(receiptValue), tag = evmRpcRecord(tagValue);
    if (evmRpcHex(receipt.transactionHash, 32) !== hash)
        throw new ApnError("APN_RPC_PROTOCOL", "The receipt names another transaction.");
    const blockNumber = evmRpcQuantity(receipt.blockNumber), blockHash = evmRpcHex(receipt.blockHash, 32);
    if (blockNumber > evmRpcQuantity(tag.number))
        return { kind: "pending", reason: `receipt_above_${t.proofTag}` };
    const [canonical, allowance] = await rpc.batch([{ method: "eth_getBlockByNumber", params: [hexQuantity(blockNumber), false] },
        allowanceCall(t.owner, t.token, t.spender, { blockHash: evmRpcHex(tag.hash, 32), requireCanonical: true })]);
    if (evmRpcHex(evmRpcRecord(canonical).hash, 32) !== blockHash)
        return { kind: "pending", reason: "receipt_block_not_canonical" };
    const status = evmRpcQuantity(receipt.status) === 1n ? "success" : "reverted";
    const logs = Array.isArray(receipt.logs) ? receipt.logs : [];
    const approvalLog = status === "success" && logs.some((value) => {
        const log = evmRpcRecord(value), topics = Array.isArray(log.topics) ? log.topics : [];
        return typeof log.address === "string" && log.address.toLowerCase() === t.token.toLowerCase() && topics.length === 3 &&
            topics[0] === APPROVAL_TOPIC && topics[1] === `0x${word(t.owner)}` && topics[2] === `0x${word(t.spender)}` &&
            typeof log.data === "string" && /^0x0{64}$/u.test(log.data);
    });
    const allowanceAtTag = BigInt(evmRpcHex(allowance, 32)).toString();
    if (status === "success" && !approvalLog && allowanceAtTag !== "0") {
        throw new ApnError("APN_RPC_PROTOCOL", "A successful revoke showed neither its Approval log nor a zero allowance.");
    }
    return { kind: "receipt", outcome: { kind: "receipt", blockNumber: blockNumber.toString(), blockHash, status, approvalLog,
            allowanceAtTagAtomic: allowanceAtTag, tag: t.proofTag, observedAt: now.toISOString() } };
}
//# sourceMappingURL=chain.js.map