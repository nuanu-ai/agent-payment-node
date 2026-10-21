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
/** Owner admission pin for this exact native lane, in the same provider/reference form as the token lane. */
export declare const STARGATE_NATIVE_MECHANISM: Readonly<{
    provider: "stargate-v2";
    reference: `eip155:1:0x${string}/eip155:130:0x${string}`;
}>;
/** v2 (0.5.25..) and v3 (admission-bound) are the only native schemas any release wrote. */
export declare const STARGATE_NATIVE_SCHEMAS: readonly ["apn.stargate-v2-native-operation.v2", "apn.stargate-v2-native-operation.v3"];
export declare function fail(code: "APN_INVALID_INPUT" | "APN_OPERATION_BLOCKED" | "APN_RPC_PROTOCOL" | "APN_RPC_AMBIGUOUS" | "APN_CHAIN_MISMATCH" | "APN_REPREPARE_REQUIRED" | "APN_STATE_CORRUPT", reason: string): never;
export declare function uint(value: unknown, positive?: boolean): bigint;
export declare function address(value: unknown): Address;
export declare function hex32(value: unknown): Hex;
export declare function rpcQuantity(value: unknown): bigint;
export declare function transition(operation: StargateNativeOperation, phase: StargateNativePhase, reason: string, at: number): StargateNativeOperation;
export declare function seal<T extends Omit<StargateNativeOperation, "integrityHash"> & {
    integrityHash?: never;
} | StargateNativeOperation>(value: T): StargateNativeOperation;
/** Every phase of a native Stargate journal; `observed` and `failed_confirmed_revert` are its outcomes (nothing signs or lands after them). */
export declare const STARGATE_NATIVE_PHASES: readonly StargateNativePhase[];
export declare const STARGATE_NATIVE_TERMINAL_PHASES: readonly StargateNativePhase[];
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
    /** From the send's own canonical receipt; null when the record does not hold it (never the gas envelope). */
    readonly actualSourceFee: StargateNativeActualSourceFee | null;
    readonly evidenceHash: string;
}
export interface StargateNativeActualSourceFee {
    readonly gasUsedAtomic: string;
    readonly effectiveGasPriceAtomic: string;
    /** gasUsed × effectiveGasPrice of the send itself. */
    readonly networkFeeAtomic: string;
    /** The send's value (principal + quoted LayerZero fee) plus that network fee; a LayerZero refund in the same
     * transaction, if any, is not subtracted. */
    readonly sourceDebitAtomic: string;
}
/** Null unless both numbers are present and inside the signed envelope (gas limit, max fee per gas). */
export declare function nativeActualSourceFee(operation: StargateNativeOperation): StargateNativeActualSourceFee | null;
export declare function stargateV2NativeCanonicalReceipt(operationInput: StargateNativeOperation): StargateNativeCanonicalReceipt;
