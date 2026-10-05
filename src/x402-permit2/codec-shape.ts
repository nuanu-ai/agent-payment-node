import { canonicalJson, exactKeys, isPlainRecord } from "../canonical.js";
import { ApnError } from "../errors.js";
import type { Address } from "../model.js";
import { planPermit2Authorization } from "./authorization.js";
import { selectPermit2Offer } from "./offer.js";

const UINT256 = (1n << 256n) - 1n;
const ORDER = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const HALF_ORDER = ORDER >> 1n;

/** Strict pinned Permit2 wire shape only; this boundary neither signs nor admits a payment. */
export function validatePermit2PaymentPayload(value: unknown): void {
  try { validate(value); }
  catch { throw new ApnError("APN_HTTP_PROTOCOL", "PAYMENT-SIGNATURE pinned Permit2 shape is invalid."); }
}

function validate(value: unknown): void {
  const wire = record(value);
  if (!exactKeys(wire, ["x402Version", "resource", "accepted", "payload", ...(wire.extensions === undefined ? [] : ["extensions"])]) ||
      wire.x402Version !== 2) invalid();
  const resource = record(wire.resource);
  if (!exactKeys(resource, ["url", ...["description", "mimeType"].filter(key => Object.hasOwn(resource, key))]) ||
      ["description", "mimeType"].some(key => Object.hasOwn(resource, key) &&
        (typeof resource[key] !== "string" || Buffer.byteLength(resource[key] as string) > 2048))) invalid();
  if (typeof resource.url !== "string" || Buffer.byteLength(resource.url) < 1 || Buffer.byteLength(resource.url) > 2048) invalid();
  const endpoint = new URL(resource.url);
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.hash || endpoint.toString() !== resource.url) invalid();
  const payload = record(wire.payload);
  if (!exactKeys(payload, ["signature", "permit2Authorization"])) invalid();
  signature(payload.signature);
  const authorization = record(payload.permit2Authorization);
  if (!exactKeys(authorization, ["from", "permitted", "spender", "nonce", "deadline", "witness"])) invalid();
  if (typeof authorization.from !== "string") invalid();
  const selection = selectPermit2Offer([wire.accepted], authorization.from as Address);
  const nonce = uint(authorization.nonce), deadline = uint(authorization.deadline);
  const signingSecond = deadline - BigInt(selection.maxTimeoutSeconds);
  if (signingSecond < 1n || signingSecond > BigInt(Number.MAX_SAFE_INTEGER)) invalid();
  let permitInfo: Record<string, unknown> | null = null;
  if (wire.extensions !== undefined) {
    const extensions = record(wire.extensions);
    if (!exactKeys(extensions, ["eip2612GasSponsoring"])) invalid();
    const extension = record(extensions.eip2612GasSponsoring);
    if (!exactKeys(extension, ["info"])) invalid();
    permitInfo = record(extension.info);
    if (!exactKeys(permitInfo, ["from", "asset", "spender", "amount", "nonce", "deadline", "version", "signature"])) invalid();
    signature(permitInfo.signature);
  }
  const rebuilt = planPermit2Authorization(selection, {
    payer: authorization.from as Address, nowSeconds: Number(signingSecond), nonce,
    permit2AllowanceAtomic: permitInfo === null ? selection.amountAtomic : "0",
    eip2612Nonce: permitInfo === null ? null : uint(permitInfo.nonce), sellerSponsorsEip2612: permitInfo !== null,
  });
  if (canonicalJson(authorization) !== canonicalJson(rebuilt.authorization)) invalid();
  if (permitInfo !== null) {
    const { signature: _signature, ...info } = permitInfo;
    if (canonicalJson(info) !== canonicalJson(rebuilt.eip2612?.info)) invalid();
  }
}

function record(value: unknown): Record<string, unknown> { if (!isPlainRecord(value)) invalid(); return value; }
function uint(value: unknown): bigint {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]{0,77})$/u.test(value) || BigInt(value) > UINT256) invalid();
  return BigInt(value);
}
function signature(value: unknown): void {
  if (typeof value !== "string" || !/^0x[0-9a-f]{130}$/u.test(value)) invalid();
  const r = BigInt(`0x${value.slice(2, 66)}`), s = BigInt(`0x${value.slice(66, 130)}`);
  if (r === 0n || r >= ORDER || s === 0n || s > HALF_ORDER || !["1b", "1c"].includes(value.slice(130))) invalid();
}
function invalid(): never { throw new Error("Invalid Permit2 wire shape."); }
