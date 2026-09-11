import { getAddress, keccak256, recoverTransactionAddress, serializeTransaction,
  type TransactionSerializable, type TransactionSerialized } from "viem";
import { recoverAuthorizationAddress } from "viem/utils";
import { exactKeys } from "../../canonical.js";
import type { Address, Hex } from "../../model.js";
import type { MetaMaskGaslessIntent } from "../model.js";
import { mmRegistry } from "../registry.js";
import { mmFail } from "../reasons.js";
import { rpcAddress, rpcHex, rpcQuantity, rpcRecord } from "./abi.js";

const CURVE_ORDER = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const HALF_CURVE_ORDER = CURVE_ORDER / 2n;

export interface VerifiedMetaMaskOuterTransaction {
  readonly typeAtomic: string;
  readonly from: Address;
  readonly to: Address;
  readonly nonceAtomic: string;
  readonly valueAtomic: string;
  readonly input: Hex;
  readonly gasLimitAtomic: string;
  readonly maxFeePerGasAtomic: string;
  readonly maxPriorityFeePerGasAtomic: string;
  readonly authorizationOwner: Address | null;
}

/** Reconstruct types 0..4, authenticate the sender, and bind an optional exact EIP-7702 authorization. */
export async function verifyMetaMaskOuterTransaction(raw: Record<string, unknown>, expectedHash: Hex,
  intent: MetaMaskGaslessIntent): Promise<VerifiedMetaMaskOuterTransaction> {
  const type = rpcQuantity(raw.type), nonce = safeNumber(rpcQuantity(raw.nonce));
  const to = rpcAddress(raw.to), from = rpcAddress(raw.from);
  if (type > 4n || rpcHex(raw.hash, 32, 32) !== expectedHash) mmFail("mm_gasless_evidence_invalid");
  const input = rpcHex(raw.input, 256 * 1024), gas = rpcQuantity(raw.gas), value = rpcQuantity(raw.value);
  const r = rpcHex(raw.r, 32, 32), s = rpcHex(raw.s, 32, 32);
  assertSignatureParts(r, s);
  let y: number;
  if (type === 0n) {
    const v = rpcQuantity(raw.v);
    if (v < 35n) mmFail("mm_gasless_evidence_invalid");
    y = Number((v - 35n) & 1n);
    if ((v - 35n - BigInt(y)) / 2n !== BigInt(intent.request.chainId) ||
      (raw.chainId !== undefined && rpcQuantity(raw.chainId) !== BigInt(intent.request.chainId))) {
      mmFail("mm_gasless_evidence_invalid");
    }
  } else {
    if (raw.chainId === undefined || rpcQuantity(raw.chainId) !== BigInt(intent.request.chainId)) {
      mmFail("mm_gasless_evidence_invalid");
    }
    y = safeNumber(rpcQuantity(raw.yParity ?? raw.v));
  }
  if ((y !== 0 && y !== 1) || (raw.yParity !== undefined && rpcQuantity(raw.yParity) !== BigInt(y))) {
    mmFail("mm_gasless_evidence_invalid");
  }
  const accessList = type === 0n ? [] : parseAccessList(raw.accessList);
  const maxFee = rpcQuantity(type < 2n ? raw.gasPrice : raw.maxFeePerGas);
  const priority = type < 2n ? 0n : rpcQuantity(raw.maxPriorityFeePerGas);
  if (priority > maxFee) mmFail("mm_gasless_evidence_invalid");
  const common = { to, nonce, gas, value, data: input };
  let serializable: TransactionSerializable;
  let authorizationOwner: Address | null = null;
  if (type === 0n) {
    if (raw.authorizationList !== undefined) mmFail("mm_gasless_evidence_invalid");
    serializable = { ...common, type: "legacy", chainId: intent.request.chainId, gasPrice: maxFee };
  } else if (type === 1n) {
    if (raw.authorizationList !== undefined) mmFail("mm_gasless_evidence_invalid");
    serializable = { ...common, type: "eip2930", chainId: intent.request.chainId, gasPrice: maxFee, accessList };
  } else {
    const feeFields = { ...common, chainId: intent.request.chainId, maxFeePerGas: maxFee,
      maxPriorityFeePerGas: priority, accessList };
    if (type === 2n) {
      if (raw.authorizationList !== undefined) mmFail("mm_gasless_evidence_invalid");
      serializable = { ...feeFields, type: "eip1559" };
    } else if (type === 3n) {
      if (raw.authorizationList !== undefined || !Array.isArray(raw.blobVersionedHashes) ||
        raw.blobVersionedHashes.length < 1 || raw.blobVersionedHashes.length > 64) mmFail("mm_gasless_evidence_invalid");
      serializable = { ...feeFields, type: "eip4844", maxFeePerBlobGas: rpcQuantity(raw.maxFeePerBlobGas),
        blobVersionedHashes: raw.blobVersionedHashes.map((hash) => rpcHex(hash, 32, 32)) };
    } else {
      const parsed = await parseAuthorization(raw.authorizationList, intent);
      authorizationOwner = parsed.owner;
      serializable = { ...feeFields, type: "eip7702", authorizationList: [parsed.authorization] };
    }
  }
  let serialized: Hex;
  try {
    const signature = type === 0n ? { r, s, v: rpcQuantity(raw.v) } : { r, s, yParity: y };
    serialized = serializeTransaction(serializable, signature);
    const recovered = getAddress(await recoverTransactionAddress({
      serializedTransaction: serialized as TransactionSerialized })).toLowerCase();
    if (serialized.length > 2 + 256 * 1024 * 2 || keccak256(serialized) !== expectedHash || recovered !== from) {
      throw new Error("identity");
    }
  } catch { return mmFail("mm_gasless_evidence_invalid"); }
  return { typeAtomic: type.toString(), from, to, nonceAtomic: nonce.toString(), valueAtomic: value.toString(),
    input, gasLimitAtomic: gas.toString(), maxFeePerGasAtomic: maxFee.toString(),
    maxPriorityFeePerGasAtomic: priority.toString(), authorizationOwner };
}

