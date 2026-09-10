import { ApnError, type ErrorCode } from "../errors.js";
/** Closed public reasons: never copy provider, RPC, custody or thrown error text. */
export declare const SA_REASON_CODES: Readonly<{
    readonly sa_gasless_input: "APN_INVALID_INPUT";
    readonly sa_gasless_capability: "APN_PROVIDER_CAPABILITY_UNAVAILABLE";
    readonly sa_gasless_identity: "APN_PROFILE_DRIFT";
    readonly sa_gasless_permission: "APN_PERMISSION_INACTIVE";
    readonly sa_gasless_allowance: "APN_PERMISSION_ALLOWANCE_INSUFFICIENT";
    readonly sa_gasless_balance: "APN_INSUFFICIENT_USDC";
    readonly sa_gasless_economics: "APN_FEE_BUDGET_EXCEEDED";
    readonly sa_gasless_approval: "APN_FOREGROUND_APPROVAL_REQUIRED";
    readonly sa_gasless_approval_rejected: "APN_OPERATION_BLOCKED";
    readonly sa_gasless_expired: "APN_OPERATION_BLOCKED";
    readonly sa_gasless_clock: "APN_OPERATION_BLOCKED";
    readonly sa_gasless_state_corrupt: "APN_STATE_CORRUPT";
    readonly sa_gasless_material_unavailable: "APN_OPERATION_BLOCKED";
    readonly sa_gasless_archive_incompatible: "APN_OPERATION_BLOCKED";
    readonly sa_gasless_capacity: "APN_OPERATION_BLOCKED";
    readonly sa_gasless_rpc_binding: "APN_RPC_CONFIG";
    readonly sa_gasless_rpc_unavailable: "APN_RPC_AMBIGUOUS";
    readonly sa_gasless_evidence: "APN_RPC_PROTOCOL";
    readonly sa_gasless_provider_unavailable: "APN_PROVIDER_UNAVAILABLE";
    readonly sa_gasless_provider_protocol: "APN_PROVIDER_PROTOCOL";
    readonly sa_gasless_verify_rejected: "APN_OPERATION_BLOCKED";
    readonly sa_gasless_unknown: "APN_OPERATION_BLOCKED";
    readonly sa_gasless_partial: "APN_OPERATION_BLOCKED";
    readonly sa_gasless_internal: "APN_INTERNAL";
}>;
export type SmartAccountGaslessReason = keyof typeof SA_REASON_CODES;
export interface SmartAccountGaslessFailure {
    readonly code: ErrorCode;
    readonly reason: SmartAccountGaslessReason;
}
export declare function saError(reason: SmartAccountGaslessReason): ApnError;
export declare function saFail(reason: SmartAccountGaslessReason): never;
export declare function saFailure(reason: SmartAccountGaslessReason): SmartAccountGaslessFailure;
export declare function saClassify(error: unknown, fallback: SmartAccountGaslessReason): SmartAccountGaslessFailure;
