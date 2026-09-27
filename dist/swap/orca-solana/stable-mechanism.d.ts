/** Identity of the USDC→USDT route. Its distinct constructor and transaction schema cannot select SOL→USDC. */
export declare const ORCA_STABLE_MECHANISM_PIN: import("../pin.js").SwapMechanismPin;
export declare const ORCA_STABLE_MECHANISM_DIGEST: string;
/** Exact-digest selection works for both Orca mechanisms; family/chain selection is ambiguous and refuses. */
export declare const ORCA_PROTOCOL_REGISTRY: import("../protocol-registry.js").SwapProtocolRegistry;
