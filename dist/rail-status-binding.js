import { getBase58Decoder, getBase58Encoder } from "@solana/kit";
const EVM_TRANSACTION_HASH = /^0x[0-9a-fA-F]{64}$/u;
const SOLANA_SIGNATURE_TEXT = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/u;
/**
 * Narrows to `Hex` so an EVM reader can never be handed a Solana signature by accident. The
 * predicate is exactly the one `bridgeHex(value, 32, 32)` enforced: 0x plus 64 hex digits.
 */
export function isEvmTransactionHash(value) {
    return typeof value === "string" && EVM_TRANSACTION_HASH.test(value);
}
/** True only for a canonical base58 encoding of exactly 64 signature bytes. */
export function isSolanaTransactionSignature(value) {
    if (typeof value !== "string" || !SOLANA_SIGNATURE_TEXT.test(value))
        return false;
    try {
        const bytes = getBase58Encoder().encode(value);
        return bytes.length === 64 && getBase58Decoder().decode(bytes) === value;
    }
    catch {
        return false;
    }
}
/** Null marks a value that is neither rail's transaction identity. */
export function railStatusFamily(value) {
    if (isEvmTransactionHash(value))
        return "evm";
    return isSolanaTransactionSignature(value) ? "solana" : null;
}
/**
 * Returns the identifier in its own rail's canonical form: an EVM hash lowercased exactly as the
 * hex reader always returned it, a Solana signature as itself. Null marks an unusable value; the
 * caller decides how to fail, so this module stays free of any one rail's error vocabulary.
 */
export function railStatusIdentifier(value) {
    if (isEvmTransactionHash(value))
        return value.toLowerCase();
    return isSolanaTransactionSignature(value) ? value : null;
}
//# sourceMappingURL=rail-status-binding.js.map