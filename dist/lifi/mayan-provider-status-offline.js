/** Provider reports are hints. This module makes no HTTP or settlement claim. */
import { getBase58Decoder, getBase58Encoder } from "@solana/kit";
import { keccak256 } from "viem";
import { decodeMayanBaseSolanaQuoteOffline } from "./mayan-offline.js";
import { bridgeFailure, bridgeHex, bridgeRecord, bridgeUint, BRIDGE_ZERO_WORD } from "./validation.js";
function fail(reason) { return bridgeFailure("APN_PROVIDER_PROTOCOL", `mayan_provider_${reason}`); }
function hash(value) {
    const result = bridgeHex(value, 32, 32);
    if (result === BRIDGE_ZERO_WORD)
        fail("zero_hash");
    return result;
}
function signature(value) {
    if (typeof value !== "string" || value.length < 64 || value.length > 88)
        fail("solana_signature");
    try {
        const bytes = getBase58Encoder().encode(value);
        if (bytes.length !== 64 || getBase58Decoder().decode(bytes) !== value)
            fail("solana_signature");
    }
    catch {
        fail("solana_signature");
    }
    return value;
}
/** Parse only the fields documented by Circle CCTP V1 and LI.FI. */
export function inspectMayanProviderStatusOffline(input) {
    const quote = decodeMayanBaseSolanaQuoteOffline(input.quote, input.binding);
    const sourceTransactionHash = hash(input.sourceTransactionHash);
    const cctpMessageHash = hash(input.cctpMessageHash);
    const cctpNonce = bridgeUint(input.cctpNonce).toString();
    if (BigInt(cctpNonce) > (1n << 64n) - 1n)
        fail("nonce_width");
    const circle = bridgeRecord(input.circleMessages);
    if (!Array.isArray(circle.messages) || circle.messages.length !== 1)
        fail("circle_message_count");
    const message = bridgeRecord(circle.messages[0]);
    const bytes = bridgeHex(message.message, 12 * 1024);
    if (bytes.length !== 2 + 248 * 2 || keccak256(bytes) !== cctpMessageHash ||
        bridgeUint(message.eventNonce).toString() !== cctpNonce ||
        BigInt(`0x${bytes.slice(2, 2 + 4 * 2)}`) !== 0n ||
        BigInt(`0x${bytes.slice(2 + 4 * 2, 2 + 8 * 2)}`) !== 6n ||
        BigInt(`0x${bytes.slice(2 + 8 * 2, 2 + 12 * 2)}`) !== 5n ||
        BigInt(`0x${bytes.slice(2 + 12 * 2, 2 + 20 * 2)}`) !== BigInt(cctpNonce))
        fail("circle_message_binding");
    const attestation = bridgeHex(message.attestation, 4096);
    if (attestation.length < 2 + 65 * 2 || (attestation.length - 2) % (65 * 2) !== 0)
        fail("circle_attestation");
    if (!Array.isArray(input.lifiStatuses) || input.lifiStatuses.length !== 1)
        fail("lifi_status_count");
    const status = bridgeRecord(input.lifiStatuses[0]);
    const sending = bridgeRecord(status.sending);
    const receiving = bridgeRecord(status.receiving);
    if (hash(status.transactionId) !== quote.transactionId.toLowerCase() ||
        hash(sending.txHash) !== sourceTransactionHash || status.tool !== "mayanMCTP" ||
        status.status !== "DONE" || status.substatus !== "COMPLETED")
        fail("lifi_status_binding");
    const receivingSolanaSignature = signature(receiving.txHash);
    return { kind: "offline_mayan_mctp_provider_status_hint", transactionId: quote.transactionId,
        sourceTransactionHash, cctpMessageHash, cctpNonce, circleAttestation: attestation,
        receivingSolanaSignature, providerOutcome: "completed", bridgeCompletion: false };
}
//# sourceMappingURL=mayan-provider-status-offline.js.map