/**
 * The on-disk custody envelope formats of APN 0.5.45, written here independently of `src`. Golden envelopes produced
 * by the 0.5.45 stores open with this reference, so it is the 0.5.45 format; a file sealed by the current stores that
 * opens with it is therefore a file 0.5.45 opens.
 */
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalJson } from "../../src/canonical.js";
import type { WrappingSecretPort } from "../../src/macos-keychain.js";

// Envelope files are JSON shaped per store; the reference reads them structurally.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Json = any;
export interface Parts { readonly salt: string; readonly nonce: string; readonly ciphertext: string; readonly tag: string }
export interface ReferenceFormat {
  parts(file: Json): Parts;
  withParts(file: Json, parts: Parts): Json;
  info(file: Json): string;
  aad(file: Json): unknown;
}

/** `{ kdf: { name, salt }, cipher: { name, nonce|iv, ciphertext, tag } }`; the AAD is the file without ciphertext and tag. */
export function nestedFormat(nonceKey: "nonce" | "iv", info: (file: Json) => string): ReferenceFormat {
  return {
    parts: file => ({ salt: file.kdf.salt, nonce: file.cipher[nonceKey], ciphertext: file.cipher.ciphertext, tag: file.cipher.tag }),
    withParts: (file, p) => ({ ...file, kdf: { ...file.kdf, salt: p.salt },
      cipher: { ...file.cipher, [nonceKey]: p.nonce, ciphertext: p.ciphertext, tag: p.tag } }),
    info,
    aad: file => ({ ...file, cipher: { name: file.cipher.name, [nonceKey]: file.cipher[nonceKey] } }),
  };
}

/** `{ ...header, salt, nonce, ciphertext, tag }`; the AAD is the file without ciphertext and tag unless given. */
export function flatFormat(info: (file: Json) => string, aad?: (file: Json) => unknown): ReferenceFormat {
  return {
    parts: file => ({ salt: file.salt, nonce: file.nonce, ciphertext: file.ciphertext, tag: file.tag }),
    withParts: (file, p) => ({ ...file, ...p }),
    info,
    aad: aad ?? (file => { const { ciphertext: _c, tag: _t, ...header } = file; return header; }),
  };
}

function key(format: ReferenceFormat, file: Json, secret: Buffer, salt: Buffer): Buffer {
  return Buffer.from(hkdfSync("sha256", secret, salt, Buffer.from(format.info(file), "utf8"), 32));
}

export function referenceOpen(format: ReferenceFormat, file: Json, secret: Buffer): Buffer {
  const p = format.parts(file);
  const decipher = createDecipheriv("aes-256-gcm", key(format, file, secret, Buffer.from(p.salt, "base64")),
    Buffer.from(p.nonce, "base64"), { authTagLength: 16 });
  decipher.setAAD(Buffer.from(canonicalJson(format.aad(file)), "utf8"));
  decipher.setAuthTag(Buffer.from(p.tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(p.ciphertext, "base64")), decipher.final()]);
}

/** Re-encrypts `plaintext` into the same header with a fresh salt and nonce, exactly as 0.5.45 sealed it. */
export function referenceSeal(format: ReferenceFormat, file: Json, secret: Buffer, plaintext: Buffer): Json {
  const salt = randomBytes(32), nonce = randomBytes(12);
  const header = format.withParts(file, { salt: salt.toString("base64"), nonce: nonce.toString("base64"), ciphertext: "", tag: "" });
  const cipher = createCipheriv("aes-256-gcm", key(format, header, secret, salt), nonce, { authTagLength: 16 });
  cipher.setAAD(Buffer.from(canonicalJson(format.aad(header)), "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return format.withParts(header, { salt: salt.toString("base64"), nonce: nonce.toString("base64"),
    ciphertext: ciphertext.toString("base64"), tag: cipher.getAuthTag().toString("base64") });
}

export type Outcome =
  | { readonly ok: true; readonly plaintext: string }
  | { readonly ok: false; readonly name: string; readonly code: string | null; readonly message: string; readonly details: unknown };

