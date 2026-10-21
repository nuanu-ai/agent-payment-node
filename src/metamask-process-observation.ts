import { isPlainRecord, sha256 } from "./canonical.js";
import type { MetaMaskNativeDiagnostic } from "./metamask-native-diagnostic.js";
import { METAMASK_AGENT_WALLET_SHASUM, METAMASK_AGENT_WALLET_VERSION } from "./metamask-package.js";

type JsonType = "object" | "array" | "string" | "number" | "boolean" | "null";
export interface MetaMaskObjectShape { readonly keys: readonly MetaMaskKeyShape[]; readonly otherKeys: number }
/** A key's name and value type; a value only for the provider's own enum fields, never ids, addresses, hashes or text. */
export interface MetaMaskKeyShape {
  readonly key: string; readonly type: JsonType; readonly value?: string | boolean; readonly object?: MetaMaskObjectShape;
}
export type MetaMaskFrameShape =
  | { readonly json: false; readonly bytes: number }
  | { readonly json: true; readonly type: JsonType; readonly object?: MetaMaskObjectShape };
export interface MetaMaskStreamShape {
  readonly bytes: number;
  /** "truncated": APN kept only the first bytes (stderr 4 KiB, stdout 1 MiB); the hash covers complete captures only. */
  readonly captured: "empty" | "complete" | "truncated";
  readonly sha256: string | null;
  readonly frames: readonly MetaMaskFrameShape[];
  readonly framesOmitted: number;
}
/**
 * What one `mm` child process answered, taken before its bytes are zeroed: exit, both streams' sizes, SHA-256 and JSON
 * shape. The package is the one the resolver admits (it refuses any other version or tarball). Diagnosis only: it
 * never changes a classification and is never a reason to send again.
 */
export interface MetaMaskProcessObservation {
  readonly provider: { readonly package: "@metamask/agent-wallet"; readonly version: string; readonly shasum: string };
  readonly outcome: "exit" | "signal" | "timeout" | "start" | "protocol" | "deadline";
  readonly exitCode: number | null;
  readonly signal: MetaMaskNativeDiagnostic["signal"];
  readonly durationMs: number;
  readonly stdout: MetaMaskStreamShape;
  readonly stderr: MetaMaskStreamShape;
}
export interface MetaMaskCapturedStream { readonly bytes: Buffer; readonly total: number }

const ENUM_KEYS = new Set(["ok", "code", "kind", "status", "mode", "chainNamespace"]);
const KEY = /^[A-Za-z_$][A-Za-z0-9_$.-]{0,63}$/u, ENUM = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/u;
const MAX_KEYS = 32, MAX_FRAMES = 8;

export function observeMetaMaskProcess(input: Omit<MetaMaskProcessObservation, "provider" | "stdout" | "stderr"> &
  { readonly stdout: MetaMaskCapturedStream; readonly stderr: MetaMaskCapturedStream }): MetaMaskProcessObservation {
  return Object.freeze({
    provider: { package: "@metamask/agent-wallet" as const, version: METAMASK_AGENT_WALLET_VERSION, shasum: METAMASK_AGENT_WALLET_SHASUM },
    outcome: input.outcome, exitCode: input.exitCode, signal: input.signal, durationMs: input.durationMs,
    stdout: streamShape(input.stdout), stderr: streamShape(input.stderr),
  });
}

function streamShape({ bytes, total }: MetaMaskCapturedStream): MetaMaskStreamShape {
  if (total === 0) return { bytes: 0, captured: "empty", sha256: null, frames: [], framesOmitted: 0 };
  const complete = bytes.length === total, text = bytes.toString("utf8").trim(), whole = parse(text);
  const lines = whole === undefined ? text.split(/\r?\n/u).filter((line) => line.trim().length > 0) : [];
  const frames = whole === undefined ? lines.slice(0, MAX_FRAMES).map((line) => frame(line)) : [frameOf(whole)];
  return { bytes: total, captured: complete ? "complete" : "truncated", sha256: complete ? sha256(bytes) : null,
    frames, framesOmitted: Math.max(0, lines.length - MAX_FRAMES) };
}

function frame(line: string): MetaMaskFrameShape {
  const value = parse(line.trim());
  return value === undefined ? { json: false, bytes: Buffer.byteLength(line, "utf8") } : frameOf(value);
}

function frameOf(value: unknown): MetaMaskFrameShape {
  return isPlainRecord(value) ? { json: true, type: "object", object: objectShape(value, true) } : { json: true, type: typeOf(value) };
}

function objectShape(value: Record<string, unknown>, nest: boolean): MetaMaskObjectShape {
  const named = Object.keys(value).filter((key) => KEY.test(key)), keys = named.slice(0, MAX_KEYS).map((key): MetaMaskKeyShape => {
    const item = value[key], type = typeOf(item);
    const shown = ENUM_KEYS.has(key) && (typeof item === "boolean" || typeof item === "string" && ENUM.test(item)) ? { value: item as string | boolean } : {};
    return { key, type, ...shown, ...(nest && isPlainRecord(item) ? { object: objectShape(item, false) } : {}) };
  });
  return { keys, otherKeys: Object.keys(value).length - keys.length };
}

function typeOf(value: unknown): JsonType {
  return value === null ? "null" : Array.isArray(value) ? "array" : typeof value === "object" ? "object"
    : typeof value === "string" ? "string" : typeof value === "number" ? "number" : "boolean";
}

function parse(text: string): unknown {
  if (text.length === 0) return undefined;
  try { return JSON.parse(text) as unknown; } catch { return undefined; }
}
