import { validateRelayUnsignedOperation } from "../relay-unsigned-operation.js";
import { verifyDepositObservation } from "./deposit-effect.js";
import { BNB_NATIVE } from "./quote.js";
import { relayNativeRouteByReference, RELAY_MEGA_USDM } from "./native-routes.js";
const HASH = /^0x[0-9a-fA-F]{64}$/u;
const same = (left, right) => left.toLowerCase() === right.toLowerCase();
const pending = (reason) => ({ status: "pending", reason,
    relayOrderFulfillmentProven: false, paidAcceptance: false });
const unproven = (reason) => ({ status: "unproven", reason,
    relayOrderFulfillmentProven: false, paidAcceptance: false });
const mismatch = (reason) => ({ status: "mismatch", reason,
    relayOrderFulfillmentProven: false, paidAcceptance: false });
/** Relay router V3 (relay-periphery cc6808ba97f7, deployments/v3/addresses.json): one immutable, non-proxy CREATE2
 * deployment at the same address on Base, BNB, Polygon, Monad and MegaETH. Its SolverNativeTransfer(to, amount) is
 * emitted only by a frame that completed the native transfer, so the receipt event proves the credit (P5: address pin,
 * no code-hash pin). */
export const RELAY_ROUTER_V3 = "0xb92fe925dc43a0ecde6c8b1a2709c170ec4fff4f";
const SOLVER_NATIVE_TRANSFER_TOPIC = "0xd35467972d1fda5b63c735f59d3974fa51785a41a92aa3ed1b70832836f8dba6";
const ERC20_TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
/** Physical POSTs of one candidate proof: chain, transaction, receipt and finality head; then the inclusion block and,
 * for a depth checkpoint, the checkpoint block (P4). */
