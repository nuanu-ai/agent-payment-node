import { recoverTypedDataAddress } from "viem";
import { canonicalJson, domainHash, exactKeys, isPlainRecord } from "./canonical.js";
import { BASE_USDC } from "./constants.js";
import { ApnError } from "./errors.js";
import type { NativePort, NativeRequest } from "./ports.js";
import { encodePaymentSignatureHeader } from "./x402-codec.js";
import { materializePaymentIdentifier } from "./x402-policy.js";
import type { X402OperationRecord } from "./x402-state-integrity.js";

const SIGNATURE = /^0x[0-9a-f]{130}$/u;
const HASH = /^[a-f0-9]{64}$/u;
const SECP256K1_ORDER = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const SECP256K1_HALF_ORDER = 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0n;

export type PaymentIdentifierPosture = "absent" | "optional" | "required";

type FrozenAuthorization = Omit<X402OperationRecord["authorization"], "intentHash">;
type PublicAuthorization = Omit<FrozenAuthorization, "createdAt">;

export interface X402NativeCreatePayload {
  readonly profile: string;
  readonly operationId: string;
  readonly fingerprint: string;
  readonly wallet: `0x${string}`;
  readonly chainId: "8453";
  readonly token: `0x${string}`;
  readonly resource: { readonly origin: string; readonly path: string; readonly urlHash: string };
  readonly capAtomic: string;
  readonly payee: `0x${string}`;
  readonly amountAtomic: string;
  readonly tokenDomain: { readonly name: string; readonly version: string };
  readonly authorization: FrozenAuthorization;
  readonly paymentIdentifierPosture: PaymentIdentifierPosture;
  readonly paymentIdentifierValue?: string;
  readonly offerHash: string;
  readonly intentHash: string;
}

export interface X402NativeRecoveryPayload {
  readonly profile: string;
  readonly operationId: string;
  readonly fingerprint: string;
  readonly wallet: `0x${string}`;
  readonly chainId: "8453";
  readonly token: `0x${string}`;
  readonly tokenDomain: { readonly name: string; readonly version: string };
  readonly authorization: PublicAuthorization;
  readonly intentHash: string;
  readonly expectedSignatureHash?: string;
}

export interface X402NativeAuthorizationMaterial {
  readonly authorization: PublicAuthorization;
  readonly signature: `0x${string}`;
  readonly signatureHash: string;
}

export interface VerifiedX402PaymentMaterial {
  readonly native: X402NativeAuthorizationMaterial;
  readonly paymentPayloadHash: string;
  readonly paymentHeaderHash: string;
  readonly paymentHeader: string;
}

export function x402NativeRequest(
  requestId: string,
  operation: X402OperationRecord,
  kind: "create" | "get",
): NativeRequest {
  const payload = kind === "create"
    ? x402NativeCreatePayload(operation)
    : x402NativeRecoveryPayload(operation, operation.signatureHash);
  return {
    version: "apn.native.v1",
    requestId,
    operation: kind === "create"
      ? "x402Exact.approveAndAuthorize"
      : "x402Exact.authorizationMaterial.get",
    payload: payload as unknown as Readonly<Record<string, unknown>>,
  };
}

export function x402NativeCreatePayload(operation: X402OperationRecord): X402NativeCreatePayload {
  const posture = paymentIdentifierPosture(operation);
  return {
    profile: operation.profile,
    operationId: operation.operationId,
    fingerprint: operation.fingerprint,
    wallet: operation.wallet,
    chainId: "8453",
    token: operation.token,
    resource: {
      origin: operation.resource.origin,
      path: operation.resource.path,
      urlHash: operation.resource.urlHash,
    },
    capAtomic: operation.capAtomic,
    payee: operation.payee,
    amountAtomic: operation.amountAtomic,
    tokenDomain: {
      name: operation.selectedOffer.resolved.tokenName,
      version: operation.selectedOffer.resolved.tokenVersion,
    },
    authorization: frozenAuthorization(operation),
    paymentIdentifierPosture: posture,
    ...(operation.paymentIdentifier === undefined ? {} : { paymentIdentifierValue: operation.paymentIdentifier.value }),
    offerHash: operation.selectedOffer.offerHash,
    intentHash: operation.authorization.intentHash,
  };
}

