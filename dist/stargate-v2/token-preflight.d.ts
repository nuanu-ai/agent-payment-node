import type { StargateTokenExecutionPorts, StargateTokenOperation, StargateTokenPostApprovalQuote } from "./token-model.js";
/** The pre-signing reads of a token Stargate send: the fresh post-approval quote, the frozen fee admission and the preflight. */
export declare function createPostApprovalQuote(op: StargateTokenOperation, ports: StargateTokenExecutionPorts): Promise<StargateTokenPostApprovalQuote>;
/** The one fee rule for a send whose quote was bound in this invocation: the frozen envelope must be includable now. */
export declare function sendFeeAdmitted(op: StargateTokenOperation, ports: StargateTokenExecutionPorts): Promise<void>;
export declare function freshPreflight(op: StargateTokenOperation, ports: StargateTokenExecutionPorts, stage: "before_approval" | "before_send"): Promise<void>;
