import { type EvmNativeCustody } from "../evm-native-custody.js";
/**
 * Frozen, read-only codec of the 0.5.41 "finalized Circle source" native admission rider stored on direct Arbitrum
 * native transfers (`evm.circleNativeAdmission`). 0.5.42 retired the rider: such a record still loads (status, receipt),
 * and approving it is refused before effect (`circle_native_admission_retired`); nothing re-verifies it any more.
 */
export interface CircleNativeAdmission {
    readonly schemaVersion: "apn.circle-finalized-native-admission.v1";
    readonly recipientCustody: EvmNativeCustody;
    readonly sources: readonly {
        readonly operationId: string;
        readonly sourceIdentityHash: string;
    }[];
}
export declare function validateCircleNativeAdmission(value: unknown): CircleNativeAdmission;
