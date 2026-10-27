/**
 * Delivery of a Circle CCTP V2 Base USDC to Solana burn. Circle's forwarding service (or any payer) receives the message
 * on Solana; APN only reads. Circle's issuer API locates the attested message and the receiving transaction; the record is
 * proven from the chains: the attested bytes are the message the burn transaction itself emitted on Base (its one
 * `MessageSent`, every byte but the attester's fields), and the finalized Solana transaction, later than the burn's
 * block, carries those exact bytes to MessageTransmitterV2, writes the message's used-nonce account and credits the
 * journal's recipient token account with the principal minus the executed fee. Each message proves one operation only.
 * CCTP V2 assigns nonces offchain and this route's message names no payer, so burns of one amount to one account emit
 * the same bytes: between such burns in flight together, Circle's nonce is the only discriminator. A read that fails is
 * shown with its reason and never fails the status.
 */
import { createHash } from "node:crypto";
import { address, getProgramDerivedAddress } from "@solana/kit";
import { canonicalJson, hashObject, isPlainRecord } from "../canonical.js";
import { SOLANA_USDC } from "../chain-policy.js";
import { ApnError } from "../errors.js";
import { evmRpcQuantity } from "../evm-rpc-codec.js";
import { SecureStateStore, stateIdentifier } from "../secure-state-store.js";
import { assertSolanaNetworkValue, rpcArray, rpcAtomic, rpcRecord, solanaSignature } from "../solana/rpc.js";
import { attestedFromSource, CCTP_BASE_MESSAGE_TRANSMITTER, CCTP_MESSAGE_SENT, circleBurnTerms, decodeCctpBurnMessage, messageBindsBurn, messageSentBytes, receiveMessageBytes } from "./circle-v2-cctp-message.js";
import { BridgeHttps } from "./https.js";
/** v2 binds the message to the burn's own `MessageSent`; v1 records (0.5.76, without that binding) are never read. */
export const CIRCLE_SOLANA_DELIVERY_SCHEMA = "apn.circle-v2-solana-delivery.v2";
const CLAIM_SCHEMA = "apn.circle-v2-solana-delivery-claim.v2", CLAIMS = "circle-solana-delivery-claims-v2";
/** Circle's CCTP V2 message transmitter on Solana mainnet; a received message's nonce account is its PDA ["used_nonce", nonce]. */
export const CIRCLE_SOLANA_MESSAGE_TRANSMITTER = "CCTPV2Sm4AdWt5296sk4P66VBZ7bEhcARwFaaS9YPbeC";
export const CIRCLE_SOLANA_RPC_ACTION = "Set APN_SOLANA_RPC_URL to a Solana mainnet HTTPS endpoint, then rerun the same command.";
const NONCE_PAGE = 16;
const UINT = /^(?:0|[1-9][0-9]*)$/u, NONCE = /^0x[0-9a-f]{64}$/u, SHA = /^[0-9a-f]{64}$/u;
const UNREAD = new Set(["APN_PROVIDER_UNAVAILABLE", "APN_PROVIDER_PROTOCOL", "APN_RPC_PROTOCOL", "APN_RPC_RATE_LIMITED", "APN_RPC_AMBIGUOUS",
    "APN_RPC_CONFIG", "APN_RPC_BUDGET_EXCEEDED", "APN_HTTP_CONFIG", "APN_HTTP_PROTOCOL", "APN_HTTP_AMBIGUOUS", "APN_CHAIN_MISMATCH"]);
const DELIVERY_KEYS = ["burnAtomic", "eventNonce", "feeExecutedAtomic", "integrityHash", "maxFeeAtomic", "messageSha256", "mintedAtomic",
    "observedAt", "operationId", "profileHash", "receiveBlockTimeAtomic", "recipientAta", "recipientOwner", "schemaVersion", "slotAtomic",
    "solanaSignature", "sourceBlockTimeAtomic", "sourceLogIndexAtomic", "sourceMessageSha256", "sourceTransactionHash"];
