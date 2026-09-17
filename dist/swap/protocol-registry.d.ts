import { type SwapMechanismPin } from "./pin.js";
export declare const SWAP_PROTOCOL_REGISTRY_SCHEMA: "apn.swap-protocol-registry.v1";
export interface SwapProtocolRecord {
    readonly pin: SwapMechanismPin;
    readonly mechanismDigest: string;
}
export interface SwapProtocolRegistry {
    readonly schemaVersion: typeof SWAP_PROTOCOL_REGISTRY_SCHEMA;
    readonly registryVersion: string;
    readonly records: readonly SwapProtocolRecord[];
    readonly registryDigest: string;
}
/** The shipped registry is intentionally empty until owners supply official immutable pins. */
export declare const EMPTY_SWAP_PROTOCOL_REGISTRY: SwapProtocolRegistry;
export declare function compileSwapProtocolRegistry(input: {
    readonly registryVersion: string;
    readonly pins: readonly unknown[];
}): SwapProtocolRegistry;
export declare function validateSwapProtocolRegistry(value: unknown): SwapProtocolRegistry;
export declare function requireSwapProtocol(registryValue: unknown, mechanismDigest: string): SwapProtocolRecord;
