/** Historical identity of the USDC→USDT route (Whirlpool deployed at slot 440170207). Existing operations only. */
export declare const ORCA_STABLE_MECHANISM_PIN_SLOT_440170207: import("../pin.js").SwapMechanismPin;
export declare const ORCA_STABLE_GUARDED_MECHANISM_PIN_SLOT_440170207: import("../pin.js").SwapMechanismPin;
/** The historical registry; its digest stays exact so existing stable operations and their material still validate. */
export declare const ORCA_PROTOCOL_REGISTRY_SLOT_440170207: import("../protocol-registry.js").SwapProtocolRegistry;
/** Historical generation pinned to the Whirlpool bytes deployed at slot 457152296 (APN 0.5.41 and 0.5.42). Existing operations only. */
export declare const ORCA_STABLE_MECHANISM_PIN_SLOT_457152296: import("../pin.js").SwapMechanismPin;
export declare const ORCA_STABLE_GUARDED_MECHANISM_PIN_SLOT_457152296: import("../pin.js").SwapMechanismPin;
/** The registry of that generation; its digest stays exact so its operations and material still validate. */
export declare const ORCA_PROTOCOL_REGISTRY_SLOT_457152296: import("../protocol-registry.js").SwapProtocolRegistry;
/**
 * Identity of the USDC→USDT route. Its distinct constructor and transaction schema cannot select SOL→USDC. It names no
 * deployment: the Whirlpool program is accepted for any deployment by its pinned upgrade authority (pins.ts).
 */
export declare const ORCA_STABLE_MECHANISM_PIN: import("../pin.js").SwapMechanismPin;
export declare const ORCA_STABLE_MECHANISM_DIGEST: string;
/** Separate owner opt-in for a chain priced and simulated guarded candidate. The preview pin never selects it. */
export declare const ORCA_STABLE_GUARDED_MECHANISM_PIN: import("../pin.js").SwapMechanismPin;
export declare const ORCA_STABLE_GUARDED_MECHANISM_DIGEST: string;
/** Exact-digest selection works for both Orca mechanisms; family/chain selection is ambiguous and refuses. */
export declare const ORCA_PROTOCOL_REGISTRY: import("../protocol-registry.js").SwapProtocolRegistry;
export declare function isOrcaStableGuardedMechanismDigest(digest: string): boolean;
/** The exact registry digest that a guarded generation was prepared under, or null for an unknown mechanism. */
export declare function orcaStableGuardedRegistryDigest(mechanismDigest: string): string | null;
