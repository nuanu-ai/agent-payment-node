import { exactKeys, hashObject, isPlainRecord } from "./canonical.js";
import { APPROVAL_WINDOW_MS, BASE_USDC, CHAIN_ID } from "./constants.js";
import { ApnError } from "./errors.js";
import { decimal, hash, hex32 } from "./local-wallet-native-fields.js";
import type { Hex } from "./model.js";
import { formatAtomic } from "./money.js";
import { transferData } from "./transfer-policy.js";
import type { TransferApprovalIntent } from "./tty-approval.js";
import { canonicalAddress, canonicalProfile } from "./wallet-policy.js";
const HEX = /^0x(?:[0-9a-fA-F]{2})+$/u;

export interface DirectIntent extends TransferApprovalIntent {
  readonly transactionData: Hex;
  readonly nonceAtomic: string;
  readonly gasLimitAtomic: string;
  readonly maxFeePerGasAtomic: string;
  readonly maxPriorityFeePerGasAtomic: string;
}

export function parseDirectIntent(payload: Readonly<Record<string, unknown>>): DirectIntent {
  exactRecord(payload, ["profile", "operationId", "fingerprint", "walletAddress", "chainId", "transaction", "approval"]);
  const profile = canonicalProfile(payload.profile);
  const operationId = hash(payload.operationId, "operation ID");
  const fingerprint = hash(payload.fingerprint, "fingerprint");
  const walletAddress = canonicalAddress(payload.walletAddress);
  if (payload.chainId !== CHAIN_ID) throw protocol("Direct-transfer chain is unsupported.");
  const transaction = exactRecord(payload.transaction, ["type", "to", "valueAtomic", "data", "nonceAtomic", "gasLimitAtomic", "maxFeePerGasAtomic", "maxPriorityFeePerGasAtomic", "accessList"]);
  const approval = exactRecord(payload.approval, ["recipient", "amountAtomic", "amountDecimal", "expiresAt"]);
  if (transaction.type !== "eip1559" || transaction.to !== BASE_USDC || transaction.valueAtomic !== "0" || !Array.isArray(transaction.accessList) || transaction.accessList.length !== 0) throw protocol("Direct-transfer transaction is not bounded Base USDC.");
  const recipient = canonicalAddress(approval.recipient);
  const amountAtomic = decimal(approval.amountAtomic, "amount", true);
  if (approval.amountDecimal !== formatAtomic(amountAtomic, 6)) throw protocol("Direct-transfer decimal amount is inconsistent.");
  if (typeof transaction.data !== "string" || !HEX.test(transaction.data) || transaction.data.toLowerCase() !== transferData(recipient, amountAtomic).toLowerCase()) throw protocol("Direct-transfer calldata is invalid.");
  const nonceAtomic = decimal(transaction.nonceAtomic, "nonce");
  const gasLimitAtomic = decimal(transaction.gasLimitAtomic, "gas limit", true);
  const maxFeePerGasAtomic = decimal(transaction.maxFeePerGasAtomic, "maximum fee", true);
  const maxPriorityFeePerGasAtomic = decimal(transaction.maxPriorityFeePerGasAtomic, "priority fee");
  const nonce = BigInt(nonceAtomic);
  const gas = BigInt(gasLimitAtomic);
  const fee = BigInt(maxFeePerGasAtomic);
  const priority = BigInt(maxPriorityFeePerGasAtomic);
  if (nonce > BigInt(Number.MAX_SAFE_INTEGER) || gas < 21_000n || gas > 200_000n || fee > 1_000_000_000_000n || priority > fee) throw protocol("Direct-transfer economics exceed the custody boundary.");
  if (typeof approval.expiresAt !== "string" || !Number.isFinite(Date.parse(approval.expiresAt))) throw protocol("Direct-transfer expiry is invalid.");
  const expiresAt = approval.expiresAt;
  const preparedAt = new Date(Date.parse(expiresAt) - APPROVAL_WINDOW_MS).toISOString();
  const expectedFingerprint = hashObject({
    method: "pay.transfer", operationId, profile, chainId: CHAIN_ID, token: BASE_USDC,
    walletAddress, recipient, amountAtomic, transactionData: transaction.data,
    economics: {
      nonceAtomic, gasLimitAtomic, maxFeePerGasAtomic, maxPriorityFeePerGasAtomic,
      maximumGasCostAtomic: (gas * fee).toString(),
    },
    preparedAt,
    expiresAt,
  });
  if (expectedFingerprint !== fingerprint || Date.now() >= Date.parse(expiresAt)) throw rejected("APN_APPROVAL_EXPIRED", "Direct-transfer approval is invalid or expired.");
  return {
    profile, operationId, fingerprint, walletAddress, recipient, amountAtomic,
    amountDecimal: approval.amountDecimal as string, nonceAtomic, gasLimitAtomic,
    maxFeePerGasAtomic, maxPriorityFeePerGasAtomic, expiresAt, transactionData: transaction.data as Hex,
  };
}

export function parseDirectRecovery(payload: Readonly<Record<string, unknown>>): {
  readonly profile: string; readonly operationId: string; readonly fingerprint: string;
  readonly expectedTransactionHash: Hex; readonly expectedRawTransactionHash: Hex;
} | { readonly profile: string; readonly operationId: string; readonly fingerprint: string; readonly expectedPayloadHash: string } {
  if (payload.expectedPayloadHash !== undefined) {
    exactRecord(payload, ["profile", "operationId", "fingerprint", "expectedPayloadHash"]);
    return { profile: canonicalProfile(payload.profile), operationId: hash(payload.operationId, "operation ID"), fingerprint: hash(payload.fingerprint, "fingerprint"), expectedPayloadHash: hash(payload.expectedPayloadHash, "payload hash") };
  }
  exactRecord(payload, ["profile", "operationId", "fingerprint", "expectedTransactionHash", "expectedRawTransactionHash"]);
  return {
    profile: canonicalProfile(payload.profile),
    operationId: hash(payload.operationId, "operation ID"),
    fingerprint: hash(payload.fingerprint, "fingerprint"),
    expectedTransactionHash: hex32(payload.expectedTransactionHash, "transaction hash"),
    expectedRawTransactionHash: hex32(payload.expectedRawTransactionHash, "raw transaction hash"),
  };
}

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!isPlainRecord(value) || !exactKeys(value, keys)) throw protocol("Custody request violates the exact schema.");
  return value;
}
function protocol(message: string): ApnError { return new ApnError("APN_NATIVE_PROTOCOL", message); }
function rejected(nativeCode: string, message: string): ApnError {
  return new ApnError("APN_NATIVE_REJECTED", message, { nativeCode });
}
