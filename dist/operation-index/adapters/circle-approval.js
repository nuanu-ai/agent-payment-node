import { CIRCLE_APPROVAL_RESOLVED_PHASES, loadCircleApproval } from "../../lifi/circle-v2-approval-executor.js";
import { field, readableClaims, requiredRecordPath, salvageEvm, salvageRecord } from "../adapter.js";
import { evmClaim, pastUnstartedDeadline } from "./family-claims.js";
import { OPERATION_STATUS } from "./family-commands.js";
const STORE = { directory: "circle-approvals", perProfile: false };
/**
 * Circle Base USDC allowance effects. Execute refuses a `prepared` approval past its preparation expiry before signing;
 * a started one resolves through status (an unsent marker ends failed_before_effect, a sent one is observed).
 */
export const circleApprovalAdapter = {
    family: "circle_approval",
    stores: [STORE],
    async load(root, recordPath) { return await loadCircleApproval(root, requiredRecordPath(recordPath, STORE).operationId); },
    // The ID is the digest of the profile and the exact prepared intent; there is no idempotency key.
    identity: record => ({ profileHash: record.profileHash, operationId: record.id, idempotencyHash: null, requestHash: null }),
    claims: record => readableClaims(() => [evmClaim(8453, record.preparation.transaction.from)]),
    terminal: record => CIRCLE_APPROVAL_RESOLVED_PHASES.includes(record.phase) || record.phase === "prepared" && pastUnstartedDeadline(record.preparation.expiresAt),
    state: record => record.phase,
    salvage: raw => salvageRecord(raw, value => [salvageEvm(8453, field(value, "preparation", "transaction", "from"))]),
    view: async (record) => record,
    // Status observes a sent approval and closes an unsent marker as failed_before_effect; it never signs or resends.
    status: async (context, record) => await (await import("../../circle-command-service.js")).executeCircleCommand({ command: "circle.approval.status", operationId: record.id }, context),
    commands: { status: OPERATION_STATUS, resume: OPERATION_STATUS },
    runtimeCommand: async () => "circle.approval.status",
};
//# sourceMappingURL=circle-approval.js.map