import { ApnError } from "../errors.js";
import { EvmDirectRpcGuard } from "../evm-direct-rpc-guard.js";
import { evmRpcAddress, evmRpcBlockResult, evmRpcHex, evmRpcQuantity, evmRpcRecord } from "../evm-rpc-codec.js";
import { HttpsBaseRpc } from "../rpc.js";
const HASH = /^0x[0-9a-fA-F]{64}$/u;
const same = (left, right) => left.toLowerCase() === right.toLowerCase();
const invalid = (reason) => { throw new ApnError("APN_RPC_PROTOCOL", "Relay Arbitrum source proof is invalid.", { reason }); };
/** One shared 24-POST guard; at most two batches per effect plus one joint final recheck. */
export class RelayArbitrumSourceFinalityObserver {
    url;
    state;
    guardFactory;
    holdAfterPost;
    rpc;
    constructor(url, state, rpc, guardFactory = () => new EvmDirectRpcGuard(state), holdAfterPost = () => new Promise(resolve => setTimeout(resolve, 750))) {
        this.url = url;
        this.state = state;
        this.guardFactory = guardFactory;
        this.holdAfterPost = holdAfterPost;
        this.rpc = rpc ?? new HttpsBaseRpc(url);
    }
    async observe(deposit, approval) {
        validateExpected(deposit);
        if (approval !== undefined)
            validateExpected(approval);
        const guard = this.guardFactory();
        const approved = approval === undefined ? null : await this.effect(approval, guard);
        if (approval !== undefined && approved === null)
            return null;
        const deposited = await this.effect(deposit, guard);
        if (deposited === null)
            return null;
        // Earlier safe observations cannot be combined into a joint proof: the
        // approval or safe head may have reorganized while the deposit was read.
        const finalSafe = await this.confirmTogether(guard, [
            ...(approval === undefined || approved === null ? [] : [{ expected: approval, proof: approved.effect }]),
            { expected: deposit, proof: deposited.effect },
        ]);
        if (finalSafe === null)
            return null;
        return { sourceChainId: 42161, rpcOrigin: new URL(this.url).origin,
            deposit: deposited.effect, approval: approved?.effect ?? null, safeHead: finalSafe,
            proofClass: "canonical_safe_source_receipts", destinationDeliveryProven: false,
            causalLinkCryptographicallyProven: false, paidAcceptance: false };
    }
    async batch(guard, calls) {
        // The guard persists the provider-family start before transport setup. Keep
        // its lock for 750 ms after settlement so slow DNS cannot compress actual POST starts.
        const results = await guard.post(this.url, async () => {
            try {
                return await this.rpc.batchCall(calls);
            }
            finally {
                await this.holdAfterPost();
            }
        });
        if (!Array.isArray(results) || results.length !== calls.length)
            invalid("batch_shape");
        return results;
    }
    async confirmTogether(guard, effects) {
        const calls = [{ method: "eth_chainId", params: [] }];
        for (const { expected, proof } of effects)
            calls.push({ method: "eth_getBlockByNumber", params: [`0x${BigInt(proof.blockNumber).toString(16)}`, false] }, { method: "eth_getTransactionByHash", params: [expected.transactionHash] }, { method: "eth_getTransactionReceipt", params: [expected.transactionHash] });
        calls.push({ method: "eth_getBlockByNumber", params: ["safe", false] });
        const rows = await this.batch(guard, calls);
        if (evmRpcQuantity(rows[0]) !== 42161n)
            throw new ApnError("APN_CHAIN_MISMATCH", "Relay source RPC is not Arbitrum One.");
        if (rows[rows.length - 1] === null)
            return null;
        const safe = evmRpcBlockResult(rows[rows.length - 1], "safe");
        for (const [index, { expected, proof }] of effects.entries()) {
            const offset = 1 + index * 3;
            if (rows[offset] === null || rows[offset + 1] === null || rows[offset + 2] === null)
                return null;
            const tag = `0x${BigInt(proof.blockNumber).toString(16)}`;
            const block = evmRpcBlockResult(rows[offset], tag);
            const tx = evmRpcRecord(rows[offset + 1]), receipt = evmRpcRecord(rows[offset + 2]);
            if (BigInt(safe.number) < BigInt(proof.blockNumber) || !same(block.hash, proof.blockHash) ||
                !same(evmRpcHex(tx.blockHash, 32), proof.blockHash) ||
                !same(evmRpcHex(receipt.blockHash, 32), proof.blockHash) ||
                evmRpcQuantity(tx.blockNumber) !== BigInt(proof.blockNumber) ||
                evmRpcQuantity(receipt.blockNumber) !== BigInt(proof.blockNumber))
                return null;
            if (!same(evmRpcHex(tx.hash, 32), expected.transactionHash) ||
                !same(evmRpcHex(receipt.transactionHash, 32), expected.transactionHash))
                invalid("transaction_hash");
            if (evmRpcQuantity(tx.chainId) !== 42161n ||
                !same(evmRpcAddress(tx.from), expected.from) || tx.to === null ||
                !same(evmRpcAddress(tx.to), expected.to) || !same(evmRpcHex(tx.input), expected.data) ||
                evmRpcQuantity(tx.value) !== expected.valueWei)
                invalid("transaction_envelope");
            const status = evmRpcQuantity(receipt.status);
            if (status !== 0n && status !== 1n)
                invalid("receipt_status");
            if (status !== 1n)
                return null;
        }
        return { number: safe.number, hash: safe.hash };
    }
    async effect(expected, guard) {
        const [chain, rawTx, rawReceipt, rawSafe] = await this.batch(guard, [
            { method: "eth_chainId", params: [] },
            { method: "eth_getTransactionByHash", params: [expected.transactionHash] },
            { method: "eth_getTransactionReceipt", params: [expected.transactionHash] },
            { method: "eth_getBlockByNumber", params: ["safe", false] },
        ]);
        if (evmRpcQuantity(chain) !== 42161n)
            throw new ApnError("APN_CHAIN_MISMATCH", "Relay source RPC is not Arbitrum One.");
        if (rawTx === null || rawReceipt === null || rawSafe === null)
            return null;
        const tx = evmRpcRecord(rawTx), receipt = evmRpcRecord(rawReceipt);
        const safe = evmRpcBlockResult(rawSafe, "safe");
        const blockNumber = evmRpcQuantity(receipt.blockNumber);
        if (BigInt(safe.number) < blockNumber)
            return null;
        const blockTag = `0x${blockNumber.toString(16)}`;
        const [rawBlock, rawSafeAgain, rawTxAgain, rawReceiptAgain] = await this.batch(guard, [
            { method: "eth_getBlockByNumber", params: [blockTag, false] },
            { method: "eth_getBlockByNumber", params: ["safe", false] },
            { method: "eth_getTransactionByHash", params: [expected.transactionHash] },
            { method: "eth_getTransactionReceipt", params: [expected.transactionHash] },
        ]);
        if (rawBlock === null || rawSafeAgain === null || rawTxAgain === null || rawReceiptAgain === null)
            return null;
        const block = evmRpcBlockResult(rawBlock, blockTag);
        const safeAgain = evmRpcBlockResult(rawSafeAgain, "safe");
        if (BigInt(safeAgain.number) < blockNumber ||
            (safeAgain.number === safe.number && !same(safe.hash, safeAgain.hash)))
            return null;
        const txAgain = evmRpcRecord(rawTxAgain), receiptAgain = evmRpcRecord(rawReceiptAgain);
        const txHash = evmRpcHex(tx.hash, 32), receiptHash = evmRpcHex(receipt.transactionHash, 32);
        const includedHash = evmRpcHex(tx.blockHash, 32), receiptBlockHash = evmRpcHex(receipt.blockHash, 32);
        if (!same(txHash, expected.transactionHash) || !same(receiptHash, expected.transactionHash) ||
            !same(evmRpcHex(txAgain.hash, 32), txHash) || !same(evmRpcHex(receiptAgain.transactionHash, 32), receiptHash))
            invalid("transaction_hash");
        if (!same(includedHash, block.hash) || !same(receiptBlockHash, block.hash) ||
            !same(evmRpcHex(txAgain.blockHash, 32), block.hash) ||
            !same(evmRpcHex(receiptAgain.blockHash, 32), block.hash) ||
            evmRpcQuantity(tx.blockNumber) !== blockNumber || evmRpcQuantity(txAgain.blockNumber) !== blockNumber ||
            evmRpcQuantity(receiptAgain.blockNumber) !== blockNumber)
            return null;
        for (const observed of [tx, txAgain]) {
            if (evmRpcQuantity(observed.chainId) !== 42161n ||
                !same(evmRpcAddress(observed.from), expected.from) ||
                observed.to === null || !same(evmRpcAddress(observed.to), expected.to) ||
                !same(evmRpcHex(observed.input), expected.data) ||
                evmRpcQuantity(observed.value) !== expected.valueWei)
                invalid("transaction_envelope");
        }
        const status = evmRpcQuantity(receipt.status), statusAgain = evmRpcQuantity(receiptAgain.status);
        if ((status !== 0n && status !== 1n) || (statusAgain !== 0n && statusAgain !== 1n))
            invalid("receipt_status");
        if (status !== 1n || statusAgain !== 1n)
            return null;
        return { effect: { transactionHash: txHash, blockNumber: blockNumber.toString(), blockHash: block.hash } };
    }
}
function validateExpected(effect) {
    if (!HASH.test(effect.transactionHash) || !/^0x[0-9a-fA-F]{40}$/u.test(effect.from) ||
        !/^0x[0-9a-fA-F]{40}$/u.test(effect.to) || !/^0x(?:[0-9a-fA-F]{2})+$/u.test(effect.data) ||
        effect.valueWei < 0n)
        throw new ApnError("APN_INVALID_INPUT", "Relay source effect expectation is invalid.");
}
//# sourceMappingURL=arbitrum-source-finality.js.map