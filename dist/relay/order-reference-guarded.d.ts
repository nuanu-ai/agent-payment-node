import { EvmDirectRpcGuard } from "../evm-direct-rpc-guard.js";
import { HttpsBaseRpc } from "../rpc.js";
import type { StateStore } from "../state.js";
import { type RelayArbitrumQuoteIntent } from "./arbitrum-usdc-ethereum-quote.js";
type BatchRpc = Pick<HttpsBaseRpc, "batchCall">;
export type RelayGuardedOrderReferenceResult = Readonly<{
    status: "unproven";
    reason: string;
    orderReferencedRecipientCreditProven: false;
    relayOrderFulfillmentProven: false;
    cryptographicCausalityProven: false;
    paidAcceptance: false;
}> | Readonly<{
    status: "proven";
    orderReferencedRecipientCreditProven: true;
    relayOrderFulfillmentProven: false;
    cryptographicCausalityProven: false;
    paidAcceptance: false;
    proof: Readonly<{
        orderId: string;
        quoteDigest: string;
        sourceTransactionHash: string;
        sourceBlockHash: string;
        sourceDepositLogIndex: string;
        destinationTransactionHash: string;
        destinationBlockHash: string;
        destinationTransferLogIndex: string;
        creditedAtomic: string;
        destinationTimestampSeconds: string;
        proofClass: "guarded_canonical_safe_order_reference_and_recipient_credit";
    }>;
}>;
/** Production defaults to public HTTPS RPC. Injection is limited to raw transport for synthetic tests. */
export declare class RelayGuardedOrderReferenceObserver {
    private readonly sourceUrl;
    private readonly destinationUrl;
    private readonly holdAfterPost;
    private readonly sourceRpc;
    private readonly destinationRpc;
    private readonly sourceGuard;
    private readonly destinationGuard;
    private sourcePosts;
    private destinationPosts;
    constructor(sourceUrl: string, destinationUrl: string, state: StateStore, sourceRpc?: BatchRpc, destinationRpc?: BatchRpc, guardFactory?: () => EvmDirectRpcGuard, holdAfterPost?: () => Promise<void>);
    get physicalPosts(): number;
    private batch;
    private initial;
    private recheck;
    /** Six guarded batch POSTs at most; no caller-provided proof records are accepted. */
    observe(rawQuote: unknown, intent: RelayArbitrumQuoteIntent, sourceHash: string, destinationHash: string): Promise<RelayGuardedOrderReferenceResult>;
}
export {};
