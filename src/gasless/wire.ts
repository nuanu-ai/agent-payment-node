import { concat, decodeFunctionData, encodeFunctionData, hashTypedData, numberToHex, padHex } from "viem";
import type { Address, Hex } from "../model.js";
import { GASLESS_ACCOUNT_ABI, GASLESS_TOKEN_ABI } from "./abi.js";
import type { GaslessBootstrapMaterial } from "./ports.js";
import type { GaslessAuthorization, GaslessIntent, GaslessUserOperation } from "./model.js";
import { GASLESS_FACTORY, GASLESS_MAX_UINT, GASLESS_ZERO_ADDRESS, gaslessAddress, gaslessExact, gaslessFailure, gaslessHex,
  gaslessSame, gaslessUint } from "./validation.js";

const WIRE_FIELDS = ["sender", "nonce", "factory", "factoryData", "callData", "callGasLimit",
  "verificationGasLimit", "preVerificationGas", "maxFeePerGas", "maxPriorityFeePerGas", "paymaster",
  "paymasterVerificationGasLimit", "paymasterPostOpGasLimit", "paymasterData", "signature"] as const;
const AUTH_FIELDS = ["chainId", "address", "nonce", "yParity", "r", "s"] as const;
const CURVE_ORDER = BigInt("0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141");
const HALF_CURVE_ORDER = CURVE_ORDER / 2n;

export function gaslessBatch(token: Address, recipient: Address, recipientAtomic: string, paymaster: Address): Hex {
  gaslessAddress(token); gaslessAddress(recipient); gaslessAddress(paymaster);
  if (recipient === GASLESS_ZERO_ADDRESS || recipient === token || recipient === paymaster) wireFailure();
  const amount = gaslessUint(recipientAtomic, true);
  const transfer = encodeFunctionData({ abi: GASLESS_TOKEN_ABI, functionName: "transfer", args: [recipient, amount] });
  const cleanup = encodeFunctionData({ abi: GASLESS_TOKEN_ABI, functionName: "approve", args: [paymaster, 0n] });
  return encodeFunctionData({ abi: GASLESS_ACCOUNT_ABI, functionName: "executeBatch", args: [[
    { target: token, value: 0n, data: transfer }, { target: token, value: 0n, data: cleanup },
  ]] });
}

export function validateGaslessBatch(intent: GaslessIntent): void {
  const recipient = intent.request.recipient;
  if ([intent.owner.address, intent.token, intent.paymaster, intent.entryPoint, intent.delegate].includes(recipient)) wireFailure();
  const expected = gaslessBatch(intent.token, intent.request.recipient, intent.recipientAtomic, intent.paymaster);
  const data = gaslessHex(intent.callData);
  try {
    const decoded = decodeFunctionData({ abi: GASLESS_ACCOUNT_ABI, data });
    if (decoded.functionName !== "executeBatch" || !gaslessSame(data, expected) || data !== expected) wireFailure();
  } catch { wireFailure(); }
}

export function gaslessPermitTypedData(intent: GaslessIntent) {
  return {
    domain: {
      name: intent.tokenDomain.name,
      version: intent.tokenDomain.version,
      chainId: intent.tokenDomain.chainId,
      verifyingContract: intent.tokenDomain.verifyingContract,
    },
    types: { Permit: [
      { name: "owner", type: "address" }, { name: "spender", type: "address" },
      { name: "value", type: "uint256" }, { name: "nonce", type: "uint256" },
      { name: "deadline", type: "uint256" },
    ] },
    primaryType: "Permit" as const,
    message: {
      owner: intent.owner.address, spender: intent.paymaster, value: BigInt(intent.feeCapAtomic),
      nonce: BigInt(intent.initialSnapshot.permitNonceAtomic), deadline: GASLESS_MAX_UINT,
    },
  } as const;
}

export function gaslessAuthorizationRequest(intent: GaslessIntent) {
  const nonce = gaslessUint(intent.initialSnapshot.eoaNonceAtomic);
  if (nonce > BigInt(Number.MAX_SAFE_INTEGER)) wireFailure();
  return { chainId: intent.request.chainId, address: intent.delegate, nonce: Number(nonce) } as const;
}

export function gaslessUserOperation(intent: GaslessIntent,
  bootstrap: Pick<GaslessBootstrapMaterial, "permitSignature" | "authorization">,
  signature: Hex): GaslessUserOperation {
  validateGaslessBatch(intent);
  const permit = structuralSignature(bootstrap.permitSignature);
  const accountSignature = structuralSignature(signature);
  const base = {
    sender: intent.owner.address,
    nonce: quantity(intent.initialSnapshot.entryPointNonceAtomic),
    factory: GASLESS_FACTORY,
    factoryData: "0x" as const,
    callData: intent.callData,
    callGasLimit: quantity(intent.gas.callGasLimit),
    verificationGasLimit: quantity(intent.gas.verificationGasLimit),
    preVerificationGas: quantity(intent.gas.preVerificationGas),
    maxFeePerGas: quantity(intent.gas.maxFeePerGas),
    maxPriorityFeePerGas: quantity(intent.gas.maxPriorityFeePerGas),
    paymaster: intent.paymaster,
    paymasterVerificationGasLimit: quantity(intent.gas.paymasterVerificationGasLimit),
    paymasterPostOpGasLimit: quantity(intent.gas.paymasterPostOpGasLimit),
    paymasterData: concat(["0x00", intent.token, word(intent.feeCapAtomic), permit]).toLowerCase() as Hex,
    signature: accountSignature,
  };
  if (bootstrap.authorization === null) {
    if (intent.initialSnapshot.delegation !== "expected") wireFailure();
    return base;
  }
  if (intent.initialSnapshot.delegation !== "empty") wireFailure();
  return { ...base, eip7702Auth: validateAuthorization(intent, bootstrap.authorization) };
}

