import { canonicalJson, exactKeys, isPlainRecord } from "./canonical.js";
import { ApnError } from "./errors.js";
import { directEvmChain, directEvmNetwork, type DirectEvmFeeModel } from "./evm-direct-networks.js";
import type { Hex, OperationRecord } from "./model.js";

/**
 * The receipt fields that carry a direct transfer's charge, exactly as the node answered them. A field the node did not
 * send stays absent; a value that is not a short string is kept as "invalid" so the derivation below stays reproducible.
 */
export const EVM_RECEIPT_FEE_FIELDS = ["gasUsed", "effectiveGasPrice", "l1Fee", "operatorFeeScalar", "operatorFeeConstant",
  "operatorFee", "blobGasUsed", "blobGasPrice"] as const;
export type EvmReceiptFeeFields = Readonly<Partial<Record<typeof EVM_RECEIPT_FEE_FIELDS[number], string>>>;

export function readEvmReceiptFeeFields(receipt: Readonly<Record<string, unknown>>): EvmReceiptFeeFields {
  const fields: Partial<Record<typeof EVM_RECEIPT_FEE_FIELDS[number], string>> = {};
  for (const name of EVM_RECEIPT_FEE_FIELDS) {
    const value = receipt[name];
    if (value === undefined || value === null) continue;
    fields[name] = typeof value === "string" && value.length <= 66 ? value : "invalid";
  }
  return fields;
}

/**
 * What a completed or reverted direct transfer actually paid, derived only from its own canonical receipt by the
 * network's charge rule (see `DirectEvmFeeModel`). A component APN cannot read from the receipt leaves the fee
 * `incomplete` with its reason: nothing is estimated and the quote is never put in its place.
 */
export interface EvmActualFee {
  readonly schemaVersion: "apn.evm-direct-actual-fee.v1";
  readonly chainId: number;
  readonly feeModel: DirectEvmFeeModel;
  readonly transactionHash: Hex;
  readonly blockNumberAtomic: string;
  readonly gasLimitAtomic: string;
  readonly maxFeePerGasAtomic: string;
  readonly receiptFields: EvmReceiptFeeFields;
  readonly complete: boolean;
  readonly incompleteReason: string | null;
  readonly gasBilledAtomic: string | null;
  readonly executionFeeAtomic: string | null;
  readonly l1DataFeeAtomic: string | null;
  readonly operatorFeeAtomic: string | null;
  readonly totalFeeAtomic: string | null;
}

export type EvmActualFeeInput = Pick<EvmActualFee, "chainId" | "transactionHash" | "blockNumberAtomic" | "gasLimitAtomic" |
  "maxFeePerGasAtomic" | "receiptFields">;
const FEE_MODELS: readonly DirectEvmFeeModel[] = ["eip1559", "op-stack", "arbitrum-inclusive", "monad-gas-limit"];

/** A new observation names the network's current charge rule; a stored one is re-derived by the rule it names (R2). */
export function deriveEvmActualFee(input: EvmActualFeeInput, feeModel: DirectEvmFeeModel): EvmActualFee {
  return derive(input, feeModel, false);
}

/**
 * A direct transfer signs an EIP-1559 (type 2) transaction (evm-native-intent pins it), so it carries no blob and pays no
 * blob fee. OP stack (Jovian) reports the transaction's DA footprint as `blobGasUsed` with no `blobGasPrice`: block-limit
 * metadata, not a charge (the data is paid through `l1Fee`), so it is neither a reason for `incomplete` nor added again.
 * Anywhere else, or beside a blob price, a nonzero `blobGasUsed` claims a blob charge APN does not model: incomplete.
 * `blobAlwaysCharged` is the rule 0.5.52 applied (every nonzero `blobGasUsed` was unmodeled, OP stack included); a fee it
 * stored that way is still that rule's honest reading of the same receipt fields, and is shown by the corrected rule.
 */
