import { canonicalJson, hashObject, isPlainRecord } from "../canonical.js";
import { ApnError } from "../errors.js";
import { SecureStateStore, stateIdentifier } from "../secure-state-store.js";
import type { ReceiptFactsRefusal } from "../direct-receipt-facts.js";
import { validSwapEconomics, type SwapOperationRecord, type SwapReceiptEconomics } from "./model.js";

/**
 * A swap finalized before APN recorded its economics keeps its sealed record untouched. Its status reads that swap's own
 * finalized transaction once more through the lane's configured RPC, bound to the transaction hash the record proved, and
 * keeps what it proved here, bound to the record's integrity hash; later reads use this file and no RPC. A missing RPC
 * setting or an unreadable transaction refuses this extra read only, by name: the status itself still answers.
 */
export const SWAP_RECEIPT_FACTS_SCHEMA = "apn.swap-receipt-facts.v1";
export interface SwapReceiptFacts {
  readonly schemaVersion: typeof SWAP_RECEIPT_FACTS_SCHEMA; readonly operationId: string; readonly recordIntegrityHash: string;
  readonly transactionHash: string; readonly economics: SwapReceiptEconomics; readonly observedAt: string; readonly integrityHash: string;
}
/** Added beside the record in a swap's status: the facts, where they came from, or why the extra read was refused. */
export interface SwapActualEconomicsView {
  readonly actualEconomics: SwapReceiptEconomics | null;
  readonly actualEconomicsSource?: "receipt_proof" | "receipt_facts";
  readonly actualFactsRefusal?: ReceiptFactsRefusal;
}
/** Reads one finalized swap's own transaction for its economics (each lane's observer implements it, observe-only). */
export type SwapEconomicsRead = () => Promise<SwapReceiptEconomics>;

const PROVEN = ["finalized", "failed_confirmed_revert"];

/** What a finalized record allows: success credits an output, a revert moved no input and credited nothing. */
export function assertSwapEconomicsOutcome(record: Pick<SwapOperationRecord, "state">, economics: unknown): SwapReceiptEconomics {
  if (!validSwapEconomics(economics) || !PROVEN.includes(record.state) || (record.state === "finalized" ? economics.outputAtomic === null
    : economics.outputAtomic !== null || economics.inputAtomic !== "0")) {
    throw new ApnError("APN_STATE_CORRUPT", "Swap economics contradict the swap outcome.");
  }
  return economics;
}

export class SwapReceiptFactsStore extends SecureStateStore {
  private path(operationId: string): string { stateIdentifier(operationId, "Swap receipt facts operation"); return `receipt-facts/${operationId}.swap.json`; }
  async load(record: SwapOperationRecord): Promise<SwapReceiptFacts | null> {
    const value = await this.readJson(this.path(record.operationId));
    return value === null ? null : validateFacts(value, record);
  }
  /** Create-only: a concurrent reader's file wins and is returned after the same validation. */
  async create(record: SwapOperationRecord, economics: SwapReceiptEconomics, observedAt: string): Promise<SwapReceiptFacts> {
    const body = { schemaVersion: SWAP_RECEIPT_FACTS_SCHEMA, operationId: record.operationId, recordIntegrityHash: record.integrityHash,
      transactionHash: record.receiptProof?.transactionHash ?? "", economics, observedAt };
    const facts = validateFacts({ ...body, integrityHash: hashObject(body) }, record);
    await this.initialize(); await this.ensureDirectory("receipt-facts");
    try { await this.writeJson(this.path(record.operationId), facts, true); }
    catch (error) {
      if (!(error instanceof ApnError) || error.message !== "State target is already occupied.") throw error;
      const existing = await this.load(record); if (existing === null) throw error; return existing;
    }
    return facts;
  }
}

function validateFacts(value: unknown, record: SwapOperationRecord): SwapReceiptFacts {
  const corrupt = (): never => { throw new ApnError("APN_STATE_CORRUPT", "Swap receipt facts are not the ones this record allows."); };
  if (!isPlainRecord(value) || canonicalJson(Object.keys(value).sort()) !== canonicalJson(["economics", "integrityHash", "observedAt", "operationId",
    "recordIntegrityHash", "schemaVersion", "transactionHash"])) corrupt();
  const facts = value as unknown as SwapReceiptFacts, { integrityHash, ...body } = facts;
  if (facts.schemaVersion !== SWAP_RECEIPT_FACTS_SCHEMA || hashObject(body) !== integrityHash || facts.operationId !== record.operationId ||
    facts.recordIntegrityHash !== record.integrityHash || record.receiptProof === null || !record.receiptProof.finalized ||
    facts.transactionHash !== record.receiptProof.transactionHash || typeof facts.observedAt !== "string" || !Number.isFinite(Date.parse(facts.observedAt))) corrupt();
  assertSwapEconomicsOutcome(record, facts.economics);
  return facts;
}

/** The record's own economics, its facts sidecar, or one read now; never a failure of the status it serves. */
export async function swapActualEconomics(root: string, record: SwapOperationRecord, read: SwapEconomicsRead | undefined, now: Date): Promise<SwapActualEconomicsView> {
  if (record.receiptProof?.economics !== undefined) return { actualEconomics: record.receiptProof.economics, actualEconomicsSource: "receipt_proof" };
  if (!PROVEN.includes(record.state) || record.receiptProof === null) return { actualEconomics: null };
  const store = new SwapReceiptFactsStore(root);
  try {
    const stored = await store.load(record);
    if (stored !== null) return { actualEconomics: stored.economics, actualEconomicsSource: "receipt_facts" };
    if (read === undefined) throw new ApnError("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "This lane cannot read its receipt facts.", { reason: "receipt_facts_unsupported" });
    const economics = assertSwapEconomicsOutcome(record, await read());
    return { actualEconomics: (await store.create(record, economics, now.toISOString())).economics, actualEconomicsSource: "receipt_facts" };
  } catch (error) {
    const code = error instanceof ApnError ? error.code : "APN_RPC_PROTOCOL";
    return { actualEconomics: null, actualFactsRefusal: { code,
      reason: code === "APN_RPC_CONFIG" ? "receipt_facts_rpc_required" : code === "APN_STATE_CORRUPT" ? "receipt_facts_state_invalid"
        : error instanceof ApnError && typeof error.details?.reason === "string" ? error.details.reason : "receipt_facts_unavailable",
      message: code === "APN_RPC_CONFIG" && error instanceof Error ? error.message
        : "The finalized transaction could not be read for its economics; status is unchanged and the read is retried next time." } };
  }
}
