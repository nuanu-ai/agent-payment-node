import { ApnError } from "./errors.js";

/**
 * Server mode: APN runs as cloud infrastructure with no person at a terminal. Every consent that the open-source build
 * asks a human to type is granted by the owner policy that the operator configured once; the policy, caps, frozen-fact
 * re-checks and send markers still run unchanged. It is on only when the operator sets `APN_SERVER_MODE=1`.
 */
export const SERVER_MODE_ENV = "APN_SERVER_MODE";

export function isServerMode(): boolean {
  const value = process.env[SERVER_MODE_ENV];
  if (value === undefined || value === "" || value === "0") return false;
  if (value === "1") return true;
  throw new ApnError("APN_INVALID_INPUT", `${SERVER_MODE_ENV} must be 1 (server mode) or 0 (foreground owner mode).`);
}

/**
 * The record of one policy-granted consent: one JSON line on stderr (journald or the container log keeps it). It carries
 * the same lines the terminal would have shown, never a secret: consent screens hold only public facts.
 */
export function recordServerConsent(lines: readonly string[]): void {
  const entry = { apn_server_consent: { at: new Date().toISOString(), terms: lines.filter((line) => line.length > 0) } };
  process.stderr.write(`${JSON.stringify(entry)}\n`);
}
