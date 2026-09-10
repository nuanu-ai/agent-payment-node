import { ApnError, type ErrorCode } from "../errors.js";

/** Closed public reasons: never copy provider, RPC, custody or thrown error text. */
export const SA_REASON_CODES = Object.freeze({
  sa_gasless_input: "APN_INVALID_INPUT",
  sa_gasless_capability: "APN_PROVIDER_CAPABILITY_UNAVAILABLE",
  sa_gasless_identity: "APN_PROFILE_DRIFT",
  sa_gasless_permission: "APN_PERMISSION_INACTIVE",
  sa_gasless_allowance: "APN_PERMISSION_ALLOWANCE_INSUFFICIENT",
  sa_gasless_balance: "APN_INSUFFICIENT_USDC",
  sa_gasless_economics: "APN_FEE_BUDGET_EXCEEDED",
  sa_gasless_approval: "APN_FOREGROUND_APPROVAL_REQUIRED",
  sa_gasless_approval_rejected: "APN_OPERATION_BLOCKED",
  sa_gasless_expired: "APN_OPERATION_BLOCKED",
  sa_gasless_clock: "APN_OPERATION_BLOCKED",
  sa_gasless_state_corrupt: "APN_STATE_CORRUPT",
  sa_gasless_material_unavailable: "APN_OPERATION_BLOCKED",
  sa_gasless_archive_incompatible: "APN_OPERATION_BLOCKED",
  sa_gasless_capacity: "APN_OPERATION_BLOCKED",
  sa_gasless_rpc_binding: "APN_RPC_CONFIG",
  sa_gasless_rpc_unavailable: "APN_RPC_AMBIGUOUS",
  sa_gasless_evidence: "APN_RPC_PROTOCOL",
  sa_gasless_provider_unavailable: "APN_PROVIDER_UNAVAILABLE",
  sa_gasless_provider_protocol: "APN_PROVIDER_PROTOCOL",
  sa_gasless_verify_rejected: "APN_OPERATION_BLOCKED",
  sa_gasless_unknown: "APN_OPERATION_BLOCKED",
  sa_gasless_partial: "APN_OPERATION_BLOCKED",
  sa_gasless_internal: "APN_INTERNAL",
} as const satisfies Record<string, ErrorCode>);
export type SmartAccountGaslessReason = keyof typeof SA_REASON_CODES;
export interface SmartAccountGaslessFailure { readonly code: ErrorCode; readonly reason: SmartAccountGaslessReason }
export function saError(reason: SmartAccountGaslessReason): ApnError {
  return new ApnError(SA_REASON_CODES[reason], "Smart Account gasless operation could not advance safely.", { reason });
}
export function saFail(reason: SmartAccountGaslessReason): never { throw saError(reason); }
export function saFailure(reason: SmartAccountGaslessReason): SmartAccountGaslessFailure {
  return { code: SA_REASON_CODES[reason], reason };
}
export function saClassify(error: unknown, fallback: SmartAccountGaslessReason): SmartAccountGaslessFailure {
  if (!(error instanceof ApnError)) return saFailure(fallback);
  const reason = error.details?.reason;
  if (typeof reason === "string" && Object.hasOwn(SA_REASON_CODES, reason) &&
    SA_REASON_CODES[reason as SmartAccountGaslessReason] === error.code) return saFailure(reason as SmartAccountGaslessReason);
  const retained: Partial<Record<ErrorCode, SmartAccountGaslessReason>> = {
    APN_STATE_CORRUPT: "sa_gasless_state_corrupt", APN_PROFILE_DRIFT: "sa_gasless_identity",
    APN_RPC_CONFIG: "sa_gasless_rpc_binding", APN_RPC_PROTOCOL: "sa_gasless_evidence",
    APN_RPC_AMBIGUOUS: "sa_gasless_rpc_unavailable", APN_PERMISSION_INACTIVE: "sa_gasless_permission",
    APN_PERMISSION_ALLOWANCE_INSUFFICIENT: "sa_gasless_allowance", APN_INSUFFICIENT_USDC: "sa_gasless_balance",
    APN_PROVIDER_UNAVAILABLE: "sa_gasless_provider_unavailable", APN_PROVIDER_PROTOCOL: "sa_gasless_provider_protocol",
  };
  return saFailure(retained[error.code] ?? fallback);
}
