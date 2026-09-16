/** Structural, read-only Base observation for a sealed NEAR/1Click source transaction. */
import type { Hex } from "../model.js";
import { hashObject } from "../canonical.js";
import { inspectNearBaseTronQuoteOffline, type NearTronOfflineBinding } from "./near-tron-offline.js";
import { inspectNearBaseTronSourceReceiptOffline } from "./near-tron-source-receipt.js";
import type { NonEvmSourceJournal, NonEvmSourceJournalRepository, RpcObservedNearTronSourceObservation } from "./non-evm-source-journal.js";
import type { BridgeRpcPort } from "./ports.js";
import { bridgeFailure } from "./validation.js";

export interface NearTronSourceReconciliationInput {
  readonly journal: NonEvmSourceJournal;
  readonly repository: NonEvmSourceJournalRepository;
  readonly rpc: Pick<BridgeRpcPort, "chainId" | "origin" | "observe">;
  readonly frozenQuote: unknown;
  readonly binding: NearTronOfflineBinding;
  /** Independently frozen RPC endpoint; a caller-provided endpoint is never authenticated proof. */
  readonly expectedRpcOrigin: string;
  readonly observedAt: string;
}
function inconsistent(): never { return bridgeFailure("APN_RPC_PROTOCOL", "near_tron_source_inconsistent"); }
function matchesPrior(j: NonEvmSourceJournal, next: RpcObservedNearTronSourceObservation): boolean {
  const p = j.safeSourceProof;
  if (p === null) return true;
  return p.provenance === next.provenance && p.transactionHash === next.transactionHash && p.status === next.status &&
    p.blockNumberAtomic === next.blockNumberAtomic && p.blockHash === next.blockHash && p.logsHash === next.logsHash &&
    p.receiptHash === next.receiptHash && p.rpcOrigin === next.rpcOrigin && p.protocolInputDigest === next.protocolInputDigest &&
    p.protocolProofHash === next.protocolProofHash && BigInt(next.safeBlockNumberAtomic) >= BigInt(p.safeBlockNumberAtomic) &&
    (next.safeBlockNumberAtomic !== p.safeBlockNumberAtomic || next.safeBlockHash === p.safeBlockHash);
}
/** A synthetic port or caller quote cannot promote this result beyond untrusted observation. */
export async function reconcileNearTronBaseSource(input: NearTronSourceReconciliationInput): Promise<NonEvmSourceJournal> {
  const { journal: j, repository: repo, rpc, frozenQuote, binding, observedAt } = input;
  if (j.route !== "base_usdc_to_tron_usdt_lifi_near_intents" || j.transactionHash === null ||
    j.signedTransaction === null || j.submissionAttempts !== 1) inconsistent();
  const fail = async () => j.phase === "unknown_finality" ? j : repo.observeUnknown(j.profileHash, j.operationId,
    j.integrityHash, "near_tron_source_inconsistent", observedAt);
  try {
    if (rpc.chainId !== 8453 || rpc.origin !== input.expectedRpcOrigin || binding.sender !== j.sourceCall.from) inconsistent();
    const quote = inspectNearBaseTronQuoteOffline(frozenQuote, binding);
    if (quote.transactionTarget !== j.sourceCall.to || quote.calldataSha256 !== j.sourceCall.dataSha256 ||
      (frozenQuote as { transactionRequest: { data: string } }).transactionRequest.data !== j.sourceCall.data ||
      j.sourceCall.valueAtomic !== "0") inconsistent();
    const observed = await rpc.observe(j.transactionHash as Hex);
    if (observed === null) inconsistent();
    const tx = observed.transaction, receipt = observed.receipt, safe = tx.safeBlock;
    if (safe === null || tx.chainId !== 8453 || receipt.chainId !== 8453 ||
      tx.transactionHash !== j.transactionHash || receipt.transactionHash !== j.transactionHash ||
      tx.rpcOrigin !== input.expectedRpcOrigin || tx.from !== j.sourceCall.from || tx.to !== j.sourceCall.to ||
      tx.valueAtomic !== j.sourceCall.valueAtomic || tx.dataHash !== j.sourceCall.dataSha256 ||
      tx.nonceAtomic !== j.sourceCall.nonceAtomic || tx.gasLimitAtomic !== j.sourceCall.gasLimitAtomic ||
      tx.maxFeePerGasAtomic !== j.sourceCall.maxFeePerGasAtomic ||
      tx.maxPriorityFeePerGasAtomic !== j.sourceCall.maxPriorityFeePerGasAtomic ||
      receipt.blockHash !== tx.block.hash || receipt.blockNumberAtomic !== tx.block.numberAtomic ||
      hashObject(receipt.logs) !== tx.logsHash || BigInt(safe.numberAtomic) < BigInt(tx.block.numberAtomic)) inconsistent();
    const candidate = tx.status === "success" ? inspectNearBaseTronSourceReceiptOffline(frozenQuote, binding,
      { chainId: 8453, hash: tx.transactionHash, from: tx.from, to: tx.to,
        input: j.sourceCall.data as Hex, valueAtomic: tx.valueAtomic },
      { chainId: 8453, transactionHash: receipt.transactionHash, status: "success", safe: true,
        blockNumberAtomic: receipt.blockNumberAtomic, blockHash: receipt.blockHash, logs: receipt.logs }) : null;
    const next: RpcObservedNearTronSourceObservation = {
      provenance: "rpc_observed_untrusted_near_tron_base_source_v1", transactionHash: tx.transactionHash,
      status: tx.status, blockNumberAtomic: tx.block.numberAtomic, blockHash: tx.block.hash,
      safeBlockNumberAtomic: safe.numberAtomic, safeBlockHash: safe.hash, observedAt,
      rpcOrigin: tx.rpcOrigin, logsHash: tx.logsHash, receiptHash: hashObject(receipt),
      protocolInputDigest: hashObject({ version: "near_tron_base_source_input_v1", sourceCall: j.sourceCall,
        frozenQuote, binding, quote }), protocolProofHash: candidate === null ? null : hashObject(candidate),
      executionAdmitted: false, bridgeCompletion: false,
    };
    if (!matchesPrior(j, next)) inconsistent();
    if (j.phase === "source_observed_untrusted") return j;
    return await repo.recordRpcObservedNearTronSource(j.profileHash, j.operationId, j.integrityHash, next, observedAt);
  } catch { return await fail(); }
}
