import { decodeFunctionResult, encodeFunctionData, parseAbi } from "viem";
import { ApnError } from "../../errors.js";
import { evmRpcAddress, evmRpcHex, evmRpcQuantity, evmRpcRecord } from "../../evm-rpc-codec.js";
import { envelopeOf } from "./token-custody.js";
import { tokenLaneOf } from "./token-lane.js";
import { tokenBatch, tokenBlock } from "./token-rpc.js";
const ERC20 = parseAbi(["function allowance(address owner,address spender) view returns (uint256)", "function balanceOf(address owner) view returns (uint256)"]);
export class UniswapTokenObserver {
    call;
    constructor(call) {
        this.call = call;
    }
    async observe(op, kind, transactionHash) {
        const rpc = this.call, lane = tokenLaneOf(op.route);
        const [primary, receiptRows] = await Promise.all([
            tokenBatch(rpc, "primary", [{ method: "eth_chainId", params: [], cachePolicy: "immutable", decoder: lane.chainDecoder },
                { method: "eth_getTransactionByHash", params: [transactionHash], cachePolicy: "none", decoder: transactionDecoder }]),
            tokenBatch(rpc, "receipt", [{ method: "eth_chainId", params: [], cachePolicy: "immutable", decoder: lane.chainDecoder },
                { method: "eth_getTransactionReceipt", params: [transactionHash], cachePolicy: "none", decoder: receiptDecoder }]),
        ]);
        if (evmRpcQuantity(primary[0]) !== BigInt(lane.chainId) || evmRpcQuantity(receiptRows[0]) !== BigInt(lane.chainId)) {
            throw new ApnError("APN_CHAIN_MISMATCH", `Uniswap token observer requires ${lane.chainLabel}.`);
        }
        const rawTx = primary[1], rawReceipt = receiptRows[1];
        // Null means the node knows neither the transaction nor a receipt (the only case an R4 never-lands check reads on);
        // a known transaction that is not yet in a safe block is pending.
        if (rawTx === null && rawReceipt === null)
            return null;
        if (rawTx === null || rawReceipt === null) {
            if (rawReceipt === null)
                return pending(transactionHash);
            blocked("Receipt exists without its transaction.", "uniswap_token_receipt_conflict");
        }
        const tx = evmRpcRecord(rawTx), receipt = evmRpcRecord(rawReceipt), hash = evmRpcHex(transactionHash, 32), attempt = kind === "approval" ? op.approvalAttempt : kind === "swap" ? op.swapAttempt : op.cleanupAttempt;
        if (attempt === null)
            corrupt("Uniswap token observation has no attempt.");
        if (evmRpcHex(tx.hash, 32) !== hash || evmRpcHex(receipt.transactionHash, 32) !== hash)
            blocked("Transaction hash evidence conflicts.", "uniswap_token_transaction_conflict");
        const envelope = envelopeOf(op, kind, attempt.nonce), blockNumber = evmRpcQuantity(receipt.blockNumber), txBlock = evmRpcQuantity(tx.blockNumber), blockHash = evmRpcHex(receipt.blockHash, 32);
        if (blockNumber !== txBlock || evmRpcHex(tx.blockHash, 32) !== blockHash || blockNumber === 0n)
            blocked("Transaction block evidence conflicts.", "uniswap_token_reorg_conflict");
        assertEnvelope(tx, envelope);
        if (evmRpcAddress(receipt.from) !== op.account || evmRpcAddress(receipt.to) !== envelope.to)
            blocked("Receipt sender or target conflicts.", "uniswap_token_receipt_conflict");
        const [rawBlock, rawSafe] = await tokenBatch(rpc, "primary", [
            { method: "eth_getBlockByNumber", params: [`0x${blockNumber.toString(16)}`, false], cachePolicy: "none", decoder: tokenBlock },
            { method: "eth_getBlockByNumber", params: ["safe", false], cachePolicy: "none", decoder: tokenBlock },
        ]), block = decodedBlock(rawBlock), safe = decodedBlock(rawSafe);
        if (block.hash !== blockHash)
            blocked("Receipt block is no longer canonical.", "uniswap_token_reorg_conflict");
        if (BigInt(safe.number) < blockNumber)
            return pending(hash);
        await recheck(rpc, block, safe);
        const status = evmRpcQuantity(receipt.status), gasUsed = evmRpcQuantity(receipt.gasUsed), effectivePrice = evmRpcQuantity(receipt.effectiveGasPrice), cap = kind === "approval" ? op.approvalGas : kind === "swap" ? op.swapGas : op.cleanupGas;
        if (gasUsed > BigInt(cap.gasLimit) || effectivePrice > BigInt(cap.maxFeePerGas))
            blocked("Actual network fee exceeds its effect cap.", "uniswap_token_gas_cap");
        const tag = block.tag, gasDebitWei = (gasUsed * effectivePrice).toString();
        // The effect's own block state; a primary without an archive serves it only while it keeps that block's state.
        const atEffect = async (items) => {
            try {
                return await tokenBatch(rpc, "archive", items);
            }
            catch (error) {
                throw statusStateRefused(error, rpc, lane, op, blockNumber, BigInt(safe.number));
            }
        };
        if (status === 0n || kind !== "swap") {
            const [rawAllowance] = await atEffect([allowanceRequest(op, tag)]), allowance = BigInt(evmRpcHex(rawAllowance, 32));
            await recheck(rpc, block, safe);
            if (status === 0n)
                return { status: "reverted", transactionHash: hash, gasDebitWei, allowanceAtomic: allowance.toString() };
            if (status !== 1n)
                blocked("Receipt status is invalid.", "uniswap_token_receipt_conflict");
            return { status: "success", transactionHash: hash, gasDebitWei, allowanceAtomic: allowance.toString() };
        }
        if (status !== 1n)
            blocked("Receipt status is invalid.", "uniswap_token_receipt_conflict");
        const before = `0x${(blockNumber - 1n).toString(16)}`;
        if (lane.outputAsset(op.route).kind === "native") {
            // A native output has no token balance to read: the router unwrapped exactly what it sent the recipient (its
            // unwrapWETH9 withdraws its whole WBNB balance and transfers that amount, or the transaction reverts), so the credit
            // is the one WBNB Withdrawal the pinned router made in this receipt. The input debit and the allowance are read as
            // for a token output.
            const [allowanceRow, inputBeforeRow, inputAfterRow] = await atEffect([allowanceRequest(op, tag), balanceRequest(op.route.inputToken, op.account, before),
                balanceRequest(op.route.inputToken, op.account, tag)]);
            await recheck(rpc, block, safe);
            const inputBefore = BigInt(evmRpcHex(inputBeforeRow, 32)), inputAfter = BigInt(evmRpcHex(inputAfterRow, 32));
            if (inputAfter > inputBefore)
                blocked("Token balance evidence is inconsistent.", "uniswap_token_balance_conflict");
            return { status: "success", transactionHash: hash, gasDebitWei, allowanceAtomic: BigInt(evmRpcHex(allowanceRow, 32)).toString(),
                inputDebitAtomic: (inputBefore - inputAfter).toString(), outputCreditAtomic: unwrappedNativeCredit(receipt, op.route.outputToken, op.route.router, hash) };
        }
        const [first, second] = await Promise.all([
            atEffect([allowanceRequest(op, tag), balanceRequest(op.route.inputToken, op.account, before), balanceRequest(op.route.inputToken, op.account, tag)]),
            atEffect([balanceRequest(op.route.outputToken, op.route.recipient, before), balanceRequest(op.route.outputToken, op.route.recipient, tag)]),
        ]), allowance = BigInt(evmRpcHex(first[0], 32)), inputBefore = BigInt(evmRpcHex(first[1], 32)), inputAfter = BigInt(evmRpcHex(first[2], 32)), outputBefore = BigInt(evmRpcHex(second[0], 32)), outputAfter = BigInt(evmRpcHex(second[1], 32));
        await recheck(rpc, block, safe);
        if (inputAfter > inputBefore || outputAfter < outputBefore)
            blocked("Token balance evidence is inconsistent.", "uniswap_token_balance_conflict");
        return { status: "success", transactionHash: hash, gasDebitWei, allowanceAtomic: allowance.toString(),
            inputDebitAtomic: (inputBefore - inputAfter).toString(), outputCreditAtomic: (outputAfter - outputBefore).toString() };
    }
}
/** How many recent blocks of state a pruning full node keeps (geth's default; public endpoints serve about as many). */
const PRUNED_STATE_DEPTH = 128n;
/** WETH9's `Withdrawal(address indexed src, uint256 wad)`; WBNB is a WETH9. */
const WITHDRAWAL_TOPIC = "0x7fcf532c15f0a6db0bd6d0e038bea71d30d808c7d98cb3bf7268a95bf5081b65";
/**
 * The native output of an unwrapping swap: exactly one Withdrawal log of the pinned wrapped-native contract in this
 * receipt, by the pinned router, not removed, of this transaction. Any other shape refuses.
 */
