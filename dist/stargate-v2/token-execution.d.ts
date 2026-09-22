import type { StargateTokenExecutionPorts, StargateTokenJournal, StargateTokenOperation, StargateTokenPreparationRequest } from "./token-model.js";
export { LAYERZERO_ENDPOINT_V2, STARGATE_TOKEN_APPROVAL_FINALITY_WINDOW_MS, STARGATE_TOKEN_DESTINATION_CHAIN, STARGATE_TOKEN_DESTINATION_EID, STARGATE_TOKEN_DESTINATION_EXECUTOR, STARGATE_TOKEN_DESTINATION_MESSAGING, STARGATE_TOKEN_DESTINATION_MESSAGING_CODE_HASH, STARGATE_TOKEN_DESTINATION_POOL, STARGATE_TOKEN_DESTINATION_TOKEN, STARGATE_TOKEN_MAX_BRIDGE_GAS, STARGATE_TOKEN_MECHANISM, STARGATE_TOKEN_POST_APPROVAL_QUOTE_TTL_MS, STARGATE_TOKEN_SOURCE_CHAIN, STARGATE_TOKEN_SOURCE_EID, STARGATE_TOKEN_SOURCE_EXECUTOR, STARGATE_TOKEN_SOURCE_MESSAGING, STARGATE_TOKEN_SOURCE_MESSAGING_CODE_HASH, STARGATE_TOKEN_SOURCE_POOL, STARGATE_TOKEN_SOURCE_TOKEN, encodeStargateNativeDrop, } from "./token-codec.js";
export { FileStargateTokenJournal, stargateV2TokenCanonicalReceipt } from "./token-journal.js";
export type * from "./token-model.js";
export declare function prepareStargateV2Token(request: StargateTokenPreparationRequest, ports: StargateTokenExecutionPorts, journal: StargateTokenJournal): Promise<StargateTokenOperation>;
export declare function executeStargateV2Token(id: string, ports: StargateTokenExecutionPorts, journal: StargateTokenJournal): Promise<StargateTokenOperation>;
/** Network observation only: it may advance an attempted effect and can never sign or broadcast. */
export declare function observeStargateV2Token(id: string, ports: StargateTokenExecutionPorts, journal: StargateTokenJournal): Promise<StargateTokenOperation>;
/** Explicit foreground cleanup. Observation remains separate and never invokes this signer path. */
export declare function cleanupStargateV2Token(id: string, ports: StargateTokenExecutionPorts, journal: StargateTokenJournal): Promise<StargateTokenOperation>;
/** Local ledger reconciliation for status/recovery callers; this never signs, broadcasts, or performs RPC. */
export declare function reconcileStargateV2TokenUsage(id: string, ports: Pick<StargateTokenExecutionPorts, "reserveUsage" | "followUsage">, journal: StargateTokenJournal): Promise<StargateTokenOperation>;
