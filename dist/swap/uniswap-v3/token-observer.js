import { encodeFunctionData, parseAbi } from "viem";
import { ApnError } from "../../errors.js";
import { evmRpcAddress, evmRpcBlock, evmRpcHex, evmRpcQuantity, evmRpcRecord, evmTokenBalance, recheckEvmBlock } from "../../evm-rpc-codec.js";
import { envelopeOf } from "./token-custody.js";
const ERC20 = parseAbi(["function allowance(address owner,address spender) view returns (uint256)"]);
export class UniswapTokenObserver {
    call;
    constructor(call) {
        this.call = call;
    }
    async observe(op, kind, transactionHash) {
        if (evmRpcQuantity(await this.call("eth_chainId", [])) !== 1n)
            throw new ApnError("APN_CHAIN_MISMATCH", "Uniswap token observer requires Ethereum chain 1.");
        const [rawTx, rawReceipt] = await Promise.all([this.call("eth_getTransactionByHash", [transactionHash]), this.call("eth_getTransactionReceipt", [transactionHash])]);
        if (rawTx === null && rawReceipt === null)
            return null;
        if (rawTx === null || rawReceipt === null) {
            if (rawReceipt === null)
                return null;
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
        const block = await evmRpcBlock(this.call, `0x${blockNumber.toString(16)}`), safe = await evmRpcBlock(this.call, "safe");
        if (block.hash !== blockHash)
            blocked("Receipt block is no longer canonical.", "uniswap_token_reorg_conflict");
        if (BigInt(safe.number) < blockNumber)
            return null;
        await recheckEvmBlock(this.call, block);
        await recheckEvmBlock(this.call, safe);
        const status = evmRpcQuantity(receipt.status), gasUsed = evmRpcQuantity(receipt.gasUsed), effectivePrice = evmRpcQuantity(receipt.effectiveGasPrice), cap = kind === "approval" ? op.approvalGas : kind === "swap" ? op.swapGas : op.cleanupGas;
        if (gasUsed > BigInt(cap.gasLimit) || effectivePrice > BigInt(cap.maxFeePerGas))
            blocked("Actual network fee exceeds its effect cap.", "uniswap_token_gas_cap");
        const tag = block.tag, allowance = await allowanceAt(this.call, op, tag), gasDebitWei = (gasUsed * effectivePrice).toString();
        await recheckEvmBlock(this.call, block);
        await recheckEvmBlock(this.call, safe);
        if (status === 0n)
            return { status: "reverted", transactionHash: hash, gasDebitWei, allowanceAtomic: allowance.toString() };
        if (status !== 1n)
            blocked("Receipt status is invalid.", "uniswap_token_receipt_conflict");
        if (kind !== "swap")
            return { status: "success", transactionHash: hash, gasDebitWei, allowanceAtomic: allowance.toString() };
        const before = `0x${(blockNumber - 1n).toString(16)}`;
        const [inputBefore, inputAfter, outputBefore, outputAfter] = await Promise.all([
            evmTokenBalance(this.call, op.route.inputToken, op.account, before), evmTokenBalance(this.call, op.route.inputToken, op.account, tag),
            evmTokenBalance(this.call, op.route.outputToken, op.route.recipient, before), evmTokenBalance(this.call, op.route.outputToken, op.route.recipient, tag),
        ]);
        await recheckEvmBlock(this.call, block);
        await recheckEvmBlock(this.call, safe);
        if (inputAfter > inputBefore || outputAfter < outputBefore)
            blocked("Token balance evidence is inconsistent.", "uniswap_token_balance_conflict");
        return { status: "success", transactionHash: hash, gasDebitWei, allowanceAtomic: allowance.toString(),
            inputDebitAtomic: (inputBefore - inputAfter).toString(), outputCreditAtomic: (outputAfter - outputBefore).toString() };
    }
}
async function allowanceAt(call, op, tag) {
    const data = encodeFunctionData({ abi: ERC20, functionName: "allowance", args: [op.account, op.route.router] });
    return BigInt(evmRpcHex(await call("eth_call", [{ to: op.route.inputToken, data }, tag]), 32));
}
function assertEnvelope(tx, envelope) {
    if (evmRpcQuantity(tx.chainId) !== 1n || evmRpcAddress(tx.from) !== envelope.from || evmRpcAddress(tx.to) !== envelope.to ||
        evmRpcHex(tx.input) !== envelope.data.toLowerCase() || evmRpcQuantity(tx.value) !== 0n || evmRpcQuantity(tx.nonce).toString() !== envelope.nonce ||
        evmRpcQuantity(tx.gas).toString() !== envelope.gasLimit || evmRpcQuantity(tx.maxFeePerGas).toString() !== envelope.maxFeePerGas ||
        evmRpcQuantity(tx.maxPriorityFeePerGas).toString() !== envelope.maxPriorityFeePerGas || evmRpcQuantity(tx.type) !== 2n) {
        blocked("Mined transaction conflicts with the signed envelope.", "uniswap_token_transaction_conflict");
    }
}
function corrupt(message) { throw new ApnError("APN_STATE_CORRUPT", message); }
function blocked(message, reason) { throw new ApnError("APN_OPERATION_BLOCKED", message, { reason }); }
//# sourceMappingURL=token-observer.js.map