/**
 * The attested CCTP V2 message of a Circle Base USDC to Solana burn, read from its bytes: Circle's issuer API serves them
 * with the attestation, and MessageTransmitterV2 `receive_message` on Solana carries the same bytes in its instruction data.
 * Header: version, source and destination domain (u32), nonce, sender, recipient, destination caller (bytes32),
 * min and executed finality (u32). BurnMessageV2 body: version (u32), burn token, mint recipient (bytes32), amount
 * (uint256), message sender (bytes32), max fee, fee executed, expiration block (uint256), hook data.
 * The burn transaction emits the same message on Base in `MessageSent(bytes message)` with the attester's fields left zero.
 */
import { createHash } from "node:crypto";
import { getBase58Encoder } from "@solana/kit";
import { toEventSelector } from "viem";
import { circleBurnCall } from "./circle-v2-source-usage.js";
const BASE_USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
export const CCTP_BASE_DOMAIN = 6, CCTP_SOLANA_DOMAIN = 5;
const HEADER = 148, BODY = 228;
const RECEIVE_MESSAGE = createHash("sha256").update("global:receive_message").digest().subarray(0, 8);
/** Circle's MessageTransmitterV2 on Base: the emitter of a burn's one `MessageSent`. */
export const CCTP_BASE_MESSAGE_TRANSMITTER = "0x81d40f21f12a8f0e3252bccb954d722d4c464b64";
export const CCTP_MESSAGE_SENT = toEventSelector("event MessageSent(bytes message)");
/** What Circle's attestation service fills after the burn: nonce, executed finality, executed fee and expiration block. */
const ATTESTER_FIELDS = [[12, 44], [144, 148], [HEADER + 164, HEADER + BODY]];
const word = (bytes, at) => `0x${bytes.subarray(at, at + 32).toString("hex")}`;
const uint = (bytes, at) => BigInt(word(bytes, at));
/** A bytes32 that holds an EVM address: twelve zero bytes, then the address. */
function evmWord(bytes, at) {
    const value = word(bytes, at);
    return value.slice(2, 26) === "0".repeat(24) ? `0x${value.slice(26)}` : null;
}
function ataWord(ata) {
    try {
        const bytes = getBase58Encoder().encode(ata);
        return bytes.length === 32 ? `0x${Buffer.from(bytes).toString("hex")}` : null;
    }
    catch {
        return null;
    }
}
/** The burn's terms from the journal's calldata and admission; null when they disagree (the calldata is the signed truth). */
export function circleBurnTerms(journal) {
    const call = circleBurnCall(journal), ata = ataWord(journal.admissionProof.recipientAta);
    if (call === null || ata === null || call.destinationDomain !== CCTP_SOLANA_DOMAIN || call.burnToken !== BASE_USDC ||
        call.mintRecipient !== ata || call.amount <= 0n)
        return null;
    return { amount: call.amount, mintRecipient: ata, messageSender: journal.sourceCall.to.toLowerCase(),
        recipientOwner: journal.admissionProof.recipientOwner, recipientAta: journal.admissionProof.recipientAta };
}
/** A version 1 burn message of exactly one body and hook data; null for any other layout. */
export function decodeCctpBurnMessage(bytes) {
    if (bytes.length < HEADER + BODY || bytes.length > 4096 || bytes.readUInt32BE(0) !== 1)
        return null;
    const body = bytes.subarray(HEADER);
    if (body.readUInt32BE(0) !== 1)
        return null;
    const burnToken = evmWord(body, 4), messageSender = evmWord(body, 100);
    if (burnToken === null || messageSender === null)
        return null;
    return { bytes, sha256: createHash("sha256").update(bytes).digest("hex"), nonce: word(bytes, 12),
        sourceDomain: bytes.readUInt32BE(4), destinationDomain: bytes.readUInt32BE(8), burnToken, mintRecipient: word(body, 36),
        amount: uint(body, 68), messageSender, maxFee: uint(body, 132), feeExecuted: uint(body, 164) };
}
/** Whether an attested message is this burn's: Base to Solana, Base USDC, the journal's messenger, account and principal. */
export function messageBindsBurn(message, terms) {
    return message.sourceDomain === CCTP_BASE_DOMAIN && message.destinationDomain === CCTP_SOLANA_DOMAIN &&
        message.burnToken === BASE_USDC && message.messageSender === terms.messageSender && message.mintRecipient === terms.mintRecipient &&
        message.amount === terms.amount && message.feeExecuted <= message.maxFee && message.feeExecuted < message.amount;
}
/** The message of a `MessageSent` log's data: one canonically encoded ABI `bytes`; null for anything else. */
export function messageSentBytes(data) {
    if (typeof data !== "string" || data.length > 2 + 2 * (64 + 4128) || !/^0x(?:[0-9a-fA-F]{2})+$/u.test(data))
        return null;
    const bytes = Buffer.from(data.slice(2), "hex");
    if (bytes.length < 64 || uint(bytes, 0) !== 32n || uint(bytes, 32) > 4096n)
        return null;
    const length = Number(uint(bytes, 32));
    if (bytes.length !== 64 + Math.ceil(length / 32) * 32 || bytes.subarray(64 + length).some(byte => byte !== 0))
        return null;
    return bytes.subarray(64, 64 + length);
}
/**
 * Whether attested bytes are the message the burn transaction emitted. CCTP V2 assigns nonces offchain, so the source event
 * leaves the attester's fields zero; every other byte, the hook data included, must be the same.
 */
export function attestedFromSource(source, attested) {
    const filled = (index) => ATTESTER_FIELDS.some(([from, to]) => index >= from && index < to);
    if (source.length !== attested.length || source.length < HEADER + BODY)
        return false;
    for (let index = 0; index < source.length; index++) {
        if (filled(index) ? source[index] !== 0 : source[index] !== attested[index])
            return false;
    }
    return true;
}
/** The message bytes of a MessageTransmitterV2 `receive_message` instruction (Anchor: discriminator, two borsh vectors). */
export function receiveMessageBytes(data) {
    if (typeof data !== "string" || data.length === 0 || data.length > 2048)
        return null;
    let bytes;
    try {
        bytes = Buffer.from(getBase58Encoder().encode(data));
    }
    catch {
        return null;
    }
    if (bytes.length < 16 || !bytes.subarray(0, 8).equals(RECEIVE_MESSAGE))
        return null;
    const messageLength = bytes.readUInt32LE(8);
    if (12 + messageLength + 4 > bytes.length)
        return null;
    const attestationLength = bytes.readUInt32LE(12 + messageLength);
    if (16 + messageLength + attestationLength !== bytes.length)
        return null;
    return bytes.subarray(12, 12 + messageLength);
}
//# sourceMappingURL=circle-v2-cctp-message.js.map