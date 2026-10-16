import type { X402RpcPort } from "./ports.js";
import type { Eip3009StateUnusedExpiryEvidence, X402OperationRecord } from "./x402-state-model.js";
/**
 * An EIP-3009 authorization executes only while block.timestamp < validBefore, and its
 * (authorizer, nonce) state flips to used exactly once. A finalized block at or after validBefore
 * that still reads "unused" therefore proves the signed authorization can never move money.
 * Returns null when the chain cannot prove it yet.
 */
export declare function readX402UnusedExpiryEvidence(rpc: X402RpcPort, operation: X402OperationRecord): Promise<Eip3009StateUnusedExpiryEvidence | null>;
