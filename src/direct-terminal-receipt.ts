import { canonicalJson, exactKeys, isPlainRecord } from "./canonical.js";
import { ApnError } from "./errors.js";
import { evmUint } from "./evm-asset.js";
import type { EvmTransferEvidence } from "./evm-ports.js";
import type { OperationRecord, ReceiptRecord } from "./model.js";
import { assertProviderTerminalReceiptAuthority } from "./provider-direct-receipt.js";

export function validateEvmTransferEvidence(value: unknown): EvmTransferEvidence {
  if (!isPlainRecord(value) || !exactKeys(value, ["blockHash", "transactionVerified", "tokenBalanceDeltasVerified",
    ...(value.safeBlockNumberAtomic === undefined ? [] : ["safeBlockNumberAtomic"]), ...(value.safeBlockHash === undefined ? [] : ["safeBlockHash"]),
    ...(value.senderDeltaAtomic === undefined ? [] : ["senderDeltaAtomic"]), ...(value.recipientDeltaAtomic === undefined ? [] : ["recipientDeltaAtomic"])])) corrupt();
  const evidence = value as unknown as EvmTransferEvidence;
  if (!/^0x[0-9a-f]{64}$/u.test(evidence.blockHash) || evidence.blockHash === `0x${"0".repeat(64)}` ||
      typeof evidence.transactionVerified !== "boolean" || typeof evidence.tokenBalanceDeltasVerified !== "boolean") corrupt();
  for (const delta of [evidence.senderDeltaAtomic, evidence.recipientDeltaAtomic]) {
    if (delta !== undefined && (typeof delta !== "string" || delta.length > 79 || !/^(?:0|-?[1-9][0-9]*)$/u.test(delta))) corrupt();
  }
  if (evidence.tokenBalanceDeltasVerified && (evidence.senderDeltaAtomic === undefined || evidence.recipientDeltaAtomic === undefined)) corrupt();
  if ((evidence.safeBlockNumberAtomic === undefined) !== (evidence.safeBlockHash === undefined)) corrupt();
  if (evidence.safeBlockNumberAtomic !== undefined) {
    evmUint(evidence.safeBlockNumberAtomic);
    if (!/^0x[0-9a-f]{64}$/u.test(evidence.safeBlockHash ?? "") || evidence.safeBlockHash === `0x${"0".repeat(64)}`) corrupt();
  }
  return evidence;
}

export function hasSafeEvmInclusion(value: unknown, blockNumberAtomic: string): boolean {
  const evidence = validateEvmTransferEvidence(value);
  return evidence.safeBlockNumberAtomic !== undefined && evmUint(evidence.safeBlockNumberAtomic) >= evmUint(blockNumberAtomic) &&
    (evidence.safeBlockNumberAtomic !== blockNumberAtomic || evidence.safeBlockHash === evidence.blockHash);
}

export function assertDirectTerminalReceiptAuthority(operation: OperationRecord, receipt: ReceiptRecord | null): void {
  if (operation.evm === undefined) return assertProviderTerminalReceiptAuthority(operation, receipt);
  if (receipt === null || !receipt.terminal || !operation.terminal || receipt.operationId !== operation.operationId ||
      receipt.operationIntegrityHash !== operation.integrityHash || receipt.state !== operation.state || receipt.reason !== operation.reason ||
      receipt.proofClass !== operation.proofClass || receipt.createdAt !== operation.transitions.at(-1)?.at ||
      receipt.transactionHash !== operation.transactionHash || receipt.amountAtomic !== operation.amountAtomic ||
      canonicalJson(receipt.evm) !== canonicalJson(operation.evm)) corrupt();
  if (operation.state === "completed" || operation.state === "failed_confirmed_revert") {
    const evidence = validateEvmTransferEvidence(receipt.evmEvidence);
    if (!evidence.transactionVerified || receipt.blockNumberAtomic === undefined) corrupt();
    evmUint(receipt.blockNumberAtomic);
    if (operation.chainId === 42161 ? !hasSafeEvmInclusion(evidence, receipt.blockNumberAtomic) : evidence.safeBlockNumberAtomic !== undefined) corrupt();
    if (operation.state === "failed_confirmed_revert") {
      if (operation.reason !== "confirmed_receipt_revert" || operation.proofClass !== "confirmed_receipt") corrupt();
    } else if (operation.evm.asset.kind === "native") {
      if (operation.reason !== "confirmed_exact_native_transfer" || operation.proofClass !== "included_native_transaction_and_receipt") corrupt();
    } else if (operation.reason !== "confirmed_exact_erc20_transfer" || operation.proofClass !== "included_transfer_event_and_block_balance_deltas" ||
        receipt.exactTransferLog !== true || evidence.tokenBalanceDeltasVerified !== true || evidence.senderDeltaAtomic !== operation.amountAtomic || evidence.recipientDeltaAtomic !== operation.amountAtomic) corrupt();
  } else if (receipt.blockNumberAtomic !== undefined || receipt.evmEvidence !== undefined ||
      !["failed_before_effect", "failed_proven_superseded"].includes(operation.state)) corrupt();
}

function corrupt(): never { throw new ApnError("APN_STATE_CORRUPT", "Generic direct receipt does not prove its exact operation state."); }
