import { validX402Tuple, type X402ChainText } from "./x402-network.js";
import { exactKeys, isPlainRecord } from "./canonical.js";
import { decimal, hash, hex32 } from "./local-wallet-native-fields.js";
import type { Address, Hex } from "./model.js";
import { canonicalAddress, canonicalProfile } from "./wallet-policy.js";
import { x402AuthorizationIntentHash } from "./x402-state-integrity.js";
import { ApnError } from "./errors.js";
const HASH = /^[a-f0-9]{64}$/u;
export interface X402Binding {
  readonly profile: string; readonly operationId: string; readonly fingerprint: string;
  readonly wallet: Address; readonly chainId: X402ChainText; readonly token: Address;
  /** EIP-3009: the token's EIP-712 domain. Absent on a Permit2 witness transfer. */
  readonly tokenDomain?: { readonly name: string; readonly version: string };
  /** Permit2 witness transfer: the seller-sponsored exact-amount EIP-2612 permit to Permit2, or null. */
  readonly permit2?: { readonly eip2612: { readonly name: string; readonly version: string; readonly nonce: string } | null };
  readonly authorization: { readonly from: Address; readonly to: Address; readonly value: string; readonly validAfter: "0"; readonly validBefore: string; readonly nonce: Hex };
  readonly intentHash: string;
}

export interface X402Create extends X402Binding {
  readonly payee: Address;
  readonly amountAtomic: string;
  readonly capAtomic: string;
  readonly authorization: X402Binding["authorization"] & { readonly createdAt: string };
}

export type X402CustodyMethod = "eip3009" | "permit2";
const methodKey = (method: X402CustodyMethod) => method === "eip3009" ? "tokenDomain" : "permit2";

export function parseX402Create(payload: Readonly<Record<string, unknown>>, method: X402CustodyMethod = "eip3009"): X402Create {
  const baseKeys = ["profile", "operationId", "fingerprint", "wallet", "chainId", "token", "resource", "capAtomic", "payee", "amountAtomic", methodKey(method), "authorization", "paymentIdentifierPosture", "offerHash", "intentHash"];
  const posture = payload.paymentIdentifierPosture;
  exactRecord(payload, posture === "absent" ? baseKeys : [...baseKeys, "paymentIdentifierValue"]);
  if (method === "permit2" && posture !== "absent") throw protocol("A Permit2 authorization carries no payment identifier.");
  const common = parseX402Common(payload, true, method);
  const resource = exactRecord(payload.resource, ["origin", "path", "urlHash"]);
  if (typeof resource.origin !== "string" || typeof resource.path !== "string" || typeof resource.urlHash !== "string" || !HASH.test(resource.urlHash)) throw protocol("x402 resource binding is invalid.");
  if (!HASH.test(String(payload.offerHash)) || !["absent", "optional", "required"].includes(String(posture))) throw protocol("x402 offer binding is invalid.");
  if (posture !== "absent" && (typeof payload.paymentIdentifierValue !== "string" || payload.paymentIdentifierValue.length === 0)) throw protocol("x402 payment identifier is invalid.");
  const payee = x402Address(payload.payee, "payee");
  const amountAtomic = decimal(payload.amountAtomic, "x402 amount", true);
  const capAtomic = decimal(payload.capAtomic, "x402 cap", true);
  if (BigInt(amountAtomic) > BigInt(capAtomic) || !addressEqual(payee, common.authorization.to) || common.authorization.value !== amountAtomic) throw protocol("x402 economics are invalid.");
  const rawAuthorization = exactRecord(payload.authorization, ["from", "to", "value", "validAfter", "validBefore", "nonce", "createdAt"]);
  const createdAt = decimal(rawAuthorization.createdAt, "x402 creation time");
  const authorization = { ...common.authorization, createdAt };
  const created = BigInt(createdAt);
  const validBefore = BigInt(authorization.validBefore);
  const now = BigInt(Math.floor(Date.now() / 1000));
  if (created > now || validBefore <= now || validBefore - created < 30n || validBefore - created > 300n) throw rejected("APN_APPROVAL_EXPIRED", "x402 authorization window is invalid or expired.");
  if (common.intentHash !== x402AuthorizationIntentHash(authorization)) throw protocol("x402 authorization intent hash is invalid.");
  return { ...common, payee, amountAtomic, capAtomic, authorization };
}

