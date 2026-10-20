import { x402AssetOf } from "./x402-network.js";
import { assertX402RpcChain } from "./x402-service-rpc.js";
import { appendX402Transition, sealX402Operation } from "./x402-state-integrity.js";
import { matchingAuthorizationUsed, matchingTransfer } from "./x402-rpc-scan.js";
import { stateSettlementEvidence } from "./x402-state-evidence.js";
import { readX402UnusedExpiryEvidence } from "./x402-expiry-proof.js";
import { STATE_SHAPE } from "./x402-state-shape.js";
/**
 * EIP-3009 outcomes come from the token's own nonce state, one header and one eth_call per proof, on any public RPC:
 * - used at a block of the record's proof tag (safe, or finalized off the released chains) means settled: APN signs exactly one TransferWithAuthorization per random nonce and never a
 *   cancellation, so a used nonce is exactly this payment of `value` to `to`;
 * - unused at a finalized block at or after validBefore means it can never settle.
 * A transaction hash from PAYMENT-RESPONSE is recorded only when its receipt carries the matching logs.
 */
export class X402RpcReconciler {
    rpc;
    clock;
    store;
    constructor(rpc, clock, store) {
        this.rpc = rpc;
        this.clock = clock;
        this.store = store;
    }
    async reconcile(input) {
        if (input.unusedExpiryEvidence !== undefined || input.settlementEvidence !== undefined)
            return { operation: input, unusedAtSafe: false };
        const chain = await assertX402RpcChain(this.rpc, x402AssetOf(input).chainId);
        // The record's frozen proof tag: `safe` on the released chains, `finalized` (the stronger tag) on every other chain.
        const tag = input.tokenFacts?.proofTag ?? "safe";
        const state = await this.rpc.getX402AuthorizationState(input.wallet, input.authorization.nonce, { tag });
        // A lagging endpoint whose proof head is behind the prepared block proves nothing about this authorization.
        if (state.blockTag !== tag ||
            BigInt(state.blockNumber) < BigInt(input.preparedBlock.number))
            return { operation: input, unusedAtSafe: false };
        if (state.value) {
            const evidence = stateSettlementEvidence(input, { ...state, value: true, blockTag: tag }, chain.rpcOrigin, await this.matchingTransaction(input, state.blockNumber));
            // A used nonce with no attempt means the signed header reached the chain without APN sending it.
            return { operation: await this.persist(input, { settlementEvidence: evidence }, input.state === "authorized_not_sent" ? "effect_unknown" : undefined), unusedAtSafe: false };
        }
        const validBefore = BigInt(input.authorization.validBefore);
        if (BigInt(state.blockTimestamp) < validBefore && BigInt(Math.floor(this.clock.now().getTime() / 1000)) < validBefore) {
            return { operation: input, unusedAtSafe: true };
        }
        const unused = await readX402UnusedExpiryEvidence(this.rpc, input);
        return { operation: unused === null ? input : await this.persist(input, { unusedExpiryEvidence: unused }), unusedAtSafe: true };
    }
    async matchingTransaction(operation, safeNumber) {
        const hint = operation.transactionHint;
        if (hint === undefined)
            return undefined;
        const receipt = await this.rpc.getX402Receipt(hint.transactionHash);
        if (receipt === null || receipt.status !== "success" || receipt.transactionHash !== hint.transactionHash ||
            BigInt(receipt.blockNumber) > BigInt(safeNumber) ||
            receipt.logs.filter((log) => matchingAuthorizationUsed(log, operation)).length !== 1 ||
            receipt.logs.filter((log) => matchingTransfer(log, operation)).length !== 1)
            return undefined;
        return { transactionHash: hint.transactionHash, blockNumber: receipt.blockNumber, blockHash: receipt.blockHash };
    }
    async persist(operation, additions, stateOverride) {
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
//# sourceMappingURL=x402-rpc-reconciler.js.map