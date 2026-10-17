import { CIRCLE_V2_SOURCE_TTL_MS } from "../../lifi/circle-v2-source-service.js";
import { NonEvmSourceJournalRepository } from "../../lifi/non-evm-source-journal.js";
import { field, readableClaims, requiredRecordPath, salvageEvm, salvageRecord } from "../adapter.js";
import { evmClaim, pastUnstartedDeadline } from "./family-claims.js";
import { OPERATION_STATUS } from "./family-commands.js";
const STORE = { directory: "non-evm-source-journals", perProfile: true };
/**
 * CCTP V2 Base USDC to Solana source burns. The submit command signs only before its preparation expires, which is at
 * most CIRCLE_V2_SOURCE_TTL_MS after the journal was staged, and sends at most once in that same command. APN has no
 * observer of the source receipt for this route, so the payer is held for that window plus the unstarted margin in
 * every phase: after it, the burn either landed or its signed quote expired, and no APN path signs or sends it again.
 */
export const circleSourceAdapter = {
    family: "circle_source",
    stores: [STORE],
    async load(root, recordPath) {
        const { profileHash, operationId } = requiredRecordPath(recordPath, STORE);
        return await new NonEvmSourceJournalRepository(root).load(profileHash, operationId);
    },
    identity: record => ({ profileHash: record.profileHash, operationId: record.operationId, idempotencyHash: null, requestHash: null }),
    claims: record => readableClaims(() => [evmClaim(8453, record.sourceCall.from)]),
    terminal: record => pastUnstartedDeadline(Date.parse(record.createdAt) + CIRCLE_V2_SOURCE_TTL_MS),
    state: record => record.phase,
    salvage: raw => salvageRecord(raw, value => [salvageEvm(8453, field(value, "sourceCall", "from"))]),
    view: async (record) => record,
    // The route has no status, observation or exit command of its own: the generic status shows the saved journal.
    commands: { status: OPERATION_STATUS },
};
//# sourceMappingURL=circle-source.js.map