export function x402NativeRecoveryPayload(
  operation: X402OperationRecord,
  expectedSignatureHash?: string,
): X402NativeRecoveryPayload {
  return {
    profile: operation.profile,
    operationId: operation.operationId,
    fingerprint: operation.fingerprint,
    wallet: operation.wallet,
    chainId: "8453",
    token: operation.token,
    tokenDomain: {
      name: operation.selectedOffer.resolved.tokenName,
      version: operation.selectedOffer.resolved.tokenVersion,
    },
    authorization: publicAuthorization(operation),
    intentHash: operation.authorization.intentHash,
    ...(expectedSignatureHash === undefined ? {} : { expectedSignatureHash }),
  };
}

export async function requestX402Authorization(
  native: NativePort,
  request: NativeRequest,
  operation: X402OperationRecord,
): Promise<VerifiedX402PaymentMaterial> {
  return await verifyAndConstructX402PaymentMaterial(await native.request(request), operation);
}

export async function verifyAndConstructX402PaymentMaterial(
  value: unknown,
  operation: X402OperationRecord,
): Promise<VerifiedX402PaymentMaterial> {
  const native = parseNativeMaterial(value);
  if (canonicalJson(native.authorization) !== canonicalJson(publicAuthorization(operation))) {
    throw protocol("Native authorization fields differ from the frozen operation.");
  }
  const signatureBytes = Buffer.from(native.signature.slice(2), "hex");
  const signatureHash = domainHash("apn.x402.signature.v1", signatureBytes);
  if (native.signatureHash !== signatureHash) {
    throw protocol("Native signature hash is invalid.");
  }
  let recovered: string;
  try {
    recovered = await recoverTypedDataAddress({
      domain: {
        name: operation.selectedOffer.resolved.tokenName,
        version: operation.selectedOffer.resolved.tokenVersion,
        chainId: 8453,
        verifyingContract: BASE_USDC,
      },
      types: {
        TransferWithAuthorization: [
          { name: "from", type: "address" },
          { name: "to", type: "address" },
          { name: "value", type: "uint256" },
          { name: "validAfter", type: "uint256" },
          { name: "validBefore", type: "uint256" },
          { name: "nonce", type: "bytes32" },
        ],
      },
      primaryType: "TransferWithAuthorization",
      message: {
        from: native.authorization.from,
        to: native.authorization.to,
        value: BigInt(native.authorization.value),
        validAfter: 0n,
        validBefore: BigInt(native.authorization.validBefore),
        nonce: native.authorization.nonce,
      },
      signature: native.signature,
    });
  } catch {
    throw protocol("Native signature recovery failed.");
  }
  if (recovered.toLowerCase() !== operation.wallet || native.authorization.from !== operation.wallet) {
    throw protocol("Native signature does not recover the frozen payer.");
  }

  const resource = parseProtectedCanonical(operation.sellerWire.resourceCanonicalJson, "resource");
  const accepted = parseProtectedCanonical(operation.selectedOffer.declaredCanonicalJson, "accepted requirements");
  const paymentIdentifierDeclaration = materializePaymentIdentifier(operation.paymentIdentifier);
  const payload = {
    x402Version: 2,
    resource,
    accepted,
    payload: {
      signature: native.signature,
      authorization: {
        from: native.authorization.from,
        to: native.authorization.to,
        value: native.authorization.value,
        validAfter: native.authorization.validAfter,
        validBefore: native.authorization.validBefore,
        nonce: native.authorization.nonce,
      },
    },
    ...(paymentIdentifierDeclaration === undefined ? {} : {
      extensions: { "payment-identifier": paymentIdentifierDeclaration as Record<string, unknown> },
    }),
  };
  const paymentHeader = encodePaymentSignatureHeader(payload);
  const paymentPayloadHash = domainHash("apn.x402.payment-payload.v1", canonicalJson(payload));
  const paymentHeaderHash = domainHash("apn.x402.payment-header.v1", Buffer.from(paymentHeader, "ascii"));
  return { native, paymentPayloadHash, paymentHeaderHash, paymentHeader };
}

