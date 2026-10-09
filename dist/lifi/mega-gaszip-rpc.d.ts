import { type Hex } from "viem";
import { BridgeHttps } from "./https.js";
import { type MegaCorrelatedDelivery } from "./mega-gaszip-contract.js";
import type { MegaFundingPlan, MegaFundingRecord } from "./mega-gaszip-journal.js";
export interface MegaRpcPort {
    call(method: string, params: readonly unknown[]): Promise<unknown>;
}
/** Finite public RPC transport shares DNS pinning, response bounds, TLS and no-redirect/no-retry HTTP. */
export declare class MegaFundingRpc implements MegaRpcPort {
    private readonly https;
    private sequence;
    private reads;
    private readonly url;
    constructor(url: string, https?: Pick<BridgeHttps, "request">);
    call(method: string, params: readonly unknown[]): Promise<unknown>;
}
export declare function readMegaFundingPlan(rpc: MegaRpcPort, owner: string, amount: string, maxFee: string, frozenFeeUpper?: string): Promise<MegaFundingPlan>;
export declare function assertMegaFundingFresh(initial: MegaFundingPlan, fresh: MegaFundingPlan): void;
export interface MegaSafeProof {
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
export declare function proveMegaSafeTransaction(rpc: MegaRpcPort, chain: 8453 | 4326, hash: Hex, expected: {
    from: string;
    to: string;
    data: Hex;
    value: string;
    nonce: string;
    gas?: string;
    maxFee?: string;
    tip?: string;
}): Promise<MegaSafeProof | null>;
export declare function proveMegaDelivery(rpc: MegaRpcPort, owner: string, d: MegaCorrelatedDelivery): Promise<MegaSafeProof | null>;
export declare function proveMegaSource(rpc: MegaRpcPort, r: MegaFundingRecord): Promise<MegaSafeProof | null>;
