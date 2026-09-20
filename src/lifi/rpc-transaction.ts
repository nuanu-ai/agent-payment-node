import { getAddress, keccak256, recoverTransactionAddress, serializeTransaction, type TransactionSerializable, type TransactionSerialized } from "viem";
import { sha256 } from "../canonical.js";
import { evmRpcAddress, evmRpcHex, evmRpcQuantity, evmRpcRecord } from "../evm-rpc-codec.js";
import type { BridgeChainId } from "./chains.js";
import type { Hex } from "../model.js";
import type { BridgeEnvelope } from "./model.js";
import { verifyBridgeSigned } from "./transaction.js";
import { bridgeFailure, bridgeHex } from "./validation.js";

export async function verifyRpcTransaction(raw: Record<string, unknown>, chainId: BridgeChainId, hash: Hex, expected?: BridgeEnvelope) {
  const type = evmRpcQuantity(raw.type), nonce = safeNumber(evmRpcQuantity(raw.nonce)), to = evmRpcAddress(raw.to), from = evmRpcAddress(raw.from);
  if (type > 4n || evmRpcHex(raw.hash, 32) !== hash || (raw.chainId !== undefined && evmRpcQuantity(raw.chainId) !== BigInt(chainId))) bridgeFailure("APN_RPC_PROTOCOL", "transaction_chain_or_hash");
  const data = bridgeHex(raw.input, 128 * 1024, undefined, "APN_RPC_PROTOCOL"), gas = evmRpcQuantity(raw.gas), value = evmRpcQuantity(raw.value);
  const r = evmRpcHex(raw.r, 32), s = evmRpcHex(raw.s, 32), v = evmRpcQuantity(raw.v ?? raw.yParity);
  if (BigInt(r) === 0n || BigInt(s) === 0n || BigInt(s) > 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0n) bridgeFailure("APN_RPC_PROTOCOL", "transaction_signature");
  const y = type === 0n ? Number((v >= 35n ? v - 35n - 2n * BigInt(chainId) : v - 27n)) : safeNumber(evmRpcQuantity(raw.yParity ?? raw.v));
  if ((y !== 0 && y !== 1) || (raw.yParity !== undefined && evmRpcQuantity(raw.yParity) !== BigInt(y))) bridgeFailure("APN_RPC_PROTOCOL", "transaction_parity");
  const accessList = type === 0n ? [] : parseAccessList(raw.accessList);
  const maxFee = evmRpcQuantity(type < 2n ? raw.gasPrice : raw.maxFeePerGas), priority = type < 2n ? 0n : evmRpcQuantity(raw.maxPriorityFeePerGas);
  const common = { to, nonce, gas, value, data };
  let serializable: TransactionSerializable;
  if (type === 0n) serializable = { ...common, type: "legacy", ...(v >= 35n ? { chainId } : {}), gasPrice: maxFee };
  else if (type === 1n) serializable = { ...common, type: "eip2930", chainId, gasPrice: maxFee, accessList };
  else {
    const fees = { ...common, chainId, maxFeePerGas: maxFee, maxPriorityFeePerGas: priority, accessList };
    if (type === 2n) serializable = { ...fees, type: "eip1559" };
    else if (type === 3n) {
      if (!Array.isArray(raw.blobVersionedHashes) || raw.blobVersionedHashes.length < 1 || raw.blobVersionedHashes.length > 64) bridgeFailure("APN_RPC_PROTOCOL", "transaction_blob_hashes");
      serializable = { ...fees, type: "eip4844", maxFeePerBlobGas: evmRpcQuantity(raw.maxFeePerBlobGas), blobVersionedHashes: raw.blobVersionedHashes.map((h) => evmRpcHex(h, 32)) };
    } else {
      if (!Array.isArray(raw.authorizationList) || raw.authorizationList.length < 1 || raw.authorizationList.length > 256) bridgeFailure("APN_RPC_PROTOCOL", "transaction_authorizations");
      serializable = { ...fees, type: "eip7702", authorizationList: raw.authorizationList.map((value) => {
        const a = evmRpcRecord(value), parity = safeNumber(evmRpcQuantity(a.yParity));
        if (parity !== 0 && parity !== 1) bridgeFailure("APN_RPC_PROTOCOL", "authorization_parity");
        return { chainId: safeNumber(evmRpcQuantity(a.chainId)), address: evmRpcAddress(a.address), nonce: safeNumber(evmRpcQuantity(a.nonce)),
          r: evmRpcHex(a.r, 32), s: evmRpcHex(a.s, 32), yParity: parity };
      }) };
    }
  }
  let serialized: Hex;
  try {
    serialized = serializeTransaction(serializable, type === 0n ? { r, s, v } : { r, s, yParity: y });
    if (serialized.length > 2 + 256 * 1024 * 2 || keccak256(serialized) !== hash ||
      getAddress(await recoverTransactionAddress({ serializedTransaction: serialized as TransactionSerialized })) !== from) throw new Error("identity");
  } catch { return bridgeFailure("APN_RPC_PROTOCOL", "transaction_signature_reconstruction"); }
  if (expected !== undefined) await verifyBridgeSigned(serialized, hash, expected);
  return { from, to, nonceAtomic: String(nonce), valueAtomic: value.toString(), dataHash: sha256(Buffer.from(data.slice(2), "hex")),
    gasLimitAtomic: gas.toString(), maxFeePerGasAtomic: maxFee.toString(), maxPriorityFeePerGasAtomic: priority.toString() };
}
function safeNumber(n: bigint): number {
  if (n > BigInt(Number.MAX_SAFE_INTEGER)) bridgeFailure("APN_RPC_PROTOCOL", "transaction_integer_bound");
  return Number(n);
}
function parseAccessList(value: unknown) {
  if (!Array.isArray(value) || value.length > 256) bridgeFailure("APN_RPC_PROTOCOL", "transaction_access_list");
  return value.map((v) => {
    const r = evmRpcRecord(v);
    if (!Array.isArray(r.storageKeys) || r.storageKeys.length > 256) bridgeFailure("APN_RPC_PROTOCOL", "transaction_storage_keys");
    return { address: evmRpcAddress(r.address), storageKeys: r.storageKeys.map((k) => evmRpcHex(k, 32)) };
  });
}
