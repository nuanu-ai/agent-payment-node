/** Read-only approval boundary for a saved Relay Arbitrum operation. Never signs, sends, or admits execution. */
import type { ActiveAssetPolicy } from "../allowlist-active-policy.js";
import { ApnError } from "../errors.js";
import { EvmDirectRpcGuard } from "../evm-direct-rpc-guard.js";
import { evmRpcHex, evmRpcQuantity, evmRpcRecord } from "../evm-rpc-codec.js";
import type { ReadOnlyRpcBatchCall } from "../rpc.js";
import { HttpsBaseRpc } from "../rpc.js";
import type { StateStore } from "../state.js";
import { validateRelayUnsignedOperation, type RelayUnsignedOperation } from "../relay-unsigned-operation.js";
import { validateRelayArbitrumUsdcEthereumUsdcQuote } from "./arbitrum-usdc-ethereum-quote.js";
import { preflightRelayArbitrumSourceDraft, type RelayArbitrumReadCall } from "./arbitrum-usdc-source-draft.js";

const blocked = (reason: string): never => {
  throw new ApnError("APN_OPERATION_BLOCKED", "Relay Arbitrum approval preflight is blocked.", { reason });
};

export interface RelayArbitrumApprovalPreflightPorts {
  readonly batch: (calls: readonly RelayArbitrumReadCall[]) => Promise<readonly unknown[]>;
  readonly now: () => Date;
}

/** Three read-only batches total. The third binds nonce and block base fee to the funding block. */
export async function preflightRelayArbitrumApproval(operation: RelayUnsignedOperation,
  active: ActiveAssetPolicy, publicAccount: string, dailyUsageAtomic: string, now: Date,
  ports: RelayArbitrumApprovalPreflightPorts) {
  validateRelayUnsignedOperation(operation);
  const draft = operation.arbitrumDraft;
  if (draft === undefined || operation.sourceChainId !== 42161 || operation.destinationChainId !== 1) {
    return blocked("saved_arbitrum_operation_required");
  }
  const funding = await preflightRelayArbitrumSourceDraft(draft, active, publicAccount,
    dailyUsageAtomic, now, ports);
  const quote = await validateRelayArbitrumUsdcEthereumUsdcQuote(draft.rawQuote, {
    payer: draft.owner, amountAtomic: draft.amountAtomic,
    minimumOutputAtomic: draft.minimumOutputAtomic, nowSeconds: Math.floor(now.getTime() / 1000),
  });
  if (quote.quoteDigest !== draft.quoteDigest || quote.orderId !== draft.orderId) blocked("quote_changed");
  const reference = { blockHash: funding.observationBlockHash, requireCanonical: true };
  const blockTag = `0x${BigInt(funding.observationBlockNumber).toString(16)}`;
  const rows = await ports.batch([
    { method: "eth_chainId", params: [] },
    { method: "eth_getBlockByNumber", params: [blockTag, false] },
    { method: "eth_getTransactionCount", params: [draft.owner, reference] },
    { method: "eth_getTransactionCount", params: [draft.owner, "pending"] },
  ]);
  if (!Array.isArray(rows) || rows.length !== 4) blocked("nonce_batch_shape");
  if (evmRpcQuantity(rows[0]) !== 42161n) blocked("source_chain");
  const block = evmRpcRecord(rows[1]);
  if (evmRpcQuantity(block.number).toString() !== funding.observationBlockNumber ||
    evmRpcHex(block.hash, 32) !== funding.observationBlockHash) blocked("source_block_changed");
  const baseFee = evmRpcQuantity(block.baseFeePerGas);
  const confirmedNonce = evmRpcQuantity(rows[2]);
  const pendingNonce = evmRpcQuantity(rows[3]);
  const maxFee = BigInt(quote.approval.maxFeePerGas);
  const priority = BigInt(quote.approval.maxPriorityFeePerGas);
  const feeWithinQuote = baseFee + priority <= maxFee;
  const nonceUncontended = confirmedNonce === pendingNonce;
  const observedAt = ports.now();
  if (!(observedAt instanceof Date) || !Number.isFinite(observedAt.getTime()) ||
    observedAt.getTime() + 60_000 >= Date.parse(draft.deadline) ||
    (active.registry.expiresAt !== undefined && observedAt.toISOString() >= active.registry.expiresAt) ||
    active.digest !== draft.policyDigest || active.digest !== active.registry.policyDigest ||
    active.revision !== draft.policyRevision || active.accounts.evm?.toLowerCase() !== draft.owner)
    blocked("expired_or_policy_changed_during_read");
  validateRelayUnsignedOperation(operation);
  const reasons = Object.freeze([
    ...funding.fundingReasons,
    ...(nonceUncontended ? [] : ["pending_nonce_conflict"]),
    ...(feeWithinQuote ? [] : ["approval_base_fee_exceeds_quote"]),
  ]);
  return Object.freeze({ kind: "relay_arbitrum_read_only_approval_preflight" as const,
    operationId: operation.operationId, operationIntegrityHash: operation.integrityHash,
    draftIntegrityHash: draft.integrityHash, quoteDigest: draft.quoteDigest,
    policyDigest: draft.policyDigest, policyRevision: draft.policyRevision,
    sourceChainId: 42161 as const, sourceAccount: draft.owner,
    observationBlockNumber: funding.observationBlockNumber,
    observationBlockHash: funding.observationBlockHash,
    tokenBalanceAtomic: funding.tokenBalanceAtomic, allowanceAtomic: funding.allowanceAtomic,
    nativeBalanceWei: funding.nativeBalanceWei, requiredNativeWei: funding.requiredNativeWei,
    approvalRequired: funding.approvalRequired,
    confirmedNonce: confirmedNonce.toString(), pendingNonce: pendingNonce.toString(),
    baseFeePerGas: baseFee.toString(), quotedMaxFeePerGas: quote.approval.maxFeePerGas,
    quotedMaxPriorityFeePerGas: quote.approval.maxPriorityFeePerGas,
    readOnlyConditionsSatisfied: reasons.length === 0, reasons, rpcBatches: 3 as const,
    proofClass: "read_only_rpc_observation" as const, executionAdmitted: false as const,
    nextActions: [] as const });
}

/** Optional transport adapter; one persisted guard covers all three physical POSTs. */
export class RelayArbitrumApprovalPreflightReader {
  private readonly rpc: Pick<HttpsBaseRpc, "batchCall">;
  constructor(private readonly url: string, private readonly state: StateStore,
    rpc?: Pick<HttpsBaseRpc, "batchCall">,
    private readonly guardFactory: () => EvmDirectRpcGuard = () => new EvmDirectRpcGuard(state),
    private readonly holdAfterPost: () => Promise<void> = () => new Promise(resolve => setTimeout(resolve, 750))) {
    this.rpc = rpc ?? new HttpsBaseRpc(url);
  }

  async read(operation: RelayUnsignedOperation, active: ActiveAssetPolicy, publicAccount: string,
    dailyUsageAtomic: string, now: Date, clock: () => Date = () => new Date()) {
    const guard = this.guardFactory();
    return preflightRelayArbitrumApproval(operation, active, publicAccount, dailyUsageAtomic, now, {
      now: clock,
      batch: async (calls: readonly ReadOnlyRpcBatchCall[]) => {
        const rows = await guard.post(this.url, async () => {
          try { return await this.rpc.batchCall(calls); }
          finally { await this.holdAfterPost(); }
        });
        if (!Array.isArray(rows) || rows.length !== calls.length) blocked("rpc_batch_shape");
        return rows;
      },
    });
  }
}
