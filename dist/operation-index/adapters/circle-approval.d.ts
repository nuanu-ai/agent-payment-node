import { type CircleApprovalRecord } from "../../lifi/circle-v2-approval-executor.js";
import { type OperationFamilyAdapter } from "../adapter.js";
/**
 * Circle Base USDC allowance effects. Execute refuses a `prepared` approval past its preparation expiry before signing;
 * a started one resolves through status: an unsent marker ends failed_before_effect, a sent one is observed, and one
 * without a receipt ends failed_proven_superseded once the payer's finalized nonce is past its nonce while the node
 * knows neither its transaction nor a receipt.
 */
export declare const circleApprovalAdapter: OperationFamilyAdapter<CircleApprovalRecord>;
