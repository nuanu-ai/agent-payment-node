import { canonicalJson, hashObject, isPlainRecord } from "./canonical.js";
import { ApnError } from "./errors.js";
import { assertEvmActualFeeBinding, deriveEvmActualFee, publicEvmActualFee, readEvmReceiptFeeFields, validateEvmActualFee,
  type EvmActualFee } from "./evm-direct-actual-fee.js";
import { directEvmChain, directEvmNetwork } from "./evm-direct-networks.js";
import { assertFinalizedChain, FINALIZED_RPC_ENV, type FinalizedReader } from "./evm-finalized-proof.js";
import { evmRpcHex, evmRpcQuantity, evmRpcRecord } from "./evm-rpc-codec.js";
import type { OperationRecord, ReceiptRecord } from "./model.js";
import { SecureStateStore, stateIdentifier } from "./secure-state-store.js";

/**
 * A transfer completed before APN recorded its actual fee keeps its sealed record untouched. On status or receipt APN
 * reads that operation's own receipt once more (its stored transaction hash, in the very block its record proved), derives
 * the fee by the network's rule, and keeps it in this sidecar bound to the record's integrity hash; later reads use the
 * sidecar and no RPC. A missing RPC setting or an unreadable receipt refuses this extra read only, by name.
 */
export const DIRECT_RECEIPT_FACTS_SCHEMA = "apn.direct-receipt-facts.v1";
export interface DirectReceiptFacts {
  readonly schemaVersion: typeof DIRECT_RECEIPT_FACTS_SCHEMA; readonly operationId: string; readonly recordIntegrityHash: string;
  readonly fee: EvmActualFee; readonly observedAt: string; readonly integrityHash: string;
}
export interface ReceiptFactsRefusal { readonly code: string; readonly reason: string; readonly message: string }

const PROVEN = ["completed", "failed_confirmed_revert"];

/** The receipt bound to what the record proved: its transaction, its block (and block hash where kept) and its outcome. */
export function directFeeFromReceipt(operation: OperationRecord, receipt: ReceiptRecord, raw: unknown): EvmActualFee {
  const r = evmRpcRecord(raw), chainId = directEvmChain(operation.chainId);
  if (operation.transactionHash === undefined || operation.economics === undefined || receipt.blockNumberAtomic === undefined ||
    evmRpcHex(r.transactionHash, 32) !== operation.transactionHash.toLowerCase() ||
    evmRpcQuantity(r.blockNumber).toString() !== receipt.blockNumberAtomic ||
    (receipt.evmEvidence !== undefined && evmRpcHex(r.blockHash, 32) !== receipt.evmEvidence.blockHash) ||
    evmRpcQuantity(r.status) !== (operation.state === "completed" ? 1n : 0n)) {
    throw new ApnError("APN_RPC_PROTOCOL", "The receipt read for the fee is not the one this record proved.", { reason: "receipt_facts_binding" });
  }
  return deriveEvmActualFee({ chainId, transactionHash: operation.transactionHash.toLowerCase() as `0x${string}`,
    blockNumberAtomic: receipt.blockNumberAtomic, gasLimitAtomic: operation.economics.gasLimitAtomic,
    maxFeePerGasAtomic: operation.economics.maxFeePerGasAtomic, receiptFields: readEvmReceiptFeeFields(r) }, directEvmNetwork(chainId).feeModel);
}

export class DirectReceiptFactsStore extends SecureStateStore {
  private path(operationId: string): string { stateIdentifier(operationId, "Direct receipt facts operation"); return `receipt-facts/${operationId}.direct.json`; }
  async load(operation: OperationRecord): Promise<DirectReceiptFacts | null> {
    const value = await this.readJson(this.path(operation.operationId));
    return value === null ? null : validateFacts(value, operation);
  }
  /** Create-only: a concurrent reader's file wins and is returned after the same validation. */
  async create(operation: OperationRecord, fee: EvmActualFee, observedAt: string): Promise<DirectReceiptFacts> {
    const body = { schemaVersion: DIRECT_RECEIPT_FACTS_SCHEMA, operationId: operation.operationId, recordIntegrityHash: operation.integrityHash, fee, observedAt };
    const facts = validateFacts({ ...body, integrityHash: hashObject(body) }, operation);
    await this.initialize(); await this.ensureDirectory("receipt-facts");
    try { await this.writeJson(this.path(operation.operationId), facts, true); }
    catch (error) {
      if (!(error instanceof ApnError) || error.message !== "State target is already occupied.") throw error;
      const existing = await this.load(operation); if (existing === null) throw error; return existing;
    }
    return facts;
  }
}

