/** Closed reason tokens for the Avalanche facilitator route; public errors never carry provider text. */
export declare const FACILITATOR_REASONS: {
    readonly facilitator_gasless_input: "APN_INVALID_INPUT";
    readonly facilitator_gasless_capability: "APN_PROVIDER_CAPABILITY_UNAVAILABLE";
    readonly facilitator_gasless_provider_unavailable: "APN_PROVIDER_UNAVAILABLE";
    readonly facilitator_gasless_provider_protocol: "APN_PROVIDER_PROTOCOL";
    readonly facilitator_gasless_verify_rejected: "APN_OPERATION_BLOCKED";
    readonly facilitator_gasless_settle_unknown: "APN_OPERATION_BLOCKED";
    readonly facilitator_gasless_rpc_binding: "APN_RPC_CONFIG";
    readonly facilitator_gasless_rpc_unavailable: "APN_RPC_AMBIGUOUS";
    readonly facilitator_gasless_evidence: "APN_RPC_PROTOCOL";
    readonly facilitator_gasless_balance: "APN_INSUFFICIENT_USDC";
    readonly facilitator_gasless_expired: "APN_OPERATION_BLOCKED";
    readonly facilitator_gasless_guard: "APN_OPERATION_BLOCKED";
    readonly facilitator_gasless_signing: "APN_PROVIDER_EFFECT_UNAVAILABLE";
    readonly facilitator_gasless_capacity: "APN_OPERATION_BLOCKED";
    readonly facilitator_gasless_state_corrupt: "APN_STATE_CORRUPT";
};
export type FacilitatorReason = keyof typeof FACILITATOR_REASONS;
export declare function facilitatorFail(reason: FacilitatorReason): never;
export declare function facilitatorReason(error: unknown, fallback: FacilitatorReason): FacilitatorReason;
