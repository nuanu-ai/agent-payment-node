/**
 * Frozen, finish-only (SWAP-10, APN 0.5.47): the former stable USDC to USDT lane. New USDC to USDT swaps run through
 * the keyless Orca route's usdc-usdt pool, whose route equals these pins'. These identities only recognise operations a
 * released version prepared, so status, release, no-send recovery and observation can finish them. Nothing here
 * quotes, prepares, approves, signs or sends.
 */
export declare const ORCA_STABLE_POOL: "4fuUiYxTQ6QCrdSq9ouBYcTM7bqSwYTSyLueGZLTy4T4";
export declare const ORCA_STABLE_VAULT_A: "4oY1eVHJrt7ywuFoQnAZwto4qcQip1QhYMAhD11PU4QL";
export declare const ORCA_STABLE_VAULT_B: "4dSG9tKHZR4CAictyEnH9XuGZyKapodWXq5xyg7uFwE9";
/** Historical identity of the USDC→USDT route (Whirlpool deployed at slot 440170207). Existing operations only. */
export declare const ORCA_STABLE_MECHANISM_PIN_SLOT_440170207: import("../../swap/pin.js").SwapMechanismPin;
export declare const ORCA_STABLE_GUARDED_MECHANISM_PIN_SLOT_440170207: import("../../swap/pin.js").SwapMechanismPin;
/** The historical registry; its digest stays exact so existing stable operations and their material still validate. */
export declare const ORCA_PROTOCOL_REGISTRY_SLOT_440170207: import("../../swap/protocol-registry.js").SwapProtocolRegistry;
/** Historical generation pinned to the Whirlpool bytes deployed at slot 457152296 (APN 0.5.41 and 0.5.42). Existing operations only. */
export declare const ORCA_STABLE_MECHANISM_PIN_SLOT_457152296: import("../../swap/pin.js").SwapMechanismPin;
export declare const ORCA_STABLE_GUARDED_MECHANISM_PIN_SLOT_457152296: import("../../swap/pin.js").SwapMechanismPin;
/** The registry of that generation; its digest stays exact so its operations and material still validate. */
export declare const ORCA_PROTOCOL_REGISTRY_SLOT_457152296: import("../../swap/protocol-registry.js").SwapProtocolRegistry;
/**
 * Identity of the USDC→USDT route. Its distinct constructor and transaction schema cannot select SOL→USDC. It names no
 * deployment: the Whirlpool program is accepted for any deployment by its pinned upgrade authority (pins.ts).
 */
export declare const ORCA_STABLE_MECHANISM_PIN: import("../../swap/pin.js").SwapMechanismPin;
export declare const ORCA_STABLE_MECHANISM_DIGEST: string;
/** Separate owner opt-in for a chain priced and simulated guarded candidate. The preview pin never selects it. */
export declare const ORCA_STABLE_GUARDED_MECHANISM_PIN: import("../../swap/pin.js").SwapMechanismPin;
export declare const ORCA_STABLE_GUARDED_MECHANISM_DIGEST: string;
/** Exact-digest selection works for both Orca mechanisms; family/chain selection is ambiguous and refuses. */
export declare const ORCA_PROTOCOL_REGISTRY: import("../../swap/protocol-registry.js").SwapProtocolRegistry;
export declare function isOrcaStableGuardedMechanismDigest(digest: string): boolean;
/** The exact registry digest that a guarded generation was prepared under, or null for an unknown mechanism. */
export declare function orcaStableGuardedRegistryDigest(mechanismDigest: string): string | null;
