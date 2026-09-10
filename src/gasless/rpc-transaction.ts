import { getAddress, keccak256, recoverTransactionAddress, serializeTransaction,
  type TransactionSerializable, type TransactionSerialized } from "viem";
import { sha256 } from "../canonical.js";
import type { Address, Hex } from "../model.js";
import type { GaslessChainId } from "./model.js";
import { rpcAddress, rpcHex, rpcQuantity, rpcRecord } from "./rpc-codec.js";
import { gaslessFailure } from "./validation.js";

const HALF_CURVE_ORDER = 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0n;

export interface GaslessOuterTransaction {
  readonly typeAtomic: string;
  readonly from: Address;
  readonly to: Address;
  readonly nonceAtomic: string;
  readonly valueAtomic: string;
  readonly dataHash: string;
  readonly gasLimitAtomic: string;
  readonly maxFeePerGasAtomic: string;
  readonly maxPriorityFeePerGasAtomic: string;
}

/** Reconstruct and authenticate a signed outer EVM transaction of type 0 through 4. */
export async function verifyGaslessOuterTransaction(raw: Record<string, unknown>, chainId: GaslessChainId,
  expectedHash: Hex): Promise<GaslessOuterTransaction> {
  const type = rpcQuantity(raw.type), nonce = safeNumber(rpcQuantity(raw.nonce));
  const to = rpcAddress(raw.to), from = rpcAddress(raw.from);
  if (type > 4n || rpcHex(raw.hash, 32, 32) !== expectedHash) fail("gasless_outer_chain_or_hash");
  const data = rpcHex(raw.input, 256 * 1024), gas = rpcQuantity(raw.gas), value = rpcQuantity(raw.value);
  const r = signatureScalar(raw.r), s = signatureScalar(raw.s), v = rpcQuantity(raw.v ?? raw.yParity);
  assertSignature(r, s);
  let y: number;
  if (type === 0n) {
    if (v < 35n) fail("gasless_outer_unprotected_legacy");
    y = Number((v - 35n) & 1n);
    const encodedChain = (v - 35n - BigInt(y)) / 2n;
    if (encodedChain !== BigInt(chainId)) fail("gasless_outer_chain_or_hash");
    if (raw.chainId !== undefined && rpcQuantity(raw.chainId) !== BigInt(chainId)) fail("gasless_outer_chain_or_hash");
  } else {
    if (raw.chainId === undefined || rpcQuantity(raw.chainId) !== BigInt(chainId)) fail("gasless_outer_chain_or_hash");
    y = safeNumber(rpcQuantity(raw.yParity ?? raw.v));
  }
  if ((y !== 0 && y !== 1) || (raw.yParity !== undefined && rpcQuantity(raw.yParity) !== BigInt(y))) {
    fail("gasless_outer_parity");
  }
  const accessList = type === 0n ? [] : parseAccessList(raw.accessList);
  const maxFee = rpcQuantity(type < 2n ? raw.gasPrice : raw.maxFeePerGas);
  const priority = type < 2n ? 0n : rpcQuantity(raw.maxPriorityFeePerGas);
  if (priority > maxFee) fail("gasless_outer_fee_fields");
  const common = { to, nonce, gas, value, data };
  let serializable: TransactionSerializable;
  if (type === 0n) {
    serializable = { ...common, type: "legacy", chainId, gasPrice: maxFee };
  } else if (type === 1n) {
    serializable = { ...common, type: "eip2930", chainId, gasPrice: maxFee, accessList };
  } else {
    const feeFields = { ...common, chainId, maxFeePerGas: maxFee, maxPriorityFeePerGas: priority, accessList };
    if (type === 2n) serializable = { ...feeFields, type: "eip1559" };
    else if (type === 3n) {
      if (!Array.isArray(raw.blobVersionedHashes) || raw.blobVersionedHashes.length < 1 || raw.blobVersionedHashes.length > 64) {
        fail("gasless_outer_blob_hashes");
      }
      serializable = { ...feeFields, type: "eip4844", maxFeePerBlobGas: rpcQuantity(raw.maxFeePerBlobGas),
        blobVersionedHashes: raw.blobVersionedHashes.map((hash) => rpcHex(hash, 32, 32)) };
    } else {
      if (!Array.isArray(raw.authorizationList) || raw.authorizationList.length < 1 || raw.authorizationList.length > 256) {
        fail("gasless_outer_authorizations");
      }
      serializable = { ...feeFields, type: "eip7702", authorizationList: raw.authorizationList.map((item) => {
        const auth = rpcRecord(item), parity = safeNumber(rpcQuantity(auth.yParity));
        const authR = signatureScalar(auth.r), authS = signatureScalar(auth.s);
        if (parity !== 0 && parity !== 1) fail("gasless_outer_authorization_parity");
        assertSignature(authR, authS);
        return { chainId: safeNumber(rpcQuantity(auth.chainId)), address: rpcAddress(auth.address),
          nonce: safeNumber(rpcQuantity(auth.nonce)), r: authR, s: authS, yParity: parity };
      }) };
    }
  }
  let serialized: Hex;
  try {
    serialized = serializeTransaction(serializable, type === 0n ? { r, s, v } : { r, s, yParity: y });
    if (serialized.length > 2 + 256 * 1024 * 2 || keccak256(serialized) !== expectedHash ||
      getAddress(await recoverTransactionAddress({ serializedTransaction: serialized as TransactionSerialized })) !== from) {
      throw new Error("identity");
    }
  } catch { return fail("gasless_outer_signature_reconstruction"); }
  return { typeAtomic: type.toString(), from, to, nonceAtomic: String(nonce), valueAtomic: value.toString(),
    dataHash: sha256(Buffer.from(data.slice(2), "hex")), gasLimitAtomic: gas.toString(),
    maxFeePerGasAtomic: maxFee.toString(), maxPriorityFeePerGasAtomic: priority.toString() };
}

function signatureScalar(value: unknown): Hex {
  // RPC signatures use quantities; retain fixed-width responses accepted by older runtimes.
  if (typeof value === "string" && value.length === 66) return rpcHex(value, 32, 32);
  return `0x${rpcQuantity(value).toString(16).padStart(64, "0")}`;
}

function assertSignature(r: Hex, s: Hex): void {
  if (BigInt(r) === 0n || BigInt(s) === 0n || BigInt(s) > HALF_CURVE_ORDER) fail("gasless_outer_signature");
}

function safeNumber(value: bigint): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) fail("gasless_outer_integer_bound");
  return Number(value);
}

function parseAccessList(value: unknown) {
  if (!Array.isArray(value) || value.length > 256) fail("gasless_outer_access_list");
  return value.map((item) => {
    const row = rpcRecord(item);
    if (!Array.isArray(row.storageKeys) || row.storageKeys.length > 256) fail("gasless_outer_storage_keys");
    return { address: rpcAddress(row.address), storageKeys: row.storageKeys.map((key) => rpcHex(key, 32, 32)) };
  });
}

function fail(reason: string): never { return gaslessFailure("APN_RPC_PROTOCOL", reason); }