function unwrappedNativeCredit(receipt, wrapped, router, hash) {
    if (!Array.isArray(receipt.logs))
        blocked("Receipt logs are missing.", "uniswap_token_receipt_conflict");
    const withdrawals = receipt.logs.map((value) => evmRpcRecord(value)).filter((log) => evmRpcAddress(log.address) === wrapped && Array.isArray(log.topics) && log.topics.length > 0 && evmRpcHex(log.topics[0], 32) === WITHDRAWAL_TOPIC);
    if (withdrawals.length !== 1)
        blocked("The swap's receipt does not hold exactly one unwrap.", "uniswap_token_unwrap_conflict");
    const log = withdrawals[0], topics = log.topics;
    if (topics.length !== 2 || evmRpcHex(topics[1], 32) !== `0x${router.slice(2).toLowerCase().padStart(64, "0")}` || log.removed === true ||
        log.transactionHash !== undefined && evmRpcHex(log.transactionHash, 32) !== hash)
        blocked("The unwrap was not the pinned router's.", "uniswap_token_unwrap_conflict");
    return BigInt(evmRpcHex(log.data, 32)).toString();
}
/**
 * Without the lane's archive setting (APN_ETHEREUM_ARCHIVE_RPC_URL, APN_BNB_ARCHIVE_RPC_URL) the primary serves the reads
 * pinned to the effect's block. When it answers one of them with a JSON-RPC error (not a rate limit, a revert or a
 * transport failure) and the block is provably older than a pruning node keeps (the safe head, at or below the latest
 * head, is more than 128 blocks past it), status names the archive setting and the command to run again. A nearer
 * block's refusal (a load-balanced backend behind, a provider reporting a revert as -32000) and any failure of a
 * configured archive are returned unchanged.
 */
