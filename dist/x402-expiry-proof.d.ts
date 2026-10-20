import type { X402AuthorizationState, X402BlockReference, X402RpcPort } from "./ports.js";
import type { Eip3009StateUnusedExpiryEvidence, X402OperationRecord } from "./x402-state-model.js";
/**
 * An EIP-3009 authorization executes only while block.timestamp < validBefore, and its
 * (authorizer, nonce) state flips to used exactly once. A finalized block at or after validBefore
 * that still reads "unused" therefore proves the signed authorization can never move money.
 * Returns null when the chain cannot prove it yet.
 */
export declare function readX402UnusedExpiryEvidence(rpc: X402RpcPort, operation: X402OperationRecord): Promise<Eip3009StateUnusedExpiryEvidence | null>;
/** The one-shot nonce state an operation's method spends: EIP-3009 authorizationState, or Permit2's unordered nonce bit. */
export declare function x402NonceState(rpc: X402RpcPort, operation: X402OperationRecord, block: X402BlockReference): Promise<X402AuthorizationState>;
