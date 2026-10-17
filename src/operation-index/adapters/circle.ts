import { circleSourceSettled } from "../../circle-native-admission.js";
import { publicKnownCircle, validateKnownCircle, type CircleKnownOperation } from "../../circle-v2-evm/funding-operation.js";
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
const sourceKey = (record: CircleKnownOperation) => conflictDomainKey(evmConflictDomain(42161, record.sourceCustody.walletAddress));

/** Circle v2 routes and v1 routes (finish-only), one file per operation; both signing profiles hold the route. */
export const circleAdapter: OperationFamilyAdapter<CircleKnownOperation> = {
  family: "circle_route",
  stores: [STORE],
  async load(root, recordPath) {
    return await new CircleRepository(root).loadAny(requiredRecordPath(recordPath, STORE).operationId);
  },
  identity: standardIdentity,
  claims: record => readableClaims(() => [...domainClaims(circleDomains(record)), profileClaim(record.destinationProfileHash)]),
  terminal: record => record.terminal,
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
    if (!record.terminal) throw new ApnError("APN_RECEIPT_NOT_FOUND", "Circle finality is pending.",
      { operationId: record.operationId, nextActions: [`apn circle evm observe --operation ${record.operationId}`] });
    return receiptOutcome(publicKnownCircle(validateKnownCircle(record)));
  },
  // Approval, mint, observation and cleanup are Circle's own foreground and network commands.
  commands: { status: "apn circle evm status --operation <operation-id>", resume: "apn circle evm observe --operation <operation-id>",
    exit: "apn circle evm cleanup --operation <operation-id>" },
};