function statusStateRefused(error, rpc, lane, op, block, safeHead) {
    const details = error instanceof ApnError && error.code === "APN_RPC_PROTOCOL" ? error.details : undefined;
    if (rpc.archiveConfigured?.() !== false || details === undefined || details.rpcSubcallId === undefined || details.providerCode === 3 ||
        safeHead - block <= PRUNED_STATE_DEPTH)
        return error;
    return new ApnError("APN_PROVIDER_CAPABILITY_UNAVAILABLE", `Uniswap token status needs the token state at the effect's block ${block}, ` +
        `and the primary RPC refused that read. Without ${lane.archiveEnvironment} the primary serves it, and a pruning node keeps a block's ` +
        "state for about 128 blocks.", { reason: "uniswap_token_status_archive_required", endpointRole: "primary", blockNumber: block.toString(),
        safeBlockNumber: safeHead.toString(),
        ...(typeof details.rpcMethod === "string" ? { rpcMethod: details.rpcMethod } : {}),
        ...(typeof details.providerCode === "number" ? { providerCode: details.providerCode } : {}),
        nextActions: [`Set ${lane.archiveEnvironment} to a public HTTPS ${lane.networkName} archive endpoint, then run status again.`,
            `${lane.commandPrefix} status --operation ${op.operationId}`] });
}
function pending(transactionHash) {
    return { status: "pending", transactionHash: evmRpcHex(transactionHash, 32), gasDebitWei: "0", allowanceAtomic: "0" };
}
function allowanceRequest(op, tag) {
    const data = encodeFunctionData({ abi: ERC20, functionName: "allowance", args: [op.account, op.route.router] });
    return { method: "eth_call", params: [{ to: op.route.inputToken, data }, tag], cachePolicy: "none", decoder: allowanceDecoder };
}
function balanceRequest(token, account, tag) {
    return { method: "eth_call",
        params: [{ to: token, data: `0x70a08231${account.slice(2).toLowerCase().padStart(64, "0")}` }, tag], cachePolicy: "none", decoder: balanceDecoder };
}
function decodedBlock(value) {
    const raw = evmRpcRecord(value), number = evmRpcQuantity(raw.number), hash = evmRpcHex(raw.hash, 32);
    return { tag: `0x${number.toString(16)}`, number: number.toString(), hash };
}
async function recheck(rpc, block, safe) {
    const [a, b] = await tokenBatch(rpc, "primary", [
        { method: "eth_getBlockByNumber", params: [block.tag, false], cachePolicy: "none", decoder: tokenBlock },
        { method: "eth_getBlockByNumber", params: [safe.tag, false], cachePolicy: "none", decoder: tokenBlock },
    ]);
    if (decodedBlock(a).hash !== block.hash || decodedBlock(b).hash !== safe.hash)
        blocked("Receipt block changed during observation.", "uniswap_token_reorg_conflict");
}
function allowanceDecoder(value) { decodeFunctionResult({ abi: ERC20, functionName: "allowance", data: evmRpcHex(value, 32) }); return value; }
function balanceDecoder(value) { decodeFunctionResult({ abi: ERC20, functionName: "balanceOf", data: evmRpcHex(value, 32) }); return value; }
function transactionDecoder(value) {
    if (value === null)
        return value;
    const row = evmRpcRecord(value);
    evmRpcHex(row.hash, 32);
    evmRpcQuantity(row.chainId);
    evmRpcAddress(row.from);
    evmRpcAddress(row.to);
    evmRpcHex(row.input);
    evmRpcQuantity(row.value);
    evmRpcQuantity(row.nonce);
    return value;
}
function receiptDecoder(value) {
    if (value === null)
        return value;
    const row = evmRpcRecord(value);
    evmRpcHex(row.transactionHash, 32);
    evmRpcAddress(row.from);
    evmRpcAddress(row.to);
    evmRpcQuantity(row.blockNumber);
    evmRpcHex(row.blockHash, 32);
    evmRpcQuantity(row.status);
    evmRpcQuantity(row.gasUsed);
    evmRpcQuantity(row.effectiveGasPrice);
    return value;
}
function assertEnvelope(tx, envelope) {
    if (evmRpcQuantity(tx.chainId) !== BigInt(envelope.chainId) || evmRpcAddress(tx.from) !== envelope.from || evmRpcAddress(tx.to) !== envelope.to ||
        evmRpcHex(tx.input) !== envelope.data.toLowerCase() || evmRpcQuantity(tx.value) !== 0n || evmRpcQuantity(tx.nonce).toString() !== envelope.nonce ||
        evmRpcQuantity(tx.gas).toString() !== envelope.gasLimit || evmRpcQuantity(tx.maxFeePerGas).toString() !== envelope.maxFeePerGas ||
        evmRpcQuantity(tx.maxPriorityFeePerGas).toString() !== envelope.maxPriorityFeePerGas || evmRpcQuantity(tx.type) !== 2n) {
        blocked("Mined transaction conflicts with the signed envelope.", "uniswap_token_transaction_conflict");
    }
}
function corrupt(message) { throw new ApnError("APN_STATE_CORRUPT", message); }
function blocked(message, reason) { throw new ApnError("APN_OPERATION_BLOCKED", message, { reason }); }
//# sourceMappingURL=token-observer.js.map