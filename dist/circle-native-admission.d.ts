import { type EvmNativeCustody } from "./evm-native-custody.js";
import type { OperationRecord } from "./model.js";
import type { RpcPort } from "./ports.js";
import type { StateStore } from "./state.js";
import type { CircleKnownOperation } from "./circle-v2-evm/funding-operation.js";
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
/** A Circle route of this account whose source burn is FINALIZED with zero residual allowance: it never signs on its
 * source chain again (cleanup and nonce retirement need an unburned source), only the mint on its destination. */
export declare function circleSourceSettled(op: CircleKnownOperation, profileHash: string, account: string): boolean;
export declare function circleNativeSourceIdentity(op: CircleKnownOperation): string;
export declare function verifyCircleNativeAdmission(state: StateStore, port: RpcPort, profile: string, account: string, recipient: string, expected?: CircleNativeAdmission): Promise<{
    readonly binding: CircleNativeAdmission;
    readonly token: VerifiedCircleNativeAdmission;
} | null>;
/** Native calls this after foreground approval, before the actual signature; one additional pending nonce read. */
export declare function recheckCircleNativeAdmission(state: StateStore, operation: OperationRecord, port?: RpcPort): Promise<VerifiedCircleNativeAdmission | null>;
