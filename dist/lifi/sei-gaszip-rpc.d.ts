import { type Hex } from "viem";
import { BridgeHttps } from "./https.js";
import { type SeiCorrelatedDelivery } from "./sei-gaszip-contract.js";
import type { SeiFundingPlan, SeiFundingRecord } from "./sei-gaszip-journal.js";
export interface SeiRpcPort {
    call(method: string, params: readonly unknown[], beforeSend?: () => void): Promise<unknown>;
}
/** Finite public RPC transport shares DNS pinning, response bounds, TLS and no-redirect/no-retry HTTP. */
export declare class SeiFundingRpc implements SeiRpcPort {
    private readonly https;
    private sequence;
    private reads;
    private readonly url;
    constructor(url: string, https?: Pick<BridgeHttps, "request">);
    call(method: string, params: readonly unknown[], beforeSend?: () => void): Promise<unknown>;
}
export declare function readSeiFundingPlan(rpc: SeiRpcPort, owner: string, amount: string, maxFee: string, frozenFeeUpper?: string): Promise<SeiFundingPlan>;
export declare function assertSeiFundingFresh(initial: SeiFundingPlan, fresh: SeiFundingPlan): void;
export interface SeiSafeProof {
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
export declare function proveSeiSafeTransaction(rpc: SeiRpcPort, chain: 8453 | 1329, hash: Hex, expected: {
    from: string;
    to: string;
    data: Hex;
    value: string;
    nonce: string;
    gas?: string;
    maxFee?: string;
    tip?: string;
}): Promise<SeiSafeProof | null>;
export declare function proveSeiDelivery(rpc: SeiRpcPort, owner: string, d: SeiCorrelatedDelivery): Promise<SeiSafeProof | null>;
export declare function proveSeiSource(rpc: SeiRpcPort, r: SeiFundingRecord): Promise<SeiSafeProof | null>;
