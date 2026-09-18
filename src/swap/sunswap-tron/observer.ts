import { canonicalJson } from "../../canonical.js";
import { ApnError } from "../../errors.js";
import type { SwapChainObserverPort } from "../ports.js";
import { validateSwapOperation, type SwapOperationRecord, type SwapReceiptProof } from "../model.js";
import { validateSunSwapExecutionBinding, type SunSwapExecutionBinding } from "./signer.js";
import { validateSunSwapReceipt, type SunSwapReceiptExpectation, type SunSwapReceiptValidation } from "./receipt.js";

export type SunSwapObservationMethod = "wallet/gettransactionbyid" | "wallet/gettransactioninfobyid" |
  "walletsolidity/gettransactionbyid" | "walletsolidity/gettransactioninfobyid" | "walletsolidity/getnowblock";
export interface SunSwapObservationRpcPort {
  call(method: SunSwapObservationMethod, body: Readonly<Record<string, unknown>>): Promise<unknown>;
}

export class SunSwapSolidifiedObserver implements SwapChainObserverPort {
  constructor(private readonly rpc: SunSwapObservationRpcPort, private readonly expectedOperation: SwapOperationRecord,
    private readonly binding: SunSwapExecutionBinding, private readonly maximumFeeSun: string,
    private readonly now: () => Date = () => new Date()) {
    validateSunSwapExecutionBinding(expectedOperation, binding);
    if (maximumFeeSun !== binding.intent.feeLimitSun) conflict();
  }

  async observe(operationValue: SwapOperationRecord): Promise<SwapReceiptProof | null> {
    const operation = validateSwapOperation(operationValue);
    if (operation.operationId !== this.expectedOperation.operationId ||
        validateSunSwapExecutionBinding(operation, this.binding) !== validateSunSwapExecutionBinding(this.expectedOperation, this.binding) ||
        operation.submissionMarker === null) conflict();
    const receipt = await observeSunSwapFinality(this.rpc, { transactionHash: this.binding.transaction.txID,
      recipient: operation.quote.recipient, inputAmountAtomic: operation.quote.inputAmountAtomic,
      minimumOutputAtomic: operation.quote.minimumOutputAtomic,
      unsignedRawDataHex: this.binding.transaction.raw_data_hex, maximumFeeSun: this.maximumFeeSun });
    const observedAt = this.now();
    if (!Number.isFinite(observedAt.getTime())) conflict();
    return { receiptHash: receipt.receiptHash, transactionHash: receipt.transactionHash,
      observedAt: observedAt.toISOString(), finalized: true };
  }
}

export async function observeSunSwapFinality(rpc: SunSwapObservationRpcPort,
  expected: SunSwapReceiptExpectation): Promise<SunSwapReceiptValidation> {
  let fullTransaction: unknown, fullInfo: unknown, solidTransaction: unknown, solidInfo: unknown, head: unknown;
  try {
    [fullTransaction, fullInfo, solidTransaction, solidInfo, head] = await Promise.all([
      rpc.call("wallet/gettransactionbyid", { value: expected.transactionHash }),
      rpc.call("wallet/gettransactioninfobyid", { value: expected.transactionHash }),
      rpc.call("walletsolidity/gettransactionbyid", { value: expected.transactionHash }),
      rpc.call("walletsolidity/gettransactioninfobyid", { value: expected.transactionHash }),
      rpc.call("walletsolidity/getnowblock", {}),
    ]);
  } catch { return conflict(); }
  const solid = solidHead(head);
  const full = validateSunSwapReceipt(fullTransaction, fullInfo, solid, expected);
  const finalized = validateSunSwapReceipt(solidTransaction, solidInfo, solid, expected);
  const proof = (value: SunSwapReceiptValidation) => ({ transactionHash: value.transactionHash, blockNumber: value.blockNumber,
    solidifiedHeadNumber: value.solidifiedHeadNumber, inputAmountAtomic: value.inputAmountAtomic,
    outputAmountAtomic: value.outputAmountAtomic, feeSun: value.feeSun, trxDebitSun: value.trxDebitSun, finalized: value.finalized });
  if (canonicalJson(proof(full)) !== canonicalJson(proof(finalized))) conflict();
  if (full.receiptHash !== finalized.receiptHash) conflict();
  return finalized;
}

function solidHead(value: unknown): string {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return conflict();
  const header = (value as Record<string, unknown>).block_header;
  if (header === null || typeof header !== "object" || Array.isArray(header)) return conflict();
  const raw = (header as Record<string, unknown>).raw_data;
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return conflict();
  const number = (raw as Record<string, unknown>).number;
  if ((typeof number !== "string" && typeof number !== "number" && typeof number !== "bigint") || !/^[0-9]+$/u.test(String(number))) conflict();
  return String(number);
}
function conflict(): never { throw new ApnError("APN_RPC_PROTOCOL", "SunSwap full-node and solidified history is missing, conflicting, or not finalized."); }
