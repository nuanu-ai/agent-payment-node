import { type Hex } from "viem";
import type { Address } from "../model.js";
import { type StargateV2RouteFinalityPolicy } from "./finality-policy.js";
import type { StargateNativeOperation, StargateNativePhase, StargateSourceReceipt, StargateDestinationEvidence } from "./native-execution.js";
export declare const SOURCE_CHAIN: 1;
export declare const DESTINATION_CHAIN: 130;
export declare const SOURCE_EID: 30101;
export declare const DESTINATION_EID: 30320;
export declare const SOURCE_POOL: `0x${string}`;
export declare const DESTINATION_POOL: `0x${string}`;
export declare const HASH: RegExp;
export declare const CODE: RegExp;
export declare const MAX_TTL_MS = 120000;
export declare function fail(code: "APN_INVALID_INPUT" | "APN_OPERATION_BLOCKED" | "APN_RPC_PROTOCOL" | "APN_RPC_AMBIGUOUS" | "APN_CHAIN_MISMATCH" | "APN_REPREPARE_REQUIRED" | "APN_STATE_CORRUPT", reason: string): never;
export declare function uint(value: unknown, positive?: boolean): bigint;
export declare function address(value: unknown): Address;
export declare function hex32(value: unknown): Hex;
export declare function rpcQuantity(value: unknown): bigint;
export declare function transition(operation: StargateNativeOperation, phase: StargateNativePhase, reason: string, at: number): StargateNativeOperation;
export declare function seal<T extends Omit<StargateNativeOperation, "integrityHash"> & {
    integrityHash?: never;
} | StargateNativeOperation>(value: T): StargateNativeOperation;
export declare function validateRecord(value: unknown): StargateNativeOperation;
export declare function validateAdvance(previous: StargateNativeOperation | null, next: StargateNativeOperation): void;
export interface StargateNativeCanonicalReceipt {
    readonly schemaVersion: "apn.stargate-v2-native-receipt.v1";
    readonly operationId: string;
    readonly profile: string;
    readonly route: Readonly<{
        sourceChainId: 1;
        sourceEid: 30101;
        sourcePool: Address;
        destinationChainId: 130;
        destinationEid: 30320;
        destinationPool: Address;
    }>;
    readonly owner: Address;
    readonly recipient: Address;
    readonly principalAtomic: string;
    readonly nativeMessageFeeAtomic: string;
    readonly finalityPolicy: StargateV2RouteFinalityPolicy;
    readonly totalValueAtomic: string;
    readonly maximumDebitAtomic: string;
    readonly quoteHash: string;
    readonly source: StargateSourceReceipt;
    readonly destination: StargateDestinationEvidence;
    readonly evidenceHash: string;
}
export declare function stargateV2NativeCanonicalReceipt(operationInput: StargateNativeOperation): StargateNativeCanonicalReceipt;
