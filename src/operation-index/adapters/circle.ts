import { circleSourceSettled } from "../../circle-native-admission.js";
import { CIRCLE_V2_TERMINAL_STATES, publicKnownCircle, validateKnownCircle, type CircleKnownOperation } from "../../circle-v2-evm/funding-operation.js";
import { CIRCLE_V1_TERMINAL_STATES } from "../../circle-v2-evm/operation-model.js";
import { CircleRepository } from "../../circle-v2-evm/repository.js";
import { receiptOutcome } from "../../core-outcome.js";
import { ApnError } from "../../errors.js";
import { conflictDomainKey, evmConflictDomain, type MoneyConflictDomain } from "../../operation-conflict-domain.js";
import { domainClaims, field, readableClaims, requiredRecordPath, salvageEvm, salvageHash, salvageRecord, standardIdentity,
  type OperationFamilyAdapter, type OperationStore } from "../adapter.js";
import { profileClaim } from "../types.js";

const STORE: OperationStore = { directory: "circle-v2-evm", perProfile: false };

export function circleDomains(record: CircleKnownOperation): readonly MoneyConflictDomain[] {
  return [evmConflictDomain(42161, record.sourceCustody.walletAddress),
    evmConflictDomain(record.destinationChain, record.destinationCustody.walletAddress)];
}
/** The outcome list of the record's own version, which its validator ties the record's `terminal` flag to. */
export const circleTerminal = (record: Pick<CircleKnownOperation, "schemaVersion" | "state">): boolean =>
  (record.schemaVersion === "apn.circle-v2-evm-operation.v1" ? CIRCLE_V1_TERMINAL_STATES : CIRCLE_V2_TERMINAL_STATES).includes(record.state);
const sourceKey = (record: CircleKnownOperation) => conflictDomainKey(evmConflictDomain(42161, record.sourceCustody.walletAddress));

/**
 * Circle v2 routes and v1 routes, one file per operation; both signing profiles hold the route. A v1 route is read-only
 * (its commands refuse it except status), so a non-terminal one holds its accounts and both profiles until it is closed.
 */
export const circleAdapter: OperationFamilyAdapter<CircleKnownOperation> = {
  family: "circle_route",
  stores: [STORE],
  async load(root, recordPath) {
    return await new CircleRepository(root).loadAny(requiredRecordPath(recordPath, STORE).operationId);
  },
  identity: standardIdentity,
  claims: record => readableClaims(() => [...domainClaims(circleDomains(record)), profileClaim(record.destinationProfileHash)]),
  terminal: circleTerminal,
  state: record => record.state,
  admits(record, wanted, held) {
    if (held.key !== sourceKey(record)) return false;
    // Only another CCTP operation may queue a source nonce after canonical inclusion. Other rails remain conservative.
    if (wanted.tag?.kind === "circle_source_after_burn") return record.source !== null && record.residualAllowanceAtomic === "0" &&
      record.effects.find(effect => effect.role === "burn")?.phase === "confirmed";
    // R8 (OWNR-16): a native Arbitrum move to a local custody wallet does not wait for a source burn that is final.
    return wanted.tag?.kind === "native_beside_settled_circle" && wanted.profileHash !== null &&
      circleSourceSettled(record, wanted.profileHash, wanted.tag.account);
  },
  // The destination profile is a claim of the family itself (above), so an unreadable route keeps it beside its two accounts.
  salvage: raw => salvageRecord(raw, value => [salvageEvm(42161, field(value, "sourceCustody", "walletAddress")),
    salvageEvm(field(value, "destinationChain"), field(value, "destinationCustody", "walletAddress")),
    profileClaim(salvageHash(field(value, "destinationProfileHash")))], ["profileHash", "destinationProfileHash"]),
  view: async record => publicKnownCircle(record),
  async receipt(_context, record) {
    if (!circleTerminal(record)) throw new ApnError("APN_RECEIPT_NOT_FOUND", "Circle finality is pending.",
      { operationId: record.operationId, nextActions: [`apn circle evm observe --operation ${record.operationId}`] });
    return receiptOutcome(publicKnownCircle(validateKnownCircle(record)));
  },
  // The last-resort owner exit (R4 exit 3) of a v2 route a possibly-sent effect keeps open: past expiry, TTY consent, holds charged.
  abandon: async (context, record) => await (await import("../../circle-v2-evm/funding-abandon.js")).abandonCircleFunding(context.state, record.operationId,
    context.requireOperationAbandonApproval(), () => context.clock.now().getTime()),
  // Approval, mint, observation and cleanup are Circle's own foreground and network commands.
  commands: { status: "apn circle evm status --operation <operation-id>", resume: "apn circle evm observe --operation <operation-id>",
    exit: "apn circle evm cleanup --operation <operation-id>" },
};
