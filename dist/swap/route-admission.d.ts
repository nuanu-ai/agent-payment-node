import type { AssetPolicyRow } from "../asset-policy-registry.js";
import { type SwapMechanismPin, type SwapProtocolFamily } from "./pin.js";
import { type SwapProtocolRecord, type SwapProtocolRegistry } from "./protocol-registry.js";
export declare const SWAP_ROUTE_SCHEMA: "apn.swap-route.v1";
/**
 * What the owner admits for a swap: the protocol, its router or program and the contracts or pools it touches. It has
 * no APN-internal version, constructor or schema field, so an APN release or a program-byte re-pin never changes it.
 */
export interface SwapRouteAdmission {
    readonly schemaVersion: typeof SWAP_ROUTE_SCHEMA;
    readonly protocolFamily: SwapProtocolFamily;
    readonly chain: string;
    readonly routerProgramIdentity: string;
    readonly auxiliaryContractProgramIdentities: readonly string[];
}
/** A legacy full mechanism pin is still accepted; it admits by its route identity, never by its version fields. */
export type SwapAdmissionMechanism = SwapMechanismPin | SwapRouteAdmission;
export declare const MAX_SWAP_ADMISSION_OPTIONS = 16;
export declare function validateSwapAdmissionMechanism(value: unknown): SwapAdmissionMechanism;
/** The route identity of a lane pin: what an owner copies from an inventory into a policy file. */
export declare function swapRouteOf(pin: SwapMechanismPin): SwapRouteAdmission;
/** Order-insensitive digest of the route identity; equal for every generation of the same protocol, router and pools. */
export declare function swapRouteDigest(value: unknown): string;
/** Every swap mechanism one asset row admits: the single legacy pin or the owner's list of alternatives. */
export declare function swapAdmissionMechanisms(asset: Pick<AssetPolicyRow, "rails" | "mechanismPins" | "mechanismOptions">): readonly SwapAdmissionMechanism[];
export declare function assetAdmitsSwapMechanism(asset: Pick<AssetPolicyRow, "rails" | "mechanismPins" | "mechanismOptions">, lanePin: SwapMechanismPin): boolean;
/**
 * Selects the one lane record of an installed protocol registry whose route both assets admit. A version bump of the
 * lane keeps its route, so it stays admitted; a different route (another router or pool) never does.
 */
export declare function admittedSwapProtocol(registryValue: SwapProtocolRegistry, chain: string, source: Pick<AssetPolicyRow, "rails" | "mechanismPins" | "mechanismOptions">, destination: Pick<AssetPolicyRow, "rails" | "mechanismPins" | "mechanismOptions">, laneMechanismDigest?: string): SwapProtocolRecord;
