import { type EvmNativeCustody } from "./evm-native-custody.js";
import type { OperationRecord } from "./model.js";
import type { RpcPort } from "./ports.js";
import type { StateStore } from "./state.js";
import type { CircleOperationV1 } from "./circle-v2-evm/operation-model.js";
export interface CircleNativeAdmission {
    readonly schemaVersion: "apn.circle-finalized-native-admission.v1";
    readonly recipientCustody: EvmNativeCustody;
    readonly sources: readonly {
        readonly operationId: string;
        readonly sourceIdentityHash: string;
    }[];
}
export interface VerifiedCircleNativeAdmission {
    readonly kind: "verified-circle-native-source";
}
export declare function verifiedCircleNativeSources(token: VerifiedCircleNativeAdmission, profileHash: string, account: string): ReadonlyMap<string, string>;
export declare function validateCircleNativeAdmission(value: unknown): CircleNativeAdmission;
export declare function circleNativeSourceIdentity(op: CircleOperationV1): string;
export declare function verifyCircleNativeAdmission(state: StateStore, port: RpcPort, profile: string, account: string, recipient: string, expected?: CircleNativeAdmission): Promise<{
    readonly binding: CircleNativeAdmission;
    readonly token: VerifiedCircleNativeAdmission;
} | null>;
/** Native calls this after foreground approval, before the actual signature; one additional pending nonce read. */
export declare function recheckCircleNativeAdmission(state: StateStore, operation: OperationRecord, port?: RpcPort): Promise<VerifiedCircleNativeAdmission | null>;