function validateFacts(value: unknown, operation: OperationRecord): DirectReceiptFacts {
  const corrupt = (): never => { throw new ApnError("APN_STATE_CORRUPT", "Direct receipt facts are not the ones this record allows."); };
  if (!isPlainRecord(value) || canonicalJson(Object.keys(value).sort()) !== canonicalJson(["fee", "integrityHash", "observedAt", "operationId",
    "recordIntegrityHash", "schemaVersion"])) corrupt();
  const facts = value as unknown as DirectReceiptFacts, { integrityHash, ...body } = facts;
  if (facts.schemaVersion !== DIRECT_RECEIPT_FACTS_SCHEMA || hashObject(body) !== integrityHash || facts.operationId !== operation.operationId ||
    facts.recordIntegrityHash !== operation.integrityHash || !PROVEN.includes(operation.state) || typeof facts.observedAt !== "string" ||
    !Number.isFinite(Date.parse(facts.observedAt))) corrupt();
  validateEvmActualFee(facts.fee); assertEvmActualFeeBinding({ ...operation, evmActualFee: facts.fee });
  return facts;
}

/**
 * The fee of a completed local transfer: recorded, from its sidecar, or read once now; or the named refusal of that read.
 * Nothing here fails the status or receipt it serves: a damaged sidecar or receipt record is named in the refusal too.
 */
export async function directActualFee(root: string, read: FinalizedReader | undefined, operation: OperationRecord,
  loadReceipt: () => Promise<ReceiptRecord | null>, now: Date): Promise<{ readonly fee?: EvmActualFee; readonly refusal?: ReceiptFactsRefusal }> {
  if (operation.evmActualFee !== undefined) return { fee: operation.evmActualFee };
  if (operation.providerDirect !== undefined || !PROVEN.includes(operation.state)) return {};
  const env = FINALIZED_RPC_ENV[operation.chainId], store = new DirectReceiptFactsStore(root);
  try {
    const stored = await store.load(operation);
    if (stored !== null) return { fee: stored.fee };
    const receipt = await loadReceipt();
    if (receipt === null) return {};
    if (read === undefined) return { refusal: { code: "APN_RPC_CONFIG", reason: "receipt_facts_rpc_required",
      message: `Reading this transfer's actual fee from its receipt needs ${env ?? `a public RPC setting for chain ${operation.chainId}`}.` } };
    const chain = read(operation.chainId); await assertFinalizedChain(chain, operation.chainId);
    const raw = await chain.call("eth_getTransactionReceipt", [operation.transactionHash]);
    if (raw === null) throw new ApnError("APN_RPC_PROTOCOL", "The node has no receipt for this transfer.", { reason: "receipt_facts_receipt_absent" });
    return { fee: (await store.create(operation, directFeeFromReceipt(operation, receipt, raw), now.toISOString())).fee };
  } catch (error) {
    if (error instanceof ApnError && error.code === "APN_STATE_CORRUPT") return { refusal: { code: error.code, reason: "receipt_facts_state_invalid",
      message: "The stored receipt or its fee facts do not match this record; nothing was read or written." } };
    return { refusal: { code: error instanceof ApnError ? error.code : "APN_RPC_PROTOCOL",
      reason: error instanceof ApnError && error.code === "APN_RPC_CONFIG" ? "receipt_facts_rpc_required"
        : error instanceof ApnError && typeof error.details?.reason === "string" ? error.details.reason : "receipt_facts_unavailable",
      message: error instanceof ApnError && error.code === "APN_RPC_CONFIG" ? `Reading this transfer's actual fee from its receipt needs ${env ?? "an RPC setting"}.`
        : "The receipt could not be read for the actual fee; status is unchanged and the read is retried next time." } };
  }
}

/** Public form for a local transfer: the fee keys, plus the named refusal when the extra read was refused. */
export function publicDirectFacts(operation: Pick<OperationRecord, "evm" | "amountAtomic" | "state">, facts: { readonly fee?: EvmActualFee;
  readonly refusal?: ReceiptFactsRefusal }) {
  return { ...publicEvmActualFee(facts.fee, operation.evm?.asset, operation.amountAtomic, operation.state),
    ...(facts.refusal === undefined ? {} : { actual_facts_refusal: facts.refusal }) };
}
