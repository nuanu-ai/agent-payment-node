import type { Hex } from "./model.js";
/**
 * A cross-rail status hint names a transaction in the form its own rail uses: an EVM 32-byte
 * transaction hash, or a canonical base58 Solana signature. Neither form is widened and nothing
 * else is a transaction identity, so a provider cannot smuggle an arbitrary string through a hint.
 */
export type RailStatusIdentifier = string;
export type RailStatusFamily = "evm" | "solana";
/**
 * Narrows to `Hex` so an EVM reader can never be handed a Solana signature by accident. The
 * predicate is exactly the one `bridgeHex(value, 32, 32)` enforced: 0x plus 64 hex digits.
 */
export declare function isEvmTransactionHash(value: unknown): value is Hex;
/** True only for a canonical base58 encoding of exactly 64 signature bytes. */
export declare function isSolanaTransactionSignature(value: unknown): value is string;
/** Null marks a value that is neither rail's transaction identity. */
export declare function railStatusFamily(value: unknown): RailStatusFamily | null;
/**
 * Returns the identifier in its own rail's canonical form: an EVM hash lowercased exactly as the
 * hex reader always returned it, a Solana signature as itself. Null marks an unusable value; the
 * caller decides how to fail, so this module stays free of any one rail's error vocabulary.
 */
export declare function railStatusIdentifier(value: unknown): RailStatusIdentifier | null;
