import type { ActiveAssetPolicy } from "../allowlist-active-policy.js";
import type { Address, Hex } from "../model.js";
import { type UsdtAccountState, type UsdtSponsorPort } from "./engine.js";
import { USDT_GASLESS, type UsdtPaymasterPayload, type UsdtTransferPlan, type UsdtTransferRequest } from "./model.js";
import { type UsdtUserOperation } from "./userop.js";
export declare const USDT_PREPARE_STUB_WORD: `0x${string}`;
export declare function frozenCopy<T>(value: T): T;
/** A read-only adapter must authenticate the active policy and read one canonical safe block. */
export interface UsdtPreparePort {
    now(): Date;
    sponsorPermit?(bound: import("./bound-operation.js").UsdtAnyBoundOperation, identity: import("./local-signing.js").UsdtSigningIdentity, snapshot: import("./sponsor-auth.js").UsdtSponsorSnapshot): Promise<import("./sponsor-permit.js").UsdtSponsorPermit>;
    sponsorAuth?(op: UsdtUserOperation, snapshot: import("./sponsor-auth.js").UsdtSponsorSnapshot): Promise<import("./sponsor-auth.js").UsdtSponsorAuthEvidence>;
    activePolicy(profile: string): Promise<ActiveAssetPolicy | null>;
    dailyUsage(sender: Address, at: Date): Promise<string>;
    safeSnapshot(sender: Address): Promise<{
        readonly chainId: bigint;
        readonly blockNumber: bigint;
        readonly blockHash: Hex;
        readonly account: UsdtAccountState;
        readonly pins?: import("./sponsor-auth.js").UsdtSponsorSnapshot["pins"];
    }>;
}
export interface UsdtPolicyPrepareRequest extends UsdtTransferRequest {
    readonly profile: string;
    readonly chain: "eip155:1";
    readonly token: Address;
    readonly sponsorUrl: string;
}
/** Frozen, unsigned material. Integration must persist it before offering foreground approval. */
export interface UsdtPolicyPrepared {
    readonly schemaVersion: "apn.gasless-usdt-policy-prepare.v1";
    readonly profile: string;
    readonly policyDigest: string;
    readonly policyRevision: number;
    readonly activationDigest: string;
    readonly chain: "eip155:1";
    readonly token: Address;
    readonly mechanism: typeof USDT_GASLESS.mechanism;
    readonly sponsorUrl: string;
    readonly safeBlockNumber: string;
    readonly safeBlockHash: Hex;
    readonly account: UsdtAccountState;
    readonly plan: UsdtTransferPlan;
    readonly callData: Hex;
    readonly paymaster: UsdtPaymasterPayload;
    readonly paymasterData: Hex;
    readonly unsignedOperation: UsdtUserOperation;
    readonly bindingHash: string;
}
export declare function canonicalAddress(value: unknown): Address;
export declare function requirePolicy(active: ActiveAssetPolicy | null, request: UsdtPolicyPrepareRequest, usage: string, now: Date): ActiveAssetPolicy;
export declare function usdtApprovalTransferBatch(plan: Pick<UsdtTransferPlan, "request" | "feeCapAtomic" | "netAtomic">): Hex;
/** Domain-only prepare: quote and sponsor reads are checked twice; no journal, reservation, signature or send is reachable. */
export declare function preparePolicyBoundUsdt(ports: {
    readonly prepare: UsdtPreparePort;
    readonly sponsor: Pick<UsdtSponsorPort, "tokenQuote" | "gasPrice" | "paymasterData">;
}, request: UsdtPolicyPrepareRequest): Promise<UsdtPolicyPrepared>;
