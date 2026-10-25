import { operationOutcome } from "../../core-outcome.js";
import { circleSourceStatus, circleSourceTerminal } from "../../lifi/circle-v2-source-proof.js";
import { NonEvmSourceJournalRepository } from "../../lifi/non-evm-source-journal.js";
import { field, readableClaims, requiredRecordPath, salvageEvm, salvageRecord } from "../adapter.js";
import { evmClaim } from "./family-claims.js";
import { OPERATION_STATUS } from "./family-commands.js";
const STORE = { directory: "non-evm-source-journals", perProfile: true };
/**
 * CCTP V2 Base USDC to Solana source burns. The submit command signs only before its preparation expires, which is at
 * most CIRCLE_V2_SOURCE_TTL_MS after the journal was staged, and sends at most once in that same command. The payer is
 * held for that window plus the unstarted margin in every phase: after it, the burn either landed or its signed quote
 * expired, and no APN path signs or sends it again. `operation status` reads the burn's receipt at the finalized tag
 * once and records it; a recorded receipt ends the claim at once (R4 exit 1: proof). A successful burn's receipt on
 * Solana is read the same way until it is recorded (circle-v2-solana-delivery.ts).
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
    terminal: (record, root) => circleSourceTerminal(root, record),
    state: record => record.phase,
    salvage: raw => salvageRecord(raw, value => [salvageEvm(8453, field(value, "sourceCall", "from"))]),
    view: async (record) => record,
    status: async (context, record, options) => operationOutcome(await circleSourceStatus(context.state.root, record, context.finalizedRead, () => context.clock.now().getTime(), options?.refreshAllowance === true, context.circleSourceDelivery)),
    refreshesAllowance: true,
    // The route has no observation or exit command of its own: the generic status is its observer.
    commands: { status: OPERATION_STATUS },
};
//# sourceMappingURL=circle-source.js.map