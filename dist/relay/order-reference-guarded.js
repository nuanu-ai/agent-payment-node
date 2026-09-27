import { EvmDirectRpcGuard } from "../evm-direct-rpc-guard.js";
import { ApnError } from "../errors.js";
import { evmRpcAddress, evmRpcBlockResult, evmRpcHex, evmRpcQuantity, evmRpcRecord } from "../evm-rpc-codec.js";
import { HttpsBaseRpc } from "../rpc.js";
import { validateRelayArbitrumUsdcEthereumUsdcQuote } from "./arbitrum-usdc-ethereum-quote.js";
import { inspectRelayOrderReferenceCandidate } from "./order-reference-candidate.js";
import { ETHEREUM_USDC } from "./quote.js";
const HASH = /^0x[0-9a-fA-F]{64}$/u;
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const same = (left, right) => left.toLowerCase() === right.toLowerCase();
const topicAddress = (address) => `0x${"0".repeat(24)}${address.slice(2).toLowerCase()}`;
function unproven(reason) {
    return { status: "unproven", reason, orderReferencedRecipientCreditProven: false,
        relayOrderFulfillmentProven: false, cryptographicCausalityProven: false, paidAcceptance: false };
}
function parseReceipt(raw) {
    const row = evmRpcRecord(raw);
    const status = evmRpcQuantity(row.status);
    if (status !== 0n && status !== 1n || !Array.isArray(row.logs) || row.logs.length > 256)
        throw new Error("Relay order reference receipt is malformed.");
    const logs = row.logs.map(value => {
        const log = evmRpcRecord(value);
        if (!Array.isArray(log.topics) || log.topics.length > 4 || log.removed !== false)
            throw new Error("Relay order reference log is malformed.");
        return { address: evmRpcAddress(log.address), topics: log.topics.map(topic => evmRpcHex(topic, 32)),
            data: evmRpcHex(log.data), transactionHash: evmRpcHex(log.transactionHash, 32),
            blockNumber: evmRpcQuantity(log.blockNumber), blockHash: evmRpcHex(log.blockHash, 32),
            removed: false, logIndex: evmRpcQuantity(log.logIndex) };
    });
    return { raw: row, parsed: { transactionHash: evmRpcHex(row.transactionHash, 32),
            status: status === 1n ? "success" : "reverted", blockNumber: evmRpcQuantity(row.blockNumber),
            blockHash: evmRpcHex(row.blockHash, 32), logs } };
}
/** Production defaults to public HTTPS RPC. Injection is limited to raw transport for synthetic tests. */
export class RelayGuardedOrderReferenceObserver {
    sourceUrl;
    destinationUrl;
    holdAfterPost;
    sourceRpc;
    destinationRpc;
    sourceGuard;
    destinationGuard;
    sourcePosts = 0;
    destinationPosts = 0;
    constructor(sourceUrl, destinationUrl, state, sourceRpc, destinationRpc, guardFactory = () => new EvmDirectRpcGuard(state, 3), holdAfterPost = () => new Promise(resolve => setTimeout(resolve, 750))) {
        this.sourceUrl = sourceUrl;
        this.destinationUrl = destinationUrl;
        this.holdAfterPost = holdAfterPost;
        this.sourceRpc = sourceRpc ?? new HttpsBaseRpc(sourceUrl);
        this.destinationRpc = destinationRpc ?? new HttpsBaseRpc(destinationUrl);
        this.sourceGuard = guardFactory();
        this.destinationGuard = guardFactory();
    }
    get physicalPosts() { return this.sourceGuard.physicalRequests + this.destinationGuard.physicalRequests; }
    async batch(source, calls) {
        if (source ? this.sourcePosts >= 3 : this.destinationPosts >= 3)
            throw new ApnError("APN_RPC_BUDGET_EXCEEDED", "Relay order reference exhausted its read-only RPC POST budget.");
        if (source)
            this.sourcePosts++;
        else
            this.destinationPosts++;
        const url = source ? this.sourceUrl : this.destinationUrl;
        const guard = source ? this.sourceGuard : this.destinationGuard;
        const rpc = source ? this.sourceRpc : this.destinationRpc;
        const rows = await guard.post(url, async () => {
            try {
                return await rpc.batchCall(calls);
            }
            finally {
                await this.holdAfterPost();
            }
        });
        if (!Array.isArray(rows) || rows.length !== calls.length)
            throw new Error("Relay RPC batch shape is invalid.");
        return rows;
    }
    async initial(source, hash, chainId) {
        const [chain, txRaw, receiptRaw, safeRaw] = await this.batch(source, [
            { method: "eth_chainId", params: [] }, { method: "eth_getTransactionByHash", params: [hash] },
            { method: "eth_getTransactionReceipt", params: [hash] },
            { method: "eth_getBlockByNumber", params: ["safe", false] },
        ]);
        if (evmRpcQuantity(chain) !== chainId || txRaw === null || receiptRaw === null || safeRaw === null)
            return null;
        const tx = evmRpcRecord(txRaw), receipt = parseReceipt(receiptRaw), safe = evmRpcBlockResult(safeRaw, "safe");
        if (!same(evmRpcHex(tx.hash, 32), hash) || !same(receipt.parsed.transactionHash, hash) ||
            evmRpcQuantity(tx.chainId) !== chainId || tx.blockHash === null || tx.blockNumber === null ||
            !same(evmRpcHex(tx.blockHash, 32), receipt.parsed.blockHash) ||
            evmRpcQuantity(tx.blockNumber) !== receipt.parsed.blockNumber ||
            BigInt(safe.number) < receipt.parsed.blockNumber || receipt.parsed.status !== "success")
            return null;
        return { chain: chainId, tx, receiptRaw: receipt.raw, receipt: receipt.parsed,
            safeNumber: BigInt(safe.number), safeHash: safe.hash };
    }
    async recheck(source, hash, saved) {
        const number = saved.receipt.blockNumber;
        const tag = `0x${number.toString(16)}`;
        const safeTag = `0x${saved.safeNumber.toString(16)}`;
        const [chain, blockRaw, oldSafeRaw, txRaw, receiptRaw, currentSafeRaw] = await this.batch(source, [
            { method: "eth_chainId", params: [] }, { method: "eth_getBlockByNumber", params: [tag, false] },
            { method: "eth_getBlockByNumber", params: [safeTag, false] },
            { method: "eth_getTransactionByHash", params: [hash] },
            { method: "eth_getTransactionReceipt", params: [hash] },
            { method: "eth_getBlockByNumber", params: ["safe", false] },
        ]);
        if (evmRpcQuantity(chain) !== saved.chain || blockRaw === null || oldSafeRaw === null ||
            txRaw === null || receiptRaw === null || currentSafeRaw === null)
            return null;
        const block = evmRpcBlockResult(blockRaw, tag), oldSafe = evmRpcBlockResult(oldSafeRaw, safeTag);
        const currentSafe = evmRpcBlockResult(currentSafeRaw, "safe");
        const tx = evmRpcRecord(txRaw), receipt = parseReceipt(receiptRaw);
        if (!same(block.hash, saved.receipt.blockHash) || !same(oldSafe.hash, saved.safeHash) ||
            BigInt(currentSafe.number) < number || BigInt(currentSafe.number) < saved.safeNumber ||
            JSON.stringify(tx) !== JSON.stringify(saved.tx) ||
            JSON.stringify(receipt.raw) !== JSON.stringify(saved.receiptRaw))
            return null;
        return { number, hash: block.hash, timestampSeconds: evmRpcQuantity(block.raw.timestamp) };
    }
    /** Six guarded batch POSTs at most; no caller-provided proof records are accepted. */
    async observe(rawQuote, intent, sourceHash, destinationHash) {
        let quote;
        try {
            quote = await validateRelayArbitrumUsdcEthereumUsdcQuote(rawQuote, intent);
        }
        catch {
            return unproven("signed_quote_invalid");
        }
        if (!HASH.test(sourceHash) || !HASH.test(destinationHash))
            return unproven("transaction_hash_invalid");
        const source = await this.initial(true, sourceHash, 42161n);
        if (source === null)
            return unproven("source_transaction_or_safe_receipt_missing");
        if (!same(evmRpcAddress(source.tx.from), quote.payer) || source.tx.to === null ||
            !same(evmRpcAddress(source.tx.to), quote.deposit.to) ||
            !same(evmRpcHex(source.tx.input), quote.deposit.data) || evmRpcQuantity(source.tx.value) !== 0n)
            return unproven("source_envelope_mismatch");
        const destination = await this.initial(false, destinationHash, 1n);
        if (destination === null)
            return unproven("destination_transaction_or_safe_receipt_missing");
        const sourceBlock = await this.recheck(true, sourceHash, source);
        if (sourceBlock === null)
            return unproven("source_reorg_or_receipt_drift");
        const destinationBlock = await this.recheck(false, destinationHash, destination);
        if (destinationBlock === null)
            return unproven("destination_reorg_or_receipt_drift");
        // Recheck both heads and receipts after both inclusion reads, reducing cross-chain observation drift.
        const finalSourceBlock = await this.recheck(true, sourceHash, source);
        const finalDestinationBlock = await this.recheck(false, destinationHash, destination);
        if (finalSourceBlock === null || finalDestinationBlock === null ||
            !same(finalSourceBlock.hash, sourceBlock.hash) ||
            finalSourceBlock.timestampSeconds !== sourceBlock.timestampSeconds ||
            !same(finalDestinationBlock.hash, destinationBlock.hash) ||
            finalDestinationBlock.timestampSeconds !== destinationBlock.timestampSeconds)
            return unproven("cross_chain_recheck_drift");
        const creditLogs = destination.receipt.logs.filter(log => same(log.address, ETHEREUM_USDC) &&
            log.topics[0] !== undefined && same(log.topics[0], TRANSFER_TOPIC) &&
            log.topics[2] !== undefined && same(log.topics[2], topicAddress(quote.recipient)));
        const credit = creditLogs.length === 1 ? creditLogs[0] : null;
        if (credit === null)
            return unproven("recipient_credit_missing_or_ambiguous");
        const candidate = await inspectRelayOrderReferenceCandidate({ rawQuote, quoteIntent: intent, quote,
            sourceProof: { sourceChainId: 42161, rpcOrigin: new URL(this.sourceUrl).origin,
                deposit: { transactionHash: sourceHash.toLowerCase(),
                    blockNumber: source.receipt.blockNumber.toString(), blockHash: source.receipt.blockHash },
                approval: null, safeHead: { number: source.safeNumber.toString(), hash: source.safeHash },
                proofClass: "canonical_safe_source_receipts", destinationDeliveryProven: false,
                causalLinkCryptographicallyProven: false, paidAcceptance: false },
            sourceReceipt: source.receipt,
            destinationCredit: { status: "recipient_credit_proven", relayOrderFulfillmentProven: false,
                paidAcceptance: false, proof: { quoteDigest: quote.quoteDigest, orderId: quote.orderId,
                    destinationTransactionHash: destinationHash.toLowerCase(),
                    destinationBlockNumber: destination.receipt.blockNumber.toString(),
                    destinationBlockHash: destination.receipt.blockHash,
                    safeBlockNumber: destination.safeNumber.toString(), safeBlockHash: destination.safeHash,
                    token: ETHEREUM_USDC.toLowerCase(), recipient: quote.recipient,
                    minimumOutputAtomic: quote.minimumOutputAtomic, creditedAtomic: BigInt(credit.data).toString(),
                    transferLogIndex: credit.logIndex.toString(), proofClass: "canonical_safe_erc20_transfer_log" } },
            destinationReceipt: destination.receipt,
            destinationTransaction: { hash: evmRpcHex(destination.tx.hash, 32), chainId: 1,
                blockNumber: destination.receipt.blockNumber,
                blockHash: destination.receipt.blockHash, input: evmRpcHex(destination.tx.input) },
            destinationBlock });
        if (candidate.status !== "candidate_consistent" || candidate.candidate === null)
            return unproven(candidate.reason ?? "candidate_inconsistent");
        const c = candidate.candidate;
        return { status: "proven", orderReferencedRecipientCreditProven: true,
            relayOrderFulfillmentProven: false, cryptographicCausalityProven: false, paidAcceptance: false,
            proof: { orderId: c.orderId, quoteDigest: c.quoteDigest,
                sourceTransactionHash: c.sourceTransactionHash, sourceBlockHash: c.sourceBlockHash,
                sourceDepositLogIndex: c.sourceDepositLogIndex,
                destinationTransactionHash: c.destinationTransactionHash, destinationBlockHash: c.destinationBlockHash,
                destinationTransferLogIndex: c.destinationTransferLogIndex, creditedAtomic: c.creditedAtomic,
                destinationTimestampSeconds: c.destinationTimestampSeconds,
                proofClass: "guarded_canonical_safe_order_reference_and_recipient_credit" } };
    }
}
//# sourceMappingURL=order-reference-guarded.js.map