export const RELAY_DESTINATION_PROOF_POSTS = 2;
function routerEventCredit(receipt, recipient) {
    const logs = receipt.logs;
    if (!logs || logs.length > 256)
        return null;
    const transfers = logs.filter(log => same(log.address, RELAY_ROUTER_V3) &&
        log.topics.length > 0 && same(log.topics[0], SOLVER_NATIVE_TRANSFER_TOPIC));
    if (transfers.some(log => log.topics.length !== 1 || !/^0x[0-9a-fA-F]{128}$/u.test(log.data) ||
        log.data.slice(2, 26) !== "0".repeat(24)))
        return null;
    const matching = transfers.filter(log => same(`0x${log.data.slice(26, 66)}`, recipient));
    if (matching.length !== 1)
        return null;
    return BigInt(`0x${matching[0].data.slice(66)}`);
}
function tokenTransferCredit(receipt, token, recipient) {
    const recipientTopic = `0x${recipient.slice(2).toLowerCase().padStart(64, "0")}`;
    const credits = (receipt.logs ?? []).filter(log => same(log.address, token) && log.topics.length === 3 &&
        same(log.topics[0], ERC20_TRANSFER_TOPIC) && same(log.topics[2], recipientTopic) && /^0x[0-9a-fA-F]{64}$/u.test(log.data));
    return credits.length === 1 ? BigInt(credits[0].data) : null;
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
    return inspectCandidate(op, "", candidateHashes[0].toLowerCase(), ports, 8453);
}
/** A provider candidate is only a discovery hint; even a real native credit is not causal proof. */
export async function proveRelayNativeDestination(operation, sourceHash, candidateHashes, ports) {
    const op = validateRelayUnsignedOperation(operation), quote = op.nativeQuote;
    const route = quote === undefined ? null : relayNativeRouteByReference(quote.routeReference);
    if (!quote || route === null || op.sourceChainId !== route.sourceChainId || op.destinationChainId !== route.chainId ||
        quote.recipient.toLowerCase() !== op.recipient.toLowerCase() ||
        BigInt(quote.minimumOutputWei) < BigInt(op.minOutputAtomic))
        return mismatch("saved_native_quote_binding");
    if (!HASH.test(sourceHash) || candidateHashes.length !== 1 || !HASH.test(candidateHashes[0]))
        return mismatch("native_candidate_hashes_invalid");
    return inspectCandidate(op, sourceHash.toLowerCase(), candidateHashes[0].toLowerCase(), ports, op.destinationChainId);
}
async function inspectCandidate(op, sourceHash, hash, ports, expectedChainId) {
    // One proof per destination chain (OWNR R2): Polygon is always proven at its milestone-finalized checkpoint and the
    // credit is always filtered by this operation's own recipient, whatever the source chain.
    const polygonMilestone = expectedChainId === 137;
    if (polygonMilestone && !ports.polygonFinalizedCheckpoint)
        return unproven("polygon_consensus_finality_unavailable");
    // P3: chain, transaction, receipt and checkpoint are requested together; the inclusion block is requested as soon
    // as the receipt names it, so an adapter can send the whole proof in two POSTs. The checkpoint is read with or
    // after the receipt, so a canonical inclusion block at or below it is final without a header recheck (P2).
    let chainId, tx, receipt, block, safe;
    try {
        const receiptRead = ports.receipt(hash), inclusionRead = receiptRead.then(value => value === null ? null : ports.block(value.blockNumber));
        [chainId, tx, receipt, block, safe] = await Promise.all([ports.chainId(), ports.transaction(hash), receiptRead, inclusionRead,
            polygonMilestone ? ports.polygonFinalizedCheckpoint() : ports.finalityCheckpoint()]);
    }
    catch {
        return unproven("destination_rpc_unavailable");
    }
    if (chainId !== expectedChainId)
        return mismatch("destination_chain_id");
    if (tx === null || receipt === null)
        return pending("destination_transaction_or_receipt_missing");
    if (!same(tx.hash, hash) || !same(receipt.transactionHash, hash) || tx.chainId !== expectedChainId ||
        tx.blockNumber !== receipt.blockNumber || tx.blockHash === null || !same(tx.blockHash, receipt.blockHash) ||
        !HASH.test(receipt.blockHash) || receipt.blockNumber < 0n)
        return mismatch("destination_transaction_receipt_identity");
    if (receipt.status !== "success")
        return mismatch("destination_receipt_failed");
    if (block === null || safe === null)
        return pending("destination_finality_unavailable");
    if (block.number !== receipt.blockNumber || !same(block.hash, receipt.blockHash) || !HASH.test(safe.hash))
        return mismatch("destination_noncanonical_block");
    if (safe.number < receipt.blockNumber)
        return pending("destination_not_safe");
    const minimum = BigInt(op.minOutputAtomic);
    let credited, method;
    if (expectedChainId === 4326) {
        credited = tokenTransferCredit(receipt, RELAY_MEGA_USDM, op.recipient);
        if (credited === null)
            return unproven("mega_token_credit_missing_or_ambiguous");
        method = "pinned_erc20_transfer_event";
    }
    else if (tx.to !== null && same(tx.to, op.recipient)) {
        credited = tx.valueWei;
        method = "direct_native_transaction";
    }
    else {
        credited = routerEventCredit(receipt, op.recipient);
        if (credited === null || credited <= 0n)
            return unproven("relay_router_event_missing_or_ambiguous");
        method = "relay_router_event";
    }
    if (credited < minimum)
        return mismatch("destination_value_below_minimum");
    return { status: "recipient_credit_proven", relayOrderFulfillmentProven: false, paidAcceptance: false, proof: {
            operationId: op.operationId, operationIntegrityHash: op.integrityHash, quoteDigest: op.quoteDigest,
            orderId: op.nativeQuote?.orderId ?? op.quote.orderId, sourceDepositHash: sourceHash === "" ? null : sourceHash, destinationTransactionHash: hash,
            destinationBlockNumber: receipt.blockNumber.toString(), destinationBlockHash: receipt.blockHash.toLowerCase(),
            ...(polygonMilestone ? { finalityKind: "polygon_milestone_finalized" } : {}),
            finalityBlockNumber: safe.number.toString(), finalityBlockHash: safe.hash.toLowerCase(),
            recipient: op.recipient.toLowerCase(), minimumOutputWei: op.minOutputAtomic, creditedWei: credited.toString(), method
        } };
}
//# sourceMappingURL=destination-proof.js.map