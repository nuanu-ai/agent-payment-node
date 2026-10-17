import { OneClickSourceJournal, oneClickRecordLane, type OneClickSourceRecord } from "../../lifi/near-oneclick-source-journal.js";
import { field, readableClaims, requiredRecordPath, salvageEvm, salvageRecord, type OperationFamilyAdapter, type OperationStore } from "../adapter.js";
import { dataOutcome } from "../../core-outcome.js";
import { evmClaim, pastUnstartedDeadline } from "./family-claims.js";
import { installed, OPERATION_STATUS } from "./family-commands.js";

const STORE: OperationStore = { directory: "oneclick-source", perProfile: false };
/**
 * NEAR 1Click source transfers: the payer signs one transaction on the lane's origin chain, only before the effective
 * deposit deadline, and a sealed transaction is sent only by the command that sealed it. The payer is held until the
 * source receipt is observed at finality, or until the deposit deadline (plus the unstarted margin) has passed: the
 * quote is then dead (a late deposit is refunded to the payer) and the family's own nonce rule already lets a new
 * operation take the nonce of an ambiguous send, so at most one transaction can use it.
 */
export const oneClickSourceAdapter: OperationFamilyAdapter<OneClickSourceRecord> = {
  family: "oneclick_source",
  stores: [STORE],
  async load(root, recordPath) { return await new OneClickSourceJournal(root).load(requiredRecordPath(recordPath, STORE).operationId); },
  // The operation ID derives from lane, profile and key, so replay is by ID.
  identity: record => ({ profileHash: record.profileHash, operationId: record.operationId, idempotencyHash: null, requestHash: null }),
  claims: record => readableClaims(() => [evmClaim(oneClickRecordLane(record).origin.chainId, record.payer)]),
  terminal: record => record.phase === "source_observed" || pastUnstartedDeadline(record.effectiveDeadline),
  state: record => record.phase,
  // A record whose lane cannot be read names no chain; its profile is quarantined instead.
  salvage: raw => salvageRecord(raw, value => [salvageEvm(oneClickRecordLane(value as OneClickSourceRecord).origin.chainId, field(value, "payer"))]),
  view: async record => record,
  // Status observes the source receipt and proves destination delivery; it is the family's only recovery and never sends.
  status: async (context, record) => dataOutcome(await installed(context.oneClickSource, "1Click source runtime is unavailable.")
    .status(record.operationId), "oneclick_source_and_provider_observation_untrusted"),
  commands: { status: OPERATION_STATUS, resume: OPERATION_STATUS },
  runtimeCommand: async () => "oneclick.source.status",
};
