import { validateRelayUnsignedOperation } from "../relay-unsigned-operation.js";
import { verifyDepositObservation } from "./deposit-effect.js";
import { BNB_NATIVE } from "./quote.js";
import { relayNativeRoute } from "./native-quote.js";
const HASH = /^0x[0-9a-fA-F]{64}$/u;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/u;
const same = (left, right) => left.toLowerCase() === right.toLowerCase();
const pending = (reason) => ({ status: "pending", reason,
    relayOrderFulfillmentProven: false, paidAcceptance: false });
const unproven = (reason) => ({ status: "unproven", reason,
    relayOrderFulfillmentProven: false, paidAcceptance: false });
const mismatch = (reason) => ({ status: "mismatch", reason,
    relayOrderFulfillmentProven: false, paidAcceptance: false });
/** Former official Base V3 deployment: relay-periphery cc6808ba97f7, deployments/v3/addresses.json.
 * Runtime hash matches its verified Base bytecode (Blockscout) at safe block 51770413. */
const BASE_RELAY_ROUTER_V3 = "0xb92fe925dc43a0ecde6c8b1a2709c170ec4fff4f";
const BASE_RELAY_ROUTER_V3_CODE_HASH = "0xde894e5c12e9513d50613c8fff375ecbf19b5d9a53bec0662e2b9667e3ec8f15";
const SOLVER_NATIVE_TRANSFER_TOPIC = "0xd35467972d1fda5b63c735f59d3974fa51785a41a92aa3ed1b70832836f8dba6";
function routerEventCredit(receipt, recipient) {
    const logs = receipt.logs;
    if (!logs || logs.length > 256)
        return null;
    const transfers = logs.filter(log => same(log.address, BASE_RELAY_ROUTER_V3) &&
        log.topics.length > 0 && same(log.topics[0], SOLVER_NATIVE_TRANSFER_TOPIC));
    if (transfers.some(log => log.topics.length !== 1 || !/^0x[0-9a-fA-F]{128}$/u.test(log.data) ||
        log.data.slice(2, 26) !== "0".repeat(24)))
        return null;
    const matching = transfers.filter(log => /^0x[0-9a-fA-F]{128}$/u.test(log.data) &&
        log.data.slice(2, 26) === "0".repeat(24) &&
        same(`0x${log.data.slice(26, 66)}`, recipient));
    if (matching.length !== 1)
        return null;
    return BigInt(`0x${matching[0].data.slice(66)}`);
}
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
/** A provider candidate is only a discovery hint; even a real native credit is not causal proof. */
export async function proveRelayNativeDestination(operation, sourceHash, candidateHashes, ports) {
    const op = validateRelayUnsignedOperation(operation), quote = op.nativeQuote;
    if (!quote || op.sourceChainId !== 56 || ![137, 143].includes(op.destinationChainId) ||
        quote.routeReference !== relayNativeRoute(op.sourceAccount, op.recipient).reference ||
        quote.recipient.toLowerCase() !== op.recipient.toLowerCase() ||
        BigInt(quote.minimumOutputWei) < BigInt(op.minOutputAtomic))
        return mismatch("saved_native_quote_binding");
    if (!HASH.test(sourceHash) || candidateHashes.length !== 1 || !HASH.test(candidateHashes[0]))
        return mismatch("native_candidate_hashes_invalid");
    let chainId;
    try {
        chainId = await ports.chainId();
    }
    catch {
        return unproven("destination_rpc_unavailable");
    }
    if (chainId !== op.destinationChainId)
        return mismatch("destination_chain_id");
    return inspectCandidate(op, sourceHash.toLowerCase(), candidateHashes[0].toLowerCase(), ports, op.destinationChainId);
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
        if (trace === null && expectedChainId === 8453) {
            if (!ports.routerCodeHash || !ports.adjacentBalances || receipt.blockNumber === 0n ||
                tx.to === null || !same(tx.to, BASE_RELAY_ROUTER_V3))
                return unproven("base_router_fallback_unavailable");
            const eventAmount = routerEventCredit(receipt, op.recipient);
            if (eventAmount === null || eventAmount <= 0n)
                return unproven("base_router_event_missing_or_ambiguous");
            if (eventAmount < minimum)
                return mismatch("destination_value_below_minimum");
            let codeHash, balances;
            try {
                codeHash = await ports.routerCodeHash(BASE_RELAY_ROUTER_V3, receipt.blockNumber);
                balances = await ports.adjacentBalances(op.recipient, receipt.blockNumber, receipt.blockHash);
            }
            catch {
                return unproven("base_router_state_unavailable");
            }
            if (!same(codeHash, BASE_RELAY_ROUTER_V3_CODE_HASH))
                return mismatch("base_router_code_identity");
            if (balances[0] < 0n || balances[1] < balances[0] || balances[1] - balances[0] !== eventAmount)
                return unproven("base_balance_delta_ambiguous");
            credited = eventAmount;
            method = "verified_relay_router_event_balance";
        }
        else {
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
    }
    return { status: "recipient_credit_proven", relayOrderFulfillmentProven: false, paidAcceptance: false, proof: {
            operationId: op.operationId, operationIntegrityHash: op.integrityHash, quoteDigest: op.quoteDigest,
            orderId: op.nativeQuote?.orderId ?? op.quote.orderId, sourceDepositHash: sourceHash === "" ? null : sourceHash, destinationTransactionHash: hash,
            destinationBlockNumber: receipt.blockNumber.toString(), destinationBlockHash: receipt.blockHash.toLowerCase(),
            finalityBlockNumber: safe.number.toString(), finalityBlockHash: safe.hash.toLowerCase(),
            recipient: op.recipient.toLowerCase(), minimumOutputWei: op.minOutputAtomic, creditedWei: credited.toString(), method
        } };
}
//# sourceMappingURL=destination-proof.js.map