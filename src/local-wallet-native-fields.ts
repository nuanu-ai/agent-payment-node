import { ApnError } from "./errors.js";
import { sha256 } from "./canonical.js";
import type { WalletIdentity } from "./encrypted-wallet-store.js";
import { canonicalProfile } from "./wallet-policy.js";
import type { Address, Hex } from "./model.js";
const DECIMAL = /^(?:0|[1-9][0-9]*)$/u;
const HASH = /^[a-f0-9]{64}$/u;
const NONCE = /^0x[0-9a-fA-F]{64}$/u;
export function decimal(value: unknown, label: string, positive = false): string {
  if (typeof value !== "string" || !DECIMAL.test(value) || (positive && value === "0")) throw protocol(`Invalid ${label}.`);
  return value;
}

export function hash(value: unknown, label: string): string {
  if (typeof value !== "string" || !HASH.test(value)) throw protocol(`Invalid ${label}.`);
  return value;
}

export function hex32(value: unknown, label: string): Hex {
  if (typeof value !== "string" || !NONCE.test(value)) throw protocol(`Invalid ${label}.`);
  return value as Hex;
}

export function assertWallet(identity: WalletIdentity, expected: Address): void {
  if (!addressEqual(identity.address, expected)) throw rejected("APN_WALLET_MISMATCH", "Wallet identity differs from the frozen payment.");
}

export function ensureX402Live(validBefore: string): void {
  if (BigInt(Math.floor(Date.now() / 1000)) >= BigInt(validBefore)) throw rejected("APN_APPROVAL_EXPIRED", "x402 authorization is expired.");
}

export function effectSlot(domain: string, profile: string, operationId: string, fingerprint: string): string {
  return sha256(`${domain}\0${profile}\0${operationId}\0${fingerprint}`);
}

export function requestProfile(payload: Readonly<Record<string, unknown>>): string {
  return canonicalProfile(payload.profile);
}

export function protocol(message: string): ApnError { return new ApnError("APN_NATIVE_PROTOCOL", message); }

export function rejected(nativeCode: string, message: string): ApnError {
  return new ApnError("APN_NATIVE_REJECTED", message, { nativeCode });
}

function addressEqual(left: string, right: string): boolean { return left.toLowerCase() === right.toLowerCase(); }