export function parseX402Recovery(payload: Readonly<Record<string, unknown>>, method: X402CustodyMethod = "eip3009"): X402Binding & { readonly expectedSignatureHash?: string } {
  const allowed = ["profile", "operationId", "fingerprint", "wallet", "chainId", "token", methodKey(method), "authorization", "intentHash"];
  exactRecord(payload, payload.expectedSignatureHash === undefined ? allowed : [...allowed, "expectedSignatureHash"]);
  const common = parseX402Common(payload, false, method);
  if (payload.expectedSignatureHash !== undefined && (typeof payload.expectedSignatureHash !== "string" || !HASH.test(payload.expectedSignatureHash))) throw protocol("x402 expected signature hash is invalid.");
  return { ...common, ...(payload.expectedSignatureHash === undefined ? {} : { expectedSignatureHash: payload.expectedSignatureHash as string }) };
}

function parseX402Common(payload: Readonly<Record<string, unknown>>, create: boolean, method: X402CustodyMethod): X402Binding {
  const profile = canonicalProfile(payload.profile);
  const operationId = hash(payload.operationId, "operation ID");
  const fingerprint = hash(payload.fingerprint, "fingerprint");
  const wallet = x402Address(payload.wallet, "wallet");
  const token = x402Address(payload.token, "token");
  if (!validX402Tuple(payload.chainId, `eip155:${String(payload.chainId)}`, token)) throw protocol("x402 network or token is unsupported.");
  const domain = method === "eip3009" ? { tokenDomain: parseTokenDomain(payload.tokenDomain) } : { permit2: parsePermit2(payload.permit2) };
  const authKeys = create ? ["from", "to", "value", "validAfter", "validBefore", "nonce", "createdAt"] : ["from", "to", "value", "validAfter", "validBefore", "nonce"];
  const authorization = exactRecord(payload.authorization, authKeys);
  const from = x402Address(authorization.from, "authorization sender");
  const to = x402Address(authorization.to, "authorization recipient");
  const value = decimal(authorization.value, "x402 value", true);
  const validBefore = decimal(authorization.validBefore, "x402 expiry", true);
  const nonce = hex32(authorization.nonce, "x402 nonce");
  if (!addressEqual(wallet, from) || authorization.validAfter !== "0") throw protocol("x402 authorization binding is invalid.");
  const intentHash = hash(payload.intentHash, "x402 intent hash");
  return {
    profile, operationId, fingerprint, wallet, chainId: payload.chainId as X402ChainText, token, ...domain,
    authorization: { from, to, value, validAfter: "0", validBefore, nonce },
    intentHash,
  };
}

export function x402RecoveryBinding(value: X402Binding): X402Binding {
  return {
    profile: value.profile, operationId: value.operationId, fingerprint: value.fingerprint,
    wallet: value.wallet, chainId: value.chainId, token: value.token,
    ...(value.permit2 !== undefined ? { permit2: value.permit2 } : value.tokenDomain !== undefined ? { tokenDomain: value.tokenDomain } : {}),
    authorization: publicAuthorization(value.authorization), intentHash: value.intentHash,
  };
}

function parseTokenDomain(value: unknown): { readonly name: string; readonly version: string } {
  const tokenDomain = exactRecord(value, ["name", "version"]);
  if (typeof tokenDomain.name !== "string" || tokenDomain.name.length === 0 || typeof tokenDomain.version !== "string" || tokenDomain.version.length === 0) throw protocol("x402 token domain is invalid.");
  return { name: tokenDomain.name, version: tokenDomain.version };
}

function parsePermit2(value: unknown): NonNullable<X402Binding["permit2"]> {
  const permit2 = exactRecord(value, ["eip2612"]);
  if (permit2.eip2612 === null) return { eip2612: null };
  const permit = exactRecord(permit2.eip2612, ["name", "version", "nonce"]);
  const { name, version } = parseTokenDomain({ name: permit.name, version: permit.version });
  return { eip2612: { name, version, nonce: decimal(permit.nonce, "x402 permit nonce") } };
}

export function publicAuthorization(value: X402Binding["authorization"]): X402Binding["authorization"] {
  return {
    from: value.from, to: value.to, value: value.value, validAfter: value.validAfter,
    validBefore: value.validBefore, nonce: value.nonce,
  };
}

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!isPlainRecord(value) || !exactKeys(value, keys)) throw protocol("Custody request violates the exact schema.");
  return value;
}
function addressEqual(left: string, right: string): boolean { return left.toLowerCase() === right.toLowerCase(); }
function x402Address(value: unknown, label: string): Address {
  if (typeof value !== "string") throw protocol(`Invalid x402 ${label}.`);
  canonicalAddress(value);
  if (value !== value.toLowerCase()) throw protocol(`x402 ${label} must be normalized lowercase.`);
  return value as Address;
}
function protocol(message: string): ApnError { return new ApnError("APN_NATIVE_PROTOCOL", message); }
function rejected(nativeCode: string, message: string): ApnError { return new ApnError("APN_NATIVE_REJECTED", message, { nativeCode }); }
