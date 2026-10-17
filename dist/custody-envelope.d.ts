/**
 * The one custody envelope: HKDF-SHA-256 over the Keychain wrapping secret with a 32-byte salt, then AES-256-GCM with a
 * 12-byte nonce and a 16-byte tag over canonical header data. Every store keeps its own file layout, identity checks,
 * HKDF info and AAD (byte-compatible with the files earlier releases wrote) and its own error codes; this module owns
 * the cryptography, the strict base64 and plaintext rules and the zeroing of every buffer it creates.
 */
export type EnvelopeField = "salt" | "nonce" | "ciphertext" | "tag";
export type EnvelopeFailure = 
/** A field is outside the strict base64 alphabet and padding. */
"encoding"
/** A field decodes to bytes that re-encode differently, or to an empty, oversized or wrong-length value. */
 | "decoding"
/** AES-GCM refused the key, AAD, nonce or tag, or the plaintext is not UTF-8 JSON, or a non-APN error was thrown. */
 | "authentication" | "canonical_plaintext";
export interface SealedParts {
    readonly salt: string;
    readonly nonce: string;
    readonly ciphertext: string;
    readonly tag: string;
}
export interface EnvelopeSpec<H> {
    /** HKDF info for this header, encoded as UTF-8. */
    readonly info: (header: H) => string;
    /** Header data authenticated as canonical JSON. */
    readonly aad: (header: H) => unknown;
    /** Largest decoded field this store accepts, or null when only the state-file size bounds it. */
    readonly maxFieldBytes: number | null;
    /** The store's own error for a failure; `cause` is the underlying error for "authentication". */
    readonly fail: (failure: EnvelopeFailure, field: EnvelopeField | null, cause: unknown) => never;
}
/** Encrypts `plaintext` and zeroes it. The caller loads, and zeroes, the wrapping secret. */
export declare function sealEnvelope<H>(secret: Buffer, spec: Pick<EnvelopeSpec<H>, "info" | "aad">, header: (salt: string, nonce: string) => H, plaintext: Buffer): SealedParts & {
    readonly header: H;
};
export declare function sealCanonicalJson<H>(secret: Buffer, spec: Pick<EnvelopeSpec<H>, "info" | "aad">, header: (salt: string, nonce: string) => H, value: unknown): SealedParts & {
    readonly header: H;
};
/**
 * Decrypts and hands the plaintext to `use`, then zeroes it. An APN error from `use` passes through unchanged; any
 * other error is the store's "authentication" failure, as decryption errors are.
 */
export declare function openEnvelope<H, T>(secret: Buffer, spec: EnvelopeSpec<H>, header: H, parts: SealedParts, use: (plaintext: Buffer) => T | Promise<T>): Promise<T>;
/** Opens strict UTF-8 canonical JSON and passes the value to `accept`, under the same error rules as openEnvelope. */
export declare function openCanonicalJson<H, T>(secret: Buffer, spec: EnvelopeSpec<H>, header: H, parts: SealedParts, accept: (value: unknown) => T | Promise<T>): Promise<T>;
/** The layout most stores write: `{ ...header, kdf: { name, salt }, cipher: { name, nonce, ciphertext, tag } }`. */
export interface NestedHeader {
    readonly kdf: {
        readonly name: "HKDF-SHA-256";
        readonly salt: string;
    };
    readonly cipher: {
        readonly name: "AES-256-GCM";
        readonly nonce: string;
    };
}
export interface NestedEnvelope {
    readonly kdf: {
        readonly name: "HKDF-SHA-256";
        readonly salt: string;
    };
    readonly cipher: {
        readonly name: "AES-256-GCM";
        readonly nonce: string;
        readonly ciphertext: string;
        readonly tag: string;
    };
}
/** Seals canonical JSON under `base` in the nested layout; the AAD is the file without ciphertext and tag. */
export declare function sealNested<B extends object>(secret: Buffer, spec: Pick<EnvelopeSpec<B & NestedHeader>, "info" | "aad">, base: B, value: unknown): B & NestedEnvelope;
/** Opens a nested-layout envelope whose shape the store has already checked. */
export declare function openNested<E extends NestedEnvelope, T>(secret: Buffer, spec: EnvelopeSpec<Omit<E, "cipher"> & NestedHeader>, envelope: E, accept: (value: unknown) => T | Promise<T>): Promise<T>;