/** Production reader: the pinned Circle origin over the bridge HTTPS transport, and the explicitly configured Solana RPC. */
export function circleSolanaDeliveryReader(solana, https = new BridgeHttps()) {
    return { solana, async issuerMessages(sourceTransactionHash) {
            if (!/^0x[0-9a-f]{64}$/u.test(sourceTransactionHash))
                throw new ApnError("APN_INTERNAL", "A Circle burn hash is not a transaction hash.");
            const response = await https.request(`https://iris-api.circle.com/v2/messages/6?transactionHash=${sourceTransactionHash}`, "GET", null, 1024 * 1024, "APN_HTTP_CONFIG");
            if (response.status !== 200)
                return { status: response.status, body: null };
            try {
                return { status: 200, body: JSON.parse(response.body) };
            }
            catch {
                return issuerFailure("circle_delivery_json");
            }
        } };
}
/** `non-evm-source-journals/<profileHash>/<operationId>.solana-delivery-v2.json` and one claim per message nonce. */
export class CircleSolanaDeliveryStore extends SecureStateStore {
    path(journal) {
        stateIdentifier(journal.profileHash, "Circle delivery profile");
        stateIdentifier(journal.operationId, "Circle delivery operation");
        return `non-evm-source-journals/${journal.profileHash}/${journal.operationId}.solana-delivery-v2.json`;
    }
    async load(journal) {
        const value = await this.readJson(this.path(journal));
        return value === null ? null : validateDelivery(value, journal);
    }
    /** The message's one operation: a create-only claim; a message another operation claimed proves nothing here. */
    async claim(journal, nonce, signature) {
        const claim = { schemaVersion: CLAIM_SCHEMA, eventNonce: nonce, operationId: journal.operationId, profileHash: journal.profileHash, solanaSignature: signature };
        const path = `${CLAIMS}/${nonce.slice(2)}.json`;
        await this.ensureDirectory(CLAIMS);
        try {
            await this.writeJson(path, claim, true);
            return;
        }
        catch (error) {
            if (!(error instanceof ApnError) || error.message !== "State target is already occupied.")
                throw error;
        }
        if (canonicalJson(await this.readJson(path)) !== canonicalJson(claim)) {
            throw new ApnError("APN_PROVIDER_PROTOCOL", "Another local operation already holds this Circle message's Solana receipt.", { reason: "circle_delivery_message_claimed" });
        }
    }
    /** Publishes the proof once; a concurrent observer's file wins and is returned after the same validation. */
    async create(journal, delivery) {
        validateDelivery(delivery, journal);
        try {
            await this.writeJson(this.path(journal), delivery, true);
        }
        catch (error) {
            if (!(error instanceof ApnError) || error.message !== "State target is already occupied.")
                throw error;
            const existing = await this.load(journal);
            if (existing === null)
                throw error;
            return existing;
        }
        return delivery;
    }
}
/**
 * The delivery of a burn whose finalized receipt succeeded. A recorded proof is returned without any read; otherwise one
 * issuer read and, once the message is attested, the burn's Base receipt and Solana reads at `finalized`. A failed read
 * becomes `unread` with its reason.
 */
