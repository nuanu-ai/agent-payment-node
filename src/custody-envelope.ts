import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { TextDecoder } from "node:util";
import { canonicalJson } from "./canonical.js";
import { ApnError } from "./errors.js";

/**
 * The one custody envelope: HKDF-SHA-256 over the Keychain wrapping secret with a 32-byte salt, then AES-256-GCM with a
 * 12-byte nonce and a 16-byte tag over canonical header data. Every store keeps its own file layout, identity checks,
 * HKDF info and AAD (byte-compatible with the files earlier releases wrote) and its own error codes; this module owns
 * the cryptography, the strict base64 and plaintext rules and the zeroing of every buffer it creates.
 */
export type EnvelopeField = "salt" | "nonce" | "ciphertext" | "tag";
export type EnvelopeFailure =
  /** A field is outside the strict base64 alphabet and padding. */
  | "encoding"
  /** A field decodes to bytes that re-encode differently, or to an empty, oversized or wrong-length value. */
  | "decoding"
  /** AES-GCM refused the key, AAD, nonce or tag, or the plaintext is not UTF-8 JSON, or a non-APN error was thrown. */
  | "authentication"
  | "canonical_plaintext";
export interface SealedParts { readonly salt: string; readonly nonce: string; readonly ciphertext: string; readonly tag: string }
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

const LENGTH: Readonly<Record<EnvelopeField, number | null>> = { salt: 32, nonce: 12, ciphertext: null, tag: 16 };
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;

/** Encrypts `plaintext` and zeroes it. The caller loads, and zeroes, the wrapping secret. */
export function sealEnvelope<H>(secret: Buffer, spec: Pick<EnvelopeSpec<H>, "info" | "aad">, header: (salt: string, nonce: string) => H,
  plaintext: Buffer): SealedParts & { readonly header: H } {
  const salt = randomBytes(32), nonce = randomBytes(12);
  let key: Buffer | undefined, ciphertext: Buffer | undefined;
  try {
    const sealedHeader = header(salt.toString("base64"), nonce.toString("base64"));
    key = derive(secret, salt, spec.info(sealedHeader));
    const cipher = createCipheriv("aes-256-gcm", key, nonce, { authTagLength: 16 });
    cipher.setAAD(Buffer.from(canonicalJson(spec.aad(sealedHeader)), "utf8"));
    ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return { header: sealedHeader, salt: salt.toString("base64"), nonce: nonce.toString("base64"),
      ciphertext: ciphertext.toString("base64"), tag: cipher.getAuthTag().toString("base64") };
  } finally {
    salt.fill(0); nonce.fill(0); key?.fill(0); ciphertext?.fill(0); plaintext.fill(0);
  }
}

export function sealCanonicalJson<H>(secret: Buffer, spec: Pick<EnvelopeSpec<H>, "info" | "aad">, header: (salt: string, nonce: string) => H,
  value: unknown): SealedParts & { readonly header: H } {
  return sealEnvelope(secret, spec, header, Buffer.from(canonicalJson(value), "utf8"));
}

/**
 * Decrypts and hands the plaintext to `use`, then zeroes it. An APN error from `use` passes through unchanged; any
 * other error is the store's "authentication" failure, as decryption errors are.
 */
export async function openEnvelope<H, T>(secret: Buffer, spec: EnvelopeSpec<H>, header: H, parts: SealedParts,
  use: (plaintext: Buffer) => T | Promise<T>): Promise<T> {
  const decoded: Buffer[] = [];
  try {
    const field = (name: EnvelopeField): Buffer => { const bytes = decode(spec, name, parts[name]); decoded.push(bytes); return bytes; };
    const salt = field("salt"), nonce = field("nonce"), ciphertext = field("ciphertext"), tag = field("tag");
    const key = derive(secret, salt, spec.info(header)); decoded.push(key);
    let plaintext = Buffer.alloc(0);
    try {
      const decipher = createDecipheriv("aes-256-gcm", key, nonce, { authTagLength: 16 });
      decipher.setAAD(Buffer.from(canonicalJson(spec.aad(header)), "utf8"));
      decipher.setAuthTag(tag);
      plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      return await use(plaintext);
    } catch (error) {
      if (error instanceof ApnError) throw error;
      return spec.fail("authentication", null, error);
    } finally { plaintext.fill(0); }
  } finally { for (const bytes of decoded) bytes.fill(0); }
}

