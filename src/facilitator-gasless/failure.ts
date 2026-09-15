import { ApnError, type ErrorCode } from "../errors.js";

/** Closed reason tokens for the Avalanche facilitator route; public errors never carry provider text. */
export const FACILITATOR_REASONS = {
  facilitator_gasless_input: "APN_INVALID_INPUT",
  facilitator_gasless_capability: "APN_PROVIDER_CAPABILITY_UNAVAILABLE",
  facilitator_gasless_provider_unavailable: "APN_PROVIDER_UNAVAILABLE",
  facilitator_gasless_provider_protocol: "APN_PROVIDER_PROTOCOL",
  facilitator_gasless_verify_rejected: "APN_OPERATION_BLOCKED",
  facilitator_gasless_settle_unknown: "APN_OPERATION_BLOCKED",
  facilitator_gasless_rpc_binding: "APN_RPC_CONFIG",
  facilitator_gasless_rpc_unavailable: "APN_RPC_AMBIGUOUS",
  facilitator_gasless_evidence: "APN_RPC_PROTOCOL",
  facilitator_gasless_balance: "APN_INSUFFICIENT_USDC",
  facilitator_gasless_expired: "APN_OPERATION_BLOCKED",
  facilitator_gasless_guard: "APN_OPERATION_BLOCKED",
  facilitator_gasless_signing: "APN_PROVIDER_EFFECT_UNAVAILABLE",
  facilitator_gasless_capacity: "APN_OPERATION_BLOCKED",
  facilitator_gasless_state_corrupt: "APN_STATE_CORRUPT",
} as const satisfies Readonly<Record<string, ErrorCode>>;

export type FacilitatorReason = keyof typeof FACILITATOR_REASONS;

export function facilitatorFail(reason: FacilitatorReason): never {
  throw new ApnError(FACILITATOR_REASONS[reason], "Avalanche facilitator transfer could not continue safely.", { reason });
}

export function facilitatorReason(error: unknown, fallback: FacilitatorReason): FacilitatorReason {
  const reason = error instanceof ApnError ? error.details?.reason : undefined;
  return typeof reason === "string" && Object.hasOwn(FACILITATOR_REASONS, reason) ? reason as FacilitatorReason : fallback;
}