export async function circleSolanaDelivery(root, journal, source, reader, read, now) {
    if (source.status !== "success")
        throw new ApnError("APN_INTERNAL", "A reverted Circle burn has no delivery.");
    const store = new CircleSolanaDeliveryStore(root), existing = await store.load(journal);
    if (existing !== null)
        return { state: "delivered", forwardState: null, proof: existing, waitingFor: null, nextActions: [], recorded: false };
    if (reader === undefined || read === undefined) {
        throw new ApnError("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "This runtime has no Circle issuer, Base and Solana readers for the burn's delivery.");
    }
    try {
        return await observe(store, journal, source, reader, read, now);
    }
    catch (error) {
        if (!(error instanceof ApnError) || !UNREAD.has(error.code))
            throw error;
        const reason = typeof error.details?.reason === "string" ? ` (${error.details.reason})` : "";
        const unreadReason = `${error.code}: ${error.message}${reason}`;
        return { state: "unread", forwardState: null, proof: null, waitingFor: `a delivery read that succeeds; the last one failed: ${unreadReason}`,
            nextActions: stringList(error.details?.nextActions), unreadReason, recorded: false };
    }
}
async function observe(store, journal, source, reader, read, now) {
    const hash = source.transactionHash;
    const waiting = (state, forwardState, waitingFor, nextActions = []) => ({ state, forwardState, proof: null, waitingFor, nextActions, recorded: false });
    const answer = await reader.issuerMessages(hash);
    if (answer.status === 404)
        return waiting("awaiting_issuer_message", null, `Circle to publish the message of burn ${hash}`);
    if (answer.status !== 200)
        unavailable(answer.status);
    // The service built the calldata's recipient from the admitted token account; a journal where they differ binds nothing.
    const terms = circleBurnTerms(journal);
    if (terms === null)
        throw new ApnError("APN_STATE_CORRUPT", "The Circle journal's burn call does not match its recipient.", { reason: "circle_delivery_terms" });
    const published = issuerMessage(answer.body, terms);
    if (published === null)
        return waiting("awaiting_issuer_message", null, `Circle to publish the message of burn ${hash}`);
    if (published.status !== "complete") {
        return waiting("awaiting_attestation", published.forwardState, `Circle to attest the message of burn ${hash} (status ${published.status})`);
    }
    const message = attested(published, terms), forwardState = published.forwardState;
    // Circle's answer only locates the message; the burn's own event and block bound whose it can be.
    const emitted = await sourceBurn(read, source);
    if (!attestedFromSource(emitted.bytes, message.bytes))
        issuerFailure("circle_delivery_source_message");
    const notForwarded = (solana) => forwardState === "FAILED"
        ? waiting("forward_failed", forwardState, "the attested message to be received on Solana; Circle's forwarding failed", [
            `Any Solana payer may submit MessageTransmitterV2 receive_message with the message and attestation of https://iris-api.circle.com/v2/messages/6?transactionHash=${hash}; APN does not sign on Solana for this route. Then rerun the same command.`,
            ...solana ? [] : [CIRCLE_SOLANA_RPC_ACTION]
        ])
        : waiting("awaiting_forward", forwardState, `Circle's forwarding service to receive the message on Solana (forwardState ${forwardState ?? "none"})`);
    if (reader.solana === null) {
        return published.forwardTxHash === null ? notForwarded(false)
            : waiting("awaiting_solana_rpc", forwardState, `APN_SOLANA_RPC_URL to read the Solana transaction ${published.forwardTxHash}`, [CIRCLE_SOLANA_RPC_ACTION]);
    }
    const rpc = reader.solana;
    assertSolanaNetworkValue(await rpc.call("getGenesisHash", []));
    const [usedNonce] = await getProgramDerivedAddress({ programAddress: address(CIRCLE_SOLANA_MESSAGE_TRANSMITTER),
        seeds: ["used_nonce", Buffer.from(message.nonce.slice(2), "hex")] });
    let signature, received;
    if (published.forwardTxHash !== null) {
        signature = published.forwardTxHash;
        const named = await solanaReceipt(rpc, terms, message, usedNonce, signature, emitted.time);
        if (named === null) {
            return waiting("awaiting_solana_finality", forwardState, `the Solana transaction ${signature} at finalized on APN_SOLANA_RPC_URL (an RPC without that history returns none)`);
        }
        received = named;
    }
    else {
        // Without Circle's forwarding transaction, a message received by anyone else is found through its used-nonce account.
        const found = await nonceReceiver(rpc, terms, message, usedNonce, emitted.time);
        if (found === null)
            return notForwarded(true);
        ({ signature, ...received } = found);
    }
    await store.claim(journal, message.nonce, signature);
    const fields = { schemaVersion: CIRCLE_SOLANA_DELIVERY_SCHEMA, operationId: journal.operationId,
        profileHash: journal.profileHash, sourceTransactionHash: hash, sourceLogIndexAtomic: emitted.logIndex.toString(),
        sourceMessageSha256: createHash("sha256").update(emitted.bytes).digest("hex"), sourceBlockTimeAtomic: emitted.time.toString(),
        receiveBlockTimeAtomic: received.blockTime.toString(), eventNonce: message.nonce, messageSha256: message.sha256,
        recipientOwner: terms.recipientOwner, recipientAta: terms.recipientAta, burnAtomic: message.amount.toString(),
        maxFeeAtomic: message.maxFee.toString(), feeExecutedAtomic: message.feeExecuted.toString(),
        mintedAtomic: (message.amount - message.feeExecuted).toString(), solanaSignature: signature, slotAtomic: received.slot.toString(),
        observedAt: new Date(now()).toISOString() };
    const proof = await store.create(journal, Object.freeze({ ...fields, integrityHash: hashObject(fields) }));
    return { state: "delivered", forwardState: null, proof, waitingFor: null, nextActions: [], recorded: true };
}
const stringList = (value) => Array.isArray(value) && value.every(item => typeof item === "string") ? value : [];
function issuerFailure(reason) {
    throw new ApnError("APN_PROVIDER_PROTOCOL", "Circle issuer API answered a message that is not this burn's.", { reason });
}
function unavailable(status) {
    throw new ApnError("APN_PROVIDER_UNAVAILABLE", "Circle issuer API response is unavailable.", { reason: "issuer_http_status", httpStatus: status, nextActions: [] });
}
function text(value, reason, maximum = 128) {
    if (typeof value !== "string" || value.length === 0 || value.length > maximum)
        issuerFailure(reason);
    return value;
}
const optional = (value, reason) => value === null || value === undefined ? null : text(value, reason);
/** This burn's one message, chosen by its decoded fields (a pending message may still lack its nonce and fee). */
function issuerMessage(body, terms) {
    if (!isPlainRecord(body) || !Array.isArray(body.messages) || body.messages.length > 8)
        issuerFailure("circle_delivery_messages");
    const ours = body.messages.filter((value) => {
        const decoded = isPlainRecord(value) && isPlainRecord(value.decodedMessage) ? value.decodedMessage : null;
        const burn = decoded !== null && isPlainRecord(decoded.decodedMessageBody) ? decoded.decodedMessageBody : null;
        return burn !== null && decoded.sourceDomain === "6" && decoded.destinationDomain === "5" &&
            typeof burn.messageSender === "string" && burn.messageSender.toLowerCase() === terms.messageSender &&
            burn.mintRecipient === terms.recipientAta && burn.amount === terms.amount.toString();
    });
    if (ours.length === 0)
        return null;
    if (ours.length !== 1)
        issuerFailure("circle_delivery_messages");
    const raw = ours[0], forwardTxHash = optional(raw.forwardTxHash, "circle_delivery_forward_tx");
    if (forwardTxHash !== null) {
        try {
            solanaSignature(forwardTxHash);
        }
        catch {
            issuerFailure("circle_delivery_forward_tx");
        }
    }
    return { raw, status: text(raw.status, "circle_delivery_status", 32), forwardState: optional(raw.forwardState, "circle_delivery_forward_state"), forwardTxHash };
}
/** The attested bytes themselves, bound to the burn; the decoded fields Circle serves beside them must agree. */
function attested(published, terms) {
    const hex = text(published.raw.message, "circle_delivery_message_bytes", 8194);
    const message = /^0x(?:[0-9a-f]{2})+$/u.test(hex) ? decodeCctpBurnMessage(Buffer.from(hex.slice(2), "hex")) : null;
    if (message === null || !messageBindsBurn(message, terms))
        issuerFailure("circle_delivery_message_bytes");
    if (typeof published.raw.eventNonce !== "string" || published.raw.eventNonce.toLowerCase() !== message.nonce)
        issuerFailure("circle_delivery_nonce");
    return message;
}
/**
 * The message the burn transaction emitted: the one `MessageSent` of Circle's Base transmitter in its receipt, in the
 * finalized block the source proof recorded, and that block's time.
 */
async function sourceBurn(read, source) {
    const fail = (reason) => {
        throw new ApnError("APN_RPC_PROTOCOL", "The Base receipt does not carry this burn's Circle message.", { reason });
    };
    const same = (value, expected) => typeof value === "string" && value.toLowerCase() === expected.toLowerCase();
    const rpc = read(8453), receipt = await rpc.call("eth_getTransactionReceipt", [source.transactionHash]);
    if (!isPlainRecord(receipt) || !same(receipt.transactionHash, source.transactionHash) || !same(receipt.blockHash, source.blockHash) ||
        receipt.status !== "0x1" || !Array.isArray(receipt.logs) || receipt.logs.length > 1024)
        fail("circle_delivery_source_receipt");
    const sent = receipt.logs.filter((log) => isPlainRecord(log) &&
        same(log.address, CCTP_BASE_MESSAGE_TRANSMITTER) && Array.isArray(log.topics) && same(log.topics[0], CCTP_MESSAGE_SENT));
    if (sent.length !== 1)
        fail("circle_delivery_source_event");
    const log = sent[0], bytes = messageSentBytes(log.data);
    if (bytes === null || log.removed === true || log.topics.length !== 1 || !same(log.transactionHash, source.transactionHash) ||
        !same(log.blockHash, source.blockHash))
        fail("circle_delivery_source_event");
    const logIndex = evmRpcQuantity(log.logIndex), number = BigInt(source.blockNumberAtomic);
    const block = await rpc.call("eth_getBlockByNumber", [`0x${number.toString(16)}`, false]);
    if (!isPlainRecord(block) || !same(block.hash, source.blockHash) || evmRpcQuantity(block.number) !== number)
        fail("circle_delivery_source_block");
    return { bytes: bytes, logIndex, time: evmRpcQuantity(block.timestamp) };
}
/** A complete receive of these bytes older than the burn: a message is received once, so it is final, not skipped. */
const RECEIVED_BEFORE_BURN = "circle_delivery_receipt_before_burn";
function binding(reason) {
    throw new ApnError("APN_RPC_PROTOCOL", "The Solana transaction is not this burn's receipt.", { reason });
}
/**
 * The receive among the successful finalized transactions naming the used-nonce account, oldest first. Anyone may name the
 * public account, so each is checked as a receipt and a well-formed one that is not is skipped; only one transaction can
 * receive a message. A candidate this node does not return or this reader cannot judge, or a full page, with no receipt
 * found is reported as unread, never taken as "not received".
 */
async function nonceReceiver(rpc, terms, message, usedNonce, burnTime) {
    const rows = rpcArray(await rpc.call("getSignaturesForAddress", [usedNonce, { commitment: "finalized", limit: NONCE_PAGE }]), NONCE_PAGE).map(rpcRecord);
    let unjudged = false;
    for (const signature of rows.filter(row => row.err === null).map(row => solanaSignature(row.signature)).reverse()) {
        try {
            const received = await solanaReceipt(rpc, terms, message, usedNonce, signature, burnTime);
            if (received !== null)
                return { signature, ...received };
            unjudged = true;
        }
        catch (error) {
            if (!(error instanceof ApnError) || error.code !== "APN_RPC_PROTOCOL" || error.details?.reason === RECEIVED_BEFORE_BURN)
                throw error;
            // A reason names a well-formed transaction that is not this receive; a bare protocol refusal is a shape not judged.
            if (typeof error.details?.reason !== "string" || !error.details.reason.startsWith("circle_delivery_"))
                unjudged = true;
        }
    }
    if (unjudged)
        binding("circle_delivery_nonce_unjudged");
    if (rows.length === NONCE_PAGE)
        binding("circle_delivery_nonce_history");
    return null;
}
/**
 * The named transaction at `finalized`, or null while the node does not return it there. It must be later than the burn's
 * block (no receive before the burn delivers it), have succeeded and carry a `receive_message` of these exact bytes to
 * the transmitter (top level or inner), write the used-nonce account and move exactly the minted amount of USDC into the
 * recipient token account owned by the recipient. Integers may be bigints.
 */
async function solanaReceipt(rpc, terms, message, usedNonce, signature, burnTime) {
    const value = await rpc.call("getTransaction", [signature, { encoding: "jsonParsed", commitment: "finalized", maxSupportedTransactionVersion: 0 }]);
    if (value === null)
        return null;
    const tx = rpcRecord(value), meta = rpcRecord(tx.meta), transaction = rpcRecord(tx.transaction), body = rpcRecord(transaction.message);
    const slot = rpcAtomic(tx.slot);
    if (meta.err !== null)
        binding("circle_delivery_transaction_failed");
    if (rpcArray(transaction.signatures, 16)[0] !== signature)
        binding("circle_delivery_signature");
    const entries = rpcArray(body.accountKeys, 256).map(rpcRecord), keys = entries.map(entry => entry.pubkey);
    if (keys.some(key => typeof key !== "string") || new Set(keys).size !== keys.length)
        binding("circle_delivery_accounts");
    const inner = meta.innerInstructions === null || meta.innerInstructions === undefined ? []
        : rpcArray(meta.innerInstructions, 64).flatMap(group => rpcArray(rpcRecord(group).instructions, 256));
    const receives = [...rpcArray(body.instructions, 64), ...inner].map(rpcRecord)
        .filter(instruction => instruction.programId === CIRCLE_SOLANA_MESSAGE_TRANSMITTER)
        .map(instruction => receiveMessageBytes(instruction.data));
    if (!receives.some(bytes => bytes !== null && bytes.equals(message.bytes)))
        binding("circle_delivery_message");
    const nonceIndex = keys.indexOf(usedNonce), index = keys.indexOf(terms.recipientAta);
    if (nonceIndex < 0 || entries[nonceIndex].writable !== true)
        binding("circle_delivery_used_nonce");
    if (index < 0 || entries[index].writable !== true)
        binding("circle_delivery_recipient");
    const balance = (list, required) => {
        const rows = (list === null || list === undefined ? [] : rpcArray(list, 256)).map(rpcRecord).filter(row => rpcAtomic(row.accountIndex) === BigInt(index));
        if (rows.length === 0 && !required)
            return 0n;
        if (rows.length !== 1)
            binding("circle_delivery_balance");
        const row = rows[0], amount = rpcRecord(row.uiTokenAmount).amount;
        if (row.mint !== SOLANA_USDC || row.owner !== terms.recipientOwner || typeof amount !== "string" || !UINT.test(amount))
            binding("circle_delivery_balance");
        return BigInt(amount);
    };
    if (balance(meta.postTokenBalances, true) - balance(meta.preTokenBalances, false) !== message.amount - message.feeExecuted)
        binding("circle_delivery_amount");
    // Last, on an otherwise complete receive. A node without the block's time cannot judge it (not a reason of a transaction
    // that is not this receive). The route's burns ask standard finality (2000, fixed by the source event), so a burn's own
    // receive comes after Base finality, many minutes after its block; with fast finality the margin would be seconds.
    if (tx.blockTime === null || tx.blockTime === undefined) {
        throw new ApnError("APN_RPC_PROTOCOL", "The Solana RPC returned the transaction without its block time.", { reason: "solana_block_time_missing" });
    }
    const blockTime = rpcAtomic(tx.blockTime);
    if (blockTime <= burnTime) {
        throw new ApnError("APN_RPC_PROTOCOL", "The message was received on Solana before this burn: Circle's answer is another burn's.", { reason: RECEIVED_BEFORE_BURN });
    }
    return { slot, blockTime };
}
function deliveryCorrupt() {
    throw new ApnError("APN_STATE_CORRUPT", "The delivery proof of a Circle burn is not the one its journal allows.", { reason: "circle_delivery_binding" });
}
function validateDelivery(value, journal) {
    if (!isPlainRecord(value) || canonicalJson(Object.keys(value).sort()) !== canonicalJson(DELIVERY_KEYS))
        deliveryCorrupt();
    const proof = value, { integrityHash, ...fields } = proof, terms = circleBurnTerms(journal);
    const numbers = [proof.burnAtomic, proof.maxFeeAtomic, proof.feeExecutedAtomic, proof.mintedAtomic, proof.slotAtomic, proof.sourceLogIndexAtomic,
        proof.sourceBlockTimeAtomic, proof.receiveBlockTimeAtomic];
    if (terms === null || proof.schemaVersion !== CIRCLE_SOLANA_DELIVERY_SCHEMA || hashObject(fields) !== integrityHash ||
        proof.operationId !== journal.operationId || proof.profileHash !== journal.profileHash || proof.sourceTransactionHash !== journal.transactionHash ||
        proof.recipientOwner !== terms.recipientOwner || proof.recipientAta !== terms.recipientAta ||
        numbers.some(number => typeof number !== "string" || !UINT.test(number)) || BigInt(proof.burnAtomic) !== terms.amount ||
        BigInt(proof.feeExecutedAtomic) > BigInt(proof.maxFeeAtomic) || BigInt(proof.feeExecutedAtomic) >= BigInt(proof.burnAtomic) ||
        BigInt(proof.mintedAtomic) !== BigInt(proof.burnAtomic) - BigInt(proof.feeExecutedAtomic) ||
        BigInt(proof.receiveBlockTimeAtomic) <= BigInt(proof.sourceBlockTimeAtomic) ||
        typeof proof.eventNonce !== "string" || !NONCE.test(proof.eventNonce) || typeof proof.messageSha256 !== "string" || !SHA.test(proof.messageSha256) ||
        typeof proof.sourceMessageSha256 !== "string" || !SHA.test(proof.sourceMessageSha256) ||
        typeof proof.observedAt !== "string" || !Number.isFinite(Date.parse(proof.observedAt)) ||
        new Date(Date.parse(proof.observedAt)).toISOString() !== proof.observedAt)
        deliveryCorrupt();
    try {
        solanaSignature(proof.solanaSignature);
    }
    catch {
        deliveryCorrupt();
    }
    return Object.freeze(proof);
}
//# sourceMappingURL=circle-v2-solana-delivery.js.map