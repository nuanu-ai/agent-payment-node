import type { OperationRecord, ReceiptRecord } from "./model.js";
import type { RpcReceipt } from "./ports.js";
/**
 * The saved reason of a Coinbase gasless policy check or usage reservation that failed before the provider ran. Only the
 * owner policy's own refusal (`APN_ALLOWLIST_REFUSED`) is `coinbase_gasless_policy_denied`. The other answers those
 * checks can give (the state store, its locks, input validation, the usage ledger) name their code; anything else is
 * `coinbase_gasless_policy_check_failed`. Every reason is in the closed list above, so orphan-receipt recovery and
 * `receipt get` accept it. Records written before keep `coinbase_gasless_policy_denied` for every cause.
 */
export declare function coinbaseGaslessPolicyFailureReason(error: unknown): string;
export declare function providerDirectReceipt(operation: OperationRecord, rpcReceipt?: RpcReceipt): ReceiptRecord;
export declare function recoverProviderTerminalOperation(operation: OperationRecord, receipt: ReceiptRecord | null): OperationRecord | null;
export declare function assertProviderTerminalReceiptAuthority(operation: OperationRecord, receipt: ReceiptRecord | null): void;
