import { type Hex } from "viem";
import { BridgeHttps } from "./https.js";
import { type GaszipCorrelatedDelivery, type GaszipDirectRoute } from "./gaszip-direct-route.js";
import type { GaszipFundingPlan, GaszipFundingRecord } from "./gaszip-direct-journal.js";
export interface GaszipRpcPort {
    call(method: string, params: readonly unknown[], beforeSend?: () => void): Promise<unknown>;
}
/** Finite public RPC transport shares DNS pinning, response bounds, TLS and no-redirect/no-retry HTTP. */
export declare class GaszipFundingRpc implements GaszipRpcPort {
    private readonly route;
    private readonly https;
    private sequence;
    private reads;
    private readonly url;
    constructor(route: GaszipDirectRoute, url: string, https?: Pick<BridgeHttps, "request">);
    call(method: string, params: readonly unknown[], beforeSend?: () => void): Promise<unknown>;
}
export declare function readGaszipFundingPlan(route: GaszipDirectRoute, rpc: GaszipRpcPort, owner: string, amount: string, maxFee: string, frozenPlan?: GaszipFundingPlan): Promise<GaszipFundingPlan>;
export declare function assertGaszipFundingFresh(route: GaszipDirectRoute, initial: GaszipFundingPlan, fresh: GaszipFundingPlan, maximumFee: string): void;
export interface GaszipSafeProof {
    readonly hash: Hex;
    readonly blockHash: Hex;
    readonly blockNumber: string;
    readonly status: "success" | "reverted";
    readonly transactionDigest: string;
    readonly receiptDigest: string;
    readonly amount: string;
    readonly actualFee: string | null;
}
/** The exact transaction and receipt must agree, have canonical block identity, and lie at or below a fresh safe head. */
export declare function proveGaszipSafeTransaction(route: GaszipDirectRoute, rpc: GaszipRpcPort, chain: number, hash: Hex, expected: {
    from: string;
    to: string;
    data: Hex;
    value: string;
    nonce: string;
    gas?: string;
    maxFee?: string;
    tip?: string;
    gasPrice?: string;
}, known?: unknown): Promise<GaszipSafeProof | null>;
/**
 * The payout is proved from the chain alone: the exact signed transaction from the provider's signer to the owner, its
 * successful receipt with empty input and no logs at or below the safe head, its block membership, and an owner account
 * that has no code, so the plain value transfer could not run code and credited exactly its value. No historical balances.
 */
export declare function proveGaszipDelivery(route: GaszipDirectRoute, rpc: GaszipRpcPort, owner: string, d: GaszipCorrelatedDelivery): Promise<GaszipSafeProof | null>;
export declare function proveGaszipSource(route: GaszipDirectRoute, rpc: GaszipRpcPort, r: GaszipFundingRecord): Promise<GaszipSafeProof | null>;
