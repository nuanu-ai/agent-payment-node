import { ONECLICK_SOURCE_EDGES, OneClickSourceJournal, oneClickRecordLane } from "../../lifi/near-oneclick-source-journal.js";
import { field, readableClaims, requiredRecordPath, salvageEvm, salvageRecord } from "../adapter.js";
import { dataOutcome } from "../../core-outcome.js";
import { evmClaim, pastUnstartedDeadline } from "./family-claims.js";
import { installed, OPERATION_STATUS } from "./family-commands.js";
const STORE = { directory: "oneclick-source", perProfile: false };
/**
 * NEAR 1Click source transfers: the payer signs one transaction on the lane's origin chain, only before the effective
 * deposit deadline, and a sealed transaction is sent only by the command that sealed it. The record ends at its own
 * outcomes, through status: a safe source receipt (`source_observed`), or `failed_proven_superseded` once the payer's
 * finalized nonce is past the source nonce while the node knows neither the transaction nor a receipt.
 *
 * The payer's account is also released when the deposit deadline plus the unstarted margin has passed (phase 4c
 * re-check, kept): (1) every signed source carries one fixed nonce, so it and any later transaction at that nonce cannot
 * both land, and the family's own nonce reservation lets a new 1Click deposit take that nonce only after the deadline
 * and while the node does not know the old hash; (2) the release is what lets a later transaction consume the nonce at
 * all, which is the proof status needs to end the record; until then a late landing is still observed by status as
 * `source_observed` (the quote is dead, so 1Click refunds that deposit to the payer, its refund address).
 */
export const oneClickSourceAdapter = {
    family: "oneclick_source",
    stores: [STORE],
    async load(root, recordPath) { return await new OneClickSourceJournal(root).load(requiredRecordPath(recordPath, STORE).operationId); },
    // The operation ID derives from lane, profile and key, so replay is by ID.
    identity: record => ({ profileHash: record.profileHash, operationId: record.operationId, idempotencyHash: null, requestHash: null }),
    claims: record => readableClaims(() => [evmClaim(oneClickRecordLane(record).origin.chainId, record.payer)]),
    terminal: record => ONECLICK_SOURCE_EDGES[record.phase]?.length === 0 || pastUnstartedDeadline(record.effectiveDeadline),
    state: record => record.phase,
    // A record whose lane cannot be read names no chain; its profile is quarantined instead.
    salvage: raw => salvageRecord(raw, value => [salvageEvm(oneClickRecordLane(value).origin.chainId, field(value, "payer"))]),
    view: async (record) => record,
    // Status observes the source receipt and proves destination delivery; it is the family's only recovery and never sends.
    status: async (context, record) => dataOutcome(await installed(context.oneClickSource, "1Click source runtime is unavailable.")
        .status(record.operationId), "oneclick_source_and_provider_observation_untrusted"),
    commands: { status: OPERATION_STATUS, resume: OPERATION_STATUS },
    runtimeCommand: async () => "oneclick.source.status",
};
//# sourceMappingURL=oneclick.js.map