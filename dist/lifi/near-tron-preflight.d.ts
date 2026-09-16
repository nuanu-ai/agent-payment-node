import type { Address, Hex } from "../model.js";
import { type NearTronOfflineBinding } from "./near-tron-offline.js";
export interface NearTronReadOnlyRpc {
    request(method: string, params: readonly unknown[]): Promise<unknown>;
}
export interface NearTronPreflightPins {
    /** Operator-confirmed currently installed facet bytecode hash. */
    readonly facetCodeHash: Hex;
    /** Operator-confirmed signer from the installed facet deployment provenance. */
    readonly backendSigner: Address;
    /** SHA-256 of canonicalJson of the entire frozen quote. */
    readonly quoteSha256: string;
    /** Trusted wall clock, never quote metadata or an RPC response. */
    readonly nowUnixSeconds: string;
    /** Maximum age of the RPC safe block in seconds. */
    readonly maxSafeBlockAgeSeconds: number;
}
export interface NearTronPreflightProof {
    readonly kind: "read_only_near_tron_source_preflight";
    readonly executionAdmitted: false;
    readonly bridgeCompletion: false;
    readonly blockNumber: string;
    readonly blockHash: Hex;
    readonly facet: Address;
    readonly facetCodeHash: Hex;
    readonly backendSigner: Address;
    readonly quoteSha256: string;
    readonly quoteId: Hex;
    readonly calldataSha256: string;
    readonly simulation: "success";
}
/** Samples a current safe Base block and pins every state read and the exact payer simulation to it. */
export declare function preflightNearBaseTronSourceReadOnly(quote: unknown, binding: NearTronOfflineBinding, pins: NearTronPreflightPins, rpc: NearTronReadOnlyRpc): Promise<NearTronPreflightProof>;
