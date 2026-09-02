import { exactKeys, isPlainRecord } from "./canonical.js";

export interface ParsedMetaMaskProcessOutput {
  readonly envelope: Record<string, unknown> | null;
  readonly notices: readonly Record<string, unknown>[];
}

export type MetaMaskPendingNotice =
  | { readonly disposition: "none" }
  | { readonly disposition: "pending"; readonly recoveryToken: string; readonly providerState: "AWAITING_MFA" }
  | { readonly disposition: "invalid"; readonly reason: "provider_response_malformed" | "provider_recovery_identity_mismatch" };

const RESERVED_STREAM_KEYS = new Set(["_notice", "_summary", "_hint", "_error"]);

/**
 * MetaMask Agent Wallet 6.1.5 writes either one ordinary JSON envelope or a
 * newline-delimited stream. Once a command emits a notice, subsequent success
 * is `{ "_summary": ... }` on stdout and failure is `{ "_error": ... }` on
 * stderr. APN captures stdout only, so a notice-only stream is meaningful
 * durable pending evidence rather than malformed JSON.
 */
export function parseMetaMaskProcessOutput(bytes: Buffer): ParsedMetaMaskProcessOutput | null {
  const text = bytes.toString("utf8").trim();
  if (text.length === 0) return null;

  const whole = parseRecord(text);
  if (
    whole !== null && typeof whole.ok === "boolean" &&
    !Object.keys(whole).some((key) => RESERVED_STREAM_KEYS.has(key))
  ) {
    return { envelope: whole, notices: [] };
  }

  const lines = text.split(/\r?\n/u);
  if (lines.some((line) => line.trim().length === 0)) return null;
  const notices: Record<string, unknown>[] = [];
  let envelope: Record<string, unknown> | null = null;
  let terminalSeen = false;

  for (const line of lines) {
    const record = parseRecord(line);
    if (record === null || terminalSeen) return null;
    if (exactKeys(record, ["_notice"]) && isPlainRecord(record._notice)) {
      notices.push(record._notice);
      continue;
    }
    if (
      (exactKeys(record, ["_summary"]) || exactKeys(record, ["_summary", "_hint"])) &&
      isPlainRecord(record._summary) &&
      (record._hint === undefined || typeof record._hint === "string")
    ) {
      envelope = { ok: true, data: record._summary, ...(record._hint === undefined ? {} : { hint: record._hint }) };
      terminalSeen = true;
      continue;
    }
    if (exactKeys(record, ["_error"]) && isPlainRecord(record._error)) {
      envelope = { ok: false, error: record._error };
      terminalSeen = true;
      continue;
    }
    return null;
  }

  if (notices.length === 0) return null;
  return { envelope, notices };
}

export function classifyMetaMaskPendingNotices(
  notices: readonly Record<string, unknown>[],
  expectedRecoveryToken?: string,
): MetaMaskPendingNotice {
  if (notices.length === 0) return { disposition: "none" };
  let recoveryToken: string | undefined;
  for (const notice of notices) {
    const state = notice.kind === "AWAITING_MFA" || notice.status === "AWAITING_MFA"
      ? "AWAITING_MFA" : undefined;
    const token = typeof notice.pollingId === "string" && validRecoveryToken(notice.pollingId)
      ? notice.pollingId : undefined;
    if (state === undefined || token === undefined) {
      return { disposition: "invalid", reason: "provider_response_malformed" };
    }
    if (
      (expectedRecoveryToken !== undefined && token !== expectedRecoveryToken) ||
      (recoveryToken !== undefined && token !== recoveryToken)
    ) return { disposition: "invalid", reason: "provider_recovery_identity_mismatch" };
    recoveryToken = token;
  }
  return recoveryToken === undefined
    ? { disposition: "invalid", reason: "provider_response_malformed" }
    : { disposition: "pending", recoveryToken, providerState: "AWAITING_MFA" };
}

function parseRecord(text: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(text) as unknown;
    return isPlainRecord(value) ? value : null;
  } catch {
    return null;
  }
}

function validRecoveryToken(value: string): boolean {
  return /^[A-Za-z0-9._:-]{1,256}$/u.test(value);
}
