import { exactKeys, isPlainRecord } from "../canonical.js";
import { ApnError } from "../errors.js";
import { validateEvmNativeCustody, type EvmNativeCustody } from "../evm-native-custody.js";

/**
 * Frozen, read-only codec of the 0.5.41 "finalized Circle source" native admission rider stored on direct Arbitrum
 * native transfers (`evm.circleNativeAdmission`). 0.5.42 retired the rider: such a record still loads (status, receipt),
 * and approving it is refused before effect (`circle_native_admission_retired`); nothing re-verifies it any more.
 */
export interface CircleNativeAdmission {
  readonly schemaVersion: "apn.circle-finalized-native-admission.v1";
  readonly recipientCustody: EvmNativeCustody;
  readonly sources: readonly { readonly operationId: string; readonly sourceIdentityHash: string }[];
}
export function validateCircleNativeAdmission(value: unknown): CircleNativeAdmission {
  if (!isPlainRecord(value) || !exactKeys(value, ["schemaVersion", "recipientCustody", "sources"]) ||
      value.schemaVersion !== "apn.circle-finalized-native-admission.v1" || !Array.isArray(value.sources) || value.sources.length !== 1) blocked();
  validateEvmNativeCustody(value.recipientCustody);
  for (const source of value.sources) if (!isPlainRecord(source) || !exactKeys(source, ["operationId", "sourceIdentityHash"]) ||
      ![source.operationId, source.sourceIdentityHash].every(x => typeof x === "string" && /^[a-f0-9]{64}$/u.test(x))) blocked();
  return value as unknown as CircleNativeAdmission;
}
function blocked(): never { throw new ApnError("APN_OPERATION_BLOCKED", "Finalized Circle source admission is unavailable or changed; retain the existing source holds."); }