/** What one open attempt did, in a form a golden file can hold and a later version must reproduce exactly. */
export async function outcome(run: () => Promise<unknown>): Promise<Outcome> {
  try { return { ok: true, plaintext: canonicalJson(await run()) }; }
  catch (error) {
    const e = error as { readonly code?: unknown; readonly message?: unknown; readonly details?: unknown; readonly constructor?: { readonly name?: string } };
    return { ok: false, name: e?.constructor?.name ?? typeof error, code: typeof e?.code === "string" ? e.code : null,
      message: String(e?.message ?? error), details: e?.details === undefined ? null : JSON.parse(canonicalJson(e.details)) };
  }
}

function flip(value: string): string {
  const bytes = Buffer.from(value, "base64"); bytes[0] = (bytes[0] ?? 0) ^ 0x01; return bytes.toString("base64");
}
function withPart(format: ReferenceFormat, file: Json, field: keyof Parts, value: (current: string) => string): Json {
  const p = format.parts(file); return format.withParts(file, { ...p, [field]: value(p[field]) });
}

/** Envelope changes that need no key: each must fail exactly as it failed on 0.5.45. */
export const FILE_TAMPERS: Readonly<Record<string, (format: ReferenceFormat, file: Json) => Json>> = {
  "tag-flipped": (f, file) => withPart(f, file, "tag", flip),
  "salt-flipped": (f, file) => withPart(f, file, "salt", flip),
  "nonce-flipped": (f, file) => withPart(f, file, "nonce", flip),
  "ciphertext-flipped": (f, file) => withPart(f, file, "ciphertext", flip),
  "tag-outside-base64": (f, file) => withPart(f, file, "tag", tag => `${tag}A`),
  "tag-wrong-length": (f, file) => withPart(f, file, "tag", () => Buffer.alloc(15, 7).toString("base64")),
  "nonce-wrong-length": (f, file) => withPart(f, file, "nonce", () => Buffer.alloc(16, 7).toString("base64")),
  "ciphertext-empty": (f, file) => withPart(f, file, "ciphertext", () => ""),
};
/** Authenticated changes made with the true secret: decryption succeeds and the plaintext checks must refuse. */
export const PLAINTEXT_TAMPERS: Readonly<Record<string, (plaintext: string) => Buffer>> = {
  "plaintext-not-canonical": plaintext => Buffer.from(JSON.stringify(JSON.parse(plaintext), null, 1), "utf8"),
  "plaintext-not-utf8": () => Buffer.from([0x7b, 0xff, 0x7d]),
  "plaintext-not-json": () => Buffer.from("{", "utf8"),
};

/** As helpers.temporaryState, without importing helpers.js: that loads core.js and every store before the mocks. */
export async function temporaryRoot(): Promise<{ readonly root: string; cleanup(): Promise<void> }> {
  const base = await mkdtemp(join(await realpath(tmpdir()), "apn-custody-"));
  return { root: join(base, "state"), cleanup: async () => await rm(base, { recursive: true, force: true }) };
}

export const GOLDEN_PATH = "tests/fixtures/custody-envelopes/golden-0.5.45.json";
export interface GoldenCase {
  readonly files: Readonly<Record<string, unknown>>;
  readonly envelopePath: string;
  readonly context: Json;
  readonly plaintext: string;
  readonly outcomes: Readonly<Record<string, Outcome>>;
}
export interface Golden {
  readonly schemaVersion: "apn.custody-envelope-golden.v1";
  readonly producedBy: string;
  readonly secret: string;
  readonly cases: Readonly<Record<string, GoldenCase>>;
}
export async function readGolden(): Promise<Golden> { return JSON.parse(await readFile(GOLDEN_PATH, "utf8")) as Golden; }

/** A wrapping-secret port holding one fixed secret; it remembers every copy it hands out so a test can see it zeroed. */
export class FixedSecret implements WrappingSecretPort {
  readonly handed: Buffer[] = [];
  constructor(private readonly secret: Buffer | null) {}
  async load(): Promise<Buffer | null> { return this.copy(); }
  async create(): Promise<Buffer> { const copy = this.copy(); if (copy === null) throw new Error("no secret to create"); return copy; }
  private copy(): Buffer | null {
    if (this.secret === null) return null;
    const copy = Buffer.from(this.secret); this.handed.push(copy); return copy;
  }
}
