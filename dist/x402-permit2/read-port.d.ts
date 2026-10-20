import type { Address } from "../model.js";
import type { ReadOnlyRpcBatchCall } from "../rpc.js";
import type { Permit2PrepareReadPort } from "./prepare.js";
/** A configured RPC source and the authenticated APN state are required; no signer or sender is accepted. */
export interface Permit2ReadRpcSource {
    /** One read-only JSON-RPC batch POST, no retry. Implementations must honor abort before sending and in flight. */
    batch(calls: readonly ReadOnlyRpcBatchCall[], signal: AbortSignal): Promise<readonly unknown[]>;
}
export interface Permit2UsageReader {
    usage(identity: {
        readonly account: string;
        readonly chain: string;
        readonly asset: {
            readonly kind: "token";
            readonly identifier: string;
        };
    }, now: Date): Promise<{
        readonly amountAtomic: string;
    }>;
}
export interface Permit2ProductionReadOptions {
    readonly profile: string;
    readonly stateRoot: string;
    /** Resolve the current local-wallet address from the authenticated wallet binding. */
    readonly localAccount: () => Promise<Address>;
    readonly usage: Permit2UsageReader;
    readonly rpc: Permit2ReadRpcSource;
    readonly now?: () => Date;
}
export interface Permit2ReadCheckpoint {
    readonly policyRevision: number;
    readonly registryVersion: string;
    readonly activationDigest: string;
    readonly blockNumber: string;
    readonly blockHash: string;
    readonly blockTimestamp: number;
    /**
     * Hash of the facilitator capability source. Since APN 0.5.43 this is the seller's checked 402 challenge hash: the
     * seller chooses the facilitator and declares eip2612GasSponsoring there; 0.5.42 records hold PayAI's /supported digest.
     */
    readonly facilitatorSupportedDigest: string;
}
export interface Permit2CheckedReadPort extends Permit2PrepareReadPort {
    readChecked(input: Parameters<Permit2PrepareReadPort["read"]>[0]): Promise<Awaited<ReturnType<Permit2PrepareReadPort["read"]>> & {
        readonly checkpoint: Permit2ReadCheckpoint;
    }>;
}
/**
 * Production read adapter for the existing unsigned prepare boundary. It never creates an operation or reservation.
 * Two POSTs: chain id with the latest header, then balance, allowance, the Permit2 nonce word and both runtime codes in
 * one batch pinned by EIP-1898 {blockHash, requireCanonical}; a third pinned POST (token domain, EIP-2612 nonce) only for
 * a sponsored permit. No facilitator read gates it: the seller picks the facilitator, and one that cannot settle leaves
 * the signature to expire unused.
 */
export declare function createPermit2ProductionReadPort(options: Permit2ProductionReadOptions): Permit2CheckedReadPort;
