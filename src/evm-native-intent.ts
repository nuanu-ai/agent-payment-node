import { exactKeys, isPlainRecord } from "./canonical.js";
import { APPROVAL_WINDOW_MS } from "./constants.js";
import { ApnError } from "./errors.js";
import { evmUint, validateEvmAmount } from "./evm-asset.js";
import { directEvmChain } from "./evm-direct-networks.js";
import { evmDirectFingerprint, evmTransaction, validateEvmDirectBinding, type EvmDirectBinding } from "./evm-direct.js";
import type { Hex } from "./model.js";
import type { TransferApprovalIntent } from "./tty-approval.js";
import { canonicalAddress, canonicalProfile } from "./wallet-policy.js";

export interface EvmNativeIntent extends TransferApprovalIntent {
  readonly evm: EvmDirectBinding;
  readonly transactionData: Hex;
  readonly nonceAtomic: string;
  readonly gasLimitAtomic: string;
  readonly maxFeePerGasAtomic: string;
  readonly maxPriorityFeePerGasAtomic: string;
}

export function parseEvmNativeIntent(payload: Readonly<Record<string, unknown>>): EvmNativeIntent {
  payload = snapshotEvmNativePayload(payload);
  if (!exactKeys(payload, ["profile", "operationId", "fingerprint", "walletAddress", "chainId", "transaction", "approval", "evm"]) ||
      !isPlainRecord(payload.transaction) || !exactKeys(payload.transaction, ["type", "to", "valueAtomic", "data", "nonceAtomic", "gasLimitAtomic", "maxFeePerGasAtomic", "maxPriorityFeePerGasAtomic", "accessList"]) ||
      !isPlainRecord(payload.approval) || !exactKeys(payload.approval, ["recipient", "amountAtomic", "amountDecimal", "expiresAt"])) invalid();
  const profile = canonicalProfile(payload.profile), walletAddress = canonicalAddress(payload.walletAddress);
  const operationId = hash(payload.operationId), fingerprint = hash(payload.fingerprint), chainId = directEvmChain(payload.chainId);
  const transaction = payload.transaction, approval = payload.approval;
  const recipient = canonicalAddress(approval.recipient), amountAtomic = evmUint(approval.amountAtomic, true).toString();
  const nonceAtomic = evmUint(transaction.nonceAtomic).toString(), gasLimitAtomic = evmUint(transaction.gasLimitAtomic, true).toString();
  const maxFeePerGasAtomic = evmUint(transaction.maxFeePerGasAtomic, true).toString();
  const maxPriorityFeePerGasAtomic = evmUint(transaction.maxPriorityFeePerGasAtomic).toString();
  if (BigInt(nonceAtomic) > BigInt(Number.MAX_SAFE_INTEGER) || BigInt(gasLimitAtomic) < 21_000n || BigInt(maxPriorityFeePerGasAtomic) > BigInt(maxFeePerGasAtomic)) invalid();
  const economics = { nonceAtomic, gasLimitAtomic, maxFeePerGasAtomic, maxPriorityFeePerGasAtomic, maximumGasCostAtomic: (BigInt(gasLimitAtomic) * BigInt(maxFeePerGasAtomic)).toString() };
  const evm = validateEvmDirectBinding(payload.evm, economics);
  if (evm.nativeCustody === undefined) throw new ApnError("APN_REPREPARE_REQUIRED", "Prepare a new generic transfer with a frozen native custody binding.");
  if (evm.nativeCustody.walletAddress !== walletAddress) invalid();
  const expected = evmTransaction(evm.asset, walletAddress, recipient, amountAtomic);
  if (evm.asset.chainId !== chainId || transaction.type !== "eip1559" || transaction.to !== expected.to ||
      transaction.to !== evm.transactionTo || transaction.valueAtomic !== expected.valueAtomic ||
      transaction.valueAtomic !== evm.valueAtomic || transaction.data !== expected.data ||
      !Array.isArray(transaction.accessList) || transaction.accessList.length !== 0 ||
      typeof approval.amountDecimal !== "string" || typeof approval.expiresAt !== "string") invalid();
  validateEvmAmount(evm.asset, amountAtomic, approval.amountDecimal);
  const expiresAt = approval.expiresAt;
  const expiration = Date.parse(expiresAt);
  if (!Number.isFinite(expiration) || new Date(expiration).toISOString() !== expiresAt || Date.now() >= expiration || expiration - Date.now() > APPROVAL_WINDOW_MS) invalid();
  const preparedAt = new Date(expiration - APPROVAL_WINDOW_MS).toISOString();
  if (evmDirectFingerprint({ operationId, profile, chainId, token: evm.asset.address, walletAddress, recipient, amountAtomic,
    transactionData: expected.data, economics, preparedAt, expiresAt, evm }) !== fingerprint) invalid();
  return Object.freeze({ profile, operationId, fingerprint, walletAddress, recipient, amountAtomic, amountDecimal: approval.amountDecimal,
    expiresAt, nonceAtomic, gasLimitAtomic, maxFeePerGasAtomic, maxPriorityFeePerGasAtomic, evm, transactionData: expected.data });
}

function hash(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value)) invalid();
  return value;
}

function invalid(): never { throw new ApnError("APN_NATIVE_PROTOCOL", "Generic direct-transfer intent violates its frozen custody boundary."); }

/** Detach caller data before an async approval can change any nested financial field. */
export function snapshotEvmNativePayload(payload: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  return snapshotJson(payload) as Readonly<Record<string, unknown>>;
}

function snapshotJson(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER) return value;
  if (Array.isArray(value)) {
    if (Object.getOwnPropertySymbols(value).length !== 0 || Object.keys(value).length !== value.length || Object.keys(value).some((key, index) => key !== String(index))) invalid();
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const detached = Array.from({ length: value.length }, (_, index) => {
      const descriptor = descriptors[String(index)];
      if (descriptor === undefined || !("value" in descriptor)) invalid();
      return snapshotJson(descriptor.value);
    });
    return Object.freeze(detached);
  }
  if (!isPlainRecord(value) || Object.getOwnPropertySymbols(value).length !== 0) invalid();
  const detached: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    if (!("value" in descriptor) || !descriptor.enumerable) invalid();
    detached[key] = snapshotJson(descriptor.value);
  }
  return Object.freeze(detached);
}
