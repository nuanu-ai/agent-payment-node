import { ApnError, type ErrorCode } from "../errors.js";
import type {
  BridgeObservationRpcFailure, BridgeObservationRpcMethod, BridgeObservationRpcReason,
  BridgeObservationRpcStage,
} from "./operation-model.js";

const METHODS = new Set<BridgeObservationRpcMethod>([
  "eth_chainId", "eth_getBlockByNumber", "eth_getTransactionByHash", "eth_getTransactionReceipt",
  "eth_getLogs", "eth_getBalance", "eth_getCode", "eth_getStorageAt", "eth_call", "eth_estimateGas",
  "eth_maxPriorityFeePerGas", "debug_traceTransaction",
]);
const REASONS = new Set<BridgeObservationRpcReason>([
  "bridge_RPC_HTTP_status", "bridge_RPC_response", "receipt_transaction_membership",
  "canonical_transaction_membership", "receipt_status", "receipt_sender_target", "receipt_log_membership",
  "receipt_execution_fee_bounds", "bridge_block_reorg", "bridge_block_number",
  "destination_log_range", "destination_log_count", "destination_log_identity",
  "destination_log_hash", "destination_scan_cursor_reorg", "destination_scan_membership",
  "destination_scan_reorg", "destination_candidate_unresolved", "duplicate_destination_delivery",
  "destination_not_safe_success", "destination_transaction_reverted", "destination_trace_rebind", "request_deadline", "DNS_deadline",
  "bridge_deployment_code_changed", "bridge_deployment_configuration_changed",
  "historical_deployment_contract_hash", "historical_deployment_code_hash",
  "historical_deployment_configuration_hash", "historical_deployment_block",
  "bridge_multicall_response", "Base_fee_code_identity", "Base_fee_configuration_identity",
  "bridge_archive_block_mismatch", "bridge_prepared_block_reorg",
  "transaction_chain_or_hash", "transaction_signature", "transaction_parity", "transaction_signature_reconstruction",
  "approval_event_identity", "source_proof", "receipt_fee_shape", "unsupported_Base_blob_transaction",
  "operator_fee_formula", "operator_receipt_parameters",
  "request_interrupted", "response_aborted", "response_interrupted",
]);

export function observationRpcFailure(chainRole: "source" | "destination", effectRole: "approval" | "bridge",
  error: unknown, fallbackCode: ErrorCode | null = null): BridgeObservationRpcFailure {
  const apn = error instanceof ApnError ? error : null;
  const reason = apn === null ? undefined : safeReason(apn);
  const rpcMethod = apn === null ? undefined : safeMethod(apn.details?.rpcMethod);
  const httpStatus = apn === null ? undefined : boundedInteger(apn.details?.httpStatus, 100, 599);
  const attempts = apn === null ? undefined : boundedInteger(apn.details?.attempts, 1, 10);
  const endpointRole = apn === null ? undefined : safeEndpointRole(apn.details?.endpointRole);
  return {
    schemaVersion: "apn.bridge-observation-rpc-failure.v1", stage: stage(chainRole, reason, rpcMethod),
    effectRole, code: apn?.code ?? fallbackCode,
    ...(reason === undefined ? {} : { reason }), ...(rpcMethod === undefined ? {} : { rpcMethod }),
    ...(httpStatus === undefined ? {} : { httpStatus }), ...(attempts === undefined ? {} : { attempts }),
    ...(endpointRole === undefined ? {} : { endpointRole }),
  };
}

function safeReason(error: ApnError): BridgeObservationRpcReason | undefined {
  const detail = error.details?.reason;
  if (typeof detail === "string" && REASONS.has(detail as BridgeObservationRpcReason)) return detail as BridgeObservationRpcReason;
  const transport = error.details?.transportReason;
  if (typeof transport === "string" && REASONS.has(transport as BridgeObservationRpcReason)) return transport as BridgeObservationRpcReason;
  const match = /^Bridge validation failed: ([A-Za-z0-9_]+)\.$/u.exec(error.message);
  return match !== null && REASONS.has(match[1] as BridgeObservationRpcReason) ? match[1] as BridgeObservationRpcReason : undefined;
}
function safeMethod(value: unknown): BridgeObservationRpcMethod | undefined {
  return typeof value === "string" && METHODS.has(value as BridgeObservationRpcMethod) ? value as BridgeObservationRpcMethod : undefined;
}
function safeEndpointRole(value: unknown): "primary" | "receipt" | "archive" | undefined {
  return value === "primary" || value === "receipt" || value === "archive" ? value : undefined;
}
function boundedInteger(value: unknown, minimum: number, maximum: number): number | undefined {
  const number = typeof value === "number" ? value : typeof value === "string" && /^(?:0|[1-9][0-9]*)$/u.test(value) ? Number(value) : NaN;
  return Number.isSafeInteger(number) && number >= minimum && number <= maximum ? number : undefined;
}
function stage(chainRole: "source" | "destination", reason: BridgeObservationRpcReason | undefined,
  method: BridgeObservationRpcMethod | undefined): BridgeObservationRpcStage {
  const boundary = reason === "canonical_transaction_membership" ? "included_block"
    : reason === "source_proof" ? "protocol_evidence"
    : reason?.startsWith("historical_deployment_") || reason?.startsWith("bridge_deployment_") ||
      reason === "bridge_prepared_block_reorg" ? "deployment"
    : reason === "bridge_multicall_response" || reason?.startsWith("Base_fee_") ||
      reason === "receipt_fee_shape" || reason === "unsupported_Base_blob_transaction" ||
      reason === "operator_fee_formula" || reason === "operator_receipt_parameters" ||
      reason === "bridge_archive_block_mismatch" ? "fee_evidence"
    : reason?.startsWith("transaction_") ? "transaction"
    : reason === "bridge_block_reorg" ? "recheck"
    : method === "eth_chainId" ? "assert_chain"
    : method === "eth_getTransactionByHash" ? "transaction"
    : method === "eth_getTransactionReceipt" || reason?.startsWith("receipt_") || reason === "approval_event_identity" ? "receipt"
    : method === "eth_getLogs" || reason?.startsWith("destination_log_") ? "logs"
    : method === "eth_getBlockByNumber" ? "safe_head"
    : "observation";
  return `${chainRole}_${boundary}` as BridgeObservationRpcStage;
}
