import { validateRelayUnsignedOperation } from "../relay-unsigned-operation.js";
import { verifyDepositObservation } from "./deposit-effect.js";
import { BNB_NATIVE } from "./quote.js";
const HASH = /^0x[0-9a-fA-F]{64}$/u;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/u;
const same = (left, right) => left.toLowerCase() === right.toLowerCase();
const pending = (reason) => ({ status: "pending", reason,
    relayOrderFulfillmentProven: false, paidAcceptance: false });
const unproven = (reason) => ({ status: "unproven", reason,
    relayOrderFulfillmentProven: false, paidAcceptance: false });
const mismatch = (reason) => ({ status: "mismatch", reason,
    relayOrderFulfillmentProven: false, paidAcceptance: false });
/**
 * Provider transaction hashes are discovery hints only. A valid credit can be an
 * unrelated payment to the same recipient; this function never proves Relay order
 * fulfillment or authorizes paid acceptance. It makes no sends or retries.
 */
export async function proveRelayBnbDestination(input, ports) {
    const op = validateRelayUnsignedOperation(input.operation);
    const quote = op.quote;
    if (op.sourceChainId !== 1 || op.destinationChainId !== 56 || !quote ||
        quote.orderData.output.chainId !== "bnb" || quote.orderData.output.calls.length !== 0 ||
        quote.orderData.output.payments.length !== 1 ||
        !same(quote.orderData.output.payments[0].currency, BNB_NATIVE) ||
        !same(quote.orderData.output.payments[0].recipient, op.recipient) ||
        BigInt(quote.orderData.output.payments[0].minimumAmount) < BigInt(op.minOutputAtomic))
        return mismatch("saved_quote_binding");
    if (!HASH.test(input.sourceDeposit.transactionHash))
        return mismatch("source_hash_invalid");
    try {
        if (verifyDepositObservation(op, input.sourceDeposit.transactionHash, input.sourceDeposit.observation) !== "confirmed")
            return mismatch("source_deposit_failed");
    }
    catch {
        return mismatch("source_deposit_binding");
    }
    if (input.candidateHashes.length > 8 || input.candidateHashes.some(hash => !HASH.test(hash)))
        return mismatch("candidate_hashes_invalid");
    const hashes = [...new Set(input.candidateHashes.map(hash => hash.toLowerCase()))];
    if (hashes.length === 0)
        return pending("destination_candidate_missing");
    let chainId;
    try {
        chainId = await ports.chainId();
    }
    catch {
        return unproven("bnb_rpc_unavailable");
    }
    if (chainId !== 56)
        return mismatch("destination_chain_id");
    const results = [];
    for (const hash of hashes)
        results.push(await inspectCandidate(op, input.sourceDeposit.transactionHash.toLowerCase(), hash, ports, 56));
    const credits = results.filter((result) => result.status === "recipient_credit_proven");
    if (credits.length > 1)
        return unproven("multiple_qualifying_candidates");
    if (credits.length === 1)
        return credits[0];
    return results.find(result => result.status === "pending") ??
        results.find(result => result.status === "unproven") ?? results[0];
}
/** Base credit observation has no source journal or order-causal proof. */
export async function proveRelayBaseDestination(operation, candidateHashes, ports) {
    const op = validateRelayUnsignedOperation(operation);
    const quote = op.quote;
    if (op.sourceChainId !== 1 || op.destinationChainId !== 8453 || !quote ||
        quote.routeReference !== "ethereum-usdc-base-eth-v1" || quote.orderData.output.chainId !== "base" ||
        quote.orderData.output.calls.length !== 0 || quote.orderData.output.payments.length !== 1 ||
        !same(quote.orderData.output.payments[0].currency, BNB_NATIVE) ||
        !same(quote.orderData.output.payments[0].recipient, op.recipient) ||
        BigInt(quote.orderData.output.payments[0].minimumAmount) < BigInt(op.minOutputAtomic))
        return mismatch("saved_quote_binding");
    if (candidateHashes.length !== 1 || !HASH.test(candidateHashes[0]))
        return mismatch("candidate_hashes_invalid");
    let chainId;
    try {
        chainId = await ports.chainId();
    }
    catch {
        return unproven("base_rpc_unavailable");
    }
    if (chainId !== 8453)
        return mismatch("destination_chain_id");
    return inspectCandidate(op, "", candidateHashes[0].toLowerCase(), ports, 8453);
}
async function inspectCandidate(op, sourceHash, hash, ports, expectedChainId) {
    let tx, receipt;
    try {
        [tx, receipt] = await Promise.all([ports.transaction(hash), ports.receipt(hash)]);
    }
    catch {
        return unproven("bnb_rpc_unavailable");
    }
    if (tx === null || receipt === null)
        return pending("destination_transaction_or_receipt_missing");
    if (!same(tx.hash, hash) || !same(receipt.transactionHash, hash) || tx.chainId !== expectedChainId ||
        tx.blockNumber !== receipt.blockNumber || tx.blockHash === null || !same(tx.blockHash, receipt.blockHash) ||
        !HASH.test(receipt.blockHash) || receipt.blockNumber < 0n)
        return mismatch("destination_transaction_receipt_identity");
    if (receipt.status !== "success")
        return mismatch("destination_receipt_failed");
    let block, safe, safeCanonical;
    try {
        [block, safe] = await Promise.all([ports.block(receipt.blockNumber), ports.finalityCheckpoint()]);
        safeCanonical = safe === null ? null : await ports.block(safe.number);
    }
    catch {
        return unproven("bnb_finality_rpc_unavailable");
    }
    if (block === null || safe === null || safeCanonical === null)
        return pending("destination_finality_unavailable");
    if (block.number !== receipt.blockNumber || !same(block.hash, receipt.blockHash) ||
        safeCanonical.number !== safe.number || !same(safeCanonical.hash, safe.hash) ||
        !HASH.test(safe.hash))
        return mismatch("destination_noncanonical_block");
    if (safe.number < receipt.blockNumber)
        return pending("destination_not_safe");
    const minimum = BigInt(op.minOutputAtomic);
    let credited, method;
    if (tx.to !== null && same(tx.to, op.recipient)) {
        if (tx.valueWei < minimum)
            return mismatch("destination_value_below_minimum");
        credited = tx.valueWei;
        method = "direct_native_transaction";
    }
    else {
        let trace;
        try {
            trace = await ports.nativeTrace(hash);
        }
        catch {
            return unproven("destination_trace_unavailable");
        }
        if (trace === null)
            return unproven("destination_trace_unavailable");
        if (!same(trace.transactionHash, hash) || !same(trace.blockHash, receipt.blockHash) ||
            trace.complete !== true || trace.revertedCallsExcluded !== true ||
            trace.transfers.some(transfer => !ADDRESS.test(transfer.from) || !ADDRESS.test(transfer.to) || transfer.valueWei < 0n))
            return mismatch("destination_trace_binding");
        const credits = trace.transfers.filter(transfer => same(transfer.to, op.recipient) && transfer.valueWei > 0n);
        if (credits.length !== 1)
            return unproven("destination_trace_ambiguous_or_no_credit");
        credited = credits[0].valueWei;
        if (credited < minimum)
            return mismatch("destination_value_below_minimum");
        method = "receipt_bound_native_trace";
    }
    return { status: "recipient_credit_proven", relayOrderFulfillmentProven: false, paidAcceptance: false, proof: {
            operationId: op.operationId, operationIntegrityHash: op.integrityHash, quoteDigest: op.quoteDigest,
            orderId: op.quote.orderId, sourceDepositHash: sourceHash === "" ? null : sourceHash, destinationTransactionHash: hash,
            destinationBlockNumber: receipt.blockNumber.toString(), destinationBlockHash: receipt.blockHash.toLowerCase(),
            finalityBlockNumber: safe.number.toString(), finalityBlockHash: safe.hash.toLowerCase(),
            recipient: op.recipient.toLowerCase(), minimumOutputWei: op.minOutputAtomic, creditedWei: credited.toString(), method
        } };
}
//# sourceMappingURL=destination-proof.js.map