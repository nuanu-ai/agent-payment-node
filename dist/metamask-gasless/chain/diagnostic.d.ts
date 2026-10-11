import { type MetaMaskGaslessFailureReason } from "../reasons.js";
export declare const MM_EVIDENCE_PREDICATES: readonly ["rpc_method", "rpc_json", "rpc_envelope", "rpc_record", "rpc_quantity", "rpc_hex", "header_identity", "header_recheck", "protocol_code_pin", "token_proxy_code_pin", "token_decimals", "token_implementation_address", "token_implementation_code_pin", "owner_designation", "snapshot_block_order", "snapshot_state_binding", "counter", "balance", "snapshot_owner_code", "snapshot_shape"];
export type MmEvidencePredicate = typeof MM_EVIDENCE_PREDICATES[number];
export type MmEvidenceMethod = "eth_chainId" | "eth_getBlockByNumber" | "eth_getCode" | "eth_getStorageAt" | "eth_call" | "eth_getTransactionByHash" | "eth_getTransactionReceipt" | "eth_getLogs";
/** Closed metadata only. No response bodies, URLs, credentials or unsigned material. */
export declare function mmEvidenceFail(reason: MetaMaskGaslessFailureReason, predicate: MmEvidencePredicate, method?: MmEvidenceMethod): never;
export declare function mmEvidenceAt<T>(stage: "safe" | "latest", action: () => Promise<T>): Promise<T>;
export declare function mmEvidenceStateAt<T>(stage: "safe" | "latest", action: () => T): T;
