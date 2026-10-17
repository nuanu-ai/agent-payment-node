import { type CircleApprovalRecord } from "../../lifi/circle-v2-approval-executor.js";
import { type OperationFamilyAdapter } from "../adapter.js";
/**
 * Circle Base USDC allowance effects. Execute refuses a `prepared` approval past its preparation expiry before signing;
 * a started one resolves through status (an unsent marker ends failed_before_effect, a sent one is observed).
 */
export declare const circleApprovalAdapter: OperationFamilyAdapter<CircleApprovalRecord>;