async function parseAuthorization(value: unknown, intent: MetaMaskGaslessIntent): Promise<{
  readonly owner: Address;
  readonly authorization: { readonly chainId: number; readonly address: Address; readonly nonce: number;
    readonly r: Hex; readonly s: Hex; readonly yParity: number };
}> {
  if (!Array.isArray(value) || value.length !== 1) mmFail("mm_gasless_evidence_invalid");
  const row = rpcRecord(value[0]), chainId = safeNumber(rpcQuantity(row.chainId));
  if (!exactKeys(row, ["chainId", "address", "nonce", "r", "s", "yParity"])) {
    mmFail("mm_gasless_evidence_invalid");
  }
  const address = rpcAddress(row.address), nonce = safeNumber(rpcQuantity(row.nonce));
  const r = rpcHex(row.r, 32, 32), s = rpcHex(row.s, 32, 32), yParity = safeNumber(rpcQuantity(row.yParity));
  if (chainId === 0 || chainId !== intent.request.chainId ||
    address !== mmRegistry(intent.request.chainId).row.protocol.delegate.address || (yParity !== 0 && yParity !== 1)) {
    mmFail("mm_gasless_evidence_invalid");
  }
  assertSignatureParts(r, s);
  const authorization = { chainId, address, nonce, r, s, yParity };
  let owner: Address;
  try { owner = (await recoverAuthorizationAddress({ authorization })).toLowerCase() as Address; }
  catch { return mmFail("mm_gasless_evidence_invalid"); }
  if (owner !== intent.binding.address) mmFail("mm_gasless_evidence_invalid");
  return { owner, authorization };
}

function assertSignatureParts(r: Hex, s: Hex): void {
  const rValue = BigInt(r), sValue = BigInt(s);
  if (rValue === 0n || rValue >= CURVE_ORDER || sValue === 0n || sValue > HALF_CURVE_ORDER) {
    mmFail("mm_gasless_evidence_invalid");
  }
}

function safeNumber(value: bigint): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) mmFail("mm_gasless_evidence_invalid");
  return Number(value);
}

function parseAccessList(value: unknown) {
  if (!Array.isArray(value) || value.length > 256) mmFail("mm_gasless_evidence_invalid");
  return value.map((item) => {
    const row = rpcRecord(item);
    if (!exactKeys(row, ["address", "storageKeys"]) || !Array.isArray(row.storageKeys) ||
      row.storageKeys.length > 256) mmFail("mm_gasless_evidence_invalid");
    return { address: rpcAddress(row.address), storageKeys: row.storageKeys.map((key) => rpcHex(key, 32, 32)) };
  });
}