export function isNativeNotFound(error: unknown): boolean {
  return error instanceof ApnError && error.code === "APN_NATIVE_REJECTED" &&
    error.details?.nativeCode === "APN_X402_AUTHORIZATION_NOT_FOUND";
}

export function isNativeExpired(error: unknown): boolean {
  return error instanceof ApnError && error.code === "APN_NATIVE_REJECTED" &&
    error.details?.nativeCode === "APN_APPROVAL_EXPIRED";
}

export function isTransientNativeFailure(error: unknown): boolean {
  if (!(error instanceof ApnError)) return false;
  if (error.code === "APN_NATIVE_PROTOCOL" && error.details?.nativeTransport === true) return true;
  if (error.code !== "APN_NATIVE_REJECTED") return false;
  return [
    "APN_KEYCHAIN_LOCKED",
    "APN_KEYCHAIN_UNAVAILABLE",
    "APN_KEYCHAIN_FAILURE",
    "APN_STATE_BUSY",
  ].includes(String(error.details?.nativeCode));
}

function paymentIdentifierPosture(operation: X402OperationRecord): PaymentIdentifierPosture {
  if (operation.paymentIdentifier === undefined) return "absent";
  const declaration = parseProtectedCanonical(operation.paymentIdentifier.declarationCanonicalJson, "payment identifier");
  if (!isPlainRecord(declaration.info) || typeof declaration.info.required !== "boolean") {
    throw new ApnError("APN_STATE_CORRUPT", "Protected payment-identifier posture is invalid.");
  }
  return declaration.info.required ? "required" : "optional";
}

function parseNativeMaterial(value: unknown): X402NativeAuthorizationMaterial {
  if (!isPlainRecord(value) || !exactKeys(value, ["authorization", "signature", "signatureHash"])) {
    throw protocol("Native authorization response violates the exact schema.");
  }
  if (!isPlainRecord(value.authorization) || !exactKeys(value.authorization, [
    "from", "to", "value", "validAfter", "validBefore", "nonce",
  ])) throw protocol("Native authorization response fields are invalid.");
  if (typeof value.signature !== "string" || !SIGNATURE.test(value.signature)) {
    throw protocol("Native authorization signature is not canonical.");
  }
  const r = BigInt(`0x${value.signature.slice(2, 66)}`);
  const s = BigInt(`0x${value.signature.slice(66, 130)}`);
  const recovery = value.signature.slice(130);
  if (r === 0n || r >= SECP256K1_ORDER || s === 0n || s > SECP256K1_HALF_ORDER || (recovery !== "1b" && recovery !== "1c")) {
    throw protocol("Native authorization signature scalar or recovery byte is invalid.");
  }
  if (typeof value.signatureHash !== "string" || !HASH.test(value.signatureHash)) {
    throw protocol("Native authorization signature hash is invalid.");
  }
  return value as unknown as X402NativeAuthorizationMaterial;
}

function frozenAuthorization(operation: X402OperationRecord): FrozenAuthorization {
  return {
    from: operation.authorization.from,
    to: operation.authorization.to,
    value: operation.authorization.value,
    validAfter: operation.authorization.validAfter,
    validBefore: operation.authorization.validBefore,
    nonce: operation.authorization.nonce,
    createdAt: operation.authorization.createdAt,
  };
}

function publicAuthorization(operation: X402OperationRecord): PublicAuthorization {
  return {
    from: operation.authorization.from,
    to: operation.authorization.to,
    value: operation.authorization.value,
    validAfter: operation.authorization.validAfter,
    validBefore: operation.authorization.validBefore,
    nonce: operation.authorization.nonce,
  };
}

function parseProtectedCanonical(text: string, label: string): Record<string, unknown> {
  let value: unknown;
  try { value = JSON.parse(text) as unknown; }
  catch { throw new ApnError("APN_STATE_CORRUPT", `Protected ${label} JSON is invalid.`); }
  if (!isPlainRecord(value) || canonicalJson(value) !== text) {
    throw new ApnError("APN_STATE_CORRUPT", `Protected ${label} JSON is not canonical.`);
  }
  return value;
}

function protocol(message: string): ApnError {
  return new ApnError("APN_NATIVE_PROTOCOL", message);
}