export function gaslessUserOperationTypedData(intent: GaslessIntent, wire: GaslessUserOperation) {
  const validated = validateGaslessWire(intent, wire);
  return {
    types: { PackedUserOperation: [
      { type: "address", name: "sender" }, { type: "uint256", name: "nonce" },
      { type: "bytes", name: "initCode" }, { type: "bytes", name: "callData" },
      { type: "bytes32", name: "accountGasLimits" }, { type: "uint256", name: "preVerificationGas" },
      { type: "bytes32", name: "gasFees" }, { type: "bytes", name: "paymasterAndData" },
    ] },
    primaryType: "PackedUserOperation" as const,
    domain: { name: "ERC4337", version: "1", chainId: intent.request.chainId, verifyingContract: intent.entryPoint },
    message: {
      sender: validated.sender,
      nonce: BigInt(validated.nonce),
      initCode: intent.delegate,
      callData: validated.callData,
      accountGasLimits: concat([padHex(validated.verificationGasLimit, { size: 16 }),
        padHex(validated.callGasLimit, { size: 16 })]),
      preVerificationGas: BigInt(validated.preVerificationGas),
      gasFees: concat([padHex(validated.maxPriorityFeePerGas, { size: 16 }),
        padHex(validated.maxFeePerGas, { size: 16 })]),
      paymasterAndData: concat([validated.paymaster,
        padHex(validated.paymasterVerificationGasLimit, { size: 16 }),
        padHex(validated.paymasterPostOpGasLimit, { size: 16 }), validated.paymasterData]).toLowerCase() as Hex,
    },
  } as const;
}

export function gaslessUserOperationHash(intent: GaslessIntent, wire: GaslessUserOperation): Hex {
  return hashTypedData(gaslessUserOperationTypedData(intent, wire));
}

export function validateGaslessWire(intent: GaslessIntent, value: unknown): GaslessUserOperation {
  const expectsAuthorization = intent.initialSnapshot.delegation === "empty";
  const fields = expectsAuthorization ? [...WIRE_FIELDS, "eip7702Auth"] : WIRE_FIELDS;
  const record = gaslessExact(value, fields, "APN_PROVIDER_PROTOCOL");
  const wire = record as unknown as GaslessUserOperation;
  validateGaslessBatch(intent);
  const permit = parsePaymasterData(intent, wire.paymasterData);
  structuralSignature(wire.signature);
  const authorization = expectsAuthorization ? validateAuthorization(intent, wire.eip7702Auth) : null;
  const rebuilt = gaslessUserOperation(intent, { permitSignature: permit, authorization }, wire.signature);
  if (!gaslessSame(rebuilt, wire)) wireFailure();
  return wire;
}

export function gaslessEnvelopeBinding(intent: Omit<GaslessIntent, "unsignedEnvelopeHash"> | GaslessIntent): unknown {
  const { unsignedEnvelopeHash: _hash, ...body } = intent as GaslessIntent;
  return { schemaVersion: "apn.gasless-envelope.v1", ...body, permitDeadlineAtomic: GASLESS_MAX_UINT.toString() };
}

function parsePaymasterData(intent: GaslessIntent, value: unknown): Hex {
  const data = gaslessHex(value, 118, 118);
  if (!data.startsWith(`0x00${intent.token.slice(2).toLowerCase()}${word(intent.feeCapAtomic).slice(2)}`)) wireFailure();
  return structuralSignature(`0x${data.slice(2 + (1 + 20 + 32) * 2)}`);
}

function validateAuthorization(intent: GaslessIntent, value: unknown): GaslessAuthorization {
  const record = gaslessExact(value, AUTH_FIELDS, "APN_PROVIDER_PROTOCOL");
  const authorization = record as unknown as GaslessAuthorization;
  if (authorization.chainId !== quantity(String(intent.request.chainId)) ||
    authorization.address !== intent.delegate || authorization.nonce !== quantity(intent.initialSnapshot.eoaNonceAtomic) ||
    !["0x0", "0x1"].includes(authorization.yParity) ||
    gaslessHex(authorization.r, 32, 32) !== authorization.r || gaslessHex(authorization.s, 32, 32) !== authorization.s) wireFailure();
  return authorization;
}

function quantity(value: string): Hex {
  return numberToHex(gaslessUint(value, false, "APN_PROVIDER_PROTOCOL"));
}
function word(value: string): Hex { return numberToHex(gaslessUint(value), { size: 32 }); }
function structuralSignature(value: unknown): Hex {
  const signature = gaslessHex(value, 65, 65);
  const r = BigInt(`0x${signature.slice(2, 66)}`), s = BigInt(`0x${signature.slice(66, 130)}`);
  if ((signature.slice(-2) !== "1b" && signature.slice(-2) !== "1c") || r === 0n || r >= CURVE_ORDER ||
    s === 0n || s > HALF_CURVE_ORDER) wireFailure();
  return signature;
}
function wireFailure(): never { return gaslessFailure("APN_PROVIDER_PROTOCOL", "gasless_protocol_identity"); }
