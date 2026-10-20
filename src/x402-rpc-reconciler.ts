import { x402AssetOf } from "./x402-network.js";
import { assertX402RpcChain } from "./x402-service-rpc.js";
import type { ClockPort, X402RpcPort } from "./ports.js";
import { appendX402Transition, sealX402Operation, type X402OperationRecord, type X402State } from "./x402-state-integrity.js";
import { matchingAuthorizationUsed, matchingPermit2Settled, matchingTransfer } from "./x402-rpc-scan.js";
import { stateSettlementEvidence } from "./x402-state-evidence.js";
import { readX402UnusedExpiryEvidence, x402NonceState } from "./x402-expiry-proof.js";
import { STATE_SHAPE } from "./x402-state-shape.js";

export interface X402ReconciliationStore {
  persist(operation: X402OperationRecord): Promise<void>;
}

export interface X402ReconciliationOutcome {
  readonly operation: X402OperationRecord;
  /** True only when this call read authorizationState(wallet, nonce) = false at the current proof (safe or finalized) block. */
  readonly unusedAtSafe: boolean;
}

/**
 * EIP-3009 outcomes come from the token's own nonce state, one header and one eth_call per proof, on any public RPC:
 * - used at a block of the record's proof tag (safe, or finalized off the released chains) means settled: APN signs exactly one TransferWithAuthorization per random nonce and never a
 *   cancellation, so a used nonce is exactly this payment of `value` to `to`;
 * - unused at a finalized block at or after validBefore means it can never settle.
 * A transaction hash from PAYMENT-RESPONSE is recorded only when its receipt carries the matching logs.
 */
export class X402RpcReconciler {
  constructor(
    private readonly rpc: X402RpcPort,
    private readonly clock: ClockPort,
    private readonly store: X402ReconciliationStore,
  ) {}

  async reconcile(input: X402OperationRecord): Promise<X402ReconciliationOutcome> {
    if (input.unusedExpiryEvidence !== undefined || input.settlementEvidence !== undefined) return { operation: input, unusedAtSafe: false };
    const chain = await assertX402RpcChain(this.rpc, x402AssetOf(input).chainId);
    // The record's frozen proof tag: `safe` on the released chains, `finalized` (the stronger tag) on every other chain.
    const tag = input.tokenFacts?.proofTag ?? "safe";
    const state = await x402NonceState(this.rpc, input, { tag });
    // A lagging endpoint whose proof head is behind the prepared block proves nothing about this authorization.
    if (state.blockTag !== tag ||
      BigInt(state.blockNumber) < BigInt(input.preparedBlock.number)) return { operation: input, unusedAtSafe: false };
    if (state.value) {
      const evidence = stateSettlementEvidence(input, { ...state, value: true, blockTag: tag }, chain.rpcOrigin,
        await this.matchingTransaction(input, state.blockNumber));
      // A used nonce with no attempt means the signed header reached the chain without APN sending it.
      return { operation: await this.persist(input, { settlementEvidence: evidence },
        input.state === "authorized_not_sent" ? "effect_unknown" : undefined), unusedAtSafe: false };
    }
    const validBefore = BigInt(input.authorization.validBefore);
    if (BigInt(state.blockTimestamp) < validBefore && BigInt(Math.floor(this.clock.now().getTime() / 1000)) < validBefore) {
      return { operation: input, unusedAtSafe: true };
    }
    const unused = await readX402UnusedExpiryEvidence(this.rpc, input);
    return { operation: unused === null ? input : await this.persist(input, { unusedExpiryEvidence: unused }), unusedAtSafe: true };
  }

  private async matchingTransaction(operation: X402OperationRecord, safeNumber: string) {
    const hint = operation.transactionHint;
    if (hint === undefined) return undefined;
    const receipt = await this.rpc.getX402Receipt(hint.transactionHash);
    if (
      receipt === null || receipt.status !== "success" || receipt.transactionHash !== hint.transactionHash ||
      BigInt(receipt.blockNumber) > BigInt(safeNumber) ||
      (operation.selectedOffer.resolved.assetTransferMethod === "permit2"
        ? receipt.logs.filter((log) => matchingPermit2Settled(log)).length !== 1
        : receipt.logs.filter((log) => matchingAuthorizationUsed(log, operation)).length !== 1) ||
      receipt.logs.filter((log) => matchingTransfer(log, operation)).length !== 1
    ) return undefined;
    return { transactionHash: hint.transactionHash, blockNumber: receipt.blockNumber, blockHash: receipt.blockHash };
  }

  private async persist(
    operation: X402OperationRecord,
    additions: Partial<Pick<X402OperationRecord, "settlementEvidence" | "unusedExpiryEvidence">>,
    stateOverride?: X402State,
  ): Promise<X402OperationRecord> {
    const at = this.clock.now().toISOString();
    const state = stateOverride ?? operation.state;
    const shape = STATE_SHAPE[state];
    const { integrityHash: _integrityHash, ...withoutIntegrity } = operation;
    const next = sealX402Operation({
      ...withoutIntegrity,
      ...additions,
      state,
      finalityClass: shape.finalityClass,
      terminal: false,
      reason: shape.reason,
      proofClass: shape.proofClass,
      nextActions: shape.nextActions,
      updatedAt: at,
      transitions: appendX402Transition(operation.transitions, { at, state, terminal: false, reason: shape.reason, proofClass: shape.proofClass }),
    });
    await this.store.persist(next);
    return next;
  }
}
