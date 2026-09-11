import { recoverTypedDataAddress } from "viem";
import { recoverAuthorizationAddress } from "viem/utils";
import type { Hex } from "../model.js";
import type { GaslessBootstrapMaterial } from "./ports.js";
import type { GaslessAuthorization, GaslessIntent, GaslessUserOperation } from "./model.js";
import { gaslessExact, gaslessFailure, gaslessHex } from "./validation.js";
import { gaslessPermitTypedData, gaslessUserOperationHash, gaslessUserOperationTypedData, validateGaslessWire } from "./wire.js";

const CURVE_ORDER = BigInt("0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141");
const HALF_CURVE_ORDER = CURVE_ORDER / 2n;

/** Valid low-s ECDSA shape which is never produced by or accepted as an APN owner signature. */
export const GASLESS_ESTIMATE_SIGNATURE =
  `0x${"0".repeat(63)}1${"0".repeat(63)}1${"1b"}` as Hex;

export async function verifyGaslessBootstrap(intent: GaslessIntent,
  value: Pick<GaslessBootstrapMaterial, "permitSignature" | "authorization">): Promise<void> {
  const record = gaslessExact(value, ["permitSignature", "authorization"], "APN_PROVIDER_PROTOCOL");
  const permit = canonicalSignature(record.permitSignature);
  let permitOwner: string;
  try { permitOwner = await recoverTypedDataAddress({ ...gaslessPermitTypedData(intent), signature: permit }); }
  catch { return signatureFailure(); }
  if (permitOwner !== intent.owner.address) signatureFailure();

  if (intent.initialSnapshot.delegation === "expected") {
    if (record.authorization !== null) signatureFailure();
    return;
  }
  if (intent.initialSnapshot.delegation !== "empty" || record.authorization === null) signatureFailure();
  const authorization = validateSignedAuthorization(intent, record.authorization);
  let authorizationOwner: string;
  try {
    authorizationOwner = await recoverAuthorizationAddress({ authorization: {
      chainId: intent.request.chainId,
      address: authorization.address,
      nonce: Number(BigInt(authorization.nonce)),
      r: authorization.r,
      s: authorization.s,
      yParity: Number(BigInt(authorization.yParity)),
    } });
  } catch { return signatureFailure(); }
  if (authorizationOwner !== intent.owner.address) signatureFailure();
}

export async function verifyGaslessUserOperation(intent: GaslessIntent, value: GaslessUserOperation): Promise<Hex> {
  const wire = validateGaslessWire(intent, value);
  const prefixBytes = (1 + 20 + 32) * 2;
  const permitSignature = gaslessHex(`0x${wire.paymasterData.slice(2 + prefixBytes)}`, 65, 65);
  await verifyGaslessBootstrap(intent, { permitSignature, authorization: wire.eip7702Auth ?? null });
  const signature = canonicalSignature(wire.signature);
  let signer: string;
  try { signer = await recoverTypedDataAddress({ ...gaslessUserOperationTypedData(intent, wire), signature }); }
  catch { return signatureFailure(); }
  if (signer !== intent.owner.address) signatureFailure();
  return gaslessUserOperationHash(intent, wire);
}

function validateSignedAuthorization(intent: GaslessIntent, value: unknown): GaslessAuthorization {
  const record = gaslessExact(value, ["chainId", "address", "nonce", "yParity", "r", "s"], "APN_PROVIDER_PROTOCOL");
  const authorization = record as unknown as GaslessAuthorization;
  const expectedChain = `0x${intent.request.chainId.toString(16)}`;
  const expectedNonce = `0x${BigInt(intent.initialSnapshot.eoaNonceAtomic).toString(16)}`;
  if (authorization.chainId !== expectedChain || authorization.address !== intent.delegate ||
    authorization.nonce !== expectedNonce || !["0x0", "0x1"].includes(authorization.yParity)) signatureFailure();
  canonicalParts(authorization.r, authorization.s);
  return authorization;
}

function canonicalSignature(value: unknown): Hex {
  const signature = gaslessHex(value, 65, 65);
  const parity = signature.slice(-2);
  if (parity !== "1b" && parity !== "1c") signatureFailure();
  canonicalParts(`0x${signature.slice(2, 66)}`, `0x${signature.slice(66, 130)}`);
  return signature;
}

function canonicalParts(rValue: unknown, sValue: unknown): void {
  const r = gaslessHex(rValue, 32, 32), s = gaslessHex(sValue, 32, 32);
  const rNumber = BigInt(r), sNumber = BigInt(s);
  if (rNumber === 0n || rNumber >= CURVE_ORDER || sNumber === 0n || sNumber > HALF_CURVE_ORDER) signatureFailure();
}

function signatureFailure(): never {
  return gaslessFailure("APN_PROVIDER_PROTOCOL", "gasless_protocol_identity");
}
