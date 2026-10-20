import { recoverTypedDataAddress } from "viem";
import { canonicalJson, domainHash, exactKeys, isPlainRecord } from "./canonical.js";
import { ApnError } from "./errors.js";
import type { Hex } from "./model.js";
import type { NativeRequest } from "./ports.js";
import { encodePaymentSignatureHeader } from "./x402-codec.js";
import type { VerifiedX402PaymentMaterial } from "./x402-native.js";
import { x402Eip2612Info, x402Eip2612TypedData, x402Permit2Authorization, x402Permit2TypedData, type X402Permit2Terms } from "./x402-permit2-exact.js";
import type { X402OperationRecord } from "./x402-state-integrity.js";

const SIGNATURE = /^0x[0-9a-f]{130}$/u;
const HASH = /^[a-f0-9]{64}$/u;
const ORDER = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;

/** The Permit2 operation's frozen terms: its EIP-3009-shaped authorization is the witness transfer. */
export function x402Permit2Terms(operation: X402OperationRecord): X402Permit2Terms {
  return { chainId: Number(operation.chainId), token: operation.token, from: operation.wallet, to: operation.payee,
    value: operation.amountAtomic, nonce: operation.authorization.nonce, deadline: operation.authorization.validBefore };
}

function permit2Resolved(operation: X402OperationRecord) {
  const resolved = operation.selectedOffer.resolved;
  if (resolved.assetTransferMethod !== "permit2") throw new ApnError("APN_STATE_CORRUPT", "Permit2 material path received another x402 transfer method.");
  return resolved;
}

function custodyPermit2(operation: X402OperationRecord) {
  const permit = permit2Resolved(operation).eip2612;
  return { eip2612: permit === null ? null : { name: permit.tokenName, version: permit.tokenVersion, nonce: permit.nonce } };
}

const publicAuthorization = (operation: X402OperationRecord) => ({ from: operation.authorization.from, to: operation.authorization.to,
  value: operation.authorization.value, validAfter: operation.authorization.validAfter, validBefore: operation.authorization.validBefore,
  nonce: operation.authorization.nonce });

/** Custody request for a Permit2 witness transfer: the same frozen binding as EIP-3009, the Permit2 terms instead of a token domain. */
export function x402Permit2NativeRequest(requestId: string, operation: X402OperationRecord, kind: "create" | "get"): NativeRequest {
  const binding = { profile: operation.profile, operationId: operation.operationId, fingerprint: operation.fingerprint, wallet: operation.wallet,
    chainId: operation.chainId, token: operation.token, permit2: custodyPermit2(operation) };
  const payload = kind === "create" ? {
    ...binding, resource: { origin: operation.resource.origin, path: operation.resource.path, urlHash: operation.resource.urlHash },
    capAtomic: operation.capAtomic, payee: operation.payee, amountAtomic: operation.amountAtomic,
    authorization: { ...publicAuthorization(operation), createdAt: operation.authorization.createdAt },
    paymentIdentifierPosture: "absent", offerHash: operation.selectedOffer.offerHash, intentHash: operation.authorization.intentHash,
  } : { ...binding, authorization: publicAuthorization(operation), intentHash: operation.authorization.intentHash,
    ...(operation.signatureHash === undefined ? {} : { expectedSignatureHash: operation.signatureHash }) };
  return { version: "apn.native.v1", requestId, operation: kind === "create" ? "x402Permit2.approveAndAuthorize" : "x402Permit2.authorizationMaterial.get",
    payload: payload as unknown as Readonly<Record<string, unknown>> };
}

/** Both signatures must recover the frozen payer over typed data rebuilt from the record; the wire is built from the same terms. */
export async function verifyX402Permit2Material(value: unknown, operation: X402OperationRecord): Promise<VerifiedX402PaymentMaterial> {
  const permit = permit2Resolved(operation).eip2612;
  if (!isPlainRecord(value) || !exactKeys(value, ["authorization", "signature", "signatureHash", ...(permit === null ? [] : ["eip2612Signature"])]) ||
      !isPlainRecord(value.authorization) || canonicalJson(value.authorization) !== canonicalJson(publicAuthorization(operation)) ||
      !canonicalSignature(value.signature) || (permit !== null && !canonicalSignature(value.eip2612Signature)) ||
      typeof value.signatureHash !== "string" || !HASH.test(value.signatureHash) ||
      value.signatureHash !== domainHash("apn.x402.signature.v1", Buffer.from(value.signature.slice(2), "hex"))) {
    throw new ApnError("APN_NATIVE_PROTOCOL", "Native Permit2 authorization response violates the exact schema.");
  }
  const terms = x402Permit2Terms(operation);
  const permitTerms = permit === null ? null : { name: permit.tokenName, version: permit.tokenVersion, nonce: permit.nonce };
  const signature = value.signature as Hex, eip2612Signature = value.eip2612Signature as Hex | undefined;
  await assertRecovers(x402Permit2TypedData(terms), signature, operation.wallet);
  if (permitTerms !== null) await assertRecovers(x402Eip2612TypedData(terms, permitTerms), eip2612Signature!, operation.wallet);
  const payload = {
    x402Version: 2,
    resource: protectedJson(operation.sellerWire.resourceCanonicalJson),
    accepted: protectedJson(operation.selectedOffer.declaredCanonicalJson),
    payload: { signature, permit2Authorization: x402Permit2Authorization(terms) },
    ...(permitTerms === null ? {} : { extensions: { eip2612GasSponsoring: { info: x402Eip2612Info(terms, permitTerms, eip2612Signature!) } } }),
  };
  const paymentHeader = encodePaymentSignatureHeader(payload);
  return {
    native: { authorization: publicAuthorization(operation), signature, signatureHash: value.signatureHash },
    materialHash: value.signatureHash,
    paymentPayloadHash: domainHash("apn.x402.payment-payload.v1", canonicalJson(payload)),
    paymentHeaderHash: domainHash("apn.x402.payment-header.v1", Buffer.from(paymentHeader, "ascii")),
    paymentHeader,
  };
}

async function assertRecovers(typedData: unknown, signature: Hex, wallet: string): Promise<void> {
  let recovered: string;
  try { recovered = await recoverTypedDataAddress({ ...(typedData as object), signature } as Parameters<typeof recoverTypedDataAddress>[0]); }
  catch { throw new ApnError("APN_NATIVE_PROTOCOL", "Native Permit2 signature recovery failed."); }
  if (recovered.toLowerCase() !== wallet.toLowerCase()) throw new ApnError("APN_NATIVE_PROTOCOL", "Native Permit2 signature does not recover the frozen payer.");
}

function canonicalSignature(value: unknown): value is Hex {
  if (typeof value !== "string" || !SIGNATURE.test(value)) return false;
  const r = BigInt(`0x${value.slice(2, 66)}`), s = BigInt(`0x${value.slice(66, 130)}`);
  return r !== 0n && r < ORDER && s !== 0n && s <= ORDER >> 1n && ["1b", "1c"].includes(value.slice(130));
}

function protectedJson(text: string): Record<string, unknown> {
  const value = JSON.parse(text) as unknown;
  if (!isPlainRecord(value) || canonicalJson(value) !== text) throw new ApnError("APN_STATE_CORRUPT", "Protected x402 JSON is not canonical.");
  return value;
}