/** Opens strict UTF-8 canonical JSON and passes the value to `accept`, under the same error rules as openEnvelope. */
export async function openCanonicalJson<H, T>(secret: Buffer, spec: EnvelopeSpec<H>, header: H, parts: SealedParts,
  accept: (value: unknown) => T | Promise<T>): Promise<T> {
  return await openEnvelope(secret, spec, header, parts, async plaintext => {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(plaintext);
    const value = JSON.parse(text) as unknown;
    if (canonicalJson(value) !== text) spec.fail("canonical_plaintext", null, null);
    return await accept(value);
  });
}

/** The layout most stores write: `{ ...header, kdf: { name, salt }, cipher: { name, nonce, ciphertext, tag } }`. */
export interface NestedHeader {
  readonly kdf: { readonly name: "HKDF-SHA-256"; readonly salt: string };
  readonly cipher: { readonly name: "AES-256-GCM"; readonly nonce: string };
}
export interface NestedEnvelope {
  readonly kdf: { readonly name: "HKDF-SHA-256"; readonly salt: string };
  readonly cipher: { readonly name: "AES-256-GCM"; readonly nonce: string; readonly ciphertext: string; readonly tag: string };
}

/** Seals canonical JSON under `base` in the nested layout; the AAD is the file without ciphertext and tag. */
export function sealNested<B extends object>(secret: Buffer, spec: Pick<EnvelopeSpec<B & NestedHeader>, "info" | "aad">, base: B,
  value: unknown): B & NestedEnvelope {
  const sealed = sealCanonicalJson(secret, spec, (salt, nonce) => ({ ...base,
    kdf: { name: "HKDF-SHA-256" as const, salt }, cipher: { name: "AES-256-GCM" as const, nonce } }), value);
  return { ...sealed.header, cipher: { ...sealed.header.cipher, ciphertext: sealed.ciphertext, tag: sealed.tag } };
}

/** Opens a nested-layout envelope whose shape the store has already checked. */
export async function openNested<E extends NestedEnvelope, T>(secret: Buffer, spec: EnvelopeSpec<Omit<E, "cipher"> & NestedHeader>,
  envelope: E, accept: (value: unknown) => T | Promise<T>): Promise<T> {
  const header = { ...envelope, cipher: { name: envelope.cipher.name, nonce: envelope.cipher.nonce } };
  return await openCanonicalJson(secret, spec, header, { salt: envelope.kdf.salt, nonce: envelope.cipher.nonce,
    ciphertext: envelope.cipher.ciphertext, tag: envelope.cipher.tag }, accept);
}

function derive(secret: Buffer, salt: Buffer, info: string): Buffer {
  return Buffer.from(hkdfSync("sha256", secret, salt, Buffer.from(info, "utf8"), 32));
}

function decode<H>(spec: EnvelopeSpec<H>, field: EnvelopeField, value: unknown): Buffer {
  if (typeof value !== "string" || !BASE64.test(value)) spec.fail("encoding", field, null);
  const bytes = Buffer.from(value, "base64"), length = LENGTH[field];
  if (bytes.toString("base64") !== value || bytes.length === 0 || (length !== null && bytes.length !== length) ||
    (spec.maxFieldBytes !== null && bytes.length > spec.maxFieldBytes)) {
    bytes.fill(0);
    spec.fail("decoding", field, null);
  }
  return bytes;
}