function derive(input: EvmActualFeeInput, feeModel: DirectEvmFeeModel, blobAlwaysCharged: boolean): EvmActualFee {
  const chainId = input.chainId;
  const base = { schemaVersion: "apn.evm-direct-actual-fee.v1" as const, chainId, feeModel, transactionHash: input.transactionHash,
    blockNumberAtomic: input.blockNumberAtomic, gasLimitAtomic: input.gasLimitAtomic, maxFeePerGasAtomic: input.maxFeePerGasAtomic,
    receiptFields: input.receiptFields };
  const incomplete = (reason: string): EvmActualFee => ({ ...base, complete: false, incompleteReason: reason, gasBilledAtomic: null,
    executionFeeAtomic: null, l1DataFeeAtomic: null, operatorFeeAtomic: null, totalFeeAtomic: null });
  const parsed: Partial<Record<typeof EVM_RECEIPT_FEE_FIELDS[number], bigint>> = {};
  for (const [name, raw] of Object.entries(input.receiptFields) as [typeof EVM_RECEIPT_FEE_FIELDS[number], string][]) {
    if (!/^0x[0-9a-fA-F]{1,64}$/u.test(raw)) return incomplete("receipt_fee_field_malformed");
    parsed[name] = BigInt(raw);
  }
  const { gasUsed, effectiveGasPrice: price } = parsed, gasLimit = BigInt(input.gasLimitAtomic);
  if (gasUsed === undefined || price === undefined) return incomplete("receipt_execution_fee_fields_unavailable");
  if (gasUsed > gasLimit || price > BigInt(input.maxFeePerGasAtomic)) return incomplete("receipt_fee_fields_contradict_signed_transaction");
  const daFootprint = !blobAlwaysCharged && feeModel === "op-stack" && (parsed.blobGasPrice ?? 0n) === 0n;
  if ((parsed.blobGasUsed ?? 0n) !== 0n && !daFootprint) return incomplete("receipt_blob_fee_unmodeled");
  const billed = feeModel === "monad-gas-limit" ? gasLimit : gasUsed, execution = billed * price;
  const complete = (l1: bigint | null, operator: bigint | null): EvmActualFee => ({ ...base, complete: true, incompleteReason: null,
    gasBilledAtomic: billed.toString(), executionFeeAtomic: execution.toString(), l1DataFeeAtomic: l1?.toString() ?? null,
    operatorFeeAtomic: operator?.toString() ?? null, totalFeeAtomic: (execution + (l1 ?? 0n) + (operator ?? 0n)).toString() });
  if (feeModel !== "op-stack") {
    // Execution-only, Arbitrum (L1 posting inside gasUsed) and Monad (gas limit billed) networks charge nothing else.
    return [parsed.l1Fee, parsed.operatorFee, parsed.operatorFeeScalar, parsed.operatorFeeConstant].some(x => (x ?? 0n) !== 0n)
      ? incomplete("receipt_fee_component_unmodeled") : complete(null, null);
  }
  // OP stack: execution plus the receipt's own L1 data fee plus the operator fee (Jovian: gasUsed x scalar x 100 + constant);
  // absent operator fields are zero parameters, a scalar without its constant or a contradicting operatorFee is not a fee.
  const { l1Fee: l1, operatorFeeScalar: scalar, operatorFeeConstant: constant, operatorFee: reported } = parsed;
  if (l1 === undefined) return incomplete("op_l1_fee_unavailable");
  if ((scalar === undefined) !== (constant === undefined) || (scalar ?? 0n) > 0xffffffffn || (constant ?? 0n) > 0xffffffffffffffffn) {
    return incomplete("op_operator_fee_fields_inconsistent");
  }
  const derived = gasUsed * (scalar ?? 0n) * 100n + (constant ?? 0n), operator = reported ?? derived;
  return scalar !== undefined && operator !== derived ? incomplete("op_operator_fee_fields_inconsistent") : complete(l1, operator);
}

/**
 * A stored fee observation must be exactly what its own receipt fields derive (R2: no current constant is consulted), by
 * the rule now or by the 0.5.52 blob reading; either way the answer is the current rule's reading of those same fields.
 */
