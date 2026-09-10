import { getAddress, keccak256, recoverTransactionAddress, serializeTransaction,
  type TransactionSerializable, type TransactionSerialized } from "viem";
import { recoverAuthorizationAddress } from "viem/utils";
import { exactKeys } from "../../canonical.js";
import type { Address, Hex } from "../../model.js";
import type { SmartAccountGaslessIntent } from "../model.js";
import { saFail } from "../reasons.js";
import { rpcAddress, rpcHex, rpcQuantity, rpcRecord } from "./abi.js";

const CURVE_ORDER = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const HALF_CURVE_ORDER = CURVE_ORDER / 2n;
const MAX_AUTHORIZATIONS = 16;

export interface VerifiedSmartAccountOuterTransaction {
  readonly typeAtomic: string;
  readonly from: Address;
  readonly to: Address;
  readonly nonceAtomic: string;
  readonly valueAtomic: string;
  readonly input: Hex;
  readonly gasLimitAtomic: string;
  readonly maxFeePerGasAtomic: string;
  readonly maxPriorityFeePerGasAtomic: string;
  readonly authorizationOwners: readonly Address[];
}

/** Reconstruct and authenticate every supported canonical signed envelope, including every type-4 authorization. */
export async function verifySmartAccountOuterTransaction(raw: Record<string, unknown>, expectedHash: Hex,
  intent: SmartAccountGaslessIntent): Promise<VerifiedSmartAccountOuterTransaction> {
  const type = rpcQuantity(raw.type), nonce = safeNumber(rpcQuantity(raw.nonce));
  const to = rpcAddress(raw.to), from = rpcAddress(raw.from);
  if (type > 4n || rpcHex(raw.hash, 32, 32) !== expectedHash ||
    rpcQuantity(raw.chainId) !== BigInt(intent.request.chainId)) saFail("sa_gasless_evidence");
  const input = rpcHex(raw.input, 64 * 1024), gas = rpcQuantity(raw.gas), value = rpcQuantity(raw.value);
  const r = rpcHex(raw.r, 32, 32), s = rpcHex(raw.s, 32, 32);
  assertSignatureParts(r, s);
  let y: number;
  if (type === 0n) {
    const v = rpcQuantity(raw.v);
    if (v < 35n) saFail("sa_gasless_evidence");
    y = Number((v - 35n) & 1n);
    if ((v - 35n - BigInt(y)) / 2n !== BigInt(intent.request.chainId) || raw.yParity !== undefined) {
      saFail("sa_gasless_evidence");
    }
  } else {
    if (raw.yParity === undefined) saFail("sa_gasless_evidence");
    y = safeNumber(rpcQuantity(raw.yParity));
    if (y !== 0 && y !== 1) saFail("sa_gasless_evidence");
    if (raw.v !== undefined) {
      const v = rpcQuantity(raw.v);
      if (v !== BigInt(y) && v !== 27n + BigInt(y)) saFail("sa_gasless_evidence");
    }
  }
  const accessList = type === 0n ? [] : parseAccessList(raw.accessList);
  const maxFee = rpcQuantity(type < 2n ? raw.gasPrice : raw.maxFeePerGas);
  const priority = type < 2n ? 0n : rpcQuantity(raw.maxPriorityFeePerGas);
  if (priority > maxFee) saFail("sa_gasless_evidence");
  const common = { to, nonce, gas, value, data: input };
  let serializable: TransactionSerializable;
  let authorizationOwners: readonly Address[] = [];
  if (type === 0n) {
    rejectPresent(raw, ["accessList", "authorizationList", "blobVersionedHashes", "maxFeePerBlobGas"]);
    serializable = { ...common, type: "legacy", chainId: intent.request.chainId, gasPrice: maxFee };
  } else if (type === 1n) {
    rejectPresent(raw, ["authorizationList", "blobVersionedHashes", "maxFeePerBlobGas"]);
    serializable = { ...common, type: "eip2930", chainId: intent.request.chainId, gasPrice: maxFee, accessList };
  } else {
    const fees = { ...common, chainId: intent.request.chainId, maxFeePerGas: maxFee,
      maxPriorityFeePerGas: priority, accessList };
    if (type === 2n) {
      rejectPresent(raw, ["authorizationList", "blobVersionedHashes", "maxFeePerBlobGas"]);
      serializable = { ...fees, type: "eip1559" };
    } else if (type === 3n) {
      rejectPresent(raw, ["authorizationList"]);
      if (!Array.isArray(raw.blobVersionedHashes) || raw.blobVersionedHashes.length < 1 ||
        raw.blobVersionedHashes.length > 64) saFail("sa_gasless_evidence");
      const blobVersionedHashes = raw.blobVersionedHashes.map(hash => {
        const result = rpcHex(hash, 32, 32);
        if (!result.startsWith("0x01")) saFail("sa_gasless_evidence");
        return result;
      });
      serializable = { ...fees, type: "eip4844", maxFeePerBlobGas: rpcQuantity(raw.maxFeePerBlobGas),
        blobVersionedHashes };
    } else {
      rejectPresent(raw, ["blobVersionedHashes", "maxFeePerBlobGas"]);
      const parsed = await parseAuthorizations(raw.authorizationList, intent);
      authorizationOwners = parsed.owners;
      serializable = { ...fees, type: "eip7702", authorizationList: parsed.authorizations };
    }
  }
  try {
    const signature = type === 0n ? { r, s, v: rpcQuantity(raw.v) } : { r, s, yParity: y };
    const serialized = serializeTransaction(serializable, signature);
    const recovered = getAddress(await recoverTransactionAddress({
      serializedTransaction: serialized as TransactionSerialized })).toLowerCase();
    if (serialized.length > 2 + 128 * 1024 * 2 || keccak256(serialized) !== expectedHash || recovered !== from) {
      throw new Error("transaction identity");
    }
  } catch { return saFail("sa_gasless_evidence"); }
  return { typeAtomic: type.toString(), from, to, nonceAtomic: nonce.toString(), valueAtomic: value.toString(), input,
    gasLimitAtomic: gas.toString(), maxFeePerGasAtomic: maxFee.toString(),
    maxPriorityFeePerGasAtomic: priority.toString(), authorizationOwners };
}

