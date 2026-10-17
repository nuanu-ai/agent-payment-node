import type { Hex } from "viem";
import type { BridgeHttps } from "./lifi/https.js";
/** One JSON-RPC batch: one POST, answered by one node. */
export type EvmBatchRead = (calls: readonly {
    readonly method: string;
    readonly params: readonly unknown[];
}[]) => Promise<readonly unknown[]>;
/** What one node says about a signed transaction and its signer at the `finalized` tag. */
export interface EvmUnlandedEvidence {
    readonly finalizedNonce: string;
    readonly receiptFound: boolean;
    readonly transactionKnown: boolean;
}
/**
 * The chain-proven "never lands" exit (phase 4c R4 exit 2) in one batch: the chain ID, the signer's nonce at the
 * `finalized` tag, and this hash's receipt and transaction. One POST keeps every answer in one node's view: a load
 * balancer could route separate requests to a node behind the finalized head, which would not know a receipt the
 * finalized nonce already covers. Current state only, never a historical (archive) read.
 */
export declare function readEvmUnlandedEvidence(batch: EvmBatchRead, chainId: number, account: string, hash: Hex): Promise<EvmUnlandedEvidence>;
/**
 * True only when a transaction other than this one took its nonce at finality and the node knows neither this
 * transaction nor a receipt for it: it can never land. A nonce that is not past yet proves nothing.
 */
export declare function provesUnlanded(evidence: EvmUnlandedEvidence, nonce: string): boolean;
/** A JSON-RPC batch reader over one public HTTPS endpoint (the URL is the family's own configured endpoint). */
export declare function jsonRpcBatchReader(https: Pick<BridgeHttps, "request">, url: string): EvmBatchRead;