export function validateEvmActualFee(value: unknown): EvmActualFee {
  if (!isPlainRecord(value) || !exactKeys(value, ["schemaVersion", "chainId", "feeModel", "transactionHash", "blockNumberAtomic", "gasLimitAtomic",
    "maxFeePerGasAtomic", "receiptFields", "complete", "incompleteReason", "gasBilledAtomic", "executionFeeAtomic", "l1DataFeeAtomic",
    "operatorFeeAtomic", "totalFeeAtomic"]) || value.schemaVersion !== "apn.evm-direct-actual-fee.v1" ||
    !Number.isSafeInteger(value.chainId) || !FEE_MODELS.includes(value.feeModel as DirectEvmFeeModel) ||
    typeof value.transactionHash !== "string" || !/^0x[0-9a-f]{64}$/u.test(value.transactionHash) ||
    ![value.blockNumberAtomic, value.gasLimitAtomic, value.maxFeePerGasAtomic].every(x => typeof x === "string" && /^(?:0|[1-9][0-9]{0,77})$/u.test(x)) ||
    !isPlainRecord(value.receiptFields) || Object.entries(value.receiptFields).some(([name, field]) =>
      !(EVM_RECEIPT_FEE_FIELDS as readonly string[]).includes(name) || typeof field !== "string" || field.length > 66)) corrupt();
  let derived: EvmActualFee, stored052: EvmActualFee;
  try {
    derived = derive(value as unknown as EvmActualFeeInput, value.feeModel as DirectEvmFeeModel, false);
    stored052 = derive(value as unknown as EvmActualFeeInput, value.feeModel as DirectEvmFeeModel, true);
  } catch { return corrupt(); }
  if (canonicalJson(derived) !== canonicalJson(value) && canonicalJson(stored052) !== canonicalJson(value)) corrupt();
  return derived;
}

/** Only a local transfer's proven outcomes carry it, and only for this operation's own signed transaction. */
export function assertEvmActualFeeBinding(operation: OperationRecord): void {
  const fee = operation.evmActualFee;
  if (fee === undefined) return;
  const proven = validateEvmActualFee(fee);
  if (operation.providerDirect !== undefined || operation.economics === undefined || !["completed", "failed_confirmed_revert"].includes(operation.state) ||
    proven.chainId !== operation.chainId || proven.transactionHash !== operation.transactionHash?.toLowerCase() ||
    proven.gasLimitAtomic !== operation.economics.gasLimitAtomic || proven.maxFeePerGasAtomic !== operation.economics.maxFeePerGasAtomic) corrupt();
}

/**
 * Public form: the fact when complete, its known parts and reason when not, null when nothing was observed. A stored
 * observation is shown as the current rule reads its own receipt fields (a 0.5.52 blob reading is not frozen in).
 */
export function publicEvmActualFee(stored: EvmActualFee | undefined, asset: { readonly kind: string } | undefined, amountAtomic: string, state: string) {
  if (stored === undefined) return { actual_network_fee: null, actual_sender_native_debit_atomic: null };
  const fee = validateEvmActualFee(stored);
  const network = directEvmNetwork(directEvmChain(fee.chainId));
  // The transfer value leaves the sender only when the native transfer succeeded; a revert charged the fee alone.
  const value = asset?.kind === "native" && state === "completed" ? BigInt(amountAtomic) : 0n;
  return {
    actual_network_fee: { status: fee.complete ? "complete" : "incomplete", chain: network.caip2, unit: network.nativeSymbol,
      decimals: network.nativeDecimals, fee_model: fee.feeModel, total_atomic: fee.totalFeeAtomic, execution_atomic: fee.executionFeeAtomic,
      l1_data_atomic: fee.l1DataFeeAtomic, operator_atomic: fee.operatorFeeAtomic, gas_billed_atomic: fee.gasBilledAtomic,
      effective_gas_price_atomic: fee.complete ? BigInt(fee.receiptFields.effectiveGasPrice!).toString() : null,
      incomplete_reason: fee.incompleteReason, transaction_hash: fee.transactionHash, block_number_atomic: fee.blockNumberAtomic },
    actual_sender_native_debit_atomic: fee.totalFeeAtomic === null ? null : (value + BigInt(fee.totalFeeAtomic)).toString(),
  };
}

function corrupt(): never { throw new ApnError("APN_STATE_CORRUPT", "Direct transfer actual fee does not match its own receipt fields."); }