async function parseAuthorizations(value: unknown, intent: SmartAccountGaslessIntent): Promise<{
  readonly owners: readonly Address[];
  readonly authorizations: readonly { readonly chainId: number; readonly address: Address; readonly nonce: number;
    readonly r: Hex; readonly s: Hex; readonly yParity: number }[];
}> {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_AUTHORIZATIONS) saFail("sa_gasless_evidence");
  const owners: Address[] = [], authorizations: Array<{ chainId: number; address: Address; nonce: number;
    r: Hex; s: Hex; yParity: number }> = [];
  for (const item of value) {
    const row = rpcRecord(item);
    if (!exactKeys(row, ["chainId", "address", "nonce", "r", "s", "yParity"])) saFail("sa_gasless_evidence");
    const chainId = safeNumber(rpcQuantity(row.chainId)), address = rpcAddress(row.address);
    const nonce = safeNumber(rpcQuantity(row.nonce)), r = rpcHex(row.r, 32, 32), s = rpcHex(row.s, 32, 32);
    const yParity = safeNumber(rpcQuantity(row.yParity));
    if (chainId !== intent.request.chainId || (yParity !== 0 && yParity !== 1)) saFail("sa_gasless_evidence");
    assertSignatureParts(r, s);
    const authorization = { chainId, address, nonce, r, s, yParity };
    let owner: Address;
    try { owner = (await recoverAuthorizationAddress({ authorization })).toLowerCase() as Address; }
    catch { return saFail("sa_gasless_evidence"); }
    if (owner === intent.binding.ownerAddress || owner === intent.binding.sessionAddress) saFail("sa_gasless_evidence");
    owners.push(owner); authorizations.push(authorization);
  }
  return { owners, authorizations };
}

function parseAccessList(value: unknown) {
  if (!Array.isArray(value) || value.length > 256) saFail("sa_gasless_evidence");
  return value.map(item => {
    const row = rpcRecord(item);
    if (!exactKeys(row, ["address", "storageKeys"]) || !Array.isArray(row.storageKeys) ||
      row.storageKeys.length > 256) saFail("sa_gasless_evidence");
    return { address: rpcAddress(row.address), storageKeys: row.storageKeys.map(key => rpcHex(key, 32, 32)) };
  });
}

function rejectPresent(raw: Record<string, unknown>, keys: readonly string[]): void {
  if (keys.some(key => raw[key] !== undefined)) saFail("sa_gasless_evidence");
}

function assertSignatureParts(r: Hex, s: Hex): void {
  const rValue = BigInt(r), sValue = BigInt(s);
  if (rValue === 0n || rValue >= CURVE_ORDER || sValue === 0n || sValue > HALF_CURVE_ORDER) {
    saFail("sa_gasless_evidence");
  }
}

function safeNumber(value: bigint): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) saFail("sa_gasless_evidence");
  return Number(value);
